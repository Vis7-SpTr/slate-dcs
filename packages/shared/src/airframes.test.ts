// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { AIRFRAMES, airframe, fuelUnit, fuelWeights, unitDisplayName } from './airframes.js';

describe('airframe table', () => {
  it('has every first-wave airframe (ui-design.md §9) under its DCS type', () => {
    for (const type of [
      'FA-18C_hornet',
      'F-16C_50',
      'AH-64D_BLK_II',
      'F-14B',
      'F-14BU',
      'A-10C_2',
    ]) {
      expect(airframe(type), type).not.toBeNull();
    }
  });

  it('agrees with the spike-3.2 burn measurements within 5 %', () => {
    const measured = { 'FA-18C_hornet': 4785, 'F-16C_50': 3110, 'AH-64D_BLK_II': 1114 };
    for (const [type, kg] of Object.entries(measured)) {
      const capacity = AIRFRAMES[type]?.internalFuelKg ?? 0;
      expect(Math.abs(capacity - kg) / capacity, type).toBeLessThan(0.05);
    }
  });

  it('returns null for unknown or missing types', () => {
    expect(airframe('Su-25T')).toBeNull();
    expect(airframe(null)).toBeNull();
    expect(airframe(undefined)).toBeNull();
  });
});

describe('unitDisplayName', () => {
  it.each([
    ['FA-18C_hornet', 'F/A-18C'],
    ['F-14BU', 'F-14B(U)'],
    ['forward_observer', 'JTAC/Operator'],
    ['M1043 HMMWV Armament', 'M1043 HMMWV Armament'],
  ])('%s → %s', (type, name) => {
    expect(unitDisplayName(type)).toBe(name);
  });
});

describe('fuelUnit', () => {
  it('is lbs for the US airframes and kg where unknown', () => {
    expect(fuelUnit('FA-18C_hornet')).toBe('lbs');
    expect(fuelUnit('Ka-50_3')).toBe('kg');
    expect(fuelUnit(null)).toBe('kg');
  });
});

describe('fuelWeights', () => {
  it('splits a fraction above 1 into internal full + external (spike 3.2: Hornet with FPU-8A)', () => {
    const { internalKg, externalKg } = fuelWeights(1.20775508881, 0, 4900);
    expect(internalKg).toBe(4900);
    expect(externalKg).toBeCloseTo(1018.0, 0);
  });

  it('is internal only below 1', () => {
    expect(fuelWeights(0.5, 0, 4900)).toEqual({ internalKg: 2450, externalKg: 0 });
  });

  it('adds fuel_external to external should a module report it', () => {
    expect(fuelWeights(1, 0.25, 4000)).toEqual({ internalKg: 4000, externalKg: 1000 });
  });
});
