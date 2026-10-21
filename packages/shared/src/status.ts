// SPDX-License-Identifier: GPL-3.0-or-later
// Status packages and fuel calls (protocol.md §6.2–§6.5).
// The Lua bridge datagrams (§6.1) are local to the host: see bridge.ts.

import { z } from 'zod';

import { Pid } from './common.js';
import { defineMessage } from './envelope.js';

// ---------------------------------------------------------------------------
// Rules (§6.3)

const FT_TO_M = 0.3048;
const KT_TO_MS = 1852 / 3600;

export const STATUS_TIMING = {
  /** Heartbeat: a package at least this often. */
  heartbeatSec: 20,
  /** Early sends never come closer together than this. */
  minIntervalSec: 5,
  /** Early send when the heading changed by more than this … */
  headingDeg: 10,
  /** … or the altitude by more than 500 ft … */
  altitudeM: 500 * FT_TO_M,
  /** … or the ground speed by more than 20 kt since the last package. */
  speedMs: 20 * KT_TO_MS,
  /** Receivers mark an aircraft stale this long after the `rts` of its last package. */
  staleAfterSec: 60,
} as const;

// ---------------------------------------------------------------------------
// Building blocks

/** Where a value came from: the own `Export.lua`, the server plugin (§13.1), or typed in. */
export const ValueSource = z.enum(['export', 'server', 'manual']);
export type ValueSource = z.infer<typeof ValueSource>;

/** Position: WGS84 degrees, altitudes in metres (§0). */
export const Position = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Altitude above mean sea level. */
  altMsl: z.number(),
  /** Altitude above ground; `null` when unknown (e.g. a position typed in by hand). */
  altAgl: z.number().nullable(),
});
export type Position = z.infer<typeof Position>;

/**
 * Heading in degrees, 0 ≤ hdg < 360. "True" follows DCS (protocol.md §0): from
 * the map grid's north, as DCS's avionics and the F10 ruler use it.
 */
export const HeadingTrue = z.number().min(0).lt(360);

/** Magnetic heading in degrees, 0 ≤ hdg < 360, as the cockpit shows it (from DCS). */
export const HeadingMagnetic = z.number().min(0).lt(360);

/** Speed in m/s. */
export const SpeedMs = z.number().nonnegative();

/** Weapon kind, derived by the host from the DCS weapon type code (spike 3.3). */
export const WeaponKind = z.enum(['missile', 'bomb', 'rocket', 'other']);
export type WeaponKind = z.infer<typeof WeaponKind>;

/**
 * Air-to-air or air-to-ground, derived by the host from the DCS weapon type
 * code (spike 3.3: air-to-air missiles have code 4,4,7,x). Everything that
 * isn't an air-to-air missile counts as air-to-ground.
 */
export const WeaponRole = z.enum(['aa', 'ag']);
export type WeaponRole = z.infer<typeof WeaponRole>;

/**
 * Station number: **DCS's station index** (1-based, as `LoGetPayloadInfo`
 * lists them). The cockpit's own label (e.g. "8B" on the F-14, "5L" on the
 * F-16) comes from the station layouts in `stations.ts`.
 */
const StationNumber = z.int().positive();

/** A weapon station: what's on it and how many are left. */
export const WeaponStation = z.object({
  st: StationNumber,
  name: z.string().min(1),
  kind: WeaponKind,
  role: WeaponRole,
  count: z.int().nonnegative(),
  source: ValueSource,
});
export type WeaponStation = z.infer<typeof WeaponStation>;

/** Pods and tanks – listed, not counted as weapons. */
export const Store = z.object({ st: StationNumber, name: z.string().min(1) });

/** Armament: per station, gun rounds, and pods/tanks. */
export const Armament = z.object({
  stations: z.array(WeaponStation),
  /** `null` for airframes without a gun. */
  gun: z.object({ rounds: z.int().nonnegative(), source: ValueSource }).nullable(),
  stores: z.array(Store),
});
export type Armament = z.infer<typeof Armament>;

/** Fuel as weight in kg; the UI shows lbs or kg like the airframe's gauges (§6.2). */
export const Fuel = z.object({
  internalKg: z.number().nonnegative(),
  externalKg: z.number().nonnegative(),
  source: ValueSource,
});
export type Fuel = z.infer<typeof Fuel>;

/** Which `Export.lua` getters returned data (§6.1); `false` = blocked or not available. */
export const ExportAvailability = z.object({
  pos: z.boolean(),
  fuel: z.boolean(),
  payload: z.boolean(),
});

/** Why a package was sent (for debugging and the flight recording). */
export const SendReason = z.enum(['heartbeat', 'change', 'event']);
export type SendReason = z.infer<typeof SendReason>;

// ---------------------------------------------------------------------------
// Messages

/**
 * `status.update` (host → relay, `to: session`, `ack: false`): the full status
 * package. The relay forwards it to the own flight and the JTACs the aircraft is
 * checked in with, and derives `status.position` for everyone else (§6.4).
 *
 * A value is `null` when no source has it – e.g. a JTAC on the F10 map before he
 * enters his position, IAS of a ground vehicle, fuel and armament of a JTAC.
 */
export const StatusUpdate = defineMessage(
  'status.update',
  z.object({
    pos: Position.nullable(),
    hdg: HeadingTrue.nullable(),
    /** Magnetic heading from DCS; `null` where DCS has none (ground vehicles). */
    hdgMag: HeadingMagnetic.nullable(),
    gs: SpeedMs.nullable(),
    ias: SpeedMs.nullable(),
    fuel: Fuel.nullable(),
    armament: Armament.nullable(),
    avail: ExportAvailability,
    reason: SendReason,
  }),
);
export type StatusUpdate = z.infer<typeof StatusUpdate>;
export type StatusBody = StatusUpdate['body'];

/**
 * `status.position` (relay → rest of the coalition session): the datalink-style
 * picture for the moving map. Only sent while the aircraft has a position.
 */
export const StatusPosition = defineMessage(
  'status.position',
  z.object({
    pid: Pid,
    /** e.g. `Enfield 1-2`. */
    callsign: z.string().min(1),
    /** DCS unit type. */
    type: z.string().min(1),
    pos: Position,
    hdg: HeadingTrue.nullable(),
    gs: SpeedMs.nullable(),
  }),
);
export type StatusPosition = z.infer<typeof StatusPosition>;

/**
 * `fuel.call` (host → relay, `ack: true`) to the flight and the JTACs the pilot is
 * checked in with. **Never sent automatically** – only when the pilot presses it (§6.5).
 */
export const FuelCall = defineMessage(
  'fuel.call',
  z.object({
    call: z.enum(['joker', 'bingo']),
    internalKg: z.number().nonnegative(),
  }),
);
export type FuelCall = z.infer<typeof FuelCall>;

// ---------------------------------------------------------------------------
// Helpers for the interval rule (§6.3)

/** The values the interval rule compares. */
export interface StatusSample {
  hdg: number | null;
  altMsl: number | null;
  gs: number | null;
  /**
   * Total count over all weapon stations; a change sends at once. Gun rounds are
   * not included – they'd send a package every second while strafing – and go out
   * with the next regular package instead. See `weaponsCount()`.
   */
  weaponsCount: number | null;
}

/** Total weapons on all stations (gun rounds not included), or `null` without armament. */
export function weaponsCount(armament: Armament | null): number | null {
  if (armament === null) return null;
  return armament.stations.reduce((sum, station) => sum + station.count, 0);
}

/** Smallest angle between two headings, 0–180°. */
export function headingDifference(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Decides whether the host sends a status package now (§6.3), and why.
 *
 * - Weapons count changed → `event`, at once.
 * - Heartbeat due (20 s) → `heartbeat`.
 * - Heading > 10°, altitude > 500 ft or speed > 20 kt changed since the last
 *   package, and at least 5 s since it → `change`.
 * - Otherwise `null` (don't send).
 *
 * Check-in/out also sends at once; that's triggered by the check-in itself, not here.
 * Joker/bingo is never a trigger.
 *
 * @param last The values in the last package sent, or `null` if none was sent yet.
 * @param secondsSinceLast Time since the last package was sent.
 */
export function statusSendReason(
  last: StatusSample | null,
  now: StatusSample,
  secondsSinceLast: number,
): SendReason | null {
  if (last === null) return 'heartbeat';
  if (last.weaponsCount !== now.weaponsCount) return 'event';
  if (secondsSinceLast >= STATUS_TIMING.heartbeatSec) return 'heartbeat';
  if (secondsSinceLast < STATUS_TIMING.minIntervalSec) return null;

  const changed =
    exceeds(last.hdg, now.hdg, STATUS_TIMING.headingDeg, headingDifference) ||
    exceeds(last.altMsl, now.altMsl, STATUS_TIMING.altitudeM) ||
    exceeds(last.gs, now.gs, STATUS_TIMING.speedMs);
  return changed ? 'change' : null;
}

/** `true` if a value appeared, disappeared, or moved by more than `limit`. */
function exceeds(
  before: number | null,
  after: number | null,
  limit: number,
  difference: (a: number, b: number) => number = (a, b) => Math.abs(a - b),
): boolean {
  if (before === null || after === null) return before !== after;
  return difference(before, after) > limit;
}

/** `true` if the last package (relay time `rts`) is older than 60 s at `nowMs` (§6.3). */
export function isStale(lastRtsMs: number, nowMs: number): boolean {
  return nowMs - lastRtsMs > STATUS_TIMING.staleAfterSec * 1000;
}
