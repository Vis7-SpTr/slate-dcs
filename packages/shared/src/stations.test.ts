// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { AIRFRAMES } from './airframes.js';
import { STATION_LAYOUTS, stationLabel, stationLayout } from './stations.js';

describe('station layouts', () => {
  it('exist for every airframe in the airframe table', () => {
    for (const type of Object.keys(AIRFRAMES)) expect(stationLayout(type), type).not.toBeNull();
  });

  it.each(Object.entries(STATION_LAYOUTS))(
    '%s: stations are unique and inside the box',
    (_type, layout) => {
      const indices = layout.stations.map((s) => s.dcs);
      expect(new Set(indices).size).toBe(indices.length);
      const labels = layout.stations.map((s) => s.label);
      expect(new Set(labels).size).toBe(labels.length);
      const [top, bottom] = layout.view;
      for (const s of layout.stations) {
        expect(s.x, s.label).toBeGreaterThanOrEqual(0);
        expect(s.x, s.label).toBeLessThanOrEqual(200);
        expect(s.y, s.label).toBeGreaterThanOrEqual(top);
        expect(s.y, s.label).toBeLessThanOrEqual(bottom);
      }
    },
  );

  it('has no layout for unknown types', () => {
    expect(stationLayout('Su-25T')).toBeNull();
    expect(stationLayout(null)).toBeNull();
  });
});

describe('stationLabel', () => {
  it.each([
    ['FA-18C_hornet', 5, '5'],
    ['F-16C_50', 10, '5L'],
    ['F-16C_50', 11, '5R'],
    ['F-14BU', 1, '1A'],
    ['F-14BU', 3, '2'],
    ['F-14B', 9, '8B'],
    ['F-14B', 10, '8A'],
    ['AH-64D_BLK_II', 5, 'AUX'],
    ['AH-64D_BLK_II', 6, 'FCR'],
    ['A-10C_2', 11, '11'],
  ])('%s DCS %i → %s', (type, dcs, label) => {
    expect(stationLabel(type, dcs)).toBe(label);
  });

  it('falls back to the DCS index', () => {
    expect(stationLabel('Su-25T', 4)).toBe('4');
    expect(stationLabel('FA-18C_hornet', 10)).toBe('10');
    expect(stationLabel(null, 2)).toBe('2');
  });
});
