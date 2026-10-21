// SPDX-License-Identifier: GPL-3.0-or-later

import { BridgeOwn } from '@slate-dcs/shared';
import { describe, expect, it } from 'vitest';

import { exportValues } from './convert.js';
import { armamentFromExport, stationKind, weaponRole } from './payload.js';
import { emptyOwn, hornetOwn, vehicleOwn } from './test-data.js';

const KT = 1852 / 3600;

describe('stationKind (spike 3.3 type codes)', () => {
  it.each([
    [[4, 4, 7, 136], 'missile'], // AIM-9X
    [[4, 4, 8, 39], 'missile'], // AGM-114K
    [[4, 5, 36, 86], 'bomb'], // GBU-38
    [[4, 7, 33, 374], 'rocket'], // Hydra 70
    [[4, 15, 44, 425], 'store'], // Litening
    [[4, 15, 45, 968], 'store'], // ALQ-184
    [[1, 3, 43, 587], 'store'], // FPU-8A tank
    [[4, 6, 10, 1], 'other'], // any other weapon
    [[2, 17, 26, 14], 'store'], // anything else
  ] as const)('%j → %s', (code, kind) => {
    expect(stationKind([...code])).toBe(kind);
  });
});

describe('weaponRole (spike 3.3 type codes)', () => {
  it.each([
    [[4, 4, 7, 136], 'aa'], // AIM-9X
    [[4, 4, 7, 322], 'aa'], // AIM-54C
    [[4, 4, 8, 271], 'ag'], // AGM-65F
    [[4, 4, 8, 39], 'ag'], // AGM-114K
    [[4, 5, 36, 86], 'ag'], // GBU-38
    [[4, 7, 33, 374], 'ag'], // Hydra 70
  ] as const)('%j → %s', (code, role) => {
    expect(weaponRole([...code])).toBe(role);
  });
});

describe('armamentFromExport', () => {
  it('splits weapons and stores, with readable store names', () => {
    const armament = armamentFromExport(BridgeOwn.parse(hornetOwn()).payload, 578);
    expect(armament?.stations.map((s) => [s.st, s.name, s.kind, s.role, s.count])).toEqual([
      [1, 'AIM-9X', 'missile', 'aa', 1],
      [2, 'AGM-65F Maverick', 'missile', 'ag', 1],
      [3, 'Mk20 Rockeye', 'bomb', 'ag', 2],
      [6, 'AIM-120C', 'missile', 'aa', 1],
      [7, 'Mk20 Rockeye', 'bomb', 'ag', 2],
      [8, 'AGM-65F Maverick', 'missile', 'ag', 1],
      [9, 'AIM-9X', 'missile', 'aa', 1],
    ]);
    expect(armament?.stores).toEqual([
      { st: 4, name: 'Litening TGP' },
      { st: 5, name: 'FPU-8A tank' },
    ]);
    expect(armament?.gun).toEqual({ rounds: 578, source: 'export' });
    expect(armament?.stations.every((s) => s.source === 'export')).toBe(true);
  });

  it('keeps an emptied station with count 0, skips empty ones, sorts by station', () => {
    const armament = armamentFromExport(
      [
        { st: 9, w: [4, 4, 7, 136], name: 'AIM-9X', count: 0, clsid: null },
        { st: 4, w: [0, 0, 0, 0], name: 'UNKNOWN_0,0,0,0', count: 0, clsid: '<CLEAN>' },
        { st: 1, w: [4, 4, 7, 136], name: 'AIM-9X', count: 1, clsid: null },
      ],
      null,
    );
    expect(armament?.stations.map((s) => [s.st, s.count])).toEqual([
      [1, 1],
      [9, 0],
    ]);
    expect(armament?.gun).toBeNull();
  });

  it('falls back to the CLSID, then a tidied DCS name', () => {
    const armament = armamentFromExport(
      [
        { st: 1, w: [4, 4, 7, 999], name: 'UNKNOWN_4,4,7,999', count: 1, clsid: 'SOME_MISSILE' },
        { st: 2, w: [4, 15, 44, 2], name: 'new_pod_name', count: 1, clsid: '{NEW}' },
        { st: 3, w: [4, 4, 7, 999], name: null, count: 1, clsid: null },
      ],
      null,
    );
    expect(armament?.stations.map((s) => s.name)).toEqual(['SOME_MISSILE', 'Unknown weapon']);
    expect(armament?.stores).toEqual([{ st: 2, name: 'new pod name' }]);
  });

  it('is null without a payload', () => {
    expect(armamentFromExport(null, 100)).toBeNull();
  });
});

describe('exportValues', () => {
  it('converts the Hornet sample', () => {
    const values = exportValues(BridgeOwn.parse(hornetOwn()));
    expect(values.pos).toEqual({
      lat: 43.6440653722,
      lon: 43.6647501335,
      altMsl: 1216.81689453,
      altAgl: 864.83380127,
    });
    // As the cockpit shows them: DCS true (map grid) and magnetic, straight from DCS.
    expect(values.hdg).toBeCloseTo(45.613, 2);
    expect(values.hdgMag).toBeCloseTo(38.534, 2);
    expect(values.gs ?? 0).toBeCloseTo(282.6, 1);
    expect((values.ias ?? 0) / KT).toBeCloseTo(508.9, 0);
    expect(values.fuel?.internalKg).toBe(4900);
    expect(values.fuel?.externalKg).toBeCloseTo(1018, 0);
    expect(values.fuel?.source).toBe('export');
    expect(values.countermeasures).toEqual({ chaff: 60, flare: 60 });
    expect(values.airData).toEqual({ tas: 282.638885498, mach: 0.827642619915, vs: 0 });
    expect(values.avail).toEqual({ pos: true, fuel: true, payload: true });
    expect(values.type).toBe('FA-18C_hornet');
    expect(values.mt).toBe(0);
    expect(values.start).toBe(64800);
  });

  it('converts a ground vehicle: no IAS, fuel or payload', () => {
    const values = exportValues(BridgeOwn.parse(vehicleOwn()));
    expect(values.hdg).toBeCloseTo(359.9998, 3);
    expect(values.hdgMag).toBeNull();
    expect(values.gs ?? 1).toBeLessThan(0.01);
    expect(values.ias).toBeNull();
    // TAS but no Mach; vertical speed from the velocity vector.
    expect(values.airData).toEqual({ tas: 1.08949637413, mach: null, vs: -1.08949458599 });
    expect(values.fuel).toBeNull();
    expect(values.armament).toBeNull();
    expect(values.avail).toEqual({ pos: true, fuel: false, payload: false });
  });

  it('gives nulls for a JTAC on the F10 map', () => {
    const values = exportValues(BridgeOwn.parse(emptyOwn(9233.2)));
    expect(values).toMatchObject({
      pos: null,
      hdg: null,
      gs: null,
      ias: null,
      fuel: null,
      armament: null,
    });
    expect(values.avail).toEqual({ pos: false, fuel: false, payload: false });
  });

  it('has no headings without DCS values, and no fuel for an unknown airframe', () => {
    const values = exportValues(
      BridgeOwn.parse(hornetOwn({ gridHdg: undefined, magHdg: undefined, type: 'Su-25T' })),
    );
    expect(values.hdg).toBeNull();
    expect(values.hdgMag).toBeNull();
    expect(values.fuel).toBeNull();
    expect(values.avail.fuel).toBe(true);
  });

  it('clamps a slightly negative IAS on the ground to 0', () => {
    expect(exportValues(BridgeOwn.parse(hornetOwn({ ias: -0.4 }))).ias).toBe(0);
  });
});
