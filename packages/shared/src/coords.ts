// SPDX-License-Identifier: GPL-3.0-or-later
// Coordinates per airframe (scope §4.1, decided 25 Oct 2026 – D1/D2): every
// position is shown in the format the airframe's cockpit uses, never split
// into keypad chunks. MGRS comes from the `mgrs` package (proj4js, MIT); the
// lat/long formats are own code. The table is checked by the user in the
// cockpit (P2.5).

import * as mgrsModule from 'mgrs';

import type { LatLon } from './cas-common.js';

/** `mgrs` `37T GG 26400 77879`, `dms` `N42°13'13.08"`, `ddm` `N42°13.218'`, `dd` `N42.22030°`. */
export type CoordFormat = 'mgrs' | 'dms' | 'ddm' | 'dd';

export interface CoordStyle {
  /** Shown in this order; the first is the main one (line 6 large). */
  formats: readonly CoordFormat[];
  /** MGRS digits, easting + northing: 10 = 1 m, 8 = 10 m. */
  mgrsDigits: 6 | 8 | 10;
  /** Decimals of the seconds (DMS) or minutes (DDM). */
  dmsDecimals: number;
  ddmDecimals: number;
}

/**
 * Node loads the package's CommonJS build (all of it under `default`), Vite
 * and Vitest its ES build (named exports only) – this works with both.
 */
const mgrs: typeof mgrsModule =
  'default' in mgrsModule
    ? (mgrsModule as unknown as { default: typeof mgrsModule }).default
    : mgrsModule;

const BASE: CoordStyle = {
  formats: ['mgrs', 'ddm'],
  mgrsDigits: 10,
  dmsDecimals: 2,
  ddmDecimals: 3,
};

/**
 * Per DCS unit type (scope §4.1). Every type not listed – the F-14B(U)
 * included – shows MGRS + DDM; JTACs MGRS.
 */
export const COORD_STYLES: Readonly<Record<string, CoordStyle>> = {
  /** Precise mode: DD°MM'SS.ss". */
  'FA-18C_hornet': { ...BASE, formats: ['dms'] },
  /** DD°MM.mmm'. */
  'F-16C_50': { ...BASE, formats: ['ddm'] },
  /** The TSD takes 8 digits. */
  'AH-64D_BLK_II': { ...BASE, formats: ['mgrs'], mgrsDigits: 8 },
  'A-10C_2': { ...BASE, formats: ['mgrs'] },
};

export const JTAC_COORD_STYLE: CoordStyle = { ...BASE, formats: ['mgrs'] };

/** The style for a viewer: a JTAC MGRS, a pilot his airframe's. */
export function coordStyle(type: string | null | undefined, role: 'jtac' | 'pilot'): CoordStyle {
  if (role === 'jtac') return JTAC_COORD_STYLE;
  return (type ? COORD_STYLES[type] : undefined) ?? BASE;
}

// ---------------------------------------------------------------------------
// Formatting

/** `37T GG 26400 77879` (10 digits), `37T GG 2640 7787` (8) – truncated, as MGRS is. */
export function formatMgrs(p: LatLon, digits: 6 | 8 | 10 = 10): string {
  const text = mgrs.forward([p.lon, p.lat], digits / 2);
  const match = /^(\d{1,2}[A-Z])([A-Z]{2})(\d*)$/.exec(text);
  if (!match) return text;
  const [, zone = '', square = '', numbers = ''] = match;
  const half = numbers.length / 2;
  return `${zone} ${square} ${numbers.slice(0, half)} ${numbers.slice(half)}`;
}

/** `N42°13'13.08" E041°44'35.16"`. */
export function formatDms(p: LatLon, decimals = 2): string {
  const part = (value: number, pos: string, neg: string, width: number) => {
    const scale = 10 ** decimals;
    // In whole units of the last decimal, so 59.999 rounds up into the next minute.
    const total = Math.round(Math.abs(value) * 3600 * scale);
    const deg = Math.floor(total / (3600 * scale));
    const min = Math.floor((total % (3600 * scale)) / (60 * scale));
    const sec = (total % (60 * scale)) / scale;
    const secText = sec.toFixed(decimals).padStart(decimals > 0 ? 3 + decimals : 2, '0');
    return `${value < 0 ? neg : pos}${String(deg).padStart(width, '0')}°${String(min).padStart(2, '0')}'${secText}"`;
  };
  return `${part(p.lat, 'N', 'S', 2)} ${part(p.lon, 'E', 'W', 3)}`;
}

/** `N42°13.218' E041°44.586'`. */
export function formatDdm(p: LatLon, decimals = 3): string {
  const part = (value: number, pos: string, neg: string, width: number) => {
    const scale = 10 ** decimals;
    const total = Math.round(Math.abs(value) * 60 * scale);
    const deg = Math.floor(total / (60 * scale));
    const min = (total % (60 * scale)) / scale;
    const minText = min.toFixed(decimals).padStart(decimals > 0 ? 3 + decimals : 2, '0');
    return `${value < 0 ? neg : pos}${String(deg).padStart(width, '0')}°${minText}'`;
  };
  return `${part(p.lat, 'N', 'S', 2)} ${part(p.lon, 'E', 'W', 3)}`;
}

/** `N42.22030° E041.74310°`. */
export function formatDd(p: LatLon, decimals = 5): string {
  const part = (value: number, pos: string, neg: string, width: number) =>
    `${value < 0 ? neg : pos}${Math.abs(value)
      .toFixed(decimals)
      .padStart(width + 1 + decimals, '0')}°`;
  return `${part(p.lat, 'N', 'S', 2)} ${part(p.lon, 'E', 'W', 3)}`;
}

export function formatCoord(p: LatLon, format: CoordFormat, style: CoordStyle = BASE): string {
  switch (format) {
    case 'mgrs':
      return formatMgrs(p, style.mgrsDigits);
    case 'dms':
      return formatDms(p, style.dmsDecimals);
    case 'ddm':
      return formatDdm(p, style.ddmDecimals);
    case 'dd':
      return formatDd(p);
  }
}

/** The position in each of the style's formats, main one first. */
export function formatPosition(p: LatLon, style: CoordStyle): string[] {
  return style.formats.map((format) => formatCoord(p, format, style));
}

/** Elevation in feet, as the cockpits use (scope §4.1): `1352 ft`. */
export function formatElevationFt(metres: number): string {
  return `${String(Math.round(metres / 0.3048))} ft`;
}

// ---------------------------------------------------------------------------
// Parsing typed coordinates (the converter, D1)

const MGRS_TEXT = /^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z]{2})(\d*)$/;

/** MGRS with or without spaces (`37TGG2640077879`, `37T GG 26400 77879`); `null` if it isn't one. */
export function parseMgrs(text: string): LatLon | null {
  // Typed with spaces, easting and northing must have as many digits each
  // (`37T GG 264 77879` is a typo, not an 8-digit grid).
  const groups = text.trim().split(/\s+/);
  const east = groups.at(-2);
  const north = groups.at(-1);
  if (groups.length >= 3 && east && north && /^\d+$/.test(east) && /^\d+$/.test(north)) {
    if (east.length !== north.length) return null;
  }
  const compact = text.replace(/\s+/g, '').toUpperCase();
  const match = MGRS_TEXT.exec(compact);
  if (!match) return null;
  const digits = match[4] ?? '';
  if (digits.length % 2 !== 0 || digits.length > 10) return null;
  const zone = Number(match[1]);
  if (zone < 1 || zone > 60) return null;
  try {
    const [lon, lat] = mgrs.toPoint(compact);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  } catch {
    return null;
  }
}

/**
 * One axis: hemisphere letter before or after (or a sign), then degrees,
 * optional minutes and seconds – separated by spaces or ° ' ".
 */
function parseAxis(text: string, pos: string, neg: string, max: number): number | null {
  let t = text.trim().toUpperCase();
  let sign = 1;
  const lead = t.at(0);
  const tail = t.at(-1);
  if (lead === pos || lead === neg) {
    sign = lead === neg ? -1 : 1;
    t = t.slice(1);
  } else if (tail === pos || tail === neg) {
    sign = tail === neg ? -1 : 1;
    t = t.slice(0, -1);
  } else if (t.startsWith('-')) {
    sign = -1;
    t = t.slice(1);
  } else if (t.startsWith('+')) {
    t = t.slice(1);
  }
  const parts = t
    .replace(/[°'"′″’”]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((s) => s !== '');
  if (parts.length < 1 || parts.length > 3 || !parts.every((s) => /^\d+(\.\d+)?$/.test(s))) {
    return null;
  }
  const [d = 0, m = 0, s = 0] = parts.map(Number);
  // Only the last part may have decimals; minutes and seconds below 60.
  if (parts.slice(0, -1).some((s) => s.includes('.'))) return null;
  if ((parts.length > 1 && m >= 60) || (parts.length > 2 && s >= 60)) return null;
  const value = d + m / 60 + s / 3600;
  return value > max ? null : sign * value;
}

/**
 * Typed coordinates in any of the formats: MGRS, or latitude and longitude as
 * DD, DDM or DMS (`N42 13.218 E041 44.586`, `42.2203, 41.7431`,
 * `N42°13'13.08" E041°44'35.16"`). `null` if it can't be read.
 */
export function parseCoordinates(text: string): LatLon | null {
  const mgrs = parseMgrs(text);
  if (mgrs) return mgrs;
  const t = text.trim().toUpperCase();
  // Split before the longitude: at its hemisphere letter, or at a comma / semicolon.
  let latText: string;
  let lonText: string;
  const comma = /[,;]/.exec(t);
  if (comma) {
    latText = t.slice(0, comma.index);
    lonText = t.slice(comma.index + 1);
  } else {
    const ew = /[EW]/.exec(t);
    if (ew) {
      // `N42 13 E041 44` or `42 13 N 041 44 E`: the letter starts or ends the longitude.
      const before = t.slice(0, ew.index).trim();
      const after = t.slice(ew.index + 1).trim();
      if (after === '') {
        const ns = /[NS]/.exec(before);
        if (!ns) return null;
        latText = before.slice(0, ns.index + 1);
        lonText = `${before.slice(ns.index + 1)}${t.slice(ew.index, ew.index + 1)}`;
      } else {
        latText = before;
        lonText = t.slice(ew.index);
      }
    } else {
      // Two plain decimal numbers.
      const numbers = t.split(/\s+/);
      if (numbers.length !== 2) return null;
      [latText = '', lonText = ''] = numbers;
    }
  }
  const lat = parseAxis(latText, 'N', 'S', 90);
  const lon = parseAxis(lonText, 'E', 'W', 180);
  return lat === null || lon === null ? null : { lat, lon };
}
