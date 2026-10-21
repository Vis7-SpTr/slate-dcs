// SPDX-License-Identifier: GPL-3.0-or-later
// Weapon names and totals for display: short labels for the station diagram,
// totals by role and type for the simplified armament view (and later the
// JTAC's ordnance totals, ui-design.md §7).

import type { WeaponKind, WeaponRole, WeaponStation } from './status.js';

const MAX_SHORT = 6;

/**
 * Short weapon label for the station diagram, e.g. `AIM-9X` → `9X`,
 * `AGM-65F Maverick` → `65F`, `GBU-12` → `GB12`, `Mk-82` / `Mk20 Rockeye` → `MK82` / `MK20`,
 * `Hydra 70 M229 HE` → `M229`. Anything else: its first word, at most 6
 * characters.
 */
export function shortWeaponName(name: string): string {
  const missile = /^(?:AIM|AGM|AGR|ATM)-([0-9A-Z]+)/i.exec(name);
  if (missile?.[1] !== undefined) return missile[1].toUpperCase();
  const guided = /^GBU-?(\d+)/i.exec(name);
  if (guided?.[1] !== undefined) return `GB${guided[1]}`;
  const general = /^Mk-?\s?(\d+)/i.exec(name);
  if (general?.[1] !== undefined) return `MK${general[1]}`;
  const rocket = /\b(M\d{3})\b/.exec(name);
  if (/hydra|rocket|apkws/i.test(name) && rocket?.[1] !== undefined) return rocket[1];
  const firstWord = name.trim().split(/\s+/)[0] ?? name;
  return firstWord.toUpperCase().slice(0, MAX_SHORT);
}

/** Short label for a pod or tank: `TGP`, `FLIR`, `HTS`, `ECM`, `FCR`, `TANK`. */
export function shortStoreName(name: string): string {
  if (/tank/i.test(name)) return 'TANK';
  if (/litening|tgp|sniper|lantirn/i.test(name)) return 'TGP';
  if (/atflir/i.test(name)) return 'FLIR';
  if (/hts/i.test(name)) return 'HTS';
  if (/ecm|alq/i.test(name)) return 'ECM';
  if (/fcr|apg-78/i.test(name)) return 'FCR';
  const firstWord = name.trim().split(/\s+/)[0] ?? name;
  return firstWord.toUpperCase().slice(0, MAX_SHORT);
}

/** One line of the totals: a weapon type and how many are left. */
export interface WeaponTotal {
  name: string;
  kind: WeaponKind;
  count: number;
}

/** Totals by role; within a role missiles, bombs, rockets, other – then by name. */
export type ArmamentTotals = Record<WeaponRole, WeaponTotal[]>;

const KIND_ORDER: Readonly<Record<WeaponKind, number>> = {
  missile: 0,
  bomb: 1,
  rocket: 2,
  other: 3,
};

/**
 * Weapons left, added up per weapon type and grouped into air-to-air and
 * air-to-ground (simplified armament view). Empty stations don't count.
 */
export function armamentTotals(stations: readonly WeaponStation[]): ArmamentTotals {
  const byName = new Map<string, WeaponTotal & { role: WeaponRole }>();
  for (const station of stations) {
    if (station.count === 0) continue;
    const key = `${station.role}|${station.name}`;
    const total = byName.get(key);
    if (total) total.count += station.count;
    else
      byName.set(key, {
        name: station.name,
        kind: station.kind,
        role: station.role,
        count: station.count,
      });
  }
  const totals: ArmamentTotals = { aa: [], ag: [] };
  for (const { role, ...total } of byName.values()) totals[role].push(total);
  for (const list of Object.values(totals)) {
    list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
  }
  return totals;
}
