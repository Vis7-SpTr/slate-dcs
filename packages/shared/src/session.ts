// SPDX-License-Identifier: GPL-3.0-or-later
// Joining a session, presence, coalition switch and leaving (protocol.md §4, §5).

import { z } from 'zod';

import {
  AircraftInfo,
  AircraftType,
  Coalition,
  CROCKFORD,
  Nick,
  Pid,
  Presence,
  readCrockford,
  RoleId,
  Seq,
} from './common.js';
import { defineMessage } from './envelope.js';
import { Flight, FlightSummary } from './flights.js';

// ---------------------------------------------------------------------------
// Building blocks (shared ones live in common.ts)

/**
 * Session code as sent on the wire: a prefix and 8 Crockford base32 characters,
 * e.g. `BLUE-7K3Q9XPM` (coalition code) or a group code for manual join (§4.1).
 * Codes typed by a person go through `normalizeSessionCode` first.
 */
export const SessionCode = z
  .string()
  .regex(new RegExp(`^[A-Z]+-[${CROCKFORD}]{8}$`), 'Expected a session code like BLUE-7K3Q9XPM');
export type SessionCode = z.infer<typeof SessionCode>;

/**
 * Token: 256-bit random value, base64url without padding = 43 characters (§0).
 * **Secret** – only the player's own host and the relay ever see it.
 */
export const Token = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'Expected a 256-bit base64url token (43 characters)');

// ---------------------------------------------------------------------------
// §4 Joining

/** `session.join` (host → relay). */
export const SessionJoin = defineMessage(
  'session.join',
  z.object({
    /** Coalition code or group code. */
    code: SessionCode,
    /** Required with the group code; ignored with a coalition code (the relay checks). */
    coalition: Coalition.nullable(),
    /** Saved token for this relay, or `null`. */
    token: Token.nullable(),
    /** Last `seq` the host saw in this session (for resync), or `null`. */
    lastSeq: Seq.nullable(),
    nick: Nick,
    role: RoleId,
    aircraft: AircraftInfo.nullable(),
    /** How the player found the relay (shown in the session list). */
    source: z.enum(['discovery', 'manual']),
  }),
);
export type SessionJoin = z.infer<typeof SessionJoin>;

/** `session.joined` (relay → host). The host replaces its saved token at once. */
export const SessionJoined = defineMessage(
  'session.joined',
  z.object({
    pid: Pid,
    /** New token – the old one stops working (§4.3). */
    token: Token,
    /** `true` = known token, session restored. */
    resumed: z.boolean(),
    session: z.string().min(1),
    coalition: Coalition,
  }),
);
export type SessionJoined = z.infer<typeof SessionJoined>;

/** One entry of the participant list in `session.state`. */
export const Participant = z.object({
  pid: Pid,
  nick: Nick,
  role: RoleId,
  /** Only the type is shared with the whole session. */
  aircraft: AircraftType.nullable(),
  presence: Presence,
});
export type Participant = z.infer<typeof Participant>;

/**
 * `session.state` (relay → host, right after `session.joined`): a full snapshot;
 * afterwards only changes are sent (§4.5).
 *
 * AOs (§8), check-ins (§9), missions (§10) and the flight plan (§11) are
 * accepted as-is for now and get their own schemas with their message families
 * in P2/P3.
 */
export const SessionState = defineMessage(
  'session.state',
  z.object({
    /** The snapshot reflects every message up to this `seq`. */
    asOfSeq: Seq,
    participants: z.array(Participant),
    /** Open flights as summaries, plus the player's own flight in full (§4.5). */
    flights: z.array(z.union([Flight, FlightSummary])),
    aos: z.array(z.unknown()),
    you: z.object({
      flight: Flight.nullable(),
      checkIns: z.array(z.unknown()),
      openMissions: z.array(z.unknown()),
      flightPlan: z.unknown().nullable().optional(),
    }),
  }),
);
export type SessionState = z.infer<typeof SessionState>;

// ---------------------------------------------------------------------------
// §5 Presence, coalition switch, leaving

/** `session.presence` (relay → session): someone joined, was lost, came back or left. */
export const SessionPresence = defineMessage(
  'session.presence',
  z.object({ pid: Pid, presence: Presence, nick: Nick, role: RoleId }),
);
export type SessionPresence = z.infer<typeof SessionPresence>;

/** `session.switch` (host → relay): move to the other coalition's session after a re-announce. */
export const SessionSwitch = defineMessage('session.switch', z.object({ code: SessionCode }));
export type SessionSwitch = z.infer<typeof SessionSwitch>;

/** `session.leave` (host → relay): deliberate exit; releases flight position and check-ins. */
export const SessionLeave = defineMessage('session.leave', z.object({}));
export type SessionLeave = z.infer<typeof SessionLeave>;

/** Reasons for `session.closed` defined in protocol.md. Receivers accept any reason. */
export const CLOSE_REASONS = ['replaced', 'expired', 'kicked', 'shutdown'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

/** `session.closed` (relay → host); the relay then closes the socket. */
export const SessionClosed = defineMessage(
  'session.closed',
  z.object({ reason: z.string().min(1) }),
);
export type SessionClosed = z.infer<typeof SessionClosed>;

// ---------------------------------------------------------------------------
// Helpers

/**
 * Turns a session code typed by a person into the wire format, or returns `null`
 * if it can't be one. Accepts lower case, spaces and a missing dash, and reads
 * the Crockford look-alikes O → 0 and I/L → 1 in the code part:
 * `blue 7k3q9xpm` → `BLUE-7K3Q9XPM`.
 */
export function normalizeSessionCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s_]/g, '');
  const match = /^([A-Z]+)-?([0-9A-Z]{8})$/.exec(compact);
  if (!match) return null;
  const [, prefix = '', rawCode = ''] = match;
  const code = readCrockford(rawCode);
  const result = `${prefix}-${code}`;
  return SessionCode.safeParse(result).success ? result : null;
}
