// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultSlices } from '@slate-dcs/shared';
import type { Command } from '@slate-dcs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CommandDispatcher } from '../commands/dispatcher.js';
import { createHandlers } from '../commands/handlers.js';
import { StateStore } from '../state/store.js';
import { blockState } from './export-block.js';
import { Installer } from './installer.js';
import { DcsIntegration } from './service.js';

const LUA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../dcs/export/Scripts');

let root: string;
let savedGames: string;
let store: StateStore;
let logs: string[];
let run: (command: Command) => ReturnType<CommandDispatcher['dispatch']>;
let integration: DcsIntegration;
let counter = 0;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'slate-dcs-'));
  savedGames = join(root, 'Saved Games');
  for (const name of ['DCS', 'DCS.openbeta', 'Other Game']) {
    await mkdir(join(savedGames, name, 'Config'), { recursive: true });
  }
  // A module folder (airframe setups only): never listed.
  await mkdir(join(savedGames, 'DCS_F14', 'TARPS'), { recursive: true });
  store = new StateStore(defaultSlices('test'));
  logs = [];
  const log = { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(`WARN ${m}`) };
  integration = new DcsIntegration({
    store,
    installer: new Installer({ luaDir: LUA_DIR, backupDir: join(root, 'backups') }),
    log,
    findSavedGames: () => Promise.resolve(savedGames),
    now: () => 1_000,
  });
  const dispatcher = new CommandDispatcher(createHandlers(store, { dcs: integration }));
  run = (command) =>
    dispatcher.dispatch(`01JABD2K7Q0M3N4P5R6S7T${String(counter++).padStart(4, '0')}`, command);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const folder = (name: string) => store.get('dcs').folders.find((f) => f.name === name);

describe('DcsIntegration', () => {
  it('scans the DCS folders into the dcs slice', async () => {
    await run({ cmd: 'dcs.rescan', args: {} });
    expect(store.get('dcs')).toEqual({
      savedGames,
      scannedAt: 1_000,
      error: null,
      folders: [
        { name: 'DCS', path: join(savedGames, 'DCS'), state: 'notInstalled', problems: [] },
        {
          name: 'DCS.openbeta',
          path: join(savedGames, 'DCS.openbeta'),
          state: 'notInstalled',
          problems: [],
        },
      ],
    });
    expect(logs).toEqual(['DCS folders: DCS notInstalled; DCS.openbeta notInstalled']);
  });

  it('installs, shows a needed repair, repairs and removes', async () => {
    await expect(run({ cmd: 'dcs.install', args: { folder: 'DCS' } })).resolves.toEqual({
      ok: true,
    });
    expect(folder('DCS')?.state).toBe('installed');
    expect(folder('DCS.openbeta')?.state).toBe('notInstalled');

    const exportLua = join(savedGames, 'DCS', 'Scripts', 'Export.lua');
    await writeFile(exportLua, '-- rewritten by another tool\r\n');
    await run({ cmd: 'dcs.rescan', args: {} });
    expect(folder('DCS')).toMatchObject({ state: 'needsRepair', problems: ['blockMissing'] });

    await run({ cmd: 'dcs.repair', args: { folder: 'DCS' } });
    expect(folder('DCS')?.state).toBe('installed');
    expect(blockState(await readFile(exportLua, 'latin1'))).toBe('ok');

    await run({ cmd: 'dcs.remove', args: { folder: 'DCS' } });
    expect(folder('DCS')?.state).toBe('notInstalled');
    expect(await readFile(exportLua, 'latin1')).toBe('-- rewritten by another tool\r\n');
    expect(logs).toContain('DCS folder DCS: remove done, now notInstalled');
  });

  const refused: [string, Command][] = [
    ['an unknown folder', { cmd: 'dcs.install', args: { folder: 'Other Game' } }],
    ['a path instead of a name', { cmd: 'dcs.install', args: { folder: '../DCS' } }],
    ['repair where SLATE is not installed', { cmd: 'dcs.repair', args: { folder: 'DCS' } }],
    ['remove where SLATE is not installed', { cmd: 'dcs.remove', args: { folder: 'DCS' } }],
  ];
  it.each(refused)('refuses %s', async (_why, command) => {
    await expect(run(command)).resolves.toMatchObject({
      ok: false,
      error: { code: 'notPossible' },
    });
  });

  it('runs changes one at a time', async () => {
    const results = await Promise.all([
      integration.run('install', 'DCS'),
      integration.run('install', 'DCS.openbeta'),
      integration.run('remove', 'DCS'),
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
    expect(folder('DCS')?.state).toBe('notInstalled');
    expect(folder('DCS.openbeta')?.state).toBe('installed');
  });

  it('reports a missing Saved Games folder', async () => {
    const lost = new DcsIntegration({
      store,
      installer: new Installer({ luaDir: LUA_DIR, backupDir: join(root, 'backups') }),
      log: { info: () => undefined, warn: (m: string) => logs.push(m) },
      findSavedGames: () => Promise.resolve(null),
    });
    await lost.rescan();
    expect(store.get('dcs')).toMatchObject({
      savedGames: null,
      folders: [],
      error: 'Saved Games folder not found',
    });
    expect(logs).toEqual(['DCS folders: Saved Games folder not found']);
  });
});
