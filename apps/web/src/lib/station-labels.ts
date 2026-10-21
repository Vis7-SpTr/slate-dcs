// SPDX-License-Identifier: GPL-3.0-or-later
// Where the station labels of the armament diagram go: in rows below the
// sketch (or above it for stations marked `above`), each in line with its
// station. A label that would touch its left neighbour moves one row further
// out, so labels never overlap however close the stations are.

import type { StationPoint } from '@slate-dcs/shared';

/** Smallest distance between two labels in one row, in SVG units (≈ 6 characters). */
export const LABEL_GAP = 24;

export interface PlacedLabel {
  point: StationPoint;
  side: 'above' | 'below';
  /** 0 = the row next to the sketch, 1 = the next one out, … */
  row: number;
  /** Label x (the station's x unless the layout gives one). */
  x: number;
}

export interface LabelPlacement {
  labels: PlacedLabel[];
  rowsAbove: number;
  rowsBelow: number;
}

function placeSide(points: readonly StationPoint[], side: PlacedLabel['side']): PlacedLabel[] {
  const rowEnds: number[] = [];
  return [...points]
    .map((point) => ({ point, x: point.labelX ?? point.x }))
    .sort((a, b) => a.x - b.x)
    .map(({ point, x }) => {
      let row = rowEnds.findIndex((end) => x - end >= LABEL_GAP);
      if (row === -1) {
        row = rowEnds.length;
        rowEnds.push(x);
      } else {
        rowEnds[row] = x;
      }
      return { point, side, row, x };
    });
}

export function placeLabels(points: readonly StationPoint[]): LabelPlacement {
  const above = placeSide(
    points.filter((p) => p.above === true),
    'above',
  );
  const below = placeSide(
    points.filter((p) => p.above !== true),
    'below',
  );
  const rows = (labels: PlacedLabel[]) =>
    labels.length === 0 ? 0 : Math.max(...labels.map((l) => l.row)) + 1;
  return { labels: [...above, ...below], rowsAbove: rows(above), rowsBelow: rows(below) };
}
