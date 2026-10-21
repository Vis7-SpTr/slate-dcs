// SPDX-License-Identifier: GPL-3.0-or-later
// The one formatting layer for numbers, units and times (ui-design.md §1).
// Values arrive in SI units (protocol.md §0); conversion happens only here.

import {
  formatTimeOfDay,
  localTimeOfDay,
  mapUtcOffsetHours,
  zuluTimeOfDay,
} from '@slate-dcs/shared';
import type { FuelUnit, MissionSlice, TimeDisplay } from '@slate-dcs/shared';

const M_TO_FT = 1 / 0.3048;
const KG_TO_LBS = 1 / 0.45359237;
const MS_TO_KT = 3600 / 1852;
const NONE = '—';

/**
 * Whole numbers without thousands separators, as cockpit displays show them.
 * In B612 Mono a comma takes a full character cell, so "5,364" would read
 * like two numbers.
 */
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, useGrouping: false });

/** `N 42°10.272′` / `E 041°40.938′` – degrees and decimal minutes (DDM). */
export function formatLatLon(lat: number, lon: number): { lat: string; lon: string } {
  return { lat: ddm(lat, 'N', 'S', 2), lon: ddm(lon, 'E', 'W', 3) };
}

function ddm(value: number, positive: string, negative: string, degreeDigits: number): string {
  const hemisphere = value < 0 ? negative : positive;
  const abs = Math.abs(value);
  let degrees = Math.floor(abs);
  let minutes = Number(((abs - degrees) * 60).toFixed(3));
  if (minutes >= 60) {
    degrees += 1;
    minutes = 0;
  }
  return `${hemisphere} ${String(degrees).padStart(degreeDigits, '0')}°${minutes.toFixed(3).padStart(6, '0')}′`;
}

/** Metres → `15000 ft`. */
export function formatAltitudeFt(metres: number | null | undefined): string {
  return metres === null || metres === undefined ? NONE : `${integer.format(metres * M_TO_FT)} ft`;
}

/** m/s → `351 kt`. */
export function formatSpeedKt(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? NONE : `${integer.format(ms * MS_TO_KT)} kt`;
}

/** Mach number → `0.83`. */
export function formatMach(mach: number | null | undefined): string {
  return mach === null || mach === undefined ? NONE : mach.toFixed(2);
}

/** Vertical speed, m/s + up → `+1200 ft/min` / `-350 ft/min`, to 10 ft/min. */
export function formatVerticalSpeed(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return NONE;
  const fpm = Math.round((ms * M_TO_FT * 60) / 10) * 10;
  if (fpm === 0) return '0 ft/min';
  return `${fpm > 0 ? '+' : '-'}${integer.format(Math.abs(fpm))} ft/min`;
}

/**
 * Heading → `047°`, or `047°M` / `047°T` with a reference. 360 is shown as
 * 360, never 000. Headings follow DCS (protocol.md §0): magnetic as the cockpit
 * shows it, true from the map grid's north.
 */
export function formatHeading(
  degrees: number | null | undefined,
  reference: '' | 'M' | 'T' = '',
): string {
  if (degrees === null || degrees === undefined) return NONE;
  const rounded = Math.round(degrees) % 360;
  return `${String(rounded === 0 ? 360 : rounded).padStart(3, '0')}°${reference}`;
}

/**
 * Fuel weight in the airframe's gauge unit (scope §4.2): kg → `8624 lbs` or
 * `3912 kg`. The unit comes from the airframe table (`fuelUnit()`).
 */
export function formatFuel(kg: number | null | undefined, unit: FuelUnit): string {
  if (kg === null || kg === undefined) return NONE;
  return unit === 'lbs' ? `${integer.format(kg * KG_TO_LBS)} lbs` : `${integer.format(kg)} kg`;
}

/** Age of data: `now`, `12 s`, `3 min`, `2 h`. */
export function formatAge(ms: number): string {
  if (ms < 2000) return 'now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h`;
}

/** Mission clock for the status strip. */
export interface ClockText {
  /** e.g. `08:30:12` – `null` without a running mission. */
  time: string | null;
  /** `Z` for Zulu, `L` for local. */
  suffix: 'Z' | 'L';
  /** `true` when Zulu was asked for but the map's UTC offset is unknown. */
  zuluUnavailable: boolean;
  /** `true` while the mission is paused (single player): the clock stands still. */
  paused: boolean;
}

/**
 * The DCS mission clock (scope §4.6): mtime advanced by the time since it was
 * sampled (not while paused), shown as Zulu or local. Without a known UTC
 * offset for the map, Zulu falls back to local time and says so.
 */
export function missionClock(
  mission: MissionSlice,
  display: TimeDisplay,
  nowMs: number,
): ClockText {
  const clock = mission.clock;
  if (!mission.running || clock === null) {
    return {
      time: null,
      suffix: display === 'zulu' ? 'Z' : 'L',
      zuluUnavailable: false,
      paused: false,
    };
  }
  const elapsed = clock.paused ? 0 : Math.max(0, nowMs - clock.sampledAt) / 1000;
  const mtime = clock.mtimeSec + elapsed;
  const offset = mapUtcOffsetHours(mission.theatre);
  if (display === 'zulu' && offset !== null) {
    return {
      time: formatTimeOfDay(zuluTimeOfDay(mtime, offset)),
      suffix: 'Z',
      zuluUnavailable: false,
      paused: clock.paused,
    };
  }
  return {
    time: formatTimeOfDay(localTimeOfDay(mtime)),
    suffix: 'L',
    zuluUnavailable: display === 'zulu',
    paused: clock.paused,
  };
}
