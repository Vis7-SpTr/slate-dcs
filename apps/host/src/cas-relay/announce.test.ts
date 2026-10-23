// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AnnouncementReader } from '@slate-dcs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  announceFileText,
  announcementLines,
  autostartFileText,
  installServerHook,
  startDiscovery,
  withPort,
} from './announce.js';

const FP = 'NZ5N-SEHR-0N1A-CA2G-QN0B-WFQE-30';
const codes = { blue: 'BLUE-7K3Q9XPM', red: 'RED-4H8W2NCD', group: 'SLATE-9F6T3RJB' };

let dir: string;
let server: string;
let hookFile: string;
const logs: string[] = [];
const log = {
  info: (m: string) => logs.push(`info ${m}`),
  warn: (m: string) => logs.push(`warn ${m}`),
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slate-announce-'));
  server = join(dir, 'DCS.server');
  await mkdir(server);
  hookFile = join(dir, 'SLATE-server-hook.lua');
  await writeFile(hookFile, '-- hook v1\n');
  logs.length = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const files = (extra: Partial<Parameters<typeof startDiscovery>[0]['files']> = {}) => ({
  codes,
  fingerprint: FP,
  publicAddress: 'slate-grp.dyndns.org',
  dcsServerFolder: server,
  lanAddress: null,
  announceMaxLength: null,
  autoStartWithDcs: true,
  ...extra,
});

describe('the announcement (§2)', () => {
  it('has one set of lines per coalition, each with its own code', () => {
    const lines = announcementLines({
      codes,
      fingerprint: FP,
      publicAddress: 'slate-grp.dyndns.org:7790',
      lanAddress: '192.168.1.20:7790',
      maxLength: null,
    });
    expect(lines).toEqual({
      blue: [
        `[SLATE] v1 relay slate-grp.dyndns.org:7790 lan 192.168.1.20:7790 code BLUE-7K3Q9XPM fp ${FP}`,
      ],
      red: [
        `[SLATE] v1 relay slate-grp.dyndns.org:7790 lan 192.168.1.20:7790 code RED-4H8W2NCD fp ${FP}`,
      ],
    });
    expect(new AnnouncementReader().feed(lines.red[0] ?? '', 0)?.code).toBe(codes.red);
    // The group code is never announced – the coalition comes from the code.
    expect(JSON.stringify(lines)).not.toContain('SLATE-9F6T3RJB');
  });

  it('writes a Lua file that only returns the lines, or none', () => {
    expect(announceFileText({ blue: ["[SLATE] a'b"], red: [] })).toContain(
      "blue = {\n    '[SLATE] a\\'b',\n  },\n  red = {},",
    );
    expect(announceFileText(null)).toContain('blue = {},\n  red = {},');
    expect(() => announceFileText({ blue: ['[SLATE] ü'], red: [] })).toThrow(/ASCII/);
  });

  it('adds the relay port to an address without one', () => {
    expect(withPort('slate-grp.dyndns.org', 7790)).toBe('slate-grp.dyndns.org:7790');
    expect(withPort('slate-grp.dyndns.org:443', 7790)).toBe('slate-grp.dyndns.org:443');
  });
});

describe('installing into the DCS server folder', () => {
  const announce = () => readFile(join(server, 'Scripts', 'SLATE', 'SLATE-announce.lua'), 'utf8');

  it('copies the hook once and writes the announcement at every start', async () => {
    const lines = { blue: ['[SLATE] v1 code BLUE-7K3Q9XPM'], red: [] };
    const first = await installServerHook(server, hookFile, lines);
    expect(first.hookUpdated).toBe(true);
    expect(await readFile(join(server, 'Scripts', 'Hooks', 'SLATE-server-hook.lua'), 'utf8')).toBe(
      '-- hook v1\n',
    );
    expect(await announce()).toContain('BLUE-7K3Q9XPM');
    expect((await installServerHook(server, hookFile, lines)).hookUpdated).toBe(false);
    await writeFile(hookFile, '-- hook v2\n');
    expect((await installServerHook(server, hookFile, lines)).hookUpdated).toBe(true);
  });

  it("doesn't create a folder that isn't there", async () => {
    await expect(
      installServerHook(join(dir, 'DCS.typo'), hookFile, { blue: [], red: [] }),
    ).rejects.toThrow(/DCS server folder not found/);
  });

  it('starts with the LAN address and public address, and empties the lines on stop', async () => {
    const stop = await startDiscovery({
      files: files(),
      port: 7790,
      lan: ['192.168.1.20:7790'],
      hookFile,
      launch: null,
      log,
    });
    expect(stop).not.toBeNull();
    expect(await announce()).toContain(
      `'[SLATE] v1 relay slate-grp.dyndns.org:7790 lan 192.168.1.20:7790 code BLUE-7K3Q9XPM fp ${FP}'`,
    );
    expect(logs.some((l) => l.includes('restart the DCS server once'))).toBe(true);
    await stop?.();
    expect(await announce()).toContain('blue = {},');
  });

  it('warns about several LAN addresses and takes lanAddress from relay.json', async () => {
    await startDiscovery({
      files: files(),
      port: 7790,
      lan: ['192.168.1.20:7790', '172.20.0.1:7790'],
      hookFile,
      launch: null,
      log,
    });
    expect(logs.some((l) => l.startsWith('warn') && l.includes('several LAN addresses'))).toBe(
      true,
    );
    logs.length = 0;
    await startDiscovery({
      files: files({ lanAddress: '192.168.1.30' }),
      port: 7790,
      lan: ['192.168.1.20:7790', '172.20.0.1:7790'],
      hookFile,
      launch: null,
      log,
    });
    expect(logs.some((l) => l.startsWith('warn'))).toBe(false);
    expect(await announce()).toContain('lan 192.168.1.30:7790');
  });

  it('is off without a folder, and only warns when it fails', async () => {
    expect(
      await startDiscovery({
        files: files({ dcsServerFolder: null }),
        port: 7790,
        lan: [],
        hookFile,
        launch: null,
        log,
      }),
    ).toBeNull();
    expect(
      await startDiscovery({
        files: files({ publicAddress: null }),
        port: 7790,
        lan: [],
        hookFile,
        launch: null,
        log,
      }),
    ).toBeNull();
    expect(
      await startDiscovery({
        files: files({ dcsServerFolder: join(dir, 'nope') }),
        port: 7790,
        lan: ['192.168.1.20:7790'],
        hookFile,
        launch: null,
        log,
      }),
    ).toBeNull();
    expect(logs.filter((l) => l.startsWith('warn'))).toHaveLength(2);
  });

  it('tells the hook how to start the packaged relay (autostart)', async () => {
    const autostart = () => readFile(join(server, 'Scripts', 'SLATE', 'SLATE-relay.lua'), 'utf8');
    const launch = {
      exe: 'C:\\SLATE\\relay\\slate-relay.exe',
      args: ['--data', 'C:\\SLATE\\relay\\data'],
    };
    await startDiscovery({
      files: files(),
      port: 7790,
      lan: ['192.168.1.20:7790'],
      hookFile,
      launch,
      log,
    });
    expect(await autostart()).toContain("exe = 'C:\\\\SLATE\\\\relay\\\\slate-relay.exe',");
    expect(await autostart()).toContain("args = { '--data', 'C:\\\\SLATE\\\\relay\\\\data' },");
    expect(await autostart()).toContain('port = 7790,');
    expect(logs.some((l) => l.includes('the DCS server starts this relay'))).toBe(true);

    // Off in relay.json, or not packaged: the file goes away.
    await startDiscovery({
      files: files({ autoStartWithDcs: false }),
      port: 7790,
      lan: ['192.168.1.20:7790'],
      hookFile,
      launch,
      log,
    });
    await expect(autostart()).rejects.toThrow();

    // A path DCS can't pass on: no autostart, with a warning.
    logs.length = 0;
    await startDiscovery({
      files: files(),
      port: 7790,
      lan: ['192.168.1.20:7790'],
      hookFile,
      launch: { exe: 'C:\\Users\\Jürgen\\slate-relay.exe', args: [] },
      log,
    });
    await expect(autostart()).rejects.toThrow();
    expect(logs.some((l) => l.startsWith('warn Autostart: off'))).toBe(true);
    expect(() => autostartFileText({ exe: 'a"b', args: [], port: 1 })).toThrow(/quotes/);
  });
});
