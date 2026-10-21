// SPDX-License-Identifier: GPL-3.0-or-later
// Flights (protocol.md §7). Membership and positions are relay state: only the
// relay changes them, and it tells the members with `flight.updated`.

import { z } from 'zod';

import { AircraftType, CROCKFORD, EpochMs, Pid, Presence, readCrockford } from './common.js';
import { defineMessage } from './envelope.js';

// ---------------------------------------------------------------------------
// Rules

export const FLIGHT_RULES = {
  /** Positions -1 to -4 (scope §4.2). */
  maxMembers: 4,
  /**
   * How long -1 must be lost before -2 may move up (§7.4). After a deliberate
   * leave there is no wait (revised 21 Oct 2026).
   */
  moveUpAfterLostMin: 10,
} as const;

// ---------------------------------------------------------------------------
// Building blocks

/** Flight ID, issued by the relay. */
export const FlightId = z.string().min(1).max(64);

/**
 * Flight name, typed freely or picked from a list – e.g. `Enfield`.
 * Leading/trailing spaces are removed and inner runs of spaces collapsed.
 */
export const FlightName = z
  .string()
  .transform((name) => name.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1).max(24));

/** Position in the flight: 1 = -1 (lead) … 4 = -4. */
export const FlightPosition = z.int().min(1).max(FLIGHT_RULES.maxMembers);

/**
 * Private flight code: 6 Crockford base32 characters with a dash, e.g. `K7Q-4XM`
 * (same format as the AO ID). Codes typed by a person go through
 * `normalizeFlightCode` first.
 */
export const PrivateFlightCode = z
  .string()
  .regex(new RegExp(`^[${CROCKFORD}]{3}-[${CROCKFORD}]{3}$`), 'Expected a code like K7Q-4XM');

/** One member of a flight. */
export const FlightMember = z.object({
  pid: Pid,
  pos: FlightPosition,
  /** `online` or `lost`; a member who left is no longer listed. */
  presence: Presence.exclude(['left']),
  aircraft: AircraftType.nullable(),
});
export type FlightMember = z.infer<typeof FlightMember>;

/**
 * Set while someone may take over -1 (§7.4): the -1 position is free after a
 * deliberate leave, or -1 is lost. Replaces `leadReserved` (21 Oct 2026).
 */
export const MoveUp = z.object({
  /** Who may move up: -2, or the member in command if there is no -2. */
  pid: Pid,
  /** From when: at once after a deliberate leave, 10 minutes after -1 was lost. */
  allowedFrom: EpochMs,
});
export type MoveUp = z.infer<typeof MoveUp>;

/** The full flight object (§7.1), as sent to the flight's members. */
export const Flight = z
  .object({
    flightId: FlightId,
    /** Name as created, e.g. `Enfield`. */
    name: FlightName,
    /** First free number for that name, picked by the relay. */
    number: z.int().positive(),
    /** Name + number, e.g. `Enfield 1`. */
    display: z.string().min(1),
    /** `true` = listed for everyone; `false` = joined only by private code. */
    open: z.boolean(),
    members: z.array(FlightMember).max(FLIGHT_RULES.maxMembers),
    /** Lowest position whose member is online; `null` while nobody is online. */
    inCommand: Pid.nullable(),
    moveUp: MoveUp.nullable(),
    /** Only for private flights, and only sent to the member in command. */
    privateCode: PrivateFlightCode.nullable(),
  })
  .superRefine((flight, ctx) => {
    const positions = flight.members.map((member) => member.pos);
    if (new Set(positions).size !== positions.length) {
      ctx.addIssue({ code: 'custom', path: ['members'], message: 'Two members share a position' });
    }
    const pids = flight.members.map((member) => member.pid);
    if (new Set(pids).size !== pids.length) {
      ctx.addIssue({ code: 'custom', path: ['members'], message: 'A member is listed twice' });
    }
    if (flight.inCommand !== null) {
      const commander = flight.members.find((member) => member.pid === flight.inCommand);
      if (!commander) {
        ctx.addIssue({ code: 'custom', path: ['inCommand'], message: 'Not a member' });
      } else if (commander.presence !== 'online') {
        ctx.addIssue({ code: 'custom', path: ['inCommand'], message: 'Member is not online' });
      }
    }
    if (flight.moveUp !== null) {
      const mover = flight.members.find((member) => member.pid === flight.moveUp?.pid);
      if (!mover) {
        ctx.addIssue({ code: 'custom', path: ['moveUp'], message: 'Not a member' });
      } else if (mover.pos === 1) {
        ctx.addIssue({ code: 'custom', path: ['moveUp'], message: '-1 cannot move up' });
      }
    }
    if (flight.open && flight.privateCode !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['privateCode'],
        message: 'An open flight has no private code',
      });
    }
  });
export type Flight = z.infer<typeof Flight>;

/** Summary of an open flight for the flight list (§7.2 `flight.listed`). */
export const FlightSummary = z.object({
  flightId: FlightId,
  display: z.string().min(1),
  memberCount: z.int().min(1).max(FLIGHT_RULES.maxMembers),
  /** Aircraft types in the flight, e.g. `["FA-18C_hornet", "F-16C_50"]`. */
  types: z.array(z.string().min(1)),
});
export type FlightSummary = z.infer<typeof FlightSummary>;

// ---------------------------------------------------------------------------
// Messages (§7.2)

/** `flight.create` (host → relay). The creator becomes -1 and is in command. */
export const FlightCreate = defineMessage(
  'flight.create',
  z.object({ name: FlightName, open: z.boolean() }),
);
export type FlightCreate = z.infer<typeof FlightCreate>;

/** `flight.created` (relay → creator): the full flight, incl. `privateCode` if private. */
export const FlightCreated = defineMessage('flight.created', Flight);
export type FlightCreated = z.infer<typeof FlightCreated>;

/**
 * `flight.join` (host → relay): an open flight by ID, or a private one by code.
 * The joiner gets the first free position, never -1.
 */
export const FlightJoin = defineMessage(
  'flight.join',
  z.union([z.object({ flightId: FlightId }), z.object({ privateCode: PrivateFlightCode })]),
);
export type FlightJoin = z.infer<typeof FlightJoin>;

/** `flight.leave` (host → relay): deliberate leave; the position is freed (-1: §7.4). */
export const FlightLeave = defineMessage('flight.leave', z.object({}));
export type FlightLeave = z.infer<typeof FlightLeave>;

/**
 * `flight.move` (host → relay), only from the member in command: free target =
 * move, occupied target = swap. Never to or from -1, so the target is 2–4.
 */
export const FlightMove = defineMessage(
  'flight.move',
  z.object({ pid: Pid, pos: FlightPosition.min(2) }),
);
export type FlightMove = z.infer<typeof FlightMove>;

/**
 * `flight.moveUp` (host → relay): take over -1 once the flight's `moveUp`
 * allows it – into a free -1, or swapping with a -1 lost for 10 minutes (§7.4).
 */
export const FlightMoveUp = defineMessage('flight.moveUp', z.object({}));
export type FlightMoveUp = z.infer<typeof FlightMoveUp>;

/** `flight.updated` (relay → flight members): the full flight after every change. */
export const FlightUpdated = defineMessage('flight.updated', Flight);
export type FlightUpdated = z.infer<typeof FlightUpdated>;

/**
 * `flight.listed` (relay → session): one open flight's summary, sent when it
 * appears or changes. Private flights never appear. The full list comes with
 * `session.state`.
 */
export const FlightListed = defineMessage('flight.listed', FlightSummary);
export type FlightListed = z.infer<typeof FlightListed>;

/** `flight.closed` (relay → members + session): the flight ended (§7.5). */
export const FlightClosed = defineMessage('flight.closed', z.object({ flightId: FlightId }));
export type FlightClosed = z.infer<typeof FlightClosed>;

// ---------------------------------------------------------------------------
// Helpers

/**
 * Key for comparing flight names: case and extra spaces don't count, so
 * "enfield" and " Enfield " are the same name (§7.1). The relay numbers flights
 * per key.
 */
export function flightNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Turns a private flight code typed by a person into the wire format, or
 * returns `null`: `k7q 4xm`, `k7q4xm` → `K7Q-4XM` (O → 0, I/L → 1).
 */
export function normalizeFlightCode(input: string): string | null {
  const compact = readCrockford(input.replace(/[\s_-]/g, ''));
  if (compact.length !== 6) return null;
  const result = `${compact.slice(0, 3)}-${compact.slice(3)}`;
  return PrivateFlightCode.safeParse(result).success ? result : null;
}
