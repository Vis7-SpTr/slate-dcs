// SPDX-License-Identifier: GPL-3.0-or-later
// SLATE's on-screen keyboard (ui-design.md §11, P2.7d): an OKB Web Dashboard
// tab passes clicks but no keyboard input, so fields are typed by clicking.
// Each field gets the smallest layout that can type its values. Pure
// functions only – the docked component lives in `shell/OnScreenKeyboard`.

import { formatMgrs } from '@slate-dcs/shared';
import type { LatLon } from '@slate-dcs/shared';

export type OskLayout = 'digits' | 'laser' | 'coord' | 'letters';

/** What a field takes: its layout and the extra keys allowed in it. */
export interface OskField {
  layout: OskLayout;
  /** `.` – decimals (distance, radius, MHz). */
  dot: boolean;
  /** `-` – signed numbers. */
  minus: boolean;
}

/**
 * The layout for a field. `data-osk` names it (`digits`, `decimal`, `signed`,
 * `laser`, `coord`, `letters`); otherwise `inputmode` decides (`numeric` →
 * digits, `decimal` → digits with `.`), and everything else is free text.
 */
export function fieldLayout(osk: string | null | undefined, inputMode: string): OskField {
  switch (osk) {
    case 'digits':
      return { layout: 'digits', dot: false, minus: false };
    case 'decimal':
      return { layout: 'digits', dot: true, minus: false };
    case 'signed':
      return { layout: 'digits', dot: false, minus: true };
    case 'laser':
      return { layout: 'laser', dot: false, minus: false };
    case 'coord':
      return { layout: 'coord', dot: true, minus: false };
    case 'letters':
      return { layout: 'letters', dot: true, minus: true };
    default:
      break;
  }
  if (inputMode === 'numeric') return { layout: 'digits', dot: false, minus: false };
  if (inputMode === 'decimal') return { layout: 'digits', dot: true, minus: false };
  return { layout: 'letters', dot: true, minus: true };
}

/**
 * Digits valid at the caret of a laser code (1111–1788, `protocol.md` §9.5):
 * first 1, second 1–7, third and fourth 1–8; none after the fourth.
 */
export function laserDigits(before: string): ReadonlySet<string> {
  const position = before.replace(/\D/g, '').length;
  const max = [1, 7, 8, 8][position];
  if (max === undefined) return new Set();
  return new Set(Array.from({ length: max }, (_, i) => String(i + 1)));
}

/** The grid zone and 100 km square of a position, e.g. `37T GG` – the MGRS key. */
export function mgrsSquare(pos: LatLon | null): string | null {
  if (!pos) return null;
  try {
    const [zone, square] = formatMgrs(pos, 10).split(' ');
    return zone && square ? `${zone} ${square}` : null;
  } catch {
    return null;
  }
}

/** One key. `text` is inserted; the other kinds act. */
export type OskKey =
  | { kind: 'text'; text: string; label?: string; wide?: boolean; disabled?: boolean }
  | { kind: 'back' }
  | { kind: 'space' }
  | { kind: 'toggle'; label: string; on: boolean; what: 'abc' | 'case' };

/** MGRS letters: A–Z without I and O. */
const MGRS_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const QWERTY = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

function chars(s: string, upper = true): OskKey[] {
  return Array.from(s, (c): OskKey => ({ kind: 'text', text: upper ? c : c.toLowerCase() }));
}

export interface RowOptions {
  /** Text before the caret – for the laser rule. */
  before: string;
  /** Coordinate keypad: the MGRS letters are shown. */
  abc: boolean;
  /** Letters: upper case. */
  upper: boolean;
  /** The user's own grid zone + 100 km square (`37T GG`), if he has a position. */
  mgrs: string | null;
}

/** The rows of keys for a field – smallest layout first (ui-design.md §11). */
export function oskRows(field: OskField, o: RowOptions): OskKey[][] {
  switch (field.layout) {
    case 'digits': {
      const extra: OskKey = field.minus
        ? { kind: 'text', text: '-', label: '−' }
        : field.dot
          ? { kind: 'text', text: '.' }
          : { kind: 'text', text: '', disabled: true };
      return [chars('123'), chars('456'), chars('789'), [extra, ...chars('0'), { kind: 'back' }]];
    }
    case 'laser': {
      const valid = laserDigits(o.before);
      const key = (d: string): OskKey => ({ kind: 'text', text: d, disabled: !valid.has(d) });
      return [
        ['1', '2', '3'].map(key),
        ['4', '5', '6'].map(key),
        [key('7'), key('8'), { kind: 'back' }],
      ];
    }
    case 'coord': {
      const rows: OskKey[][] = [
        chars('1234567890'),
        [
          ...chars('NSEW'),
          { kind: 'text', text: '°' },
          { kind: 'text', text: "'" },
          { kind: 'text', text: '"' },
          { kind: 'text', text: '.' },
          { kind: 'space' },
          { kind: 'back' },
        ],
      ];
      if (o.abc) {
        rows.push(chars(MGRS_LETTERS.slice(0, 12)), chars(MGRS_LETTERS.slice(12)));
      }
      const last: OskKey[] = [{ kind: 'toggle', label: 'ABC', on: o.abc, what: 'abc' }];
      if (o.mgrs) last.unshift({ kind: 'text', text: `${o.mgrs} `, label: o.mgrs, wide: true });
      rows.push(last);
      return rows;
    }
    case 'letters':
      return [
        chars('1234567890'),
        ...QWERTY.map((row) => chars(row, o.upper)),
        [
          { kind: 'toggle', label: o.upper ? 'abc' : 'ABC', on: !o.upper, what: 'case' },
          ...chars("-.,/:'"),
          { kind: 'space' },
          { kind: 'back' },
        ],
      ];
  }
}

/** Whether one more character fits (`maxlength`, the laser code's four digits). */
export function fits(value: string, selected: number, maxLength: number): boolean {
  return maxLength <= 0 || value.length - selected < maxLength;
}
