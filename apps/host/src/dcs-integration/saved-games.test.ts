// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  expandEnv,
  findSavedGames,
  isDcsUserFolder,
  listDcsFolders,
  parseRegQuery,
} from './saved-games.js';

const ID = '{4C5C32FF-BB9D-43b0-B5B4-2D72E54EAAA4}';

describe('parseRegQuery', () => {
  it('reads the value from reg query output', () => {
    const output = [
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
      `    ${ID}    REG_EXPAND_SZ    %USERPROFILE%\\Saved Games`,
      '',
    ].join('\r\n');
    expect(parseRegQuery(output, ID)).toBe('%USERPROFILE%\\Saved Games');
  });

  it('matches the name case-insensitively and keeps a moved folder', () => {
    const output = `    ${ID.toLowerCase()}    REG_SZ    D:\\Games\\Saved Games\r\n`;
    expect(parseRegQuery(output, ID)).toBe('D:\\Games\\Saved Games');
  });

  it('is null when the value is missing or empty', () => {
    expect(
      parseRegQuery('ERROR: The system was unable to find the specified registry key', ID),
    ).toBeNull();
    expect(parseRegQuery(`    ${ID}    REG_SZ    \r\n`, ID)).toBeNull();
  });
});

describe('expandEnv', () => {
  it('expands %NAME% case-insensitively and keeps unknown names', () => {
    expect(expandEnv('%userprofile%\\Saved Games', { USERPROFILE: 'C:\\Users\\Vis7' })).toBe(
      'C:\\Users\\Vis7\\Saved Games',
    );
    expect(expandEnv('%NOPE%\\x', {})).toBe('%NOPE%\\x');
  });
});

describe('findSavedGames', () => {
  it('uses SLATE_SAVED_GAMES when set', async () => {
    expect(await findSavedGames({ SLATE_SAVED_GAMES: '/tmp/sg' })).toBe('/tmp/sg');
  });

  it.skipIf(process.platform === 'win32')('is null off Windows without the override', async () => {
    expect(await findSavedGames({})).toBeNull();
  });
});

describe('listDcsFolders', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slate-sg-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('lists the DCS* folders DCS has used, sorted, without files or other games', async () => {
    await mkdir(join(dir, 'DCS.openbeta', 'Logs'), { recursive: true });
    await mkdir(join(dir, 'DCS', 'Config'), { recursive: true });
    await mkdir(join(dir, 'dcs_server', 'Config'), { recursive: true });
    await mkdir(join(dir, 'Frontier Developments', 'Config'), { recursive: true });
    await writeFile(join(dir, 'DCS.txt'), '');
    expect(await listDcsFolders(dir)).toEqual(['DCS', 'dcs_server', 'DCS.openbeta']);
  });

  it('skips module folders that only hold airframe setups and saves', async () => {
    await mkdir(join(dir, 'DCS', 'Config'), { recursive: true });
    await mkdir(join(dir, 'DCS_F14', 'TARPS'), { recursive: true });
    await mkdir(join(dir, 'DCS_F4E', 'jester'), { recursive: true });
    await mkdir(join(dir, 'DCS.C130J'));
    // A file named Config is not the folder DCS creates.
    await writeFile(join(dir, 'DCS.C130J', 'Config'), '');
    expect(await listDcsFolders(dir)).toEqual(['DCS']);
  });

  it('keeps a folder that holds SLATE files, so they can be removed', async () => {
    await mkdir(join(dir, 'DCS_F14', 'Scripts', 'Hooks'), { recursive: true });
    await writeFile(join(dir, 'DCS_F14', 'Scripts', 'Hooks', 'SLATE-hook.lua'), '');
    expect(await listDcsFolders(dir)).toEqual(['DCS_F14']);
    expect(await isDcsUserFolder(join(dir, 'DCS_F14'))).toBe(true);
  });

  it('is empty when Saved Games does not exist', async () => {
    expect(await listDcsFolders(join(dir, 'missing'))).toEqual([]);
  });
});
