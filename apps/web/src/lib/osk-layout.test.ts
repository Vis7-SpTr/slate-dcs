// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { fieldLayout, fits, laserDigits, mgrsSquare, oskRows } from './osk-layout.js';
import type { OskKey } from './osk-layout.js';

const texts = (rows: OskKey[][]) =>
  rows.flat().flatMap((k) => (k.kind === 'text' && k.disabled !== true ? [k.text] : []));

const plain = { before: '', abc: false, upper: true, mgrs: null };

describe('on-screen keyboard layouts (ui-design.md §11)', () => {
  it('picks the smallest layout from data-osk, else inputmode', () => {
    expect(fieldLayout('laser', 'numeric').layout).toBe('laser');
    expect(fieldLayout('coord', '').layout).toBe('coord');
    expect(fieldLayout(undefined, 'numeric')).toEqual({
      layout: 'digits',
      dot: false,
      minus: false,
    });
    expect(fieldLayout(undefined, 'decimal')).toMatchObject({ layout: 'digits', dot: true });
    expect(fieldLayout(null, '').layout).toBe('letters');
    expect(fieldLayout('digits', '').layout).toBe('digits');
  });

  it('digits offer "." only where the field takes decimals', () => {
    expect(texts(oskRows(fieldLayout(undefined, 'numeric'), plain))).not.toContain('.');
    expect(texts(oskRows(fieldLayout(undefined, 'decimal'), plain))).toContain('.');
    expect(texts(oskRows(fieldLayout('signed', ''), plain))).toContain('-');
  });

  it('a laser code only enables valid digits per position (1111–1788)', () => {
    expect([...laserDigits('')]).toEqual(['1']);
    expect([...laserDigits('1')]).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect([...laserDigits('16')]).toHaveLength(8);
    expect([...laserDigits('168')]).toHaveLength(8);
    expect(laserDigits('1688').size).toBe(0);
    const rows = oskRows(fieldLayout('laser', ''), { ...plain, before: '1' });
    expect(texts(rows)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  it('the coordinate keypad has the own grid square as one key and MGRS letters on demand', () => {
    const square = mgrsSquare({ lat: 42.2, lon: 41.75 });
    expect(square).toMatch(/^37T [A-Z]{2}$/);
    const field = fieldLayout('coord', '');
    const base = texts(oskRows(field, { ...plain, mgrs: square }));
    expect(base).toContain(`${square ?? ''} `);
    expect(base).toContain('N');
    expect(base).not.toContain('G');
    const abc = texts(oskRows(field, { ...plain, abc: true }));
    expect(abc).toContain('G');
    expect(abc).not.toContain('I');
    expect(abc).not.toContain('O');
    expect(mgrsSquare(null)).toBeNull();
  });

  it('letters follow the case toggle; maxlength is kept', () => {
    expect(texts(oskRows(fieldLayout(null, ''), { ...plain, upper: false }))).toContain('q');
    expect(fits('1688', 0, 4)).toBe(false);
    expect(fits('1688', 1, 4)).toBe(true);
    expect(fits('anything', 0, -1)).toBe(true);
  });
});
