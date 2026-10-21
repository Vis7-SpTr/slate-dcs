// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { formatTimeOfDay, localTimeOfDay, mapUtcOffsetHours, zuluTimeOfDay } from './maps.js';

describe('mapUtcOffsetHours', () => {
  it.each([
    ['Caucasus', 4],
    ['Syria', 3],
  ])('%s is UTC+%i', (theatre, offset) => {
    expect(mapUtcOffsetHours(theatre)).toBe(offset);
  });

  it('is null for an unknown map or no mission', () => {
    expect(mapUtcOffsetHours('SomeNewMap')).toBeNull();
    expect(mapUtcOffsetHours(null)).toBeNull();
  });
});

describe('mission clock', () => {
  it('turns mtime into the local time of day', () => {
    expect(localTimeOfDay(8 * 3600 + 30 * 60)).toBe(30_600);
  });

  it('wraps past midnight on long missions', () => {
    expect(localTimeOfDay(86_400 + 3600)).toBe(3600);
  });

  it('turns local time into Zulu with the map offset', () => {
    // 08:00 local on Caucasus (UTC+4) = 04:00Z
    expect(zuluTimeOfDay(8 * 3600, 4)).toBe(4 * 3600);
  });

  it('wraps to the previous day for Zulu', () => {
    // 02:00 local on Caucasus = 22:00Z the day before
    expect(zuluTimeOfDay(2 * 3600, 4)).toBe(22 * 3600);
  });

  it.each([
    [0, '00:00:00'],
    [30_600, '08:30:00'],
    [86_399, '23:59:59'],
    [3661.9, '01:01:01'],
    [86_400 + 5, '00:00:05'],
  ])('formats %d s as %s', (seconds, expected) => {
    expect(formatTimeOfDay(seconds)).toBe(expected);
  });
});
