// SPDX-License-Identifier: GPL-3.0-or-later

import { stationLayout } from '@slate-dcs/shared';
import type { StationPoint } from '@slate-dcs/shared';
import { describe, expect, it } from 'vitest';

import { LABEL_GAP, placeLabels } from './station-labels.js';

const point = (dcs: number, x: number, extra: Partial<StationPoint> = {}): StationPoint => ({
  dcs,
  label: String(dcs),
  x,
  y: 100,
  ...extra,
});

describe('placeLabels', () => {
  it('keeps well-spaced labels in one row', () => {
    const { labels, rowsBelow, rowsAbove } = placeLabels([
      point(1, 10),
      point(2, 50),
      point(3, 90),
    ]);
    expect(labels.map((l) => l.row)).toEqual([0, 0, 0]);
    expect(rowsBelow).toBe(1);
    expect(rowsAbove).toBe(0);
  });

  it('moves a label that would touch its neighbour one row out', () => {
    const { labels } = placeLabels([point(1, 10), point(2, 25), point(3, 40), point(4, 55)]);
    expect(labels.map((l) => [l.point.dcs, l.row])).toEqual([
      [1, 0],
      [2, 1],
      [3, 0],
      [4, 1],
    ]);
  });

  it('puts stations marked "above" above the sketch, at their own label x', () => {
    const { labels, rowsAbove } = placeLabels([
      point(1, 94, { above: true, labelX: 80 }),
      point(2, 106, { above: true, labelX: 120 }),
      point(3, 100),
    ]);
    expect(labels.filter((l) => l.side === 'above').map((l) => [l.x, l.row])).toEqual([
      [80, 0],
      [120, 0],
    ]);
    expect(rowsAbove).toBe(1);
  });

  it.each(['FA-18C_hornet', 'F-16C_50', 'F-14BU', 'AH-64D_BLK_II', 'A-10C_2'])(
    'never lets two labels of %s overlap',
    (type) => {
      const layout = stationLayout(type);
      if (layout === null) throw new Error('no layout');
      const { labels } = placeLabels(layout.stations);
      for (const a of labels) {
        for (const b of labels) {
          if (a !== b && a.side === b.side && a.row === b.row) {
            expect(Math.abs(a.x - b.x), `${a.point.label}/${b.point.label}`).toBeGreaterThanOrEqual(
              LABEL_GAP,
            );
          }
        }
      }
    },
  );
});
