// SPDX-License-Identifier: GPL-3.0-or-later
// Raw `own` datagram → SLATE units and conventions (protocol.md §6.1):
// headings as the cockpit shows them, ground speed, fuel weight, armament.

import { airframe, fuelWeights, headingDegFromRad } from '@slate-dcs/shared';
import type {
  AirData,
  Armament,
  BridgeOwn,
  Countermeasures,
  Fuel,
  Position,
  StatusBody,
} from '@slate-dcs/shared';

import { armamentFromExport } from './payload.js';

/** One `own` datagram in SLATE's units. */
export interface ExportValues {
  /** DCS model time and mission start time of the sample. */
  mt: number;
  start: number | null;
  /** Unit type and name from `LoGetSelfData()`. */
  type: string | null;
  unit: string | null;
  pos: Position | null;
  /** Degrees true in DCS's sense: from the map grid's north, as the cockpit's TRUE mode. */
  hdg: number | null;
  /** Degrees magnetic, straight from DCS – what the cockpit shows by default. */
  hdgMag: number | null;
  /** m/s. */
  gs: number | null;
  ias: number | null;
  /** TAS, Mach and vertical speed – host-local, not part of `status.update`. */
  airData: AirData;
  /** `null` without fuel data, or when the airframe's capacity isn't known. */
  fuel: Fuel | null;
  armament: Armament | null;
  countermeasures: Countermeasures | null;
  /** Which getters returned data – `fuel` is `true` even when the capacity is unknown. */
  avail: StatusBody['avail'];
}

export function exportValues(own: BridgeOwn): ExportValues {
  const pos =
    own.lat !== null && own.lon !== null && own.altMsl !== null
      ? { lat: own.lat, lon: own.lon, altMsl: own.altMsl, altAgl: own.altAgl }
      : null;

  // Both headings as DCS gives them, so they match the cockpit (decided 21 Oct
  // 2026): DCS's "true" is the map grid's north, not the meridian.
  const hdg = own.gridHdg === null ? null : headingDegFromRad(own.gridHdg);
  const hdgMag = own.magHdg === null ? null : headingDegFromRad(own.magHdg);

  // Velocity is in map axes: x north, z east (grid); ground speed ignores y.
  const gs = own.vel === null ? null : Math.hypot(own.vel[0], own.vel[2]);

  const capacity = airframe(own.type)?.internalFuelKg ?? null;
  const fuel: Fuel | null =
    own.fuelInt !== null && capacity !== null
      ? { ...fuelWeights(own.fuelInt, own.fuelExt ?? 0, capacity), source: 'export' }
      : null;

  return {
    mt: own.mt,
    start: own.start,
    type: own.type,
    unit: own.unit,
    pos,
    hdg,
    hdgMag,
    gs,
    // IAS, TAS and Mach read slightly below 0 when standing still.
    ias: own.ias === null ? null : Math.max(0, own.ias),
    airData: {
      tas: own.tas === null ? null : Math.max(0, own.tas),
      mach: own.mach === null ? null : Math.max(0, own.mach),
      // DCS's vertical velocity, else the vertical part of the velocity vector.
      vs: own.vs ?? own.vel?.[1] ?? null,
    },
    fuel,
    armament: armamentFromExport(own.payload, own.gun),
    countermeasures: own.cm,
    avail: { pos: pos !== null, fuel: own.fuelInt !== null, payload: own.payload !== null },
  };
}
