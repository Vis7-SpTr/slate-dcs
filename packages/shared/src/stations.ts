// SPDX-License-Identifier: GPL-3.0-or-later
// Station layouts for the armament diagram (Ownship → Aircraft, full view):
// a minimal top view of the part of the airframe that carries weapons, where
// each station sits, and its label as the cockpit shows it.
//
// Coordinates are SVG units in a 200-wide box, nose up, pilot's left on the
// left. Outlines are SLATE's own schematic sketches, not to scale.

/** One station of a layout. */
export interface StationPoint {
  /** DCS station index (`st` in the status package). */
  dcs: number;
  /** Label as the cockpit shows it, e.g. `5L`, `8B`. */
  label: string;
  x: number;
  y: number;
  /** Put the label above the sketch instead of below (crowded spots). */
  above?: boolean;
  /** Label x when it can't sit straight in line with the station. */
  labelX?: number;
}

export interface StationLayout {
  /** Top and bottom of the sketch (y), for sizing the drawing. */
  view: readonly [top: number, bottom: number];
  /** SVG path data: wings and centre body. */
  shapes: readonly string[];
  stations: readonly StationPoint[];
}

const st = (
  dcs: number,
  label: string,
  x: number,
  y: number,
  options: { above?: boolean; labelX?: number } = {},
): StationPoint => ({ dcs, label, x, y, ...options });

/** F/A-18C: stations 1–9 from the left wingtip; DCS numbers them the same (spike 3.3). */
const HORNET: StationLayout = {
  view: [70, 168],
  shapes: [
    'M89,72 L84,98 L12,132 L10,152 L89,160 Z',
    'M111,72 L116,98 L188,132 L190,152 L111,160 Z',
    'M88,76 L112,76 L112,168 L88,168 Z',
  ],
  stations: [
    st(1, '1', 11, 142),
    st(2, '2', 37, 140),
    st(3, '3', 62, 136),
    st(4, '4', 92, 140),
    st(5, '5', 100, 156),
    st(6, '6', 108, 140),
    st(7, '7', 138, 136),
    st(8, '8', 163, 140),
    st(9, '9', 189, 142),
  ],
};

/**
 * F-16C: stations 1–9 from the left wingtip; DCS 10/11 are the intake pod
 * stations 5L/5R (spike 3.3, labels confirmed 21 Oct 2026).
 */
const VIPER: StationLayout = {
  view: [70, 190],
  shapes: [
    'M91,74 L84,104 L14,170 L12,184 L91,188 Z',
    'M109,74 L116,104 L186,170 L188,184 L109,188 Z',
    'M90,74 L110,74 L110,190 L90,190 Z',
  ],
  stations: [
    st(1, '1', 12, 178),
    st(2, '2', 31, 170),
    st(3, '3', 53, 160),
    st(4, '4', 75, 150),
    st(5, '5', 100, 178),
    st(6, '6', 125, 150),
    st(7, '7', 147, 160),
    st(8, '8', 169, 170),
    st(9, '9', 188, 178),
    st(10, '5L', 94, 90),
    st(11, '5R', 106, 90),
  ],
};

/**
 * F-14: DCS 1–10 = 1A, 1B, 2 … 7, 8B, 8A. Tanks on 2/7; tunnel 3 and 6 front,
 * 4 and 5 rear (spike 3.3 log: AIM-54 on 3 and 6, AIM-7 on 4; confirmed 21 Oct 2026).
 */
const TOMCAT: StationLayout = {
  view: [82, 184],
  shapes: [
    'M77,90 L10,138 L12,156 L77,130 Z',
    'M123,90 L190,138 L188,156 L123,130 Z',
    'M76,88 L124,88 L124,184 L76,184 Z',
  ],
  stations: [
    st(1, '1A', 50, 112),
    st(2, '1B', 64, 110),
    st(3, '2', 82, 150),
    st(4, '3', 94, 104, { above: true, labelX: 80 }),
    st(5, '4', 94, 166),
    st(6, '5', 106, 166),
    st(7, '6', 106, 104, { above: true, labelX: 120 }),
    st(8, '7', 118, 150),
    st(9, '8B', 136, 110),
    st(10, '8A', 150, 112),
  ],
};

/**
 * AH-64D: pylons 1–4 from left outboard; DCS 5 = internal auxiliary fuel
 * tank, DCS 6 = Longbow FCR on the mast (spike 3.3, confirmed 21 Oct 2026).
 */
const APACHE: StationLayout = {
  view: [72, 126],
  shapes: [
    'M92,76 L108,76 L108,126 L92,126 Z',
    'M93,104 L172,106 L172,116 L93,118 Z',
    'M107,104 L28,106 L28,116 L107,118 Z',
  ],
  stations: [
    st(1, '1', 36, 111),
    st(2, '2', 64, 111),
    st(3, '3', 136, 111),
    st(4, '4', 164, 111),
    st(5, 'AUX', 100, 116),
    st(6, 'FCR', 100, 86, { above: true }),
  ],
};

/**
 * A-10C II: stations 1–11 from the left wingtip. DCS's numbering is assumed
 * to be the same – not yet seen in a log (check in the next A-10 flight).
 */
const WARTHOG: StationLayout = {
  view: [92, 132],
  shapes: [
    'M90,94 L110,94 L110,132 L90,132 Z',
    'M91,100 L8,104 L8,120 L91,124 Z',
    'M109,100 L192,104 L192,120 L109,124 Z',
  ],
  stations: [
    st(1, '1', 12, 112),
    st(2, '2', 29, 112),
    st(3, '3', 46, 112),
    st(4, '4', 63, 112),
    st(5, '5', 80, 112),
    st(6, '6', 100, 124),
    st(7, '7', 120, 112),
    st(8, '8', 137, 112),
    st(9, '9', 154, 112),
    st(10, '10', 171, 112),
    st(11, '11', 188, 112),
  ],
};

/** Station layouts by DCS unit type. */
export const STATION_LAYOUTS: Readonly<Record<string, StationLayout>> = {
  'FA-18C_hornet': HORNET,
  'F-16C_50': VIPER,
  'F-14B': TOMCAT,
  'F-14BU': TOMCAT,
  'F-14A-135-GR': TOMCAT,
  'AH-64D_BLK_II': APACHE,
  'A-10C_2': WARTHOG,
};

/** The layout for a DCS unit type, or `null` (the armament box then shows a list). */
export function stationLayout(type: string | null | undefined): StationLayout | null {
  if (type === null || type === undefined) return null;
  return STATION_LAYOUTS[type] ?? null;
}

/** The cockpit's label for a DCS station index; the index itself where unknown. */
export function stationLabel(type: string | null | undefined, dcs: number): string {
  return stationLayout(type)?.stations.find((s) => s.dcs === dcs)?.label ?? String(dcs);
}
