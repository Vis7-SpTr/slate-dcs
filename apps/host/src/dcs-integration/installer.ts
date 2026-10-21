// SPDX-License-Identifier: GPL-3.0-or-later
// Installs, checks, repairs and removes SLATE's Lua files and its Export.lua
// block in one DCS user folder, e.g. Saved Games\DCS (architecture.md §1.2).
//
// Rules:
// - Only `<DCS folder>\Scripts\` is ever written: SLATE's own files and the
//   marked block in Export.lua. The DCS install folder is never touched (C1).
// - Other tools' lines in Export.lua and other files (e.g. the spike-3.2
//   logger, decided 21 Oct 2026: left alone) are never changed.
// - Export.lua is backed up to SLATE's own folder before every change.
// - Every file is written to a temporary name first and then renamed, so a
//   crash can't leave a half-written Export.lua.

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { blockState, removeBlock, withBlock } from './export-block.js';

/** What can be wrong in a folder where SLATE is (partly) installed. */
export type FolderProblem =
  /** SLATE's files are there, but Export.lua doesn't load them. */
  | 'blockMissing'
  /** The block is incomplete, doubled or changed. */
  | 'blockBroken'
  /** One of SLATE's Lua files is missing. */
  | 'fileMissing'
  /** One of SLATE's Lua files differs from this SLATE version (older version, or edited). */
  | 'fileChanged';

export type FolderState = 'notInstalled' | 'installed' | 'needsRepair';

export interface FolderStatus {
  state: FolderState;
  problems: FolderProblem[];
}

/** One Lua file SLATE installs, as a path below `Scripts\`. */
interface BundleFile {
  parts: string[];
  content: Buffer;
  hash: string;
}

/** Written by the app later (port setting, `architecture.md` §1.1 rule 7); removed with SLATE. */
const CONFIG_FILE = ['SLATE', 'SLATE-config.lua'];
/** Folders SLATE created and removes again when they are empty. */
const OWN_DIRS = [['SLATE', 'lib'], ['SLATE']];
/** Backups of Export.lua kept per DCS folder. */
const KEEP_BACKUPS = 10;

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** SLATE's own data folder: `%APPDATA%\SLATE` on Windows, `SLATE_DATA_DIR` to override. */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['SLATE_DATA_DIR'];
  if (override !== undefined && override !== '') return override;
  if (process.platform === 'win32' && env['APPDATA']) return join(env['APPDATA'], 'SLATE');
  return join(homedir(), '.local', 'share', 'slate');
}

async function walk(dir: string, prefix: string[] = []): Promise<string[][]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[][] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory())
      files.push(...(await walk(join(dir, entry.name), [...prefix, entry.name])));
    else if (entry.isFile()) files.push([...prefix, entry.name]);
  }
  return files;
}

async function readOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(path: string, data: Buffer | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.slate-tmp`;
  try {
    await writeFile(temp, data);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

const stamp = (date: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${String(date.getFullYear())}${p(date.getMonth() + 1)}${p(date.getDate())}-` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
};

export interface InstallerOptions {
  /** The `Scripts` folder of the bundled Lua files (`dcs/export/Scripts` in the repo). */
  luaDir: string;
  /** Where Export.lua backups go (`<data dir>\backups`). */
  backupDir: string;
  now?: () => Date;
}

export class Installer {
  readonly #luaDir: string;
  readonly #backupDir: string;
  readonly #now: () => Date;
  #bundle: Promise<BundleFile[]> | null = null;

  constructor(options: InstallerOptions) {
    this.#luaDir = options.luaDir;
    this.#backupDir = options.backupDir;
    this.#now = options.now ?? (() => new Date());
  }

  /** The bundled Lua files, read once. */
  bundle(): Promise<BundleFile[]> {
    this.#bundle ??= (async () => {
      const files = await walk(this.#luaDir);
      if (files.length === 0) throw new Error(`No Lua files in ${this.#luaDir}`);
      return Promise.all(
        files.map(async (parts) => {
          const content = await readFile(join(this.#luaDir, ...parts));
          return { parts, content, hash: sha256(content) };
        }),
      );
    })();
    return this.#bundle;
  }

  async inspect(folder: string): Promise<FolderStatus> {
    const scripts = join(folder, 'Scripts');
    const exportLua = await readOrNull(join(scripts, 'Export.lua'));
    const block = exportLua === null ? 'missing' : blockState(exportLua.toString('latin1'));

    let present = 0;
    const problems = new Set<FolderProblem>();
    for (const file of await this.bundle()) {
      const installed = await readOrNull(this.#target(scripts, file.parts));
      if (installed === null) {
        problems.add('fileMissing');
      } else {
        present += 1;
        if (sha256(installed) !== file.hash) problems.add('fileChanged');
      }
    }

    if (block === 'missing' && present === 0) return { state: 'notInstalled', problems: [] };
    if (block === 'missing') problems.add('blockMissing');
    if (block === 'broken') problems.add('blockBroken');
    return problems.size === 0
      ? { state: 'installed', problems: [] }
      : { state: 'needsRepair', problems: [...problems].sort() };
  }

  /** Installs SLATE into the folder, or repairs it: all files current, exactly one block. */
  async install(folder: string, name: string): Promise<void> {
    const scripts = join(folder, 'Scripts');
    for (const file of await this.bundle()) {
      const target = this.#target(scripts, file.parts);
      const installed = await readOrNull(target);
      if (installed === null || sha256(installed) !== file.hash)
        await atomicWrite(target, file.content);
    }
    const exportPath = join(scripts, 'Export.lua');
    const exportLua = await readOrNull(exportPath);
    const text = exportLua?.toString('latin1') ?? '';
    if (exportLua === null || blockState(text) !== 'ok') {
      if (exportLua !== null) await this.#backup(name, exportLua);
      await atomicWrite(exportPath, Buffer.from(withBlock(text), 'latin1'));
    }
  }

  /** Removes the block and SLATE's own files; everything else stays. */
  async remove(folder: string, name: string): Promise<void> {
    const scripts = join(folder, 'Scripts');
    const exportPath = join(scripts, 'Export.lua');
    const exportLua = await readOrNull(exportPath);
    if (exportLua !== null && blockState(exportLua.toString('latin1')) !== 'missing') {
      await this.#backup(name, exportLua);
      await atomicWrite(
        exportPath,
        Buffer.from(removeBlock(exportLua.toString('latin1')), 'latin1'),
      );
    }
    for (const parts of [...(await this.bundle()).map((f) => f.parts), CONFIG_FILE]) {
      await unlink(this.#target(scripts, parts)).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
    for (const parts of OWN_DIRS) {
      // Only if empty – e.g. the spike logger in Scripts\SLATE\ keeps the folder.
      await rmdir(this.#target(scripts, parts)).catch(() => undefined);
    }
  }

  /** A path below `Scripts\`, refusing anything that would end up outside it. */
  #target(scripts: string, parts: readonly string[]): string {
    const target = resolve(scripts, ...parts);
    const rel = relative(resolve(scripts), target);
    if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`)) {
      throw new Error(`Refusing to write outside ${scripts}: ${target}`);
    }
    return target;
  }

  async #backup(name: string, content: Buffer): Promise<void> {
    const dir = join(this.#backupDir, name);
    await mkdir(dir, { recursive: true });
    const base = `Export-${stamp(this.#now())}`;
    let file = `${base}.lua`;
    for (let n = 1; (await readOrNull(join(dir, file))) !== null; n += 1)
      file = `${base}-${String(n)}.lua`;
    await writeFile(join(dir, file), content);
    // Oldest first; `…-183000.lua` before `…-183000-1.lua` (compared without `.lua`).
    const backups = (await readdir(dir))
      .filter((f) => /^Export-.*\.lua$/.test(f))
      .map((f) => f.slice(0, -'.lua'.length))
      .sort()
      .map((f) => `${f}.lua`);
    for (const old of backups.slice(0, Math.max(0, backups.length - KEEP_BACKUPS))) {
      await unlink(join(dir, old));
    }
  }
}
