// SPDX-License-Identifier: GPL-3.0-or-later
// Building blocks used by several message families.

import { z } from 'zod';

/** Crockford base32 alphabet as a regex character range (no I, L, O, U). */
export const CROCKFORD = '0-9A-HJKMNP-TV-Z';

/**
 * Reads Crockford look-alikes the way Crockford base32 decoding does:
 * upper case, O → 0, I and L → 1. Use only on the code part, never on a prefix.
 */
export function readCrockford(text: string): string {
  return text.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
}

/** Coalition of a session. */
export const Coalition = z.enum(['blue', 'red']);
export type Coalition = z.infer<typeof Coalition>;

/** Participant ID, issued by the relay; stable across reconnects (protocol.md §0). */
export const Pid = z.string().min(1).max(64);

/** Role ID from the role list – `pilot`, `jtac`; roles are data (scope §3.4). */
export const RoleId = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*$/, 'Expected a role ID like "pilot" or "jtac"');

/** Display name; shown to others, never used to identify a player. */
export const Nick = z.string().trim().min(1).max(32);

/** Connection state of a participant (protocol.md §5). */
export const Presence = z.enum(['online', 'lost', 'left']);
export type Presence = z.infer<typeof Presence>;

/**
 * Own aircraft or JTAC slot as far as known – from the client hook, or entered
 * by hand (protocol.md §4.2). `null` where no slot is taken.
 */
export const AircraftInfo = z.object({
  /** DCS unit type, e.g. `FA-18C_hornet`, `forward_observer`. */
  type: z.string().min(1),
  /** Unit name, e.g. `Enfield 1-1`. */
  unit: z.string().min(1).optional(),
  /** DCS slot ID. */
  slot: z.string().min(1).optional(),
});
export type AircraftInfo = z.infer<typeof AircraftInfo>;

/** What other players see of someone's aircraft: the type only. */
export const AircraftType = AircraftInfo.pick({ type: true });

/** Sequence number assigned by the relay. */
export const Seq = z.int().nonnegative();

/** Epoch milliseconds, UTC (protocol.md §0). */
export const EpochMs = z.int().nonnegative();
