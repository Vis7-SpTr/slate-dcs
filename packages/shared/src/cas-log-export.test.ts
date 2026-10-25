// SPDX-License-Identifier: GPL-3.0-or-later
// CAS log export (protocol.md §12.3, D6): Markdown timeline and CSV.

import { describe, expect, it } from 'vitest';

import { logEntry } from './cas-fixtures.js';
import type { LogEntry } from './cas-log.js';
import { casLogCsv, casLogMarkdown, formatLogMtime } from './cas-log-export.js';

const base = logEntry() as LogEntry;
const at = (seq: number, mtime: number | null, summary: string, extra: Partial<LogEntry> = {}) => ({
  ...base,
  seq,
  rts: base.rts + seq * 1000,
  mtime,
  summary,
  ...extra,
});

describe('mission time', () => {
  it('local by default, Zulu with the map’s offset, a day count past midnight', () => {
    expect(formatLogMtime(51_830)).toBe('14:23:50 L');
    expect(formatLogMtime(51_830, { display: 'zulu', utcOffsetHours: 4 })).toBe('10:23:50 Z');
    expect(formatLogMtime(86_400 + 600)).toBe('D+1 00:10:00 L');
    expect(formatLogMtime(3600, { display: 'zulu', utcOffsetHours: 4 })).toBe('D-1 21:00:00 Z');
    expect(formatLogMtime(null)).toBe('—');
  });

  it('Zulu without a known offset falls back to local and says L', () => {
    expect(formatLogMtime(51_830, { display: 'zulu', utcOffsetHours: null })).toBe('14:23:50 L');
  });
});

describe('Markdown', () => {
  it('a heading, the span and one row per entry, oldest first', () => {
    const md = casLogMarkdown(
      [
        at(1, 51_000, 'Axeman 11: on-station', { area: 'ao', missionId: null }),
        at(2, null, 'Enfield 1-1: checked in', { area: 'checkIn', missionId: null }),
        at(3, 51_830, 'Axeman 11: CLEARED HOT Enfield 1-1 (run 1)'),
      ],
      { title: 'CAS log – Blue' },
    );
    expect(md.split('\n')).toEqual([
      '# CAS log – Blue',
      '',
      '3 entries · mission time 14:10:00 L – 14:23:50 L',
      '',
      '| Mission time | Relay time (UTC) | Area | Entry |',
      '|---|---|---|---|',
      '| 14:10:00 L | 14:30:31 | AO | Axeman 11: on-station |',
      '| — | 14:30:32 | Check-in | Enfield 1-1: checked in |',
      '| 14:23:50 L | 14:30:33 | Mission m_8d21f0 | Axeman 11: CLEARED HOT Enfield 1-1 (run 1) |',
      '',
    ]);
  });

  it('typed text can’t break the table or add HTML', () => {
    const md = casLogMarkdown([at(1, 0, 'a | b\nc <img src=x> \\')], { title: 'T' });
    expect(md).toContain('| a \\| b c &lt;img src=x> \\\\ |');
  });

  it('says so when Zulu was asked for but the offset is unknown', () => {
    const md = casLogMarkdown([at(1, 0, 'x')], { title: 'T', display: 'zulu' });
    expect(md).toContain('mission times are local (L)');
    expect(
      casLogMarkdown([at(1, 0, 'x')], { title: 'T', display: 'zulu', utcOffsetHours: 4 }),
    ).not.toContain('local (L)');
  });
});

describe('CSV', () => {
  it('every field, UTF-8 with BOM, CRLF, empty for null', () => {
    const csv = casLogCsv([at(1, 51_830.04, 'Axeman 11: CLEARED HOT', { pid: null })]);
    const [header, row, end] = csv.split('\r\n');
    expect(header).toBe(
      '﻿seq,relay_time_utc,mission_time_s,mission_time,area,kind,actor,actor_name,summary,ao_id,flight_id,mission_id,pid',
    );
    expect(row).toBe(
      `1,${new Date(base.rts + 1000).toISOString()},51830,14:23:50 L,mission,fm.clear,${base.actor},Axeman 11,Axeman 11: CLEARED HOT,${String(base.aoId)},${String(base.flightId)},m_8d21f0,`,
    );
    expect(end).toBe('');
  });

  it('quotes what needs it and keeps formulas from running', () => {
    const csv = casLogCsv([
      at(1, null, 'one, "two"', { actorName: '=HYPERLINK("x")' }),
      at(2, null, '-1 left', { actorName: '+Enfield' }),
    ]);
    const rows = csv.split('\r\n');
    expect(rows[1]).toContain(`,"'=HYPERLINK(""x"")","one, ""two""",`);
    expect(rows[2]).toContain(`,'+Enfield,'-1 left,`);
  });

  it('a semicolon for spreadsheets set to German', () => {
    const csv = casLogCsv([at(1, null, 'a; b, c')], { delimiter: ';' });
    expect(csv.split('\r\n')[1]).toContain(';"a; b, c";');
    expect(csv.split('\r\n')[0]?.startsWith('﻿seq;relay_time_utc;')).toBe(true);
  });
});
