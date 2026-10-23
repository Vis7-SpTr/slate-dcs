// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Installer } from '../dcs-integration/installer.js';
import { cleanupForUninstall, markWipe, WIPE_MARKER } from './cleanup.js';

const LUA_DIR = fileURLToPath(new URL('../../../../dcs/export/Scripts', import.meta.url));

let root: string;
let savedGames: string;
let dataDir: string;
let installer: Installer;
const lines: string[] = [];
const firewallCalls: number[] = [];

const firewall = (has: boolean) => ({
  hasRule: () => Promise.resolve(has),
  removeRuleDetached: (port: number) => {
    firewallCalls.push(port);
  },
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'slate-cleanup-'));
  savedGames = join(root, 'Saved Games');
  dataDir = join(root, 'AppData', 'SLATE');
  await mkdir(join(savedGames, 'DCS', 'Config'), { recursive: true });
  await mkdir(join(savedGames, 'DCS.openbeta', 'Logs'), { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, 'relays.json'), '{}');
  installer = new Installer({ luaDir: LUA_DIR, backupDir: join(dataDir, 'backups') });
  lines.length = 0;
  firewallCalls.length = 0;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const run = (has = false) =>
  cleanupForUninstall({
    dataDir,
    installer,
    findSavedGames: () => Promise.resolve(savedGames),
    firewall: firewall(has),
    ports: [7792, 7792],
    log: (line) => lines.push(line),
  });

describe('uninstall cleanup (P1.9)', () => {
  it("removes SLATE's files and block where installed, and keeps the data folder", async () => {
    const dcs = join(savedGames, 'DCS');
    await mkdir(join(dcs, 'Scripts'), { recursive: true });
    await writeFile(join(dcs, 'Scripts', 'Export.lua'), 'dofile("Tacview.lua")\n', 'latin1');
    await installer.install(dcs, 'DCS');
    expect((await installer.inspect(dcs)).state).toBe('installed');

    const result = await run(true);
    expect(result).toEqual({
      removedFrom: ['DCS'],
      failed: [],
      firewallRule: true,
      wiped: false,
    });
    expect((await installer.inspect(dcs)).state).toBe('notInstalled');
    expect(await readFile(join(dcs, 'Scripts', 'Export.lua'), 'latin1')).toBe(
      'dofile("Tacview.lua")\n',
    );
    expect(firewallCalls).toEqual([7792]);
    expect(await readFile(join(dataDir, 'relays.json'), 'utf8')).toBe('{}');
    expect(lines.at(-1)).toMatch(/Kept SLATE's data folder/);
  });

  it('wipes the data folder after "Uninstall and wipe data"', async () => {
    await markWipe(dataDir);
    expect(await readFile(join(dataDir, WIPE_MARKER), 'utf8')).toContain('Delete');
    const result = await run();
    expect(result).toMatchObject({ removedFrom: [], wiped: true, firewallRule: false });
    await expect(readFile(join(dataDir, 'relays.json'))).rejects.toThrow();
  });

  it('carries on when a folder fails or Saved Games is missing', async () => {
    const dcs = join(savedGames, 'DCS');
    await installer.install(dcs, 'DCS');
    const broken = {
      inspect: installer.inspect.bind(installer),
      remove: () => Promise.reject(new Error('locked')),
    };
    const result = await cleanupForUninstall({
      dataDir,
      installer: broken,
      findSavedGames: () => Promise.resolve(savedGames),
      firewall: firewall(false),
      ports: [7792],
      log: (line) => lines.push(line),
    });
    expect(result.failed).toEqual(['DCS']);
    expect(lines.some((l) => l.includes('locked'))).toBe(true);

    const none = await cleanupForUninstall({
      dataDir,
      installer,
      findSavedGames: () => Promise.resolve(null),
      firewall: firewall(false),
      ports: [7792],
      log: (line) => lines.push(line),
    });
    expect(none.removedFrom).toEqual([]);
  });
});
