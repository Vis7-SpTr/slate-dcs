// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BLOCK_BEGIN, BLOCK_LOAD, blockState } from './export-block.js';
import { defaultDataDir, Installer } from './installer.js';

const LUA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../dcs/export/Scripts');
const FILES = [
  ['Hooks', 'SLATE-hook.lua'],
  ['SLATE', 'lib', 'bridge.lua'],
  ['SLATE', 'lib', 'json.lua'],
  ['SLATE', 'SLATE-export.lua'],
];
const SPIKE_LINE =
  "local SLATElfs = require('lfs'); dofile(SLATElfs.writedir() .. [[Scripts\\SLATE\\SLATE-spike-export.lua]])";
const OTHERS =
  [
    "local Tacviewlfs=require('lfs');dofile(Tacviewlfs.writedir()..'Scripts/TacviewGameExport.lua')",
    '-- café',
    SPIKE_LINE,
  ].join('\r\n') + '\r\n';
const latin1 = (text: string) => Buffer.from(text, 'latin1');

let root: string;
let folder: string;
let scripts: string;
let backups: string;
let clock: Date;
let installer: Installer;

const exportText = async () => (await readFile(join(scripts, 'Export.lua'))).toString('latin1');
const backupFiles = async () => (await readdir(join(backups, 'DCS')).catch(() => [])).sort();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'slate-inst-'));
  folder = join(root, 'Saved Games', 'DCS');
  scripts = join(folder, 'Scripts');
  backups = join(root, 'data', 'backups');
  await mkdir(folder, { recursive: true });
  clock = new Date(2026, 9, 21, 18, 30, 0);
  installer = new Installer({ luaDir: LUA_DIR, backupDir: backups, now: () => clock });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Installer.bundle', () => {
  it('holds exactly the four Lua files', async () => {
    expect((await installer.bundle()).map((f) => f.parts)).toEqual(FILES);
  });
});

describe('Installer.inspect', () => {
  it('is notInstalled in a fresh folder, also with other tools and the spike', async () => {
    expect(await installer.inspect(folder)).toEqual({ state: 'notInstalled', problems: [] });
    await mkdir(join(scripts, 'SLATE'), { recursive: true });
    await writeFile(join(scripts, 'Export.lua'), latin1(OTHERS));
    await writeFile(join(scripts, 'SLATE', 'SLATE-spike-export.lua'), '-- spike');
    expect(await installer.inspect(folder)).toEqual({ state: 'notInstalled', problems: [] });
  });

  it('is installed after install', async () => {
    await installer.install(folder, 'DCS');
    expect(await installer.inspect(folder)).toEqual({ state: 'installed', problems: [] });
  });

  it('names every problem', async () => {
    await installer.install(folder, 'DCS');
    await writeFile(join(scripts, 'Export.lua'), latin1(OTHERS)); // another tool rewrote it
    await writeFile(join(scripts, 'SLATE', 'lib', 'json.lua'), '-- old');
    await rm(join(scripts, 'Hooks', 'SLATE-hook.lua'));
    expect(await installer.inspect(folder)).toEqual({
      state: 'needsRepair',
      problems: ['blockMissing', 'fileChanged', 'fileMissing'],
    });
    await writeFile(join(scripts, 'Export.lua'), latin1(`${OTHERS}${BLOCK_BEGIN}\r\n`));
    expect((await installer.inspect(folder)).problems).toContain('blockBroken');
  });

  it('accepts the manual block from the README (en dash)', async () => {
    await installer.install(folder, 'DCS');
    const manual = `${OTHERS}\r\n-- SLATE BEGIN â\u0080\u0093 managed by SLATE, do not edit\r\n${BLOCK_LOAD}\r\n-- SLATE END\r\n`;
    await writeFile(join(scripts, 'Export.lua'), latin1(manual));
    expect(await installer.inspect(folder)).toEqual({ state: 'installed', problems: [] });
  });
});

describe('Installer.install', () => {
  it('creates Scripts, the files and a new Export.lua without a backup', async () => {
    await installer.install(folder, 'DCS');
    for (const parts of FILES) {
      expect(await readFile(join(scripts, ...parts))).toEqual(
        await readFile(join(LUA_DIR, ...parts)),
      );
    }
    expect(blockState(await exportText())).toBe('ok');
    expect(await backupFiles()).toEqual([]);
  });

  it('keeps other tools, the spike line and the spike file byte for byte, and backs up first', async () => {
    await mkdir(join(scripts, 'SLATE'), { recursive: true });
    await writeFile(join(scripts, 'Export.lua'), latin1(OTHERS));
    await writeFile(join(scripts, 'SLATE', 'SLATE-spike-export.lua'), '-- spike');
    await installer.install(folder, 'DCS');
    const text = await exportText();
    expect(text.startsWith(OTHERS)).toBe(true);
    expect(text.split(SPIKE_LINE)).toHaveLength(2);
    expect(await readFile(join(scripts, 'SLATE', 'SLATE-spike-export.lua'), 'utf8')).toBe(
      '-- spike',
    );
    expect(await backupFiles()).toEqual(['Export-20261021-183000.lua']);
    expect(
      (await readFile(join(backups, 'DCS', 'Export-20261021-183000.lua'))).toString('latin1'),
    ).toBe(OTHERS);
  });

  it('changes nothing when already installed (no new backup)', async () => {
    await mkdir(scripts, { recursive: true });
    await writeFile(join(scripts, 'Export.lua'), latin1(OTHERS));
    await installer.install(folder, 'DCS');
    const before = await exportText();
    await installer.install(folder, 'DCS');
    expect(await exportText()).toBe(before);
    expect(await backupFiles()).toHaveLength(1);
  });

  it('repairs: puts the block back at the end and restores changed files', async () => {
    await installer.install(folder, 'DCS');
    await writeFile(join(scripts, 'Export.lua'), latin1(`${OTHERS}-- SRS added later\r\n`));
    await writeFile(join(scripts, 'SLATE', 'SLATE-export.lua'), '-- edited');
    await installer.install(folder, 'DCS');
    expect(await installer.inspect(folder)).toEqual({ state: 'installed', problems: [] });
    expect((await exportText()).startsWith(`${OTHERS}-- SRS added later\r\n`)).toBe(true);
  });

  it('keeps the 10 newest backups, also for two changes in the same second', async () => {
    await mkdir(scripts, { recursive: true });
    for (let i = 0; i < 11; i += 1) {
      await writeFile(join(scripts, 'Export.lua'), latin1(`-- version ${String(i)}\r\n`));
      await installer.install(folder, 'DCS');
      if (i % 2 === 1) clock = new Date(clock.getTime() + 60_000);
    }
    const files = await backupFiles();
    expect(files).toHaveLength(10);
    // 11 backups: only the oldest goes, not the one made a moment later in the same second.
    expect(files).toContain('Export-20261021-183500.lua');
    expect(files).toContain('Export-20261021-183000-1.lua');
    expect(files).not.toContain('Export-20261021-183000.lua');
  });

  it('leaves no temporary files behind', async () => {
    await installer.install(folder, 'DCS');
    const all = await readdir(scripts, { recursive: true });
    expect(all.filter((f) => f.endsWith('.slate-tmp'))).toEqual([]);
  });
});

describe('Installer.remove', () => {
  it('takes out the block and SLATE files only; the spike stays', async () => {
    await mkdir(join(scripts, 'SLATE'), { recursive: true });
    await mkdir(join(scripts, 'Hooks'));
    await writeFile(join(scripts, 'Export.lua'), latin1(OTHERS));
    await writeFile(join(scripts, 'SLATE', 'SLATE-spike-export.lua'), '-- spike');
    await writeFile(join(scripts, 'Hooks', 'other-hook.lua'), '');
    await installer.install(folder, 'DCS');
    await writeFile(join(scripts, 'SLATE', 'SLATE-config.lua'), 'return {}');
    clock = new Date(clock.getTime() + 1000);
    await installer.remove(folder, 'DCS');

    expect(await exportText()).toBe(OTHERS);
    expect(await readdir(join(scripts, 'SLATE'))).toEqual(['SLATE-spike-export.lua']);
    expect(await readdir(join(scripts, 'Hooks'))).toEqual(['other-hook.lua']);
    expect(await backupFiles()).toHaveLength(2);
    expect(await installer.inspect(folder)).toEqual({ state: 'notInstalled', problems: [] });
  });

  it('removes its own folders when they are empty, but never Export.lua', async () => {
    await installer.install(folder, 'DCS');
    await installer.remove(folder, 'DCS');
    expect((await readdir(scripts)).sort()).toEqual(['Export.lua', 'Hooks']);
    expect(await exportText()).toBe('');
  });

  it('is harmless in a folder without SLATE', async () => {
    await mkdir(scripts, { recursive: true });
    await writeFile(join(scripts, 'Export.lua'), latin1(OTHERS));
    await installer.remove(folder, 'DCS');
    expect(await exportText()).toBe(OTHERS);
    expect(await backupFiles()).toEqual([]);
  });
});

describe('defaultDataDir', () => {
  it('uses SLATE_DATA_DIR when set', () => {
    expect(defaultDataDir({ SLATE_DATA_DIR: '/data/slate' })).toBe('/data/slate');
  });
});
