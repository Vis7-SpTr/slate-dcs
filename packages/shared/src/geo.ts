// SPDX-License-Identifier: GPL-3.0-or-later
// Small geodesy helpers (WGS84 degrees, protocol.md §0).

const RAD = Math.PI / 180;
/** WGS84 first eccentricity squared. */
const E2 = 0.00669437999014;

/** An angle in degrees, normalised to 0 ≤ a < 360. */
export function normalizeDegrees(degrees: number): number {
  const a = degrees % 360;
  const normalised = a < 0 ? a + 360 : a;
  // e.g. -1e-15 % 360 + 360 rounds to exactly 360.
  return normalised >= 360 ? 0 : normalised;
}

/**
 * Geographic bearing in degrees (0 ≤ b < 360, from the meridian – not DCS's
 * grid "true") from point 1 to a **nearby** point 2 (up to a few km), on the
 * WGS84 ellipsoid: the north and east distances use
 * the meridian and prime-vertical radii at the mid latitude. Within 0.002° of
 * the geodesic at 1 km.
 */
export function shortBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const midLat = ((lat1 + lat2) / 2) * RAD;
  const sin2 = Math.sin(midLat) ** 2;
  // East distance / north distance per radian: N cos φ / M = (1 − e² sin²φ) cos φ / (1 − e²).
  const east = (lon2 - lon1) * RAD * Math.cos(midLat) * ((1 - E2 * sin2) / (1 - E2));
  const north = (lat2 - lat1) * RAD;
  return normalizeDegrees(Math.atan2(east, north) / RAD);
}

/**
 * A DCS heading in radians (`LoGetSelfData().Heading`, `LoGetMagneticYaw()`;
 * not normalised, can exceed 2π) → degrees, 0 ≤ h < 360.
 */
export function headingDegFromRad(radians: number): number {
  return normalizeDegrees(radians / RAD);
}
