// SPDX-License-Identifier: GPL-3.0-or-later
// The CAS log on disk (protocol.md §12.1, D7) – the one exception to the
// relay keeping its state in memory only. Every entry is appended to one JSONL
// file per coalition session and relay run in <data>/cas-log/, so the log
// survives a restart:
//
//   cas-log-2026-10-26T19-30-00Z-blue.jsonl
//
// Files are kept `logRetentionDays` (relay.json, default 30) after their last
// entry. `slate-relay --export-log` turns each file into a Markdown timeline
// and a CSV file next to it. `log.request` serves only the running relay's
// sessions, from memory (cas-log.ts).

import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { casLogCsv, casLogMarkdown, LogEntry } from '@slate-dcs/shared';
import type { Coalition } from '@slate-dcs/shared';

import type { CasLogSink, RelayLog } from './core.js';

/** The log's folder inside the relay's data folder. */
export const CAS_LOG_FOLDER = 'cas-log';

const FILE = /^cas-log-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)-(blue|red)\.(jsonl|md|csv)$/;

/** `cas-log-2026-10-26T19-30-00Z-blue.jsonl` for a relay run started at `startedAt`. */
export function casLogFileName(startedAt: number, session: Coalition): string {
  const stamp = new Date(startedAt).toISOString().slice(0, 19).replace(/:/g, '-');
  return `cas-log-${stamp}Z-${session}.jsonl`;
}

/** Appends entries to this run's files, one per session, opened on the first entry. */
export class CasLogFiles implements CasLogSink {
  readonly #dir: string;
  readonly #startedAt: number;
  readonly #log: RelayLog | undefined;
  readonly #streams = new Map<Coalition, WriteStream>();
  #failed = false;

  private constructor(dir: string, startedAt: number, log: RelayLog | undefined) {
    this.#dir = dir;
    this.#startedAt = startedAt;
    this.#log = log;
  }

  /** The folder is made here, so appending never waits for it. */
  static async open(dir: string, startedAt: number, log?: RelayLog): Promise<CasLogFiles> {
    await mkdir(dir, { recursive: true });
    return new CasLogFiles(dir, startedAt, log);
  }

  append(session: Coalition, entry: LogEntry): void {
    if (this.#failed) return;
    let stream = this.#streams.get(session);
    if (!stream) {
      const path = join(this.#dir, casLogFileName(this.#startedAt, session));
      stream = createWriteStream(path, { flags: 'a', mode: 0o600 });
      // A full disk mustn't stop the relay: the log stays in memory for log.request.
      stream.on('error', (error) => {
        if (!this.#failed) this.#log?.warn(`CAS log: can't write ${path}: ${error.message}`);
        this.#failed = true;
      });
      this.#streams.set(session, stream);
    }
    stream.write(`${JSON.stringify(entry)}\n`);
  }

  /** Writes what is still buffered and closes the files. */
  async close(): Promise<void> {
    const streams = [...this.#streams.values()];
    this.#streams.clear();
    await Promise.all(
      streams.map(
        (stream) =>
          new Promise<void>((resolve) => {
            stream.end(() => {
              resolve();
            });
          }),
      ),
    );
  }
}

/** Deletes log files (and their exports) whose last change is older than `days`. Returns their names. */
export async function pruneCasLogs(dir: string, days: number, now = Date.now()): Promise<string[]> {
  const names = await logNames(dir);
  const removed: string[] = [];
  for (const name of names) {
    const path = join(dir, name);
    const { mtimeMs } = await stat(path);
    if (now - mtimeMs > days * 86_400_000) {
      await unlink(path);
      removed.push(name);
    }
  }
  return removed;
}

/** A log file's entries; lines that don't parse (a cut-off last line after a crash) are counted. */
export async function readCasLogFile(path: string): Promise<{ entries: LogEntry[]; bad: number }> {
  const text = await readFile(path, 'utf8');
  const entries: LogEntry[] = [];
  let bad = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      bad += 1;
      continue;
    }
    const parsed = LogEntry.safeParse(json);
    if (parsed.success) entries.push(parsed.data);
    else bad += 1;
  }
  return { entries, bad };
}

/** One exported log file: its Markdown and CSV next to it. */
export interface CasLogExport {
  source: string;
  markdown: string;
  csv: string;
  entries: number;
  bad: number;
}

/**
 * `slate-relay --export-log` (§12.1, §12.3 "relay admin"): every log file in
 * `dir` as a Markdown timeline and a CSV file, written next to it. Mission
 * times are local (L) – the relay doesn't know the map's UTC offset.
 */
export async function exportCasLogs(
  dir: string,
  options: { delimiter?: ',' | ';' } = {},
): Promise<CasLogExport[]> {
  const sources = (await logNames(dir)).filter((name) => name.endsWith('.jsonl'));
  const done: CasLogExport[] = [];
  for (const name of sources) {
    const match = FILE.exec(name);
    if (!match) continue;
    const [, stamp = '', session = ''] = match;
    const started = `${stamp.slice(0, 10)} ${stamp.slice(11, 16).replace('-', ':')} UTC`;
    const title = `CAS log – ${session === 'blue' ? 'Blue' : 'Red'} session, relay started ${started}`;
    const { entries, bad } = await readCasLogFile(join(dir, name));
    const base = join(dir, name.replace(/\.jsonl$/, ''));
    await writeFile(`${base}.md`, casLogMarkdown(entries, { title }), { mode: 0o600 });
    await writeFile(`${base}.csv`, casLogCsv(entries, options), { mode: 0o600 });
    done.push({
      source: name,
      markdown: `${base}.md`,
      csv: `${base}.csv`,
      entries: entries.length,
      bad,
    });
  }
  return done;
}

/** The log's own files in `dir`, sorted; none when the folder doesn't exist yet. */
async function logNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => FILE.test(name)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
