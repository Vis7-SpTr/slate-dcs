// SPDX-License-Identifier: GPL-3.0-or-later
// The host's CAS state slices (protocol.md §14.3, P2). Filled by the host's
// relay client from P2.5 on; until then they stay empty.

import { z } from 'zod';

import { Ao } from './aos.js';
import { AoId, Callsign, HoldId } from './cas-common.js';
import { LogEntry } from './cas-log.js';
import { CheckIn, CheckInBrief, Hold, SitUpdate } from './checkins.js';
import { EpochMs, Pid } from './common.js';
import { MessageId } from './envelope.js';
import { FlightId } from './flights.js';
import { MapEntry } from './map-entries.js';
import { FireMission } from './missions.js';

/** Fields of the check-in brief the lead can type over (§9.1). */
export const BRIEF_FIELDS = CheckInBrief.keyof().options;
export const BriefField = CheckInBrief.keyof();
export type BriefField = z.infer<typeof BriefField>;

/** Confirmations of one sent message (§1.2): relay receipt and who got it. Shown as ticks. */
export const Delivery = z.object({
  /** The command's message ID. */
  id: MessageId,
  /** What was sent and what it is about, so a screen shows the ticks where it belongs (P2.6). */
  type: z.string().max(40).default(''),
  /** The mission, hold or flight it is about; `null` if none. */
  ref: z.string().max(64).nullable().default(null),
  /** The aircraft (lane) it is about. */
  pid: Pid.nullable().default(null),
  /** When it was sent (host time). */
  at: EpochMs.default(0),
  /** Level 1: the relay accepted it. */
  relay: z.boolean(),
  /** Level 2: these recipients' apps got it. */
  receivedBy: z.array(Pid),
});
export type Delivery = z.infer<typeof Delivery>;

/** The latest situation update per flight (or for the whole AO), kept as a notepad (§9.3). */
export const SitUpdateNote = z.object({
  /** The `cas.sitUpdate` message, for `cas.sitCopy`. */
  id: MessageId,
  aoId: AoId,
  /** `null` = sent to the whole AO. */
  flightId: FlightId.nullable(),
  from: Pid,
  update: SitUpdate,
  receivedAt: EpochMs,
  /** The pilot pressed COPY. */
  copied: z.boolean(),
});
export type SitUpdateNote = z.infer<typeof SitUpdateNote>;

/**
 * `cas`: AOs, map entries, holds, check-ins, situation updates, and the own
 * check-in brief draft. A pilot's `checkIns` holds at most his flight's; a
 * JTAC's every check-in of his AO.
 */
export const CasSlice = z.object({
  aos: z.array(Ao),
  mapEntries: z.array(MapEntry),
  holds: z.array(Hold),
  checkIns: z.array(CheckIn),
  sitUpdates: z.array(SitUpdateNote),
  /**
   * The lead's check-in brief, prepared in the host and sent later (§9.1).
   * `edited` = fields typed over by hand; the others are refreshed at sending.
   */
  briefDraft: z.object({ brief: CheckInBrief, edited: z.array(BriefField) }).nullable(),
  /** Confirmations of the CAS messages this host sent, newest last. */
  deliveries: z.array(Delivery),
  /** WILCO for holds (§9.4) – a JTAC sees who acknowledged his holds (added P2.5). */
  holdWilcos: z.array(z.object({ holdId: HoldId, pid: Pid, at: EpochMs })).default([]),
});
export type CasSlice = z.infer<typeof CasSlice>;

/** `missions`: fire missions this user may see (§10.1); a pilot's carry only his own lane. */
export const MissionsSlice = z.object({ missions: z.array(FireMission) });
export type MissionsSlice = z.infer<typeof MissionsSlice>;

/** `casLog`: the host's local copy of the CAS log (§12.1), oldest first. */
export const CasLogSlice = z.object({ entries: z.array(LogEntry) });
export type CasLogSlice = z.infer<typeof CasLogSlice>;

/** A JOKER/BINGO call received from a flight mate or a checked-in aircraft (§6.5). */
export const ReceivedFuelCall = z.object({
  pid: Pid,
  callsign: Callsign,
  call: z.enum(['joker', 'bingo']),
  internalKg: z.number().nonnegative(),
  receivedAt: EpochMs,
});
export type ReceivedFuelCall = z.infer<typeof ReceivedFuelCall>;

/**
 * `fuelCalls`: the own joker and bingo for this sortie, the prompt on the own
 * dash only, and calls received (§6.5). Never sent automatically.
 */
export const FuelCallsSlice = z.object({
  /** `null` = not set (joker has no default). Weight in kg; shown in the airframe's unit. */
  jokerKg: z.number().nonnegative().nullable(),
  bingoKg: z.number().nonnegative().nullable(),
  /** Internal fuel reached a set value: show [SEND …] / dismiss. */
  prompt: z.enum(['joker', 'bingo']).nullable(),
  /** Calls this pilot sent this sortie. */
  sent: z.array(z.object({ call: z.enum(['joker', 'bingo']), at: EpochMs })),
  received: z.array(ReceivedFuelCall),
});
export type FuelCallsSlice = z.infer<typeof FuelCallsSlice>;

/** Empty CAS slices of a host that just started. */
export function defaultCasSlices(): {
  cas: CasSlice;
  missions: MissionsSlice;
  casLog: CasLogSlice;
  fuelCalls: FuelCallsSlice;
} {
  return {
    cas: {
      aos: [],
      mapEntries: [],
      holds: [],
      checkIns: [],
      sitUpdates: [],
      briefDraft: null,
      deliveries: [],
      holdWilcos: [],
    },
    missions: { missions: [] },
    casLog: { entries: [] },
    fuelCalls: { jokerKg: null, bingoKg: null, prompt: null, sent: [], received: [] },
  };
}
