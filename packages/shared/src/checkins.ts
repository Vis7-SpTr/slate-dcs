// SPDX-License-Identifier: GPL-3.0-or-later
// Check-in, situation update, holds and laser codes (protocol.md §9).
// Voice comes first: SLATE follows once the flight is established (scope §4.2).

import { z } from 'zod';

import {
  Altitude,
  AoId,
  blockInverted,
  Callsign,
  CheckInId,
  HoldId,
  LaserCode,
  LatLon,
  LinkedText,
  Mtime,
  PointRef,
} from './cas-common.js';
import { EpochMs, Pid } from './common.js';
import { defineMessage } from './envelope.js';
import { FlightId } from './flights.js';
import { MapEntry, Visibility } from './map-entries.js';

// ---------------------------------------------------------------------------
// Check-in brief (§9.1)

/** What the flight brings (§9.1). */
export const Capability = z.enum(['tgp', 'laser', 'irPointer', 'datalink', 'facA', 'nvg']);
export type Capability = z.infer<typeof Capability>;

/**
 * Laser codes (§9.5): one for the flight, which every member inherits, and an
 * own code for single aircraft. Set by the flight – codes can't change in the air.
 */
export const LaserCodes = z.object({
  flight: LaserCode.nullable(),
  perAircraft: z.record(Pid, LaserCode),
});
export type LaserCodes = z.infer<typeof LaserCodes>;

/** Weapons left in the whole flight, per weapon type. */
export const OrdnanceTotal = z.object({
  name: z.string().min(1).max(32),
  count: z.int().nonnegative(),
});

/** One aircraft of the checking-in flight. */
export const BriefAircraft = z.object({ pid: Pid, type: z.string().min(1) });

/**
 * The check-in brief (§9.1). Created in the lead's host and sent later; the
 * live fields (aircraft, position, ordnance) are refreshed at the moment of
 * sending, unless the lead changed them by hand.
 */
export const CheckInBrief = z.object({
  /** Flight callsign, e.g. `Enfield 1`. */
  callsign: Callsign,
  aircraft: z.array(BriefAircraft).min(1).max(4),
  /** The lead's position and altitude (MSL, metres) when sent. */
  position: LatLon.extend({ altMsl: z.number() }).nullable(),
  ordnance: z.array(OrdnanceTotal).max(32),
  /** Time on station, minutes. */
  playtimeMin: z.int().nonnegative().max(600).nullable(),
  capabilities: z.array(Capability).max(Capability.options.length),
  abortCode: z.string().trim().max(12).nullable(),
  missionNumber: z.string().trim().max(16).nullable(),
  laserCodes: LaserCodes,
  remarks: z.string().max(500),
});
export type CheckInBrief = z.infer<typeof CheckInBrief>;

/** A flight's current check-in, as `you.checkIn` in `session.state` (§4.5). */
export const CheckIn = z.object({
  checkInId: CheckInId,
  flightId: FlightId,
  /** A check-in always lands in an AO (§9.2). */
  aoId: AoId,
  /** The JTAC it was sent to, shown first; `null` when sent to the AO or he went off-station. */
  primary: Pid.nullable(),
  brief: CheckInBrief,
  /** When the flight checked in (relay time). */
  since: EpochMs,
});
export type CheckIn = z.infer<typeof CheckIn>;

// ---------------------------------------------------------------------------
// Holds (§9.4)

/** Orbit or racetrack. */
export const HoldShape = z.enum(['orbit', 'racetrack']);

const NM = 1852;

/**
 * A hold as the JTAC assigns it. Its point is a point reference (§8.5): an
 * IP/CP, a keyhole axis point or own coordinates – no quadrants.
 */
export const HoldDraft = z
  .object({
    flightId: FlightId,
    point: PointRef,
    floor: Altitude,
    ceiling: Altitude,
    turns: z.enum(['left', 'right']),
    shape: HoldShape,
    /** Orbit. */
    radiusM: z
      .number()
      .positive()
      .max(50 * NM)
      .nullable(),
    /** Racetrack: leg length and inbound course (degrees, DCS "true"). */
    legM: z
      .number()
      .positive()
      .max(100 * NM)
      .nullable(),
    inboundDeg: z.number().min(0).lt(360).nullable(),
    /** Time on station in mission time; `until` may be open. */
    from: Mtime.nullable(),
    until: Mtime.nullable(),
    visibility: Visibility,
  })
  .superRefine((hold, ctx) => {
    if (hold.shape === 'orbit' && hold.radiusM === null) {
      ctx.addIssue({ code: 'custom', path: ['radiusM'], message: 'An orbit needs a radius' });
    }
    if (hold.shape === 'racetrack' && (hold.legM === null || hold.inboundDeg === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['legM'],
        message: 'A racetrack needs a leg and an inbound course',
      });
    }
    if (blockInverted(hold.floor, hold.ceiling)) {
      ctx.addIssue({ code: 'custom', path: ['floor'], message: 'Floor is above the ceiling' });
    }
    if (hold.from !== null && hold.until !== null && hold.until < hold.from) {
      ctx.addIssue({ code: 'custom', path: ['until'], message: 'Ends before it starts' });
    }
  });
export type HoldDraft = z.infer<typeof HoldDraft>;

/** A hold as the relay keeps it: plus ID, AO and the holds it overlaps (area and altitude). */
export const Hold = HoldDraft.safeExtend({
  holdId: HoldId,
  aoId: AoId,
  /** Overlapping holds – flagged, never blocked (§9.4). */
  conflicts: z.array(HoldId),
});
export type Hold = z.infer<typeof Hold>;

// ---------------------------------------------------------------------------
// Situation update (§9.3)

/** Situation update, structured like JP 3-09.3. */
export const SitUpdate = z.object({
  threats: LinkedText,
  targets: LinkedText,
  friendlies: LinkedText,
  fires: z.string().max(500),
  clearanceAuthority: z.string().max(100),
  restrictions: z.string().max(500),
  hazards: z.string().max(500),
});
export type SitUpdate = z.infer<typeof SitUpdate>;

// ---------------------------------------------------------------------------
// Messages (§9.2–§9.4)

/**
 * `cas.checkIn` (host → relay, `ack: true`): `to` = one JTAC (`pid`) or one AO
 * (`ao`). Member in command of the flight only. Sent again with a new brief,
 * or to another target.
 */
export const CasCheckIn = defineMessage('cas.checkIn', z.object({ brief: CheckInBrief }));
export type CasCheckIn = z.infer<typeof CasCheckIn>;

/**
 * `cas.checkedIn` (relay → the AO's JTACs + the flight): checked in, no
 * acceptance step. `aoEntries` – the AO's `ao`-only map entries and holds – go
 * to the flight only (§8.4); JTACs get them empty. Sent again when `primary`
 * changes.
 */
export const CasCheckedIn = defineMessage(
  'cas.checkedIn',
  CheckIn.extend({
    aoEntries: z.object({ entries: z.array(MapEntry), holds: z.array(Hold) }),
  }),
);
export type CasCheckedIn = z.infer<typeof CasCheckedIn>;

/** `cas.checkOut` (host → relay): the flight leaves its AO. */
export const CasCheckOut = defineMessage('cas.checkOut', z.object({}));
export type CasCheckOut = z.infer<typeof CasCheckOut>;

/** `cas.release` (host → relay, JTAC): "cleared off station". */
export const CasRelease = defineMessage('cas.release', z.object({ flightId: FlightId }));
export type CasRelease = z.infer<typeof CasRelease>;

/** Why a flight was checked out (§9.2, §7.2). */
export const CheckOutReason = z.enum(['flight', 'jtac', 'aoClosed', 'flightClosed']);

/** `cas.checkedOut` (relay → JTACs + flight): full status to the JTACs stops; the flight's open missions go back to `draft`. */
export const CasCheckedOut = defineMessage(
  'cas.checkedOut',
  z.object({ checkInId: CheckInId, flightId: FlightId, aoId: AoId, by: CheckOutReason }),
);
export type CasCheckedOut = z.infer<typeof CasCheckedOut>;

/** `cas.sitUpdate` (JTAC → one flight or the whole AO, `ack: true`). Forwarded unchanged. */
export const CasSitUpdate = defineMessage(
  'cas.sitUpdate',
  z.object({ aoId: AoId, update: SitUpdate }),
);
export type CasSitUpdate = z.infer<typeof CasSitUpdate>;

/** `cas.sitCopy` (pilot → JTAC, `re` = the situation update): "copy" – a human acknowledgement. */
export const CasSitCopy = defineMessage('cas.sitCopy', z.object({}));
export type CasSitCopy = z.infer<typeof CasSitCopy>;

/** `cas.hold.assign` (JTAC → relay, `ack: true`): a hold for a checked-in flight – also after the fact. */
export const CasHoldAssign = defineMessage('cas.hold.assign', HoldDraft);
export type CasHoldAssign = z.infer<typeof CasHoldAssign>;

/** `cas.hold.update` (JTAC → relay, `ack: true`): the hold's new content, in full. */
export const CasHoldUpdate = defineMessage(
  'cas.hold.update',
  z.object({ holdId: HoldId, hold: HoldDraft }),
);
export type CasHoldUpdate = z.infer<typeof CasHoldUpdate>;

/** `cas.hold.cancel` (JTAC → relay, `ack: true`). */
export const CasHoldCancel = defineMessage('cas.hold.cancel', z.object({ holdId: HoldId }));
export type CasHoldCancel = z.infer<typeof CasHoldCancel>;

/** `cas.hold.updated` (relay → viewers): a hold was assigned or changed, with its conflicts. */
export const CasHoldUpdated = defineMessage('cas.hold.updated', Hold);
export type CasHoldUpdated = z.infer<typeof CasHoldUpdated>;

/** `cas.hold.cancelled` (relay → viewers); `hidden: true` = only no longer visible to this viewer. */
export const CasHoldCancelled = defineMessage(
  'cas.hold.cancelled',
  z.object({ holdId: HoldId, hidden: z.boolean() }),
);
export type CasHoldCancelled = z.infer<typeof CasHoldCancelled>;

/** `cas.hold.wilco` (pilot → relay): WILCO for his flight's hold – a human acknowledgement. */
export const CasHoldWilco = defineMessage('cas.hold.wilco', z.object({ holdId: HoldId }));
export type CasHoldWilco = z.infer<typeof CasHoldWilco>;
