// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { WeaponStation } from './status.js';
import { armamentTotals, shortStoreName, shortWeaponName } from './weapons.js';

describe('shortWeaponName', () => {
  it.each([
    ['AIM-9X', '9X'],
    ['AIM-120C', '120C'],
    ['AIM-54C-Mk47', '54C'],
    ['AIM-7M', '7M'],
    ['AGM-65F Maverick', '65F'],
    ['AGM-114K', '114K'],
    ['AGM-88C HARM', '88C'],
    ['GBU-38(V)1/B', 'GB38'],
    ['GBU-12', 'GB12'],
    ['Mk-82', 'MK82'],
    ['Mk20 Rockeye', 'MK20'],
    ['Hydra 70 M229 HE', 'M229'],
    ['CBU-97', 'CBU-97'],
    ['Kh-29L Kedge', 'KH-29L'],
  ])('%s → %s', (name, short) => {
    expect(shortWeaponName(name)).toBe(short);
  });
});

describe('shortStoreName', () => {
  it.each([
    ['Litening TGP', 'TGP'],
    ['ATFLIR', 'FLIR'],
    ['HTS pod', 'HTS'],
    ['ALQ-184 ECM pod', 'ECM'],
    ['Longbow FCR', 'FCR'],
    ['FPU-8A tank', 'TANK'],
    ['300 gal tank', 'TANK'],
    ['Smoke Generator', 'SMOKE'],
  ])('%s → %s', (name, short) => {
    expect(shortStoreName(name)).toBe(short);
  });
});

describe('armamentTotals', () => {
  const station = (
    st: number,
    name: string,
    kind: WeaponStation['kind'],
    role: WeaponStation['role'],
    count: number,
  ): WeaponStation => ({ st, name, kind, role, count, source: 'export' });

  it('adds up per type and groups into A/A and A/G, missiles before bombs', () => {
    // The Hornet loadout from spike 3.2 run A.
    const totals = armamentTotals([
      station(1, 'AIM-9X', 'missile', 'aa', 1),
      station(2, 'AGM-65F Maverick', 'missile', 'ag', 1),
      station(3, 'Mk20 Rockeye', 'bomb', 'ag', 2),
      station(6, 'AIM-120C', 'missile', 'aa', 1),
      station(7, 'Mk20 Rockeye', 'bomb', 'ag', 2),
      station(8, 'AGM-65F Maverick', 'missile', 'ag', 1),
      station(9, 'AIM-9X', 'missile', 'aa', 1),
    ]);
    expect(totals).toEqual({
      aa: [
        { name: 'AIM-120C', kind: 'missile', count: 1 },
        { name: 'AIM-9X', kind: 'missile', count: 2 },
      ],
      ag: [
        { name: 'AGM-65F Maverick', kind: 'missile', count: 2 },
        { name: 'Mk20 Rockeye', kind: 'bomb', count: 4 },
      ],
    });
  });

  it('puts rockets after bombs and leaves empty stations out', () => {
    const totals = armamentTotals([
      station(1, 'Hydra 70 M229 HE', 'rocket', 'ag', 19),
      station(2, 'AGM-114K', 'missile', 'ag', 0),
      station(3, 'GBU-12', 'bomb', 'ag', 1),
    ]);
    expect(totals.ag.map((t) => t.name)).toEqual(['GBU-12', 'Hydra 70 M229 HE']);
    expect(totals.aa).toEqual([]);
  });
});
