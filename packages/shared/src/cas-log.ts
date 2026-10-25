// SPDX-License-Identifier: GPL-3.0-or-later
// CAS log (protocol.md §12). The relay keeps the complete log per coalition
// session – appended to a JSONL file in its data folder, kept 30 days (D7) –
// and each host keeps a local copy of what it saw.

import { z } from 'zod';

import { AoId, MissionId, Mtime } from './cas-common.js';
import { EpochMs, Pid, Seq } from './common.js';
import { defineMessage } from './envelope.js';
import { FlightId } from './flights.js';

export const CAS_LOG_RULES = {
  /** Days the relay keeps a session's log file (`logRetentionDays` in relay.json). */
  retentionDays: 30,
  /** Entries per `log.entries` message; the rest follow from `next`. */
  pageSize: 500,
} as const;

/** What a log entry is about (§12.2). */
export const LogArea = z.enum(['checkIn', 'situation', 'mission', 'fuel', 'ao']);
export type LogArea = z.infer<typeof LogArea>;

/** One log entry (§12.2). */
export const LogEntry = z.object({
  /** The relay's `seq` of the message it records. */
  seq: Seq,
  /** Relay time. */
  rts: EpochMs,
  /** Mission time from the relay's clock anchor (§1.4); `null` without one. */
  mtime: Mtime.nullable(),
  area: LogArea,
  /** The message type it records, e.g. `fm.clear`, `cas.checkedOut`. */
  kind: z.string().min(1).max(40),
  /** Who did it; `relay` for the relay's own entries (lost JTAC, AO closed, …). */
  actor: z.union([Pid, z.literal('relay')]),
  /** Callsign or nick of the actor at the time. */
  actorName: z.string().max(40),
  /** Short readable summary, e.g. `Axeman 11: CLEARED HOT Enfield 1-1 (run 1)`. */
  summary: z.string().min(1).max(500),
  aoId: AoId.nullable(),
  flightId: FlightId.nullable(),
  missionId: MissionId.nullable(),
  /** The aircraft (lane) an entry is about, if one. */
  pid: Pid.nullable(),
});
export type LogEntry = z.infer<typeof LogEntry>;

/** Which part of the log: a JTAC his AO, a pilot his flight (§12.3). */
const LogScope = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('ao'), id: AoId }),
  z.object({ scope: z.literal('flight'), id: FlightId }),
]);

/**
 * `log.request` (host → relay): `from` / `to` = a `seq` range, `null` = from
 * the start / up to now. The relay returns only what the requester may export.
 */
export const LogRequest = defineMessage(
  'log.request',
  LogScope.and(z.object({ from: Seq.nullable(), to: Seq.nullable() })),
);
export type LogRequest = z.infer<typeof LogRequest>;

/**
 * `log.entries` (relay → requester, `re` = the request): one page, oldest
 * first. `next` = the `seq` to ask from for the next page, or `null` at the end.
 */
export const LogEntries = defineMessage(
  'log.entries',
  z.object({ entries: z.array(LogEntry).max(CAS_LOG_RULES.pageSize), next: Seq.nullable() }),
);
export type LogEntries = z.infer<typeof LogEntries>;
