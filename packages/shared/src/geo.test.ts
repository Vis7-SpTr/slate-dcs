// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { headingDegFromRad, normalizeDegrees, shortBearingDeg } from './geo.js';

// F/A-18C near Mineralnye Vody (spike 3.2 run A): own position, and the point
// 1 km grid-north of it in the Caucasus projection (reference values from PROJ).
const OWN = { lat: 43.6440653722, lon: 43.6647501335 };
const GRID_NORTH = { lat: 43.6529136012, lon: 43.6663342096 };
/** Geodesic bearing OWN → GRID_NORTH = angle between grid and geographic north there. */
const CONVERGENCE = 7.40632;

describe('normalizeDegrees', () => {
  it.each([
    [0, 0],
    [359.5, 359.5],
    [360, 0],
    [725, 5],
    [-10, 350],
    [-1e-15, 0],
  ])('%d → %d', (input, output) => {
    expect(normalizeDegrees(input)).toBeCloseTo(output, 9);
  });
});

describe('shortBearingDeg', () => {
  it('matches the geodesic to within 0.002° at 1 km', () => {
    const bearing = shortBearingDeg(OWN.lat, OWN.lon, GRID_NORTH.lat, GRID_NORTH.lon);
    expect(Math.abs(bearing - CONVERGENCE)).toBeLessThan(0.002);
  });

  it('gives the four cardinal directions', () => {
    expect(shortBearingDeg(42, 41, 42.01, 41)).toBeCloseTo(0, 6);
    expect(shortBearingDeg(42, 41, 42, 41.01)).toBeCloseTo(90, 6);
    expect(shortBearingDeg(42, 41, 41.99, 41)).toBeCloseTo(180, 6);
    expect(shortBearingDeg(42, 41, 42, 40.99)).toBeCloseTo(270, 6);
  });

  it('gives a bearing just west of north as 350–360°', () => {
    expect(shortBearingDeg(45, 30, 45.009, 29.9995)).toBeGreaterThan(350);
  });
});

describe('headingDegFromRad', () => {
  it('turns the Hornet sample (7.0793 rad, not normalised) into 45.61°', () => {
    expect(headingDegFromRad(7.07928150892)).toBeCloseTo(45.6129, 3);
  });

  it('stays below 360 and handles negative angles', () => {
    expect(headingDegFromRad(2 * Math.PI)).toBe(0);
    expect(headingDegFromRad(-Math.PI / 2)).toBeCloseTo(270, 9);
  });
});
