// SPDX-License-Identifier: GPL-3.0-or-later
// Coordinates per airframe (scope §4.1, D1/D2), helicopters and bingo
// defaults (§6.5, R9), grid north per map and keyhole points (§8.5, R10).

import { describe, expect, it } from 'vitest';

import { defaultBingoKg, isRotary, KG_PER_LB } from './airframes.js';
import { distanceM, keyholePoint } from './cas-geo.js';
import {
  coordStyle,
  formatDd,
  formatDdm,
  formatDms,
  formatElevationFt,
  formatMgrs,
  formatPosition,
  parseCoordinates,
  parseMgrs,
} from './coords.js';
import { gridConvergenceDeg } from './maps.js';

/** Near Kutaisi – a 9-line target. */
const TARGET = { lat: 42.2203, lon: 41.7431 };

describe('formats per airframe (D2)', () => {
  it('Hornet DMS precise, Viper DDM, Apache 8-digit MGRS, A-10C MGRS, others MGRS + DDM, JTAC MGRS', () => {
    expect(formatPosition(TARGET, coordStyle('FA-18C_hornet', 'pilot'))).toEqual([
      `N42°13'13.08" E041°44'35.16"`,
    ]);
    expect(formatPosition(TARGET, coordStyle('F-16C_50', 'pilot'))).toEqual([
      `N42°13.218' E041°44.586'`,
    ]);
    expect(formatPosition(TARGET, coordStyle('AH-64D_BLK_II', 'pilot'))).toEqual([
      '37T GG 2640 7787',
    ]);
    expect(formatPosition(TARGET, coordStyle('A-10C_2', 'pilot'))).toEqual(['37T GG 26400 77879']);
    expect(formatPosition(TARGET, coordStyle('F-14BU', 'pilot'))).toEqual([
      '37T GG 26400 77879',
      `N42°13.218' E041°44.586'`,
    ]);
    expect(formatPosition(TARGET, coordStyle(null, 'pilot'))).toHaveLength(2);
    // A JTAC sees MGRS whatever slot he is in.
    expect(formatPosition(TARGET, coordStyle('FA-18C_hornet', 'jtac'))).toEqual([
      '37T GG 26400 77879',
    ]);
  });

  it('rounds into the next minute or degree instead of showing 60', () => {
    expect(formatDms({ lat: 42.999_999_99, lon: -70.5 })).toBe(`N43°00'00.00" W070°30'00.00"`);
    expect(formatDdm({ lat: -0.999_999_99, lon: 179.999_99 })).toBe(`S01°00.000' E179°59.999'`);
    expect(formatDd({ lat: -33.5, lon: 7.25 })).toBe('S33.50000° E007.25000°');
  });

  it('MGRS is truncated, not rounded, as the grid is read', () => {
    // 26400.9 m east stays 26400; 8 digits drop the last digit of each.
    expect(formatMgrs(TARGET, 10)).toBe('37T GG 26400 77879');
    expect(formatMgrs(TARGET, 8)).toBe('37T GG 2640 7787');
    expect(formatMgrs(TARGET, 6)).toBe('37T GG 264 778');
  });

  it('elevation in feet', () => {
    expect(formatElevationFt(412)).toBe('1352 ft');
  });
});

describe('typed coordinates (D1)', () => {
  it('reads MGRS with or without spaces, and every lat/long format', () => {
    const near = (text: string) => {
      const p = parseCoordinates(text);
      if (!p) throw new Error(`not read: ${text}`);
      return distanceM(p, TARGET);
    };
    expect(near('37T GG 26400 77879')).toBeLessThan(2);
    expect(near('37tgg2640077879')).toBeLessThan(2);
    expect(near('37T GG 2640 7787')).toBeLessThan(15);
    expect(near(`N42°13'13.08" E041°44'35.16"`)).toBeLessThan(1);
    expect(near('N42 13 13.08 E041 44 35.16')).toBeLessThan(1);
    expect(near(`N42°13.218' E041°44.586'`)).toBeLessThan(1);
    expect(near('N42 13.218 E41 44.586')).toBeLessThan(1);
    expect(near('42 13.218 N 041 44.586 E')).toBeLessThan(1);
    expect(near('42.2203, 41.7431')).toBeLessThan(1);
    expect(near('42.2203 41.7431')).toBeLessThan(1);
    expect(parseCoordinates('S33 30 W070 30')).toEqual({ lat: -33.5, lon: -70.5 });
    expect(parseCoordinates('-33.5, -70.5')).toEqual({ lat: -33.5, lon: -70.5 });
  });

  it('every format read back gives the same place', () => {
    for (const type of ['FA-18C_hornet', 'F-16C_50', 'AH-64D_BLK_II', 'F-14BU']) {
      for (const text of formatPosition(TARGET, coordStyle(type, 'pilot'))) {
        const p = parseCoordinates(text);
        expect(p && distanceM(p, TARGET)).toBeLessThan(15);
      }
    }
  });

  it('refuses what isn’t a coordinate', () => {
    for (const text of [
      '',
      'garbage',
      'N91 E10',
      'N42 61 E041 10',
      'N42.5 30 E041 10',
      '37T GG 264 77879',
      '37T GG 2640077879 1',
      '61T GG 26400 77879',
    ]) {
      expect(parseCoordinates(text)).toBeNull();
    }
    expect(parseMgrs('42.2203 41.7431')).toBeNull();
  });
});

describe('helicopters and the bingo default (§6.5, R9)', () => {
  it('2000 lbs fixed wing, 750 lbs rotary wing; 907 / 340 kg on kg gauges', () => {
    expect(isRotary('AH-64D_BLK_II')).toBe(true);
    expect(isRotary('Ka-50_3')).toBe(true);
    expect(isRotary('FA-18C_hornet')).toBe(false);
    expect(isRotary(null)).toBe(false);
    expect(defaultBingoKg('FA-18C_hornet') / KG_PER_LB).toBeCloseTo(2000, 6);
    expect(defaultBingoKg('AH-64D_BLK_II') / KG_PER_LB).toBeCloseTo(750, 6);
    // Not in the airframe table: kg gauges.
    expect(defaultBingoKg('Su-25T')).toBe(907);
    expect(defaultBingoKg('Mi-8MT')).toBe(340);
  });
});

describe('grid north and keyhole points (§8.5, R10)', () => {
  // Spike 3.2 run A (F/A-18C, Caucasus): the aircraft and DCS's own point 1 km
  // grid-north of it (LoLoCoordinatesToGeoCoordinates(x + 1000, z)).
  const AT = { lat: 43.644_065_372_2, lon: 43.664_750_133_5 };
  const GRID_NORTH = { lat: 43.652_913_601_2, lon: 43.666_334_209_6 };

  it('Caucasus: γ from the central meridian matches DCS’s own projection', () => {
    const rad = Math.PI / 180;
    const east = (GRID_NORTH.lon - AT.lon) * Math.cos(AT.lat * rad);
    const north = GRID_NORTH.lat - AT.lat;
    const measured = Math.atan2(east, north) / rad;
    expect(measured).toBeCloseTo(7.38, 2);
    expect(gridConvergenceDeg('Caucasus', AT)).toBeCloseTo(measured, 1);
    expect(gridConvergenceDeg('Atlantis', AT)).toBeNull();
    expect(gridConvergenceDeg(null, AT)).toBeNull();
  });

  it('ALPHA 1 from ECHO lies where DCS puts grid north', () => {
    // 1 km grid-north of the spike point, as a keyhole: ALPHA at 1000 m.
    const alpha = keyholePoint(AT, 'A', 1000 / 1852, 'Caucasus');
    expect(distanceM(alpha, GRID_NORTH)).toBeLessThan(2);
    // Without the map's grid north it would be ~130 m off.
    const meridian = keyholePoint(AT, 'A', 1000 / 1852, null);
    expect(distanceM(meridian, GRID_NORTH)).toBeGreaterThan(100);
    expect(keyholePoint(AT, 'E', null, 'Caucasus')).toEqual(AT);
  });
});
