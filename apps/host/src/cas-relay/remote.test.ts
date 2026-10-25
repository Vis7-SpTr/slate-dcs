// SPDX-License-Identifier: GPL-3.0-or-later
// Remote relay (announce only): the DCS server PC announces a relay hosted
// somewhere else and listens on nothing itself.

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AnnouncementReader } from '@slate-dcs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ANNOUNCE_FILE, AUTOSTART_FILE, SERVER_HOOK } from './announce.js';
import { loadRelayFiles } from './config.js';
import type { RelayFiles } from './config.js';
import { Relay } from './relay.js';
import { announceRemote, checkRemoteRelay, remoteRelayBlock } from './remote.js';
import type { RemoteRelay } from './remote.js';
import { startRelayServer } from './server.js';
import type { RelayServer } from './server.js';

const quiet = { info: () => undefined, warn: () => undefined, debug: () => undefined };

let dir: string;
let pi: RelayFiles;
let server: RelayServer;
let dcsServer: string;
let hookFile: string;
const logs: string[] = [];
const log = {
  info: (m: string) => logs.push(`info ${m}`),
  warn: (m: string) => logs.push(`warn ${m}`),
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slate-remote-'));
  // The "Pi": a real relay with its own files.
  pi = await loadRelayFiles(join(dir, 'pi'));
  server = await startRelayServer({
    relay: new Relay({ codes: pi.codes, name: 'slate-relay pi', log: quiet }),
    port: 0,
    host: '127.0.0.1',
    certPem: pi.certPem,
    keyPem: pi.keyPem,
  });
  dcsServer = join(dir, 'DCS.server');
  await mkdir(dcsServer);
  hookFile = join(dir, 'SLATE-server-hook.lua');
  await writeFile(hookFile, '-- hook v1\n');
  logs.length = 0;
});

afterEach(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const remote = (extra: Partial<RemoteRelay> = {}): RemoteRelay => ({
  address: `127.0.0.1:${String(server.port)}`,
  codes: { blue: pi.codes.blue, red: pi.codes.red },
  fingerprint: pi.fingerprint,
  ...extra,
});

/** The server PC's relay.json with the pasted block. */
async function serverPc(block: string, extra: Record<string, unknown> = {}): Promise<RelayFiles> {
  const folder = join(dir, 'server-pc');
  const own = await loadRelayFiles(folder);
  const config = JSON.parse(await readFile(join(folder, 'relay.json'), 'utf8')) as object;
  const pasted = JSON.parse(`{${block}}`) as object;
  await writeFile(
    join(folder, 'relay.json'),
    JSON.stringify({ ...config, ...pasted, dcsServerFolder: dcsServer, ...extra }),
  );
  expect(own.remoteRelay).toBeNull();
  return loadRelayFiles(folder);
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe('--print-remote', () => {
  it('prints the block the server PC pastes into relay.json', async () => {
    expect(() => remoteRelayBlock(pi)).toThrow(/publicAddress/);
    const block = remoteRelayBlock({ ...pi, publicAddress: '203.0.113.7' });
    const files = await serverPc(block);
    expect(files.remoteRelay).toEqual({
      address: '203.0.113.7:7790',
      codes: { blue: pi.codes.blue, red: pi.codes.red },
      fingerprint: pi.fingerprint,
    });
    // The group code is never handed out with it.
    expect(block).not.toContain(pi.codes.group);
  });

  it('refuses a broken block', async () => {
    await expect(
      serverPc(
        '"remoteRelay": { "address": "pi.example.org", "codes": { "blue": "x", "red": "y" }, "fingerprint": "AAAA" }',
      ),
    ).rejects.toThrow(/session code/);
  });
});

describe('checkRemoteRelay', () => {
  it('passes when the fingerprint matches and the relay says welcome', async () => {
    expect(await checkRemoteRelay(remote(), 'slate-relay test')).toEqual({
      ok: true,
      relay: 'slate-relay pi',
    });
  });

  it('reports another fingerprint, and a relay it cannot reach', async () => {
    const other = 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA';
    expect(await checkRemoteRelay(remote({ fingerprint: other }), 'test')).toMatchObject({
      ok: false,
      reachable: true,
      fingerprint: pi.fingerprint,
    });
    const port = server.port;
    await server.close();
    expect(
      await checkRemoteRelay(remote({ address: `127.0.0.1:${String(port)}` }), 'test', 2000),
    ).toMatchObject({ ok: false, reachable: false });
    server = await startRelayServer({
      relay: new Relay({ codes: pi.codes, name: 'slate-relay pi', log: quiet }),
      port: 0,
      host: '127.0.0.1',
      certPem: pi.certPem,
      keyPem: pi.keyPem,
    });
  });
});

describe('announce only', () => {
  it('installs the hook and announces the remote relay – no autostart, no LAN address', async () => {
    const files = await serverPc(
      remoteRelayBlock({ ...pi, publicAddress: '127.0.0.1', port: server.port }),
    );
    const scripts = join(dcsServer, 'Scripts');
    // Left over from a relay that ran on this PC before.
    await mkdir(join(scripts, 'SLATE'), { recursive: true });
    await writeFile(join(scripts, ...AUTOSTART_FILE), 'return {}\n');

    expect(
      await announceRemote({
        files,
        remote: files.remoteRelay ?? remote(),
        hookFile,
        app: 'test',
        log,
      }),
    ).toBe(true);
    expect(await readFile(join(scripts, ...SERVER_HOOK), 'utf8')).toBe('-- hook v1\n');
    expect(await exists(join(scripts, ...AUTOSTART_FILE))).toBe(false);

    const announce = await readFile(join(scripts, ...ANNOUNCE_FILE), 'utf8');
    const blue = [...announce.matchAll(/'(\[SLATE\][^']*)'/g)].map((m) => m[1] ?? '');
    const reader = new AnnouncementReader();
    const parsed = blue.map((line) => reader.feed(line, 0)).find((a) => a !== null);
    expect(parsed).toMatchObject({
      relay: `127.0.0.1:${String(server.port)}`,
      lan: null,
      code: pi.codes.blue,
      fingerprint: pi.fingerprint,
    });
    expect(announce).toContain(pi.codes.red);
    expect(announce).not.toContain(files.codes.blue); // not the server PC's own codes
    expect(logs.join('\n')).toMatch(/answers \(slate-relay pi\), fingerprint matches/);
  });

  it("doesn't announce a relay with another fingerprint", async () => {
    const files = await serverPc(
      remoteRelayBlock({ ...pi, publicAddress: '127.0.0.1', port: server.port }),
    );
    const wrong = { ...remote(), fingerprint: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA' };
    expect(await announceRemote({ files, remote: wrong, hookFile, app: 'test', log })).toBe(false);
    expect(await exists(join(dcsServer, 'Scripts', ...ANNOUNCE_FILE))).toBe(false);
    expect(logs.join('\n')).toMatch(/not announced/);
  });

  it('announces a relay that is off right now, with a warning', async () => {
    const files = await serverPc(
      remoteRelayBlock({ ...pi, publicAddress: '127.0.0.1', port: server.port }),
    );
    const offline = async () =>
      Promise.resolve({
        ok: false as const,
        reachable: false,
        fingerprint: null,
        error: "Can't reach it",
      });
    expect(
      await announceRemote({ files, remote: remote(), hookFile, app: 'test', log, check: offline }),
    ).toBe(true);
    expect(await exists(join(dcsServer, 'Scripts', ...ANNOUNCE_FILE))).toBe(true);
    expect(logs.join('\n')).toMatch(/warn Remote relay: Can't reach it – announcing it anyway/);
  });

  it('needs dcsServerFolder', async () => {
    const files = await serverPc(remoteRelayBlock({ ...pi, publicAddress: '127.0.0.1' }), {
      dcsServerFolder: null,
    });
    expect(await announceRemote({ files, remote: remote(), hookFile, app: 'test', log })).toBe(
      false,
    );
    expect(logs.join('\n')).toMatch(/set dcsServerFolder/);
  });
});
