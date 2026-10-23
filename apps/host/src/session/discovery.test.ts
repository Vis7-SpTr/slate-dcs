// SPDX-License-Identifier: GPL-3.0-or-later
// Discovery (P1.7) against a real relay over WSS: the server's chat lines come
// in as `chat` datagrams, the host joins, follows a coalition change, and
// leaves the user in charge when he is in a session already.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BRIDGE_VERSION, defaultSlices, formatAnnouncement } from '@slate-dcs/shared';
import type { BridgeChat } from '@slate-dcs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadRelayFiles } from '../cas-relay/config.js';
import type { RelayFiles } from '../cas-relay/config.js';
import { Relay } from '../cas-relay/relay.js';
import { startRelayServer } from '../cas-relay/server.js';
import type { RelayServer } from '../cas-relay/server.js';
import { StateStore } from '../state/store.js';
import { RelayClient } from './client.js';
import { Discovery } from './discovery.js';
import { TokenStore } from './tokens.js';

const quiet = { info: () => undefined, warn: () => undefined, debug: () => undefined };

let dir: string;
let files: RelayFiles;
let server: RelayServer;
let address: string;
const closers: (() => void)[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slate-discovery-'));
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
  for (const close of closers.splice(0)) close();
  await server.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function host(playerName: string | null = 'VWA | Vis7') {
  const store = new StateStore(defaultSlices('test'));
  store.update({ mission: { ...store.get('mission'), running: true, playerName } });
  const tokens = new TokenStore(join(dir, `relays-${String(closers.length)}.json`));
  const warnings: string[] = [];
  const log = { info: () => undefined, warn: (m: string) => warnings.push(m) };
  const client = new RelayClient({ store, tokens, log, app: 'slate-host test' });
  const discovery = new Discovery({ store, client, log });
  closers.push(
    () => {
      discovery.close();
    },
    () => {
      client.close();
    },
  );
  return { store, client, tokens, discovery, warnings };
}

/** The server's lines for a coalition, split like a short chat line would be. */
function announce(
  h: ReturnType<typeof host>,
  coalition: 'blue' | 'red',
  extra: { server?: boolean; fingerprint?: string; lan?: string | null } = {},
): void {
  const lines = formatAnnouncement(
    {
      protocol: 1,
      relay: address,
      lan: extra.lan === undefined ? '127.0.0.2:1' : extra.lan,
      code: files.codes[coalition],
      fingerprint: extra.fingerprint ?? files.fingerprint,
    },
    80,
  );
  for (const text of lines) {
    const chat: BridgeChat = {
      t: 'chat',
      bv: BRIDGE_VERSION,
      text,
      server: extra.server ?? true,
      from: null,
      serverId: null,
    };
    h.discovery.handleChat(chat);
  }
}

async function until(check: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  expect(check()).toBe(true);
}

describe('discovery (§2)', () => {
  it('joins by itself – LAN first, then public – and follows a coalition change', async () => {
    const h = host();
    announce(h, 'blue');
    expect(h.store.get('session').announced).toMatchObject({
      relay: address,
      lan: '127.0.0.2:1',
      code: files.codes.blue,
      coalition: 'blue',
      fingerprint: files.fingerprint,
    });
    await until(() => h.store.get('session').state === 'joined');
    expect(h.store.get('session')).toMatchObject({
      coalition: 'blue',
      nick: 'VWA | Vis7',
      relay: { address, own: false },
      fingerprintCheck: null,
    });
    // The pin and token are kept under the public address.
    expect(await h.tokens.get(address)).toMatchObject({ fingerprint: files.fingerprint });
    expect(h.client.target).toMatchObject({ source: 'discovery', key: address });

    // Slot change to red: the hook re-announces, the host switches.
    const pid = h.store.get('session').pid;
    announce(h, 'red');
    await until(() => h.store.get('session').coalition === 'red');
    expect(h.store.get('session').pid).toBe(pid);
    expect(h.client.target?.code).toBe(files.codes.red);
    await until(() => h.store.get('session').participants.length === 1);

    // The same slot again: nothing changes.
    announce(h, 'red');
    await new Promise((r) => setTimeout(r, 100));
    expect(h.store.get('session')).toMatchObject({ state: 'joined', coalition: 'red' });
  });

  it('ignores a [SLATE] line a player typed, and one for another protocol', () => {
    const h = host();
    announce(h, 'blue', { server: false });
    expect(h.store.get('session').announced).toBeNull();
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]).toMatch(
      /^Ignored a \[SLATE\] chat line that did not come from the server/,
    );
    h.discovery.handleChat({
      t: 'chat',
      bv: BRIDGE_VERSION,
      server: true,
      from: 1,
      serverId: 1,
      text: `[SLATE] v2 lan ${address} code ${files.codes.blue} fp ${files.fingerprint}`,
    });
    expect(h.store.get('session').announced).toBeNull();
    expect(h.warnings[1]).toMatch(/protocol v2/);
  });

  it('only offers the session when already in one, or without a player name', async () => {
    const manual = host();
    expect(
      await manual.client.join(
        {
          address,
          code: files.codes.group,
          coalition: 'red',
          nick: 'Manual',
          role: 'pilot',
          fingerprint: files.fingerprint,
        },
        null,
      ),
    ).toEqual({ ok: true });
    announce(manual, 'blue');
    await new Promise((r) => setTimeout(r, 150));
    expect(manual.store.get('session')).toMatchObject({ coalition: 'red', nick: 'Manual' });
    expect(manual.store.get('session').announced?.coalition).toBe('blue');

    // The button: joins the announced session instead.
    expect(await manual.discovery.joinAnnounced({ nick: 'Manual', role: 'pilot' })).toEqual({
      ok: true,
    });
    expect(manual.store.get('session')).toMatchObject({ state: 'joined', coalition: 'blue' });

    const nameless = host(null);
    announce(nameless, 'blue');
    await new Promise((r) => setTimeout(r, 150));
    expect(nameless.store.get('session').state).toBe('notJoined');
    expect(nameless.store.get('session').announced).not.toBeNull();
  });

  it("doesn't join back after the user left on purpose", async () => {
    const h = host();
    announce(h, 'blue');
    await until(() => h.store.get('session').state === 'joined');
    await h.client.leave();
    announce(h, 'blue');
    await new Promise((r) => setTimeout(r, 150));
    expect(h.store.get('session').state).toBe('notJoined');
    expect(h.store.get('session').announced).not.toBeNull();
  });

  it("never joins a relay that doesn't show the announced fingerprint", async () => {
    const h = host();
    announce(h, 'blue', { fingerprint: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA', lan: null });
    await until(() => h.store.get('session').error !== null);
    expect(h.store.get('session')).toMatchObject({ state: 'notJoined', fingerprintCheck: null });
    expect(h.store.get('session').error).toMatch(/fingerprint the server announced/);
  });

  it('reports both addresses when neither answers', async () => {
    const h = host();
    expect(await h.discovery.joinAnnounced({ nick: 'x', role: 'pilot' })).toMatchObject({
      ok: false,
      error: { code: 'notPossible' },
    });
    await server.close();
    announce(h, 'blue');
    await until(() => h.store.get('session').error !== null);
    expect(h.store.get('session').error).toMatch(
      /^Can't reach 127\.0\.0\.2:1: .*; 127\.0\.0\.1:\d+: /,
    );
    server = await startRelayServer({
      relay: new Relay({ codes: files.codes, name: 'slate-relay test', log: quiet }),
      port: 0,
      host: '127.0.0.1',
      certPem: files.certPem,
      keyPem: files.keyPem,
    });
  });

  it('follows any sender in test mode (SLATE_DISCOVERY_ANY_SENDER)', async () => {
    const h = host();
    const discovery = new Discovery({
      store: h.store,
      client: h.client,
      log: { info: () => undefined, warn: (m) => h.warnings.push(m) },
      anySender: true,
    });
    closers.push(() => {
      discovery.close();
    });
    h.discovery.close();
    for (const text of formatAnnouncement(
      {
        protocol: 1,
        relay: address,
        lan: null,
        code: files.codes.blue,
        fingerprint: files.fingerprint,
      },
      null,
    )) {
      discovery.handleChat({
        t: 'chat',
        bv: BRIDGE_VERSION,
        text,
        server: false,
        from: 3,
        serverId: 1,
      });
    }
    await until(() => h.store.get('session').state === 'joined');
    expect(h.warnings[0]).toMatch(/not from the server \(from 3, server 1\) – test mode/);
  });

  it('drops the announcement when the mission stops', async () => {
    const h = host(null);
    announce(h, 'blue');
    expect(h.store.get('session').announced).not.toBeNull();
    h.store.update({ mission: { ...h.store.get('mission'), running: false } });
    await Promise.resolve();
    expect(h.store.get('session').announced).toBeNull();
  });
});
