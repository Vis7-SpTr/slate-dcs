// SPDX-License-Identifier: GPL-3.0-or-later

import { BridgeOwn } from '@slate-dcs/shared';
import type { OwnshipOverrides } from '@slate-dcs/shared';
import { describe, expect, it } from 'vitest';

import { exportValues } from './convert.js';
import { OwnshipBuilder } from './ownship.js';
import { emptyOwn, hornetOwn } from './test-data.js';

const NONE: OwnshipOverrides = { position: null, fuel: null, stations: [], gun: null };
const hornet = (overrides: Record<string, unknown> = {}) =>
  exportValues(BridgeOwn.parse(hornetOwn(overrides)));
const jtacOnMap = () => exportValues(BridgeOwn.parse(emptyOwn(100)));

describe('OwnshipBuilder', () => {
  it('is null with neither export data nor overrides', () => {
    expect(new OwnshipBuilder().build(null, NONE).status).toBeNull();
  });

  it('passes export values through', () => {
    const { status, overridesChanged } = new OwnshipBuilder().build(hornet(), NONE);
    expect(status?.pos?.lat).toBe(43.6440653722);
    expect(status?.fuel?.source).toBe('export');
    expect(status?.armament?.stations).toHaveLength(7);
    expect(status?.avail).toEqual({ pos: true, fuel: true, payload: true });
    expect(overridesChanged).toBe(false);
  });

  it('shows a manual position without any DCS data (JTAC, no DCS)', () => {
    const position = { lat: 42.1, lon: 41.7, altMsl: 120 };
    const { status } = new OwnshipBuilder().build(null, { ...NONE, position });
    expect(status?.pos).toEqual({ ...position, altAgl: null });
    expect(status?.hdg).toBeNull();
    expect(status?.avail).toEqual({ pos: false, fuel: false, payload: false });
    expect(status?.armament).toBeNull();
  });

  it('keeps a manual position while the export has none, and drops it when one appears', () => {
    const builder = new OwnshipBuilder();
    const overrides = { ...NONE, position: { lat: 42.1, lon: 41.7, altMsl: 120 } };
    expect(builder.build(jtacOnMap(), overrides).status?.pos?.lat).toBe(42.1);
    expect(builder.build(jtacOnMap(), overrides).overridesChanged).toBe(false);

    // He jumps into a vehicle: the export now has a position.
    const built = builder.build(hornet(), overrides);
    expect(built.overridesChanged).toBe(true);
    expect(built.overrides.position).toBeNull();
    expect(built.status?.pos?.lat).toBe(43.6440653722);
  });

  it('lets a station edit win until DCS reports a change on that station', () => {
    const builder = new OwnshipBuilder();
    const overrides = {
      ...NONE,
      stations: [
        {
          st: 2,
          name: 'AGM-65E Maverick',
          kind: 'missile' as const,
          role: 'ag' as const,
          count: 1,
        },
      ],
    };
    let built = builder.build(hornet(), overrides);
    expect(built.status?.armament?.stations.find((s) => s.st === 2)).toMatchObject({
      name: 'AGM-65E Maverick',
      source: 'manual',
    });

    // A release elsewhere doesn't touch it.
    const payload = BridgeOwn.parse(hornetOwn()).payload ?? [];
    const station9Fired = payload.map((s) => (s.st === 9 ? { ...s, count: 0 } : s));
    built = builder.build(hornet({ payload: station9Fired }), built.overrides);
    expect(built.overridesChanged).toBe(false);
    expect(built.status?.armament?.stations.find((s) => s.st === 2)?.source).toBe('manual');

    // Released from station 2: the export value changed, the edit is dropped.
    const station2Fired = station9Fired.map((s) => (s.st === 2 ? { ...s, count: 0 } : s));
    built = builder.build(hornet({ payload: station2Fired }), built.overrides);
    expect(built.overridesChanged).toBe(true);
    expect(built.overrides.stations).toEqual([]);
    expect(built.status?.armament?.stations.find((s) => s.st === 2)).toMatchObject({
      count: 0,
      source: 'export',
    });
  });

  it('adds a manual station that the export lacks', () => {
    const overrides = {
      ...NONE,
      stations: [{ st: 10, name: 'GBU-12', kind: 'bomb' as const, role: 'ag' as const, count: 1 }],
    };
    const stations = new OwnshipBuilder().build(hornet(), overrides).status?.armament?.stations;
    expect(stations?.at(-1)).toEqual({
      st: 10,
      name: 'GBU-12',
      kind: 'bomb',
      role: 'ag',
      count: 1,
      source: 'manual',
    });
  });

  it('builds armament from overrides alone when the export has none', () => {
    const overrides = { ...NONE, gun: { rounds: 200 } };
    const armament = new OwnshipBuilder().build(jtacOnMap(), overrides).status?.armament;
    expect(armament).toEqual({ stations: [], gun: { rounds: 200, source: 'manual' }, stores: [] });
  });

  it('drops manual fuel and gun when their export values change', () => {
    const builder = new OwnshipBuilder();
    const overrides = { ...NONE, fuel: { internalKg: 3000, externalKg: 0 }, gun: { rounds: 100 } };
    let built = builder.build(hornet(), overrides);
    expect(built.status?.fuel).toEqual({ internalKg: 3000, externalKg: 0, source: 'manual' });
    expect(built.status?.armament?.gun).toEqual({ rounds: 100, source: 'manual' });

    built = builder.build(hornet({ fuelInt: 1.1, gun: 560 }), built.overrides);
    expect(built.overrides).toEqual(NONE);
    expect(built.status?.fuel?.source).toBe('export');
    expect(built.status?.armament?.gun).toEqual({ rounds: 560, source: 'export' });
  });

  it('starts over after reset (new aircraft)', () => {
    const builder = new OwnshipBuilder();
    const overrides = { ...NONE, gun: { rounds: 100 } };
    builder.build(hornet(), overrides);
    builder.reset();
    // The new baseline is taken from the current value – nothing is dropped.
    expect(builder.build(hornet({ gun: 300 }), overrides).overridesChanged).toBe(false);
  });

  it('does not change the input overrides', () => {
    const overrides = { ...NONE, position: { lat: 1, lon: 2, altMsl: 3 } };
    const builder = new OwnshipBuilder();
    builder.build(jtacOnMap(), overrides);
    builder.build(hornet(), overrides);
    expect(overrides.position).toEqual({ lat: 1, lon: 2, altMsl: 3 });
  });
});
