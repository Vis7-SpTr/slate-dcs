// SPDX-License-Identifier: GPL-3.0-or-later
// DCS maps and the mission clock (protocol.md §0 "Mission time", scope §4.6).

/**
 * UTC offset in hours per DCS map (`theatre` from the mission), decided
 * 20 Oct 2026: the real-world offset of the map's region, one fixed value per
 * map, assumed without daylight saving time (unverified).
 *
 * Only maps whose theatre ID was seen in the spike-3.2 logs are listed. Others
 * are added in P1.2, when the hook reports their exact IDs. For a map not in
 * this table SLATE can't show Zulu time and falls back to local time.
 */
export const MAP_UTC_OFFSET_HOURS: Readonly<Record<string, number>> = {
  /** Georgia, UTC+4. */
  Caucasus: 4,
  /** Syria, UTC+3. */
  Syria: 3,
};

/** UTC offset of a map, or `null` if unknown. */
export function mapUtcOffsetHours(theatre: string | null): number | null {
  if (theatre === null) return null;
  return MAP_UTC_OFFSET_HOURS[theatre] ?? null;
}

const DAY_SEC = 86_400;

/**
 * Mission time of day in seconds (0 ≤ t < 86 400). `mtime` counts from
 * 00:00 local on the mission's start date and can pass 86 400 on long missions.
 */
export function localTimeOfDay(mtimeSec: number): number {
  return ((mtimeSec % DAY_SEC) + DAY_SEC) % DAY_SEC;
}

/** Zulu time of day in seconds: local minus the map's UTC offset. */
export function zuluTimeOfDay(mtimeSec: number, utcOffsetHours: number): number {
  return localTimeOfDay(mtimeSec - utcOffsetHours * 3600);
}

/** `HH:MM:SS` for a time of day in seconds. */
export function formatTimeOfDay(seconds: number): string {
  const total = Math.floor(localTimeOfDay(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
}

// ---------------------------------------------------------------------------
// Grid north (protocol.md §8.5, R10)

/**
 * Central meridian λ₀ (degrees east) of each map's transverse Mercator
 * projection. Grid north – DCS's "true" north, the F10 ruler's – differs from
 * the meridian by γ = atan(tan(λ − λ₀) · sin φ) at a point.
 *
 * Caucasus is checked against the spike-3.2 `north` point (run A, F/A-18C):
 * 7.38° measured, 7.41° from the formula. The others are DCS's published
 * projection values, not yet checked against a bridge `north` point on that
 * map – do that when SLATE first runs there (More → DCS shows the map).
 */
export const MAP_CENTRAL_MERIDIAN_DEG: Readonly<Record<string, number>> = {
  Caucasus: 33,
  /** Unchecked. */
  Syria: 39,
  /** Unchecked. */
  PersianGulf: 57,
  /** Unchecked. */
  Nevada: -117,
  /** Unchecked. */
  MarianaIslands: 147,
  /** Unchecked. */
  Normandy: -3,
  /** Unchecked. */
  TheChannel: 3,
  /** Unchecked. */
  Falklands: -57,
};

/**
 * γ in degrees at a point: how far grid north lies clockwise of true north
 * (east of the central meridian it points east). `null` for an unknown map.
 */
export function gridConvergenceDeg(
  theatre: string | null,
  p: { lat: number; lon: number },
): number | null {
  const lon0 = theatre === null ? undefined : MAP_CENTRAL_MERIDIAN_DEG[theatre];
  if (lon0 === undefined) return null;
  const rad = Math.PI / 180;
  return Math.atan(Math.tan((p.lon - lon0) * rad) * Math.sin(p.lat * rad)) / rad;
}

/** Scale on the central meridian of DCS's transverse Mercator maps. */
const CENTRAL_SCALE = 0.9996;

/**
 * Point scale k at a point: grid metres per metre on the ground. DCS's world
 * is the flat grid, so distances in DCS (F10 ruler, the aircraft's own
 * navigation) are grid distances – up to ~1 % longer than on the ground away
 * from the central meridian. `null` for an unknown map.
 */
export function gridScale(theatre: string | null, p: { lat: number; lon: number }): number | null {
  const lon0 = theatre === null ? undefined : MAP_CENTRAL_MERIDIAN_DEG[theatre];
  if (lon0 === undefined) return null;
  const rad = Math.PI / 180;
  const b = Math.cos(p.lat * rad) * Math.sin((p.lon - lon0) * rad);
  return CENTRAL_SCALE / Math.sqrt(1 - b * b);
}
