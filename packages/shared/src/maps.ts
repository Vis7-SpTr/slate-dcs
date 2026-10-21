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
