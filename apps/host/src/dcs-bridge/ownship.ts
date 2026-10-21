// SPDX-License-Identifier: GPL-3.0-or-later
// Builds the own status (protocol.md §6.2) from export values and the pilot's
// manual overrides. Rule (decided 17 Oct 2026): a manual edit wins until the
// export value it replaced changes – e.g. a station edit stays until DCS
// reports a release or rearm on that station.

import type { OwnshipOverrides, StatusBody, WeaponStation } from '@slate-dcs/shared';

import type { ExportValues } from './convert.js';

/** Signature of an export value; an override is dropped once it changes. */
type Signature = string;
const NONE: Signature = 'none';

function positionSignature(values: ExportValues | null): Signature {
  const pos = values?.pos;
  // ~0.1 m and 1 m: a parked aircraft keeps its signature, a moving one doesn't.
  return pos ? `${pos.lat.toFixed(6)},${pos.lon.toFixed(6)},${Math.round(pos.altMsl)}` : NONE;
}

function fuelSignature(values: ExportValues | null): Signature {
  const fuel = values?.fuel;
  return fuel ? `${Math.round(fuel.internalKg)},${Math.round(fuel.externalKg)}` : NONE;
}

function gunSignature(values: ExportValues | null): Signature {
  const gun = values?.armament?.gun;
  return gun ? String(gun.rounds) : NONE;
}

function stationSignature(values: ExportValues | null, st: number): Signature {
  const station = values?.armament?.stations.find((s) => s.st === st);
  return station ? `${station.name}|${station.count}` : NONE;
}

export interface BuiltOwnship {
  status: StatusBody | null;
  /** The overrides still in force; differs from the input when some were dropped. */
  overrides: OwnshipOverrides;
  overridesChanged: boolean;
}

export class OwnshipBuilder {
  /** Export value (signature) at the time each override was first seen. */
  readonly #baselines = new Map<string, Signature>();

  /** Forgets all baselines – when the own aircraft changes and overrides are cleared. */
  reset(): void {
    this.#baselines.clear();
  }

  build(values: ExportValues | null, input: OwnshipOverrides): BuiltOwnship {
    const overrides: OwnshipOverrides = structuredClone(input);
    let overridesChanged = false;
    const active = new Set<string>();

    /** `true` if the override for `key` stays; records its baseline the first time. */
    const keep = (key: string, current: Signature): boolean => {
      active.add(key);
      const baseline = this.#baselines.get(key);
      if (baseline === undefined) {
        this.#baselines.set(key, current);
        return true;
      }
      if (baseline === current) return true;
      this.#baselines.delete(key);
      overridesChanged = true;
      return false;
    };

    if (overrides.position !== null && !keep('position', positionSignature(values))) {
      overrides.position = null;
    }
    if (overrides.fuel !== null && !keep('fuel', fuelSignature(values))) {
      overrides.fuel = null;
    }
    if (overrides.gun !== null && !keep('gun', gunSignature(values))) {
      overrides.gun = null;
    }
    overrides.stations = overrides.stations.filter((station) =>
      keep(`st:${String(station.st)}`, stationSignature(values, station.st)),
    );
    for (const key of [...this.#baselines.keys()]) {
      if (!active.has(key)) this.#baselines.delete(key);
    }

    return { status: assemble(values, overrides), overrides, overridesChanged };
  }
}

function hasOverrides(overrides: OwnshipOverrides): boolean {
  return (
    overrides.position !== null ||
    overrides.fuel !== null ||
    overrides.gun !== null ||
    overrides.stations.length > 0
  );
}

/** Export values with the overrides on top; `null` when neither has anything. */
function assemble(values: ExportValues | null, overrides: OwnshipOverrides): StatusBody | null {
  if (values === null && !hasOverrides(overrides)) return null;

  const pos = overrides.position ? { ...overrides.position, altAgl: null } : (values?.pos ?? null);
  const fuel = overrides.fuel
    ? { ...overrides.fuel, source: 'manual' as const }
    : (values?.fuel ?? null);

  const exported = values?.armament ?? null;
  let armament = exported;
  if (overrides.stations.length > 0 || overrides.gun !== null) {
    const byStation = new Map<number, WeaponStation>(
      (exported?.stations ?? []).map((station) => [station.st, station]),
    );
    for (const station of overrides.stations) {
      byStation.set(station.st, { ...station, source: 'manual' });
    }
    armament = {
      stations: [...byStation.values()].sort((a, b) => a.st - b.st),
      gun: overrides.gun ? { ...overrides.gun, source: 'manual' } : (exported?.gun ?? null),
      stores: exported?.stores ?? [],
    };
  }

  return {
    pos,
    hdg: values?.hdg ?? null,
    hdgMag: values?.hdgMag ?? null,
    gs: values?.gs ?? null,
    ias: values?.ias ?? null,
    fuel,
    armament,
    avail: values?.avail ?? { pos: false, fuel: false, payload: false },
    // The relay sender (P1.6) picks the reason when it sends a package (§6.3).
    reason: 'change',
  };
}
