// SPDX-License-Identifier: GPL-3.0-or-later
// The CAS log on disk (protocol.md §12.1, D7): one JSONL file per session and
// relay run, retention, reading back, and the admin export.

import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LogEntry } from '@slate-dcs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CasLogFiles,
  casLogFileName,
  exportCasLogs,
  pruneCasLogs,
  readCasLogFile,
} from './cas-log-file.js';
import { loadRelayFiles } from './config.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slate-cas-log-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const STARTED = Date.UTC(2026, 9, 26, 19, 30, 5);

function entry(seq: number, summary = `entry ${String(seq)}`): LogEntry {
  return {
    seq,
    rts: STARTED + seq * 1000,
    mtime: 51_000 + seq,
    area: 'mission',
    kind: 'fm.clear',
    actor: 'p_000001',
    actorName: 'Axeman 11',
    summary,
    aoId: 'a_000001',
    flightId: 'f_000001',
    missionId: 'm_1',
    pid: 'p_000002',
  };
}

describe('log files', () => {
  it('one file per session and run, named by the run’s start', async () => {
    expect(casLogFileName(STARTED, 'blue')).toBe('cas-log-2026-10-26T19-30-05Z-blue.jsonl');
    const files = await CasLogFiles.open(join(dir, 'cas-log'), STARTED);
    files.append('blue', entry(1));
    files.append('red', entry(1, 'red one'));
    files.append('blue', entry(2));
    await files.close();
    expect((await readdir(join(dir, 'cas-log'))).sort()).toEqual([
      'cas-log-2026-10-26T19-30-05Z-blue.jsonl',
      'cas-log-2026-10-26T19-30-05Z-red.jsonl',
    ]);
    const blue = await readCasLogFile(join(dir, 'cas-log', casLogFileName(STARTED, 'blue')));
    expect(blue).toEqual({ entries: [entry(1), entry(2)], bad: 0 });
  });

  it('a restart appends to a new file, never into the old run’s', async () => {
    const first = await CasLogFiles.open(dir, STARTED);
    first.append('blue', entry(1));
    await first.close();
    const second = await CasLogFiles.open(dir, STARTED + 60_000);
    second.append('blue', entry(1, 'after the restart'));
    await second.close();
    expect(await readdir(dir)).toHaveLength(2);
  });

  it('skips lines it can’t read – a cut-off line after a crash', async () => {
    const path = join(dir, casLogFileName(STARTED, 'blue'));
    await writeFile(
      path,
      `${JSON.stringify(entry(1))}\n${JSON.stringify({ seq: 2 })}\n{"seq":3,"rts"`,
    );
    expect(await readCasLogFile(path)).toEqual({ entries: [entry(1)], bad: 2 });
  });

  it('keeps files for the retention days after their last entry, then removes them', async () => {
    const old = join(dir, casLogFileName(STARTED, 'blue'));
    const recent = join(dir, casLogFileName(STARTED, 'red'));
    const other = join(dir, 'notes.txt');
    for (const path of [old, recent, other, old.replace('.jsonl', '.md')]) {
      await writeFile(path, 'x');
    }
    const now = Date.now();
    const daysAgo = (days: number) => new Date(now - days * 86_400_000);
    await utimes(old, daysAgo(31), daysAgo(31));
    await utimes(old.replace('.jsonl', '.md'), daysAgo(31), daysAgo(31));
    await utimes(recent, daysAgo(29), daysAgo(29));
    await utimes(other, daysAgo(400), daysAgo(400));
    expect(await pruneCasLogs(dir, 30, now)).toEqual([
      'cas-log-2026-10-26T19-30-05Z-blue.jsonl',
      'cas-log-2026-10-26T19-30-05Z-blue.md',
    ]);
    expect((await readdir(dir)).sort()).toEqual([
      'cas-log-2026-10-26T19-30-05Z-red.jsonl',
      'notes.txt',
    ]);
    expect(await pruneCasLogs(join(dir, 'missing'), 30)).toEqual([]);
  });

  it('relay.json has logRetentionDays, 30 by default', async () => {
    const files = await loadRelayFiles(dir);
    expect(files.logRetentionDays).toBe(30);
    const config = JSON.parse(await readFile(join(dir, 'relay.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(config['logRetentionDays']).toBe(30);
    await writeFile(join(dir, 'relay.json'), JSON.stringify({ ...config, logRetentionDays: 7 }));
    expect((await loadRelayFiles(dir)).logRetentionDays).toBe(7);
    // An older relay.json without it still loads.
    delete config['logRetentionDays'];
    await writeFile(join(dir, 'relay.json'), JSON.stringify(config));
    expect((await loadRelayFiles(dir)).logRetentionDays).toBe(30);
  });
});

describe('slate-relay --export-log', () => {
  it('writes a Markdown timeline and a CSV file next to each log file', async () => {
    const files = await CasLogFiles.open(dir, STARTED);
    files.append('blue', entry(1, 'Axeman 11: CLEARED HOT Enfield 1-1 (run 1)'));
    files.append('blue', entry(2));
    await files.close();
    const done = await exportCasLogs(dir, { delimiter: ';' });
    const base = join(dir, 'cas-log-2026-10-26T19-30-05Z-blue');
    expect(done).toEqual([
      {
        source: 'cas-log-2026-10-26T19-30-05Z-blue.jsonl',
        markdown: `${base}.md`,
        csv: `${base}.csv`,
        entries: 2,
        bad: 0,
      },
    ]);
    const markdown = await readFile(`${base}.md`, 'utf8');
    expect(markdown).toContain('# CAS log – Blue session, relay started 2026-10-26 19:30 UTC');
    expect(markdown).toContain(
      '| 14:10:01 L | 19:30:06 | Mission m_1 | Axeman 11: CLEARED HOT Enfield 1-1 (run 1) |',
    );
    const csv = await readFile(`${base}.csv`, 'utf8');
    expect(csv.split('\r\n')[0]).toBe(
      '﻿seq;relay_time_utc;mission_time_s;mission_time;area;kind;actor;actor_name;summary;ao_id;flight_id;mission_id;pid',
    );
    // Running it again just writes them again.
    expect(await exportCasLogs(dir)).toHaveLength(1);
    expect(await exportCasLogs(join(dir, 'missing'))).toEqual([]);
  });
});
