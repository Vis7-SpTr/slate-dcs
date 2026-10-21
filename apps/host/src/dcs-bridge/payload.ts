// SPDX-License-Identifier: GPL-3.0-or-later
// DCS payload → SLATE armament (protocol.md §6.1/§6.2, spike 3.3): weapon kind
// from the DCS weapon type code, readable names for pods and tanks.

import type {
  Armament,
  BridgeStation,
  WeaponKind,
  WeaponRole,
  WeaponTypeCode,
} from '@slate-dcs/shared';

/** What a station holds: a weapon of some kind, or a store (pod, tank). */
export type StationKind = WeaponKind | 'store';

/**
 * Kind from the weapon type code (spike 3.3): `level1 = 4` is a weapon or pod –
 * `level2` 4 missile, 5 bomb, 7 rockets, 15 pod (TGP, ECM, HTS, Apache FCR);
 * `level1 = 1, level3 = 43` is a fuel tank. Any other weapon (`level1 = 4`) is
 * counted as `other`; anything else is listed as a store.
 */
export function stationKind([level1, level2]: WeaponTypeCode): StationKind {
  if (level1 === 4) {
    switch (level2) {
      case 4:
        return 'missile';
      case 5:
        return 'bomb';
      case 7:
        return 'rocket';
      case 15:
        return 'store';
      default:
        return 'other';
    }
  }
  // Fuel tanks (level1 = 1, level3 = 43) and anything unknown.
  return 'store';
}

/**
 * Air-to-air for air-to-air missiles – type code 4,4,7,x (AIM-9, -7, -120, -54
 * in spike 3.3) – and air-to-ground for everything else (AGM-65/-114 are 4,4,8,x).
 */
export function weaponRole([level1, level2, level3]: WeaponTypeCode): WeaponRole {
  return level1 === 4 && level2 === 4 && level3 === 7 ? 'aa' : 'ag';
}

/**
 * Readable names for pods and tanks whose DCS names are internal (spike 3.3),
 * by loadout CLSID. Weapon names from DCS are readable and used as they are.
 */
export const STORE_NAMES: Readonly<Record<string, string>> = {
  '{AAQ-28_LEFT}': 'Litening TGP',
  '{A111396E-D3E8-4b9c-8AC9-2432489304D5}': 'Litening TGP',
  '{AN_ASQ_228}': 'ATFLIR',
  '{AN_ASQ_213}': 'HTS pod',
  ALQ_184_Long: 'ALQ-184 ECM pod',
  '{AN_APG_78}': 'Longbow FCR',
  '{FPU_8A_FUEL_TANK}': 'FPU-8A tank',
  '{F14-300gal}': '300 gal tank',
};

/** DCS returns `UNKNOWN_l1,l2,l3,l4` when it has no name for a type code. */
function dcsName(station: BridgeStation): string | null {
  const name = station.name?.trim() ?? '';
  return name === '' || name.startsWith('UNKNOWN_') ? null : name;
}

function weaponName(station: BridgeStation): string {
  return dcsName(station) ?? station.clsid ?? 'Unknown weapon';
}

function storeName(station: BridgeStation): string {
  if (station.clsid !== null) {
    const known = STORE_NAMES[station.clsid];
    if (known !== undefined) return known;
  }
  const name = dcsName(station) ?? station.clsid ?? 'Unknown store';
  return name.replace(/_/g, ' ');
}

/**
 * Armament from the bridge's payload and gun count, all with source `export`.
 * Stations keep a count of 0 after the last release, so the pilot sees the
 * station is empty. `null` when DCS gave no payload (vehicles, no slot).
 */
export function armamentFromExport(
  payload: readonly BridgeStation[] | null,
  gunRounds: number | null,
): Armament | null {
  if (payload === null) return null;
  const armament: Armament = {
    stations: [],
    gun: gunRounds === null ? null : { rounds: gunRounds, source: 'export' },
    stores: [],
  };
  for (const station of [...payload].sort((a, b) => a.st - b.st)) {
    if (station.w[0] === 0) continue; // empty station
    const kind = stationKind(station.w);
    if (kind === 'store') {
      armament.stores.push({ st: station.st, name: storeName(station) });
    } else {
      armament.stations.push({
        st: station.st,
        name: weaponName(station),
        kind,
        role: weaponRole(station.w),
        count: station.count,
        source: 'export',
      });
    }
  }
  return armament;
}
