// SPDX-License-Identifier: GPL-3.0-or-later
import type { MapEntry } from '@slate-dcs/shared';
import { describe, expect, it } from 'vitest';

import {
  addChip,
  autoEntryName,
  FLIGHT_CALLSIGNS,
  frequencyPicks,
  hhmm,
  stepValue,
  unitCallsign,
  withCallsignName,
} from './picks.js';

describe('picks per field (ui-design.md §11)', () => {
  it('has the DCS, A-10 and Apache callsigns for flight names', () => {
    expect(FLIGHT_CALLSIGNS).toContain('Enfield');
    expect(FLIGHT_CALLSIGNS).toContain('Hawg');
    expect(FLIGHT_CALLSIGNS).toContain('Gunslinger');
  });

  it('reads the callsign word of a DCS unit name', () => {
    expect(unitCallsign('Enfield 1-1')).toBe('Enfield');
    expect(unitCallsign('Colt11')).toBe('Colt');
    expect(unitCallsign('Army Air 2-1')).toBe('Army Air');
    expect(unitCallsign('Aerial-1-1')).toBeNull();
    expect(unitCallsign(undefined)).toBeNull();
  });

  it('a picked JTAC name keeps the number typed', () => {
    expect(withCallsignName('Axeman 12', 'Hammer')).toBe('Hammer 12');
    expect(withCallsignName('', 'Hammer')).toBe('Hammer 11');
  });

  it('adds ready-made texts on a new line, after a comma, or in place', () => {
    expect(addChip('', 'ONE PASS ONLY', 'line')).toBe('ONE PASS ONLY');
    expect(addChip('A\n', 'B', 'line')).toBe('A\nB');
    expect(addChip('POWER LINES, ', 'HIGH TERRAIN', 'comma')).toBe('POWER LINES, HIGH TERRAIN');
    expect(addChip('old', 'SAFETY', 'replace')).toBe('SAFETY');
  });

  it('names a new entry with the first number not taken', () => {
    const ip = { kind: 'ip', label: 'IP 1' } as MapEntry;
    const odd = { kind: 'cp', label: 'IP 2' } as MapEntry;
    expect(autoEntryName('ip', [])).toBe('IP 1');
    expect(autoEntryName('ip', [ip, odd])).toBe('IP 3');
    expect(autoEntryName('threat', [ip])).toBe('THREAT 1');
  });

  it('steps a number within its limits; empty starts from `from`', () => {
    expect(stepValue('15000', 500)).toBe('15500');
    expect(stepValue('', 5, { from: 30 })).toBe('35');
    expect(stepValue('1', -1, { min: 1 })).toBe('1');
    expect(stepValue('0.5', 0.5)).toBe('1');
  });

  it('turns a mission time text into HHMM; offers each frequency once', () => {
    expect(hhmm('D+1 14:05:33 Z')).toBe('1405');
    expect(hhmm('—')).toBeNull();
    const picks = frequencyPicks([
      [{ mhz: 251, label: 'PRI' }],
      [
        { mhz: 251, label: null },
        { mhz: 133.5, label: null },
      ],
    ]);
    expect(picks.map((f) => f.mhz)).toEqual([251, 133.5]);
  });
});
