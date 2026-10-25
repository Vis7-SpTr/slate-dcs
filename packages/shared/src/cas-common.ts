// SPDX-License-Identifier: GPL-3.0-or-later
// Building blocks of the CAS messages (protocol.md §8–§12): IDs, positions,
// point references incl. keyhole points, altitude blocks, frequencies, laser
// codes and mission time.

import { z } from 'zod';

import { normalizeFlightCode, PrivateFlightCode } from './flights.js';

// ---------------------------------------------------------------------------
// IDs, issued by the relay

/** AO ID (§8.1): `a_` + characters, sent to everyone. Addressing, check-ins and missions use it. */
export const AoId = z.string().regex(/^a_[0-9a-z]{4,32}$/, 'Expected an AO ID like a_4m2k9q');
export type AoId = z.infer<typeof AoId>;

/**
 * AO join code (§8.1): 6 Crockford base32 characters with a dash, like the
 * private flight code – `Q4T-8MZ`. JTACs only; a second JTAC joins with it.
 */
export const AoJoinCode = PrivateFlightCode;

/** Turns a join code typed by a person into the wire format, or `null` (same rules as flight codes). */
export const normalizeAoJoinCode = normalizeFlightCode;

/** Map entry ID (§8.4). */
export const CmId = z.string().min(1).max(64);
/** Check-in ID (§9.2). */
export const CheckInId = z.string().min(1).max(64);
/** Hold ID (§9.4). */
export const HoldId = z.string().min(1).max(64);
/** Fire mission ID (§10.4). */
export const MissionId = z.string().min(1).max(64);

// ---------------------------------------------------------------------------
// Time

/**
 * Mission time (protocol.md §0): seconds since 00:00 local on the mission's
 * start date, on the mission's clock. Can pass 86 400 on long missions.
 */
export const Mtime = z.number().nonnegative();

// ---------------------------------------------------------------------------
// Positions

/** A position without altitude: WGS84 degrees (§0). */
export const LatLon = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type LatLon = z.infer<typeof LatLon>;

/** What an altitude is measured from: surface, above ground, above mean sea level. */
export const AltitudeRef = z.enum(['sfc', 'agl', 'msl']);

/** An altitude in metres with its reference (`sfc` = the ground itself, `m` is then 0). */
export const Altitude = z.object({ m: z.number(), ref: AltitudeRef });
export type Altitude = z.infer<typeof Altitude>;

/** `true` if a floor/ceiling pair with the same reference has the floor above the ceiling. */
export function blockInverted(floor: Altitude, ceiling: Altitude): boolean {
  return floor.ref === ceiling.ref && floor.m > ceiling.m;
}

// ---------------------------------------------------------------------------
// Keyhole and point references (§8.5)

/** Keyhole axes: ECHO = the centre, ALPHA north, BRAVO east, CHARLIE south, DELTA west. */
export const KeyholeAxis = z.enum(['E', 'A', 'B', 'C', 'D']);
export type KeyholeAxis = z.infer<typeof KeyholeAxis>;

/** Spoken names of the axes. */
export const KEYHOLE_AXIS_NAMES: Readonly<Record<KeyholeAxis, string>> = {
  E: 'ECHO',
  A: 'ALPHA',
  B: 'BRAVO',
  C: 'CHARLIE',
  D: 'DELTA',
};

/**
 * Grid direction of each axis in degrees, in DCS's "true" sense (map grid
 * north, §0). The axes never rotate.
 */
export const KEYHOLE_AXIS_DEG: Readonly<Record<Exclude<KeyholeAxis, 'E'>, number>> = {
  A: 0,
  B: 90,
  C: 180,
  D: 270,
};

/** Longest distance along a keyhole axis, in NM. */
export const KEYHOLE_MAX_NM = 100;

/** A keyhole point: `{ cmId, axis: "A", distanceNm: 5 }` = ALPHA 5; `axis: "E"` = ECHO. */
export const KeyholePoint = z
  .object({
    cmId: CmId,
    axis: KeyholeAxis,
    /** NM from ECHO along the axis; absent or `null` for ECHO. */
    distanceNm: z.number().positive().max(KEYHOLE_MAX_NM).nullish(),
  })
  .superRefine((point, ctx) => {
    const hasDistance = point.distanceNm !== null && point.distanceNm !== undefined;
    if (point.axis === 'E' && hasDistance) {
      ctx.addIssue({ code: 'custom', path: ['distanceNm'], message: 'ECHO has no distance' });
    }
    if (point.axis !== 'E' && !hasDistance) {
      ctx.addIssue({
        code: 'custom',
        path: ['distanceNm'],
        message: 'Axis point needs a distance',
      });
    }
  });
export type KeyholePoint = z.infer<typeof KeyholePoint>;

/**
 * A named point: an IP or CP, by its map entry. `axis` must be absent, so a
 * broken keyhole point is refused instead of being read as a named point.
 */
export const NamedPoint = z.object({ cmId: CmId, axis: z.never().optional() });

/**
 * Point reference (§8.5): a keyhole point, an IP/CP, or own coordinates.
 * Used for line 1, hold points, the line 7 mark position and the centre of a
 * Type 3 window circle.
 */
export const PointRef = z.union([KeyholePoint, NamedPoint, LatLon]);
export type PointRef = z.infer<typeof PointRef>;

/** Readable name of a keyhole point: `ALPHA 5`, `ECHO`. */
export function keyholePointName(axis: KeyholeAxis, distanceNm?: number | null): string {
  const name = KEYHOLE_AXIS_NAMES[axis];
  if (axis === 'E' || distanceNm === null || distanceNm === undefined) return name;
  return `${name} ${String(Number(distanceNm.toFixed(1)))}`;
}

// ---------------------------------------------------------------------------
// Text with links to map entries

/** Free text plus links to map entries (§9.3, line 8, Type 3 targets). */
export const LinkedText = z.object({
  text: z.string().max(500),
  cmIds: z.array(CmId).max(20),
});
export type LinkedText = z.infer<typeof LinkedText>;

// ---------------------------------------------------------------------------
// Radio

/** A radio frequency, typed by hand in P2 (D10): MHz + optional label, e.g. 251.000 AXEMAN PRI. */
export const Frequency = z.object({
  mhz: z.number().min(1).max(1000),
  label: z.string().trim().max(24).nullable(),
});
export type Frequency = z.infer<typeof Frequency>;

/** At most this many frequencies per JTAC. */
export const MAX_FREQUENCIES = 6;

/** Callsign of a JTAC or a flight, as typed: `Axeman 11`. */
export const Callsign = z.string().trim().min(1).max(24);

// ---------------------------------------------------------------------------
// Laser codes (§9.5)

/**
 * `true` for a valid weapon laser code: 4 digits, 1st digit 1, 2nd 1–7, 3rd
 * and 4th 1–8 (1111–1788).
 */
export function isValidLaserCode(code: number): boolean {
  if (!Number.isInteger(code)) return false;
  return /^1[1-7][1-8][1-8]$/.test(String(code));
}

/** A weapon laser code, e.g. 1688. */
export const LaserCode = z.int().refine(isValidLaserCode, 'Expected a laser code 1111–1788');
