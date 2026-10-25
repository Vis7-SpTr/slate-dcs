// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  blocksOverlap,
  destination,
  distanceM,
  holdArea,
  holdsConflict,
  keyholePosition,
  resolvePoint,
} from './cas-geo.js';
import type { HoldShapeInput } from './cas-geo.js';

const NM = 1852;
const KUTAISI = { lat: 42.176, lon: 42.482 };
const ECHO = { lat: 42.2, lon: 41.7 };
const lookup = (cmId: string) => (cmId === 'c_kh' || cmId === 'c_ip' ? ECHO : null);

describe('distance and destination', () => {
  it('1° of latitude is about 60 NM', () => {
    expect(distanceM({ lat: 42, lon: 41 }, { lat: 43, lon: 41 }) / NM).toBeCloseTo(60, 0);
  });

  it('goes there and back', () => {
    const there = destination(KUTAISI, 137, 15 * NM);
    expect(distanceM(KUTAISI, there) / NM).toBeCloseTo(15, 3);
  });
});

describe('keyhole points (§8.5)', () => {
  it('ALPHA 5 is 5 NM north of ECHO, DELTA 5 the same distance west', () => {
    const alpha = keyholePosition(ECHO, 'A', 5);
    expect(alpha.lon).toBeCloseTo(ECHO.lon, 6);
    expect(alpha.lat).toBeGreaterThan(ECHO.lat);
    expect(distanceM(ECHO, alpha) / NM).toBeCloseTo(5, 3);
    const delta = keyholePosition(ECHO, 'D', 5);
    expect(delta.lon).toBeLessThan(ECHO.lon);
    expect(distanceM(ECHO, delta) / NM).toBeCloseTo(5, 3);
  });

  it('turns the grid axis into a meridian bearing', () => {
    const turned = keyholePosition(ECHO, 'A', 5, 6.4);
    expect(turned.lon).toBeGreaterThan(ECHO.lon);
  });

  it('resolves point references', () => {
    expect(resolvePoint({ lat: 1, lon: 2 }, lookup)).toEqual({ lat: 1, lon: 2 });
    expect(resolvePoint({ cmId: 'c_ip' }, lookup)).toEqual(ECHO);
    expect(resolvePoint({ cmId: 'c_kh', axis: 'E' }, lookup)).toEqual(ECHO);
    expect(resolvePoint({ cmId: 'c_kh', axis: 'C', distanceNm: 3 }, lookup)?.lat).toBeLessThan(
      ECHO.lat,
    );
    expect(resolvePoint({ cmId: 'c_gone' }, lookup)).toBeNull();
  });
});

describe('altitude blocks', () => {
  const msl = (m: number) => ({ m, ref: 'msl' as const });
  it.each([
    [msl(4500), msl(5100), msl(4800), msl(5400), true],
    [msl(4500), msl(5100), msl(5100), msl(5700), false],
    [msl(4500), msl(5100), msl(6000), msl(6600), false],
    [{ m: 0, ref: 'sfc' as const }, msl(3000), msl(2500), msl(4000), true],
    [{ m: 0, ref: 'sfc' as const }, msl(3000), msl(3500), msl(4000), false],
    [msl(4500), msl(5100), { m: 300, ref: 'agl' as const }, { m: 900, ref: 'agl' as const }, true],
  ])('%o–%o against %o–%o overlaps: %s', (af, ac, bf, bc, expected) => {
    expect(blocksOverlap({ floor: af, ceiling: ac }, { floor: bf, ceiling: bc })).toBe(expected);
  });
});

describe('hold conflicts (§9.4)', () => {
  const hold = (extra: Partial<HoldShapeInput>): HoldShapeInput => ({
    point: { cmId: 'c_kh', axis: 'A', distanceNm: 8 },
    floor: { m: 4572, ref: 'msl' },
    ceiling: { m: 5181, ref: 'msl' },
    shape: 'orbit',
    radiusM: 2 * NM,
    legM: null,
    inboundDeg: null,
    ...extra,
  });

  it('two orbits on the same point and block conflict', () => {
    expect(holdsConflict(hold({}), hold({}), lookup)).toBe(true);
  });

  it('stacked blocks over the same point do not', () => {
    const above = hold({ floor: { m: 5181, ref: 'msl' }, ceiling: { m: 5800, ref: 'msl' } });
    expect(holdsConflict(hold({}), above, lookup)).toBe(false);
  });

  it('ALPHA 8 and CHARLIE 8 at the same block do not', () => {
    const charlie = hold({ point: { cmId: 'c_kh', axis: 'C', distanceNm: 8 } });
    expect(holdsConflict(hold({}), charlie, lookup)).toBe(false);
  });

  it('a racetrack covers its leg and turns behind the point', () => {
    const track = hold({ shape: 'racetrack', radiusM: null, legM: 5 * NM, inboundDeg: 180 });
    const area = holdArea(track, lookup);
    // Inbound 180° = flying south into the point, so the leg lies north of it.
    expect(area?.center.lat).toBeGreaterThan(resolvePoint(track.point, lookup)?.lat ?? 0);
    const north = hold({ point: { cmId: 'c_kh', axis: 'A', distanceNm: 13 } });
    expect(holdsConflict(track, north, lookup)).toBe(true);
  });

  it('a hold on an unknown point never conflicts', () => {
    expect(holdsConflict(hold({ point: { cmId: 'c_gone' } }), hold({}), lookup)).toBe(false);
  });
});
