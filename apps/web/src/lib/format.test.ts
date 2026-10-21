// SPDX-License-Identifier: GPL-3.0-or-later

import type { MissionSlice } from '@slate-dcs/shared';
import { describe, expect, it } from 'vitest';

import {
  formatAge,
  formatAltitudeFt,
  formatHeading,
  formatKg,
  formatLatLon,
  formatSpeedKt,
  missionClock,
} from './format.js';
import { t } from './i18n/index.js';

describe('formatLatLon', () => {
  it('formats degrees and decimal minutes like a cockpit keypad', () => {
    expect(formatLatLon(41.6123, 41.6391)).toEqual({ lat: 'N 41°36.738′', lon: 'E 041°38.346′' });
  });

  it('handles the southern and western hemispheres', () => {
    expect(formatLatLon(-51.75, -59.0)).toEqual({ lat: 'S 51°45.000′', lon: 'W 059°00.000′' });
  });

  it('never shows 60 minutes', () => {
    expect(formatLatLon(41.99999999, 41.0).lat).toBe('N 42°00.000′');
  });
});

describe('units', () => {
  it.each([
    [formatAltitudeFt(4572.4), '15001 ft'],
    [formatAltitudeFt(null), '—'],
    [formatSpeedKt(180.5), '351 kt'],
    [formatSpeedKt(undefined), '—'],
    [formatKg(3912), '3912 kg'],
    [formatHeading(47.3), '047°'],
    [formatHeading(359.7), '360°'],
    [formatHeading(0.2), '360°'],
    [formatHeading(180), '180°'],
  ])('%s → %s', (actual, expected) => {
    expect(actual).toBe(expected);
  });
});

describe('formatAge', () => {
  it.each([
    [500, 'now'],
    [12_000, '12 s'],
    [180_000, '3 min'],
    [7_200_000, '2 h'],
  ])('%i ms → %s', (ms, expected) => {
    expect(formatAge(ms)).toBe(expected);
  });
});

describe('missionClock', () => {
  const running: MissionSlice = {
    running: true,
    theatre: 'Caucasus',
    startDate: '2026-06-21',
    clock: { mtimeSec: 8 * 3600 + 30 * 60, sampledAt: 1_000_000 },
  };

  it('shows nothing without a mission', () => {
    const none: MissionSlice = { running: false, theatre: null, startDate: null, clock: null };
    expect(missionClock(none, 'zulu', 0)).toEqual({
      time: null,
      suffix: 'Z',
      zuluUnavailable: false,
    });
  });

  it('shows local time and advances it with the wall clock', () => {
    expect(missionClock(running, 'local', 1_000_000 + 12_000)).toEqual({
      time: '08:30:12',
      suffix: 'L',
      zuluUnavailable: false,
    });
  });

  it('shows Zulu with the map offset (Caucasus UTC+4)', () => {
    expect(missionClock(running, 'zulu', 1_000_000)).toEqual({
      time: '04:30:00',
      suffix: 'Z',
      zuluUnavailable: false,
    });
  });

  it('falls back to local time on a map without a known offset', () => {
    const unknown = { ...running, theatre: 'SomeNewMap' };
    expect(missionClock(unknown, 'zulu', 1_000_000)).toEqual({
      time: '08:30:00',
      suffix: 'L',
      zuluUnavailable: true,
    });
  });
});

describe('t', () => {
  it('returns the text for a key', () => {
    expect(t('tab.map')).toBe('Map');
  });

  it('fills in parameters', () => {
    expect(t('aircraft.station', { st: 3 })).toBe('Station 3');
    expect(t('cmd.failed', { text: 'No relay' })).toBe('Not done: No relay');
  });

  it('leaves unknown parameters visible', () => {
    expect(t('aircraft.station')).toBe('Station {st}');
  });
});
