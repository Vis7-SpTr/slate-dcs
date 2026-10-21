// SPDX-License-Identifier: GPL-3.0-or-later
// Per-airframe data (protocol.md §6.5): display name, internal fuel capacity
// and the unit the cockpit's fuel gauges use. Keyed by the DCS unit type.

import { z } from 'zod';

/** Unit the airframe's fuel gauges show; SLATE shows fuel the same way (scope §4.2). */
export const FuelUnit = z.enum(['lbs', 'kg']);
export type FuelUnit = z.infer<typeof FuelUnit>;

export interface Airframe {
  /** Display name, e.g. `F/A-18C`. */
  name: string;
  /**
   * Internal fuel capacity in kg – what `fuel_internal = 1.0` means. Values are
   * DCS's maximum internal fuel weight; spike 3.2 measured them by burn
   * integration to within 2–4 % (Hornet 4785, Viper 3110, Apache 1114 kg), and
   * the external-tank fractions it saw (FPU-8A ≈ 0.21, F-14 300 gal ≈ 0.125)
   * match these values.
   */
  internalFuelKg: number;
  fuelUnit: FuelUnit;
}

/**
 * The first-wave airframes (ui-design.md §9: F/A-18C, F-16C, AH-64D,
 * F-14B(U), A-10C II). Others show their DCS type name, and fuel stays empty
 * until they are added here.
 */
export const AIRFRAMES: Readonly<Record<string, Airframe>> = {
  'FA-18C_hornet': { name: 'F/A-18C', internalFuelKg: 4900, fuelUnit: 'lbs' },
  'F-16C_50': { name: 'F-16C', internalFuelKg: 3249, fuelUnit: 'lbs' },
  'AH-64D_BLK_II': { name: 'AH-64D', internalFuelKg: 1157, fuelUnit: 'lbs' },
  'F-14B': { name: 'F-14B', internalFuelKg: 7348, fuelUnit: 'lbs' },
  'F-14BU': { name: 'F-14B(U)', internalFuelKg: 7348, fuelUnit: 'lbs' },
  'F-14A-135-GR': { name: 'F-14A', internalFuelKg: 7348, fuelUnit: 'lbs' },
  'A-10C_2': { name: 'A-10C II', internalFuelKg: 5029, fuelUnit: 'lbs' },
};

/** Display names of slots that aren't aircraft. */
const OTHER_UNIT_NAMES: Readonly<Record<string, string>> = {
  forward_observer: 'JTAC/Operator',
};

/** The airframe for a DCS unit type, or `null` if it isn't in the table. */
export function airframe(type: string | null | undefined): Airframe | null {
  if (type === null || type === undefined) return null;
  return AIRFRAMES[type] ?? null;
}

/** Display name for a DCS unit type; unknown types show as they are. */
export function unitDisplayName(type: string): string {
  return AIRFRAMES[type]?.name ?? OTHER_UNIT_NAMES[type] ?? type;
}

/** Fuel unit for a DCS unit type; kg where the airframe is unknown. */
export function fuelUnit(type: string | null | undefined): FuelUnit {
  return airframe(type)?.fuelUnit ?? 'kg';
}

/**
 * DCS fuel fractions → kg (protocol.md §6.1). `fuel_internal` includes the
 * external tanks, so internal ≈ min(f, 1) × capacity and external ≈
 * max(f − 1, 0) × capacity – this assumes the external tanks feed first. Should
 * a module ever report `fuel_external`, it is added to external.
 */
export function fuelWeights(
  fractionInternal: number,
  fractionExternal: number,
  capacityKg: number,
): { internalKg: number; externalKg: number } {
  return {
    internalKg: Math.min(fractionInternal, 1) * capacityKg,
    externalKg: (Math.max(fractionInternal - 1, 0) + fractionExternal) * capacityKg,
  };
}
