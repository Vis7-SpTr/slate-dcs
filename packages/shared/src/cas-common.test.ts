// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  AoId,
  AoJoinCode,
  blockInverted,
  Frequency,
  isValidLaserCode,
  KeyholePoint,
  keyholePointName,
  LaserCode,
  normalizeAoJoinCode,
  PointRef,
} from './cas-common.js';

describe('laser codes (§9.5)', () => {
  it.each([1111, 1688, 1788, 1511, 1218])('accepts %i', (code) => {
    expect(isValidLaserCode(code)).toBe(true);
    expect(LaserCode.safeParse(code).success).toBe(true);
  });

  it.each([
    [2111, '1st digit not 1'],
    [1811, '2nd digit 8'],
    [1011, '2nd digit 0'],
    [1191, '3rd digit 9'],
    [1119, '4th digit 9'],
    [1110, '4th digit 0'],
    [111, 'three digits'],
    [11111, 'five digits'],
    [1688.5, 'not a whole number'],
  ])('rejects %d (%s)', (code) => {
    expect(isValidLaserCode(code)).toBe(false);
    expect(LaserCode.safeParse(code).success).toBe(false);
  });
});

describe('keyhole points (§8.5)', () => {
  it('accepts ALPHA 5 and ECHO', () => {
    expect(KeyholePoint.safeParse({ cmId: 'c_kh', axis: 'A', distanceNm: 5 }).success).toBe(true);
    expect(KeyholePoint.safeParse({ cmId: 'c_kh', axis: 'E' }).success).toBe(true);
    expect(KeyholePoint.safeParse({ cmId: 'c_kh', axis: 'E', distanceNm: null }).success).toBe(
      true,
    );
  });

  it.each([
    ['an axis point without a distance', { cmId: 'c_kh', axis: 'B' }],
    ['ECHO with a distance', { cmId: 'c_kh', axis: 'E', distanceNm: 3 }],
    ['a distance of 0', { cmId: 'c_kh', axis: 'C', distanceNm: 0 }],
    ['an axis that does not exist', { cmId: 'c_kh', axis: 'F', distanceNm: 5 }],
    ['more than 100 NM', { cmId: 'c_kh', axis: 'D', distanceNm: 101 }],
  ])('rejects %s', (_why, point) => {
    expect(KeyholePoint.safeParse(point).success).toBe(false);
  });

  it.each([
    ['A', 5, 'ALPHA 5'],
    ['B', 8, 'BRAVO 8'],
    ['C', 2.5, 'CHARLIE 2.5'],
    ['D', 10, 'DELTA 10'],
    ['E', null, 'ECHO'],
  ] as const)('names %s %s "%s"', (axis, distance, name) => {
    expect(keyholePointName(axis, distance)).toBe(name);
  });
});

describe('point references (§8.5)', () => {
  it('reads each kind', () => {
    expect(PointRef.parse({ cmId: 'c_ip_01' })).toEqual({ cmId: 'c_ip_01' });
    expect(PointRef.parse({ cmId: 'c_kh', axis: 'A', distanceNm: 5 })).toEqual({
      cmId: 'c_kh',
      axis: 'A',
      distanceNm: 5,
    });
    expect(PointRef.parse({ lat: 42.2, lon: 41.7 })).toEqual({ lat: 42.2, lon: 41.7 });
  });

  it('refuses a broken keyhole point instead of reading it as a named point', () => {
    expect(PointRef.safeParse({ cmId: 'c_kh', axis: 'A' }).success).toBe(false);
  });

  it('refuses coordinates out of range', () => {
    expect(PointRef.safeParse({ lat: 91, lon: 0 }).success).toBe(false);
  });
});

describe('IDs and codes', () => {
  it('AO IDs start with a_', () => {
    expect(AoId.safeParse('a_4m2k9q').success).toBe(true);
    expect(AoId.safeParse('Q4T-8MZ').success).toBe(false);
  });

  it('join codes look like flight codes and are normalised the same way', () => {
    expect(AoJoinCode.safeParse('Q4T-8MZ').success).toBe(true);
    expect(normalizeAoJoinCode('q4t 8mz')).toBe('Q4T-8MZ');
    expect(normalizeAoJoinCode('Q4T8M')).toBeNull();
  });
});

describe('frequencies and altitude blocks', () => {
  it('accepts a frequency with or without a label', () => {
    expect(Frequency.safeParse({ mhz: 251, label: 'AXEMAN PRI' }).success).toBe(true);
    expect(Frequency.safeParse({ mhz: 30.025, label: null }).success).toBe(true);
    expect(Frequency.safeParse({ mhz: 0, label: null }).success).toBe(false);
  });

  it('a floor above the ceiling is inverted only with the same reference', () => {
    expect(blockInverted({ m: 5000, ref: 'msl' }, { m: 4000, ref: 'msl' })).toBe(true);
    expect(blockInverted({ m: 4000, ref: 'msl' }, { m: 5000, ref: 'msl' })).toBe(false);
    expect(blockInverted({ m: 300, ref: 'agl' }, { m: 200, ref: 'msl' })).toBe(false);
  });
});
