// SPDX-License-Identifier: GPL-3.0-or-later
// Geometry for CAS (protocol.md §8.5, §9.4): distances, keyhole points and the
// hold overlap check. The relay uses it to flag conflicting holds; the host
// uses the same rules to warn before sending.

import type { Altitude, KeyholeAxis, LatLon, PointRef } from './cas-common.js';
import { KEYHOLE_AXIS_DEG } from './cas-common.js';
import { gridConvergenceDeg, gridScale } from './maps.js';

const RAD = Math.PI / 180;
/** Mean earth radius, metres – enough for distances of a few dozen NM. */
const EARTH_M = 6_371_008.8;
const NM = 1852;

/** Great-circle distance in metres. */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The point `distanceM` from `from` along a geographic bearing (degrees from the meridian). */
export function destination(from: LatLon, bearingDeg: number, distanceM: number): LatLon {
  const d = distanceM / EARTH_M;
  const b = bearingDeg * RAD;
  const lat1 = from.lat * RAD;
  const lon1 = from.lon * RAD;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: lat2 / RAD, lon: ((((lon2 / RAD + 540) % 360) + 360) % 360) - 180 };
}

/**
 * A keyhole point from ECHO (§8.5). `gridToMeridianDeg` turns the axis's grid
 * direction into a meridian bearing: γ at ECHO (`gridConvergenceDeg`), so
 * "ALPHA 5" lies 5 NM grid-north, where the F10 ruler measures it. With 0
 * (unknown map) a point is off by γ – on Caucasus about 0.6 NM at 5 NM.
 */
export function keyholePosition(
  echo: LatLon,
  axis: KeyholeAxis,
  distanceNm: number | null | undefined,
  gridToMeridianDeg = 0,
): LatLon {
  if (axis === 'E' || !distanceNm) return { lat: echo.lat, lon: echo.lon };
  return destination(echo, KEYHOLE_AXIS_DEG[axis] + gridToMeridianDeg, distanceNm * NM);
}

/** What a point reference points at: an entry's point (IP/CP, keyhole ECHO), by its ID. */
export type PointLookup = (cmId: string) => LatLon | null;

/** The position of a point reference, or `null` if its entry is unknown. */
export function resolvePoint(point: PointRef, lookup: PointLookup): LatLon | null {
  if ('lat' in point) return { lat: point.lat, lon: point.lon };
  const base = lookup(point.cmId);
  if (base === null) return null;
  if ('axis' in point && point.axis !== undefined) {
    return keyholePosition(base, point.axis, point.distanceNm);
  }
  return base;
}

// ---------------------------------------------------------------------------
// Hold overlap (§9.4): area AND altitude block

/** Turn radius assumed for a racetrack's ends: 1.5 NM. */
export const HOLD_TURN_RADIUS_M = 1.5 * NM;

/** The parts of a hold the overlap check needs. */
export interface HoldShapeInput {
  point: PointRef;
  floor: Altitude;
  ceiling: Altitude;
  shape: 'orbit' | 'racetrack';
  radiusM: number | null;
  legM: number | null;
  inboundDeg: number | null;
}

/**
 * The area a hold uses, as a circle: an orbit's own circle; for a racetrack
 * (inbound leg ending at the hold point) a circle around the leg's middle that
 * holds both turns. Conservative on purpose – a conflict is flagged, never blocked.
 */
export function holdArea(
  hold: HoldShapeInput,
  lookup: PointLookup,
): { center: LatLon; radiusM: number } | null {
  const point = resolvePoint(hold.point, lookup);
  if (point === null) return null;
  if (hold.shape === 'orbit') return { center: point, radiusM: hold.radiusM ?? HOLD_TURN_RADIUS_M };
  const leg = hold.legM ?? 0;
  // The leg runs into the point on the inbound course, so its middle lies behind the point.
  const middle = destination(point, ((hold.inboundDeg ?? 0) + 180) % 360, leg / 2);
  return { center: middle, radiusM: leg / 2 + HOLD_TURN_RADIUS_M };
}

/**
 * `x` lies below `y`. SFC is below everything else; MSL against AGL can't be
 * compared without the terrain and counts as "below" – so the check flags
 * rather than misses a conflict.
 */
function below(x: Altitude, y: Altitude): boolean {
  if (x.ref === 'sfc') return y.ref !== 'sfc';
  if (y.ref === 'sfc') return false;
  if (x.ref !== y.ref) return true;
  return x.m < y.m;
}

/** `true` if two altitude blocks overlap (touching blocks don't). */
export function blocksOverlap(
  a: { floor: Altitude; ceiling: Altitude },
  b: { floor: Altitude; ceiling: Altitude },
): boolean {
  return below(a.floor, b.ceiling) && below(b.floor, a.ceiling);
}

/** `true` if two holds overlap in area **and** altitude block (§9.4). */
export function holdsConflict(a: HoldShapeInput, b: HoldShapeInput, lookup: PointLookup): boolean {
  if (!blocksOverlap(a, b)) return false;
  const areaA = holdArea(a, lookup);
  const areaB = holdArea(b, lookup);
  if (areaA === null || areaB === null) return false;
  return distanceM(areaA.center, areaB.center) < areaA.radiusM + areaB.radiusM;
}

/**
 * A keyhole point on a map (§8.5): along grid north from the map's central
 * meridian, and the distance in DCS's grid NM, as the F10 ruler measures it.
 * Unknown map: true north and ground NM.
 */
export function keyholePoint(
  echo: LatLon,
  axis: KeyholeAxis,
  distanceNm: number | null | undefined,
  theatre: string | null,
): LatLon {
  const scale = gridScale(theatre, echo) ?? 1;
  const groundNm =
    distanceNm === null || distanceNm === undefined ? distanceNm : distanceNm / scale;
  return keyholePosition(echo, axis, groundNm, gridConvergenceDeg(theatre, echo) ?? 0);
}
