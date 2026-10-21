// SPDX-License-Identifier: GPL-3.0-or-later
// Where DCS keeps its user data (architecture.md §1.2): the Windows "Saved
// Games" known folder – read from the registry, so a moved folder (e.g. to
// D:\) is found too – and the DCS* folders inside it.

import { execFile } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** FOLDERID_SavedGames. */
const SAVED_GAMES_ID = '{4C5C32FF-BB9D-43b0-B5B4-2D72E54EAAA4}';
const SHELL_FOLDERS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders',
];

/** Expands `%NAME%` like Windows does; unknown names stay as they are. */
export function expandEnv(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key === undefined ? whole : (env[key] ?? whole);
  });
}

/**
 * The value of `name` in `reg query` output, e.g.
 * `    {4C5C…}    REG_EXPAND_SZ    %USERPROFILE%\Saved Games`.
 */
export function parseRegQuery(output: string, name: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s{2,}|\t+/);
    if (parts[0]?.toLowerCase() === name.toLowerCase() && parts[1]?.startsWith('REG_')) {
      const value = parts.slice(2).join('  ').trim();
      return value === '' ? null : value;
    }
  }
  return null;
}

function regQuery(key: string, name: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', name], { windowsHide: true }, (error, stdout) => {
      resolve(error ? null : parseRegQuery(stdout, name));
    });
  });
}

/**
 * The Saved Games folder. `SLATE_SAVED_GAMES` overrides it (tests, other
 * systems). On Windows: the registry, else `%USERPROFILE%\Saved Games`.
 */
export async function findSavedGames(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const override = env['SLATE_SAVED_GAMES'];
  if (override !== undefined && override !== '') return override;
  if (process.platform !== 'win32') return null;
  for (const key of SHELL_FOLDERS) {
    const value = await regQuery(key, SAVED_GAMES_ID);
    if (value !== null) return expandEnv(value, env);
  }
  const profile = env['USERPROFILE'];
  return profile ? join(profile, 'Saved Games') : null;
}

/** Created by DCS the first time it runs with a user folder (decided 21 Oct 2026). */
const DCS_MARKERS = ['Config', 'Logs'];
/** SLATE's own files: a folder holding them stays listed, so they can be removed. */
const SLATE_MARKERS = [
  ['Scripts', 'SLATE', 'SLATE-export.lua'],
  ['Scripts', 'Hooks', 'SLATE-hook.lua'],
];

const isDir = (path: string) =>
  stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * `true` for a folder DCS has used as its user folder (it has `Config` or
 * `Logs`), or one that holds SLATE's files. Module folders such as `DCS_F14`,
 * `DCS_F4E` or `DCS.C130J` only hold airframe setups and saves – they are
 * skipped.
 */
export async function isDcsUserFolder(path: string): Promise<boolean> {
  for (const name of DCS_MARKERS) if (await isDir(join(path, name))) return true;
  for (const parts of SLATE_MARKERS) if (await exists(join(path, ...parts))) return true;
  return false;
}

/**
 * The DCS user folders in Saved Games: `DCS`, `DCS.openbeta`, and whatever
 * `dcs_variant.txt` named – folders starting with "DCS" that DCS has used
 * (`isDcsUserFolder`). Sorted by name.
 */
export async function listDcsFolders(savedGames: string): Promise<string[]> {
  try {
    const entries = await readdir(savedGames, { withFileTypes: true });
    const candidates = entries.filter((e) => e.isDirectory() && /^DCS/i.test(e.name));
    const used = await Promise.all(
      candidates.map((e) => isDcsUserFolder(join(savedGames, e.name))),
    );
    return candidates
      .filter((_, i) => used[i])
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
