// SPDX-License-Identifier: GPL-3.0-or-later
// The host's relay client against a real relay: over WSS with the pinned
// fingerprint, and in host mode over the direct link.

import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultSlices } from '@slate-dcs/shared';
import type { Command, StatusBody } from '@slate-dcs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadRelayFiles } from '../cas-relay/config.js';
import type { RelayFiles } from '../cas-relay/config.js';
import { Relay } from '../cas-relay/relay.js';
import { startRelayServer } from '../cas-relay/server.js';
import type { RelayServer } from '../cas-relay/server.js';
import { StateStore } from '../state/store.js';
import { RelayClient } from './client.js';
import { HostMode } from './host-mode.js';
import { TokenStore } from './tokens.js';

const quiet = { info: () => undefined, warn: () => undefined, debug: () => undefined };

let dir: string;
let files: RelayFiles;
let server: RelayServer;
let address: string;
const clients: RelayClient[] = [];

interface Host {
  store: StateStore;
  client: RelayClient;
  tokens: TokenStore;
}

function host(name: string): Host {
  const store = new StateStore(defaultSlices('test'));
  const tokens = new TokenStore(join(dir, `${name}-relays.json`));
  const client = new RelayClient({ store, tokens, log: quiet, app: `slate-host ${name}` });
  clients.push(client);
  return { store, client, tokens };
}

type JoinArgs = Extract<Command, { cmd: 'session.join' }>['args'];
const joinArgs = (nick: string, extra: Partial<JoinArgs> = {}): JoinArgs => ({
  address,
  code: files.codes.blue,
  coalition: null,
  nick,
  role: 'pilot',
  ...extra,
});

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  expect(check()).toBe(true);
}

const status: StatusBody = {
  pos: { lat: 42.17, lon: 41.68, altMsl: 3000, altAgl: 2800 },
  hdg: 90,
  hdgMag: 84,
  gs: 180,
  ias: 160,
  fuel: { internalKg: 2900, externalKg: 0, source: 'export' },
  armament: null,
  avail: { pos: true, fuel: true, payload: false },
  reason: 'heartbeat',
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slate-client-'));
  files = await loadRelayFiles(join(dir, 'relay'));
  server = await startRelayServer({
    relay: new Relay({ codes: files.codes, name: 'slate-relay test', log: quiet }),
    port: 0,
    host: '127.0.0.1',
    certPem: files.certPem,
    keyPem: files.keyPem,
  });
  address = `127.0.0.1:${String(server.port)}`;
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

/** Joins after confirming the fingerprint, as the user would. */
async function joinConfirmed(h: Host, nick: string, extra: Partial<JoinArgs> = {}) {
  const outcome = await h.client.join(
    joinArgs(nick, { fingerprint: files.fingerprint, ...extra }),
    null,
  );
  expect(outcome).toEqual({ ok: true });
}

describe('joining over WSS (§3.1, §4)', () => {
  it('asks to confirm an unknown relay, then joins and remembers it', async () => {
    const a = host('a');
    const first = await a.client.join(joinArgs('Alpha'), null);
    expect(first).toMatchObject({ ok: false, error: { code: 'notPossible' } });
    expect(a.store.get('session')).toMatchObject({
      state: 'confirmFingerprint',
      fingerprintCheck: { address, fingerprint: files.fingerprint, known: null },
    });

    await joinConfirmed(a, 'Alpha');
    expect(a.store.get('session')).toMatchObject({
      state: 'joined',
      coalition: 'blue',
      nick: 'Alpha',
      role: 'pilot',
      fingerprintCheck: null,
      relay: { address, name: 'slate-relay test', own: false },
    });
    expect(a.store.get('host').relay.state).toBe('connected');
    expect(await a.tokens.get(address)).toMatchObject({ fingerprint: files.fingerprint });

    // Known relay: no fingerprint needed any more; the token brings the same pid back.
    const pid = a.store.get('session').pid;
    await a.client.leave();
    expect(a.store.get('session').state).toBe('notJoined');
    expect(await a.client.join(joinArgs('Alpha'), null)).toEqual({ ok: true });
    expect(a.store.get('session').pid).toBe(pid);
  });

  it('warns loudly when a known relay shows another certificate', async () => {
    const a = host('a');
    await a.tokens.set(address, { fingerprint: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA', token: null });
    const outcome = await a.client.join(joinArgs('Alpha'), null);
    expect(outcome).toMatchObject({ ok: false, error: { text: 'The relay fingerprint changed' } });
    expect(a.store.get('session')).toMatchObject({
      state: 'confirmFingerprint',
      fingerprintCheck: {
        fingerprint: files.fingerprint,
        known: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA',
      },
    });
    expect(a.store.get('session').error).toMatch(/CHANGED/);
  });

  it('reports a wrong code and an unreachable relay', async () => {
    const a = host('a');
    const bad = await a.client.join(
      joinArgs('Alpha', { code: 'BLUE-00000000', fingerprint: files.fingerprint }),
      null,
    );
    expect(bad).toMatchObject({
      ok: false,
      error: { code: 'relayError', text: 'Unknown session code' },
    });
    expect(a.store.get('session')).toMatchObject({
      state: 'notJoined',
      error: 'Unknown session code',
    });
    const gone = await a.client.join(joinArgs('Alpha', { address: '127.0.0.1:1' }), null);
    expect(gone).toMatchObject({ ok: false, error: { code: 'relayError' } });
  });
});

describe('two hosts in a flight (P1.6 done when)', () => {
  it('see each other in the session and the flight, with full status inside the flight', async () => {
    const a = host('a');
    const b = host('b');
    await joinConfirmed(a, 'Alpha');
    await joinConfirmed(b, 'Bravo');
    await until(() => a.store.get('session').participants.length === 2);

    expect(
      await a.client.flight({ cmd: 'flight.create', args: { name: 'Enfield', open: true } }),
    ).toEqual({ ok: true });
    await until(() => b.store.get('flight').open.length === 1);
    const flightId = b.store.get('flight').open[0]?.flightId ?? '';
    expect(await b.client.flight({ cmd: 'flight.join', args: { flightId } })).toEqual({ ok: true });
    await until(() => a.store.get('flight').own?.members.length === 2);
    expect(b.store.get('flight').own?.members.map((m) => m.pos)).toEqual([1, 2]);
    expect(b.store.get('flight').open).toEqual([]);

    // A's status package reaches B in full (flight) and as traffic.
    a.store.update({ ownship: { ...a.store.get('ownship'), status } });
    a.client.tick();
    await until(() => b.store.get('flight').status.length === 1);
    expect(b.store.get('flight').status[0]?.status.fuel?.internalKg).toBe(2900);
    expect(b.store.get('traffic').aircraft[0]).toMatchObject({ callsign: 'Enfield 1-1' });

    // Relay errors come back as command results.
    const c = host('c');
    await joinConfirmed(c, 'Charlie');
    expect(
      await c.client.flight({ cmd: 'flight.join', args: { flightId: 'f_nope00' } }),
    ).toMatchObject({
      ok: false,
      error: { code: 'relayError', text: 'No such flight' },
    });

    // Leaving: the others see it.
    await b.client.leave();
    await until(() => a.store.get('flight').own?.members.length === 1);
    expect(b.store.get('flight').own).toBeNull();
  });

  it('sends a slot change as session.update; a JTAC slot leaves the flight', async () => {
    const a = host('a');
    const b = host('b');
    await joinConfirmed(a, 'Alpha');
    await joinConfirmed(b, 'Bravo');
    await a.client.flight({ cmd: 'flight.create', args: { name: 'Enfield', open: true } });
    a.store.update({
      ownship: {
        ...a.store.get('ownship'),
        aircraft: { type: 'AH-64D_BLK_II', unit: 'Pontiac 1-1' },
      },
    });
    a.client.tick();
    await until(
      () =>
        b.store.get('session').participants.find((p) => p.nick === 'Alpha')?.aircraft?.type ===
        'AH-64D_BLK_II',
    );
    a.store.update({
      ownship: { ...a.store.get('ownship'), aircraft: { type: 'forward_observer' } },
    });
    a.client.tick();
    await until(() => a.store.get('flight').own === null);
    expect(a.store.get('session').role).toBe('jtac');
  });
});

describe('host mode', () => {
  it('runs a relay the own host joins directly and others join over WSS', async () => {
    const port = await freePort();
    const store = new StateStore(defaultSlices('test'));
    const hostMode = new HostMode({
      store,
      dataDir: join(dir, 'hostmode'),
      name: 'slate-host test (host mode)',
      log: quiet,
      port,
      bind: '127.0.0.1',
    });
    expect(await hostMode.start()).toEqual({ ok: true });
    try {
      const relayHost = store.get('host').relayHost;
      expect(relayHost).toMatchObject({ state: 'on', port });
      const codes = relayHost.codes;
      const fp = relayHost.fingerprint;
      if (!codes || !fp) throw new Error('no codes');

      // The own host: "localhost" on the host-mode port is the direct link.
      expect(hostMode.relayFor(`localhost:${String(server.port)}`)).toBeNull();
      const local = hostMode.relayFor(`localhost:${String(port)}`);
      expect(local).not.toBeNull();
      const a = host('a');
      const own = {
        address: `localhost:${String(port)}`,
        code: codes.blue,
        coalition: null,
        nick: 'Alpha',
        role: 'pilot',
      };
      expect(await a.client.join(own, local)).toEqual({ ok: true });
      expect(a.store.get('session').relay).toMatchObject({ own: true });
      expect(a.client.onOwnRelay).toBe(true);

      // Another host over WSS with the group code.
      const b = host('b');
      const other = {
        address: `127.0.0.1:${String(port)}`,
        code: codes.group,
        coalition: 'blue' as const,
        nick: 'Bravo',
        role: 'pilot',
        fingerprint: fp,
      };
      expect(await b.client.join(other, null)).toEqual({ ok: true });
      await until(() => a.store.get('session').participants.length === 2);

      // The relay restarts (host mode off/on): B rejoins by itself – as a new
      // participant, since the relay keeps its state in memory only.
      await hostMode.stop();
      await until(() => b.store.get('session').state === 'reconnecting');
      expect(await hostMode.start()).toEqual({ ok: true });
      await until(() => b.store.get('session').state === 'joined', 5000);
    } finally {
      await hostMode.stop();
    }
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}
