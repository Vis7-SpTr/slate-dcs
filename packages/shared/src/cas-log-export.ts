// SPDX-License-Identifier: GPL-3.0-or-later
// CAS log export (protocol.md §12.3, D6): entries → a Markdown timeline to
// read and a CSV file for spreadsheets. Used by `slate-relay --export-log`
// and by the host's More → CAS log. PDF follows later.

import type { LogArea, LogEntry } from './cas-log.js';
import { formatTimeOfDay, localTimeOfDay, zuluTimeOfDay } from './maps.js';

export interface CasLogExportOptions {
  /** Heading of the Markdown file, e.g. `CAS log – Blue, 26 Oct 2026`. */
  title: string;
  /** Mission time as Zulu (needs `utcOffsetHours`) or local; default local. */
  display?: 'zulu' | 'local';
  /** The map's UTC offset (maps.ts); `null` = unknown, Zulu falls back to local. */
  utcOffsetHours?: number | null;
  /** CSV only: `;` for a spreadsheet set to German, `,` otherwise (default). */
  delimiter?: ',' | ';';
}

const AREA_NAMES: Record<LogArea, string> = {
  checkIn: 'Check-in',
  situation: 'Situation',
  mission: 'Mission',
  fuel: 'Fuel',
  ao: 'AO',
};

/**
 * `14:23:05 L`, `13:23:05 Z`; `D+1 00:10:00 L` past midnight of the start day
 * (`D-1` for a Zulu time before it); `—` without a time.
 */
export function formatLogMtime(
  mtime: number | null,
  options: Pick<CasLogExportOptions, 'display' | 'utcOffsetHours'> = {},
): string {
  if (mtime === null) return '—';
  const offset = options.utcOffsetHours ?? null;
  const zulu = options.display === 'zulu' && offset !== null;
  const shifted = zulu ? mtime - offset * 3600 : mtime;
  const day = Math.floor(shifted / 86_400);
  const time = formatTimeOfDay(zulu ? zuluTimeOfDay(mtime, offset) : localTimeOfDay(mtime));
  const dayText = day === 0 ? '' : `D${day > 0 ? '+' : ''}${String(day)} `;
  return `${dayText}${time} ${zulu ? 'Z' : 'L'}`;
}

/** Relay time as `HH:MM:SS` UTC. */
function relayTime(rts: number): string {
  return new Date(rts).toISOString().slice(11, 19);
}

/** Where an entry belongs, e.g. `Mission m_3`. */
function areaText(entry: LogEntry): string {
  const area = AREA_NAMES[entry.area];
  return entry.area === 'mission' && entry.missionId !== null ? `${area} ${entry.missionId}` : area;
}

/** One table cell: no line breaks, pipes and HTML escaped. */
function mdCell(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/\r?\n|\r/g, ' ');
}

/** The readable timeline (§12.3): one table, oldest first. */
export function casLogMarkdown(entries: readonly LogEntry[], options: CasLogExportOptions): string {
  const time = (mtime: number | null) => formatLogMtime(mtime, options);
  const zuluWanted = options.display === 'zulu';
  const zuluKnown = options.utcOffsetHours !== null && options.utcOffsetHours !== undefined;
  const lines = [`# ${mdCell(options.title)}`, ''];
  const timed = entries.filter((e) => e.mtime !== null);
  const first = timed.at(0);
  const last = timed.at(-1);
  const span = first && last ? ` · mission time ${time(first.mtime)} – ${time(last.mtime)}` : '';
  lines.push(`${String(entries.length)} entries${span}`);
  if (zuluWanted && !zuluKnown) {
    lines.push('', 'The map’s UTC offset is unknown, so mission times are local (L).');
  }
  lines.push(
    '',
    '| Mission time | Relay time (UTC) | Area | Entry |',
    '|---|---|---|---|',
    ...entries.map(
      (e) =>
        `| ${time(e.mtime)} | ${relayTime(e.rts)} | ${mdCell(areaText(e))} | ${mdCell(e.summary)} |`,
    ),
    '',
  );
  return lines.join('\n');
}

const CSV_COLUMNS = [
  'seq',
  'relay_time_utc',
  'mission_time_s',
  'mission_time',
  'area',
  'kind',
  'actor',
  'actor_name',
  'summary',
  'ao_id',
  'flight_id',
  'mission_id',
  'pid',
] as const;

/**
 * One CSV field (RFC 4180): quoted when needed. Text that a spreadsheet would
 * run as a formula (starting with `=`, `+`, `-`, `@`, tab or CR) gets a `'`
 * first – callsigns and summaries are typed by players.
 */
function csvField(value: string | number | null, delimiter: string): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return safe.includes(delimiter) || /["\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** For spreadsheets: one row per entry, every field; UTF-8 with BOM, CRLF. */
export function casLogCsv(
  entries: readonly LogEntry[],
  options: Pick<CasLogExportOptions, 'display' | 'utcOffsetHours' | 'delimiter'> = {},
): string {
  const d = options.delimiter ?? ',';
  const rows = entries.map((e) =>
    [
      e.seq,
      new Date(e.rts).toISOString(),
      e.mtime === null ? null : Math.round(e.mtime * 10) / 10,
      e.mtime === null ? null : formatLogMtime(e.mtime, options),
      e.area,
      e.kind,
      e.actor,
      e.actorName,
      e.summary,
      e.aoId,
      e.flightId,
      e.missionId,
      e.pid,
    ]
      .map((v) => csvField(v, d))
      .join(d),
  );
  return `\uFEFF${[CSV_COLUMNS.join(d), ...rows].join('\r\n')}\r\n`;
}
