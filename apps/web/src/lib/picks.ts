// SPDX-License-Identifier: GPL-3.0-or-later
// Picks per field (ui-design.md §11, P2.7d): in VR a value is picked, not
// typed, where the field has sensible choices; CUSTOM (the field itself)
// opens the on-screen keyboard for anything else. The lists are SLATE's
// starting lists – one place to change them (`scope.md` §6.3).

import type { CmKind, Frequency, MapEntry } from '@slate-dcs/shared';

/**
 * Flight names: the DCS standard callsigns, then the DCS A-10 and AH-64 ones
 * (confirmed by the user 15 Nov 2026).
 */
export const FLIGHT_CALLSIGNS: readonly string[] = [
  'Enfield',
  'Springfield',
  'Uzi',
  'Colt',
  'Dodge',
  'Ford',
  'Chevy',
  'Pontiac',
  'Hawg',
  'Boar',
  'Pig',
  'Tusk',
  'Army Air',
  'Apache',
  'Crow',
  'Sioux',
  'Gatling',
  'Gunslinger',
  'Hammerhead',
  'Bootleg',
  'Palehorse',
  'Carnivor',
  'Saber',
];

/** The DCS JTAC callsigns. */
export const JTAC_CALLSIGNS: readonly string[] = [
  'Axeman',
  'Darknight',
  'Warrior',
  'Pointer',
  'Eyeball',
  'Moonbeam',
  'Whiplash',
  'Finger',
  'Pinpoint',
  'Ferret',
  'Shaba',
  'Playboy',
  'Hammer',
  'Jaguar',
  'Deathstar',
  'Anvil',
  'Firefly',
  'Mantis',
  'Badger',
];

/**
 * The callsign word of a DCS unit name (`Enfield 1-1` → `Enfield`,
 * `Colt11` → `Colt`); `null` for names that aren't a callsign plus numbers.
 */
export function unitCallsign(unit: string | null | undefined): string | null {
  const match = /^\s*([A-Za-z][A-Za-z ]*?)\s*\d+(?:\s*-\s*\d+)?\s*$/.exec(unit ?? '');
  return match?.[1] ?? null;
}

/**
 * A JTAC callsign with a picked name: the number already typed stays
 * (`Axeman 12` + Hammer → `Hammer 12`), otherwise `11`.
 */
export function withCallsignName(current: string, name: string): string {
  const number = /\s(\d[\d-]*)\s*$/.exec(current)?.[1] ?? '11';
  return `${name} ${number}`;
}

/** Common threat types for a threat marker's name. */
export const THREAT_TYPES: readonly string[] = [
  'SA-2',
  'SA-3',
  'SA-6',
  'SA-8',
  'SA-10',
  'SA-11',
  'SA-13',
  'SA-15',
  'SA-19',
  'ZSU-23-4',
  'ZU-23',
  'MANPADS',
  'AAA',
];

/** Ready-made texts, added to a text field; one ending in a space waits for the rest. */
export const TEXT_CHIPS = {
  restrictions: [
    'NO FLY SOUTH OF ',
    'NO FLY NORTH OF ',
    'NO FLY EAST OF ',
    'NO FLY WEST OF ',
    'FINAL ATTACK HEADING ',
    'ALTITUDE AT OR ABOVE ',
    'LASER GUIDED ONLY',
    'ONE PASS ONLY',
    'NO CLUSTER MUNITIONS',
  ],
  remarks: [
    'DANGER CLOSE',
    'FRIENDLIES NORTH 500 M',
    'FRIENDLIES SOUTH 500 M',
    'FRIENDLIES EAST 500 M',
    'FRIENDLIES WEST 500 M',
    'AIRSPACE DECONFLICTED',
    'SMOKE ON TARGET',
  ],
  hazards: ['POWER LINES', 'HIGH TERRAIN', 'MANPADS IN AREA', 'AAA IN AREA', 'CIVILIANS NEARBY'],
  abort: ['WRONG TARGET', 'FRIENDLIES', 'SAFETY', 'NOT CORRELATED', 'CHECK FIRE'],
  bda: [
    'SECONDARIES',
    'TARGET MOVING',
    'RE-ATTACK REQUIRED',
    'NO EFFECT OBSERVED',
    'SMOKE OBSCURING',
  ],
  checkIn: ['WINCHESTER SOON', 'NVG CAPABLE', 'NO TGP', 'FUEL LIMITED'],
  effects: ['DESTROY', 'NEUTRALIZE', 'SUPPRESS', 'DISRUPT', 'MARK'],
  friendlies: ['NORTH 500 M', 'SOUTH 500 M', 'EAST 500 M', 'WEST 500 M', 'NONE WITHIN 3 KM'],
  egress: ['NORTH', 'SOUTH', 'EAST', 'WEST', 'BACK TO IP'],
  fires: ['NONE', 'ARTILLERY ACTIVE', 'MORTARS ACTIVE', 'NAVAL GUNFIRE ACTIVE'],
} as const;

/** How a chip goes into the text: on a new line, after a comma, or in place of it. */
export type ChipJoin = 'line' | 'comma' | 'replace';

/** The text after adding a chip. */
export function addChip(value: string, chip: string, join: ChipJoin): string {
  if (join === 'replace' || value.trim() === '') return chip;
  if (join === 'line') return `${value.replace(/\s+$/, '')}\n${chip}`;
  return `${value.replace(/[\s,]+$/, '')}, ${chip}`;
}

const ENTRY_PREFIX: Record<CmKind, string> = {
  friendly: 'FRIENDLY',
  nfa: 'NFA',
  rfa: 'RFA',
  roz: 'ROZ',
  fscl: 'FSCL',
  cfl: 'CFL',
  ip: 'IP',
  cp: 'CP',
  keyhole: 'KEYHOLE',
  threat: 'THREAT',
  enemy: 'ENEMY',
};

/** An automatic name for a new entry: `IP 1`, `CP 2`, `THREAT 3` – the first number not taken. */
export function autoEntryName(kind: CmKind, entries: readonly MapEntry[]): string {
  const prefix = ENTRY_PREFIX[kind];
  const taken = new Set(entries.map((e) => (e.label ?? '').toUpperCase()));
  let n = entries.filter((e) => e.kind === kind).length + 1;
  while (taken.has(`${prefix} ${String(n)}`)) n += 1;
  return `${prefix} ${String(n)}`;
}

/** A number field changed by a step, kept within its limits; empty counts as `from`. */
export function stepValue(
  text: string,
  step: number,
  limits: { min?: number; max?: number; from?: number } = {},
): string {
  const current = Number(text.replace(',', '.'));
  const base = text.trim() === '' || !Number.isFinite(current) ? (limits.from ?? 0) : current;
  let next = Math.round((base + step) * 100) / 100;
  if (limits.min !== undefined) next = Math.max(limits.min, next);
  if (limits.max !== undefined) next = Math.min(limits.max, next);
  return String(next);
}

/** `HHMM` of a mission time in the user's clock – what the time fields take. */
export function hhmm(timeText: string): string | null {
  const match = /(\d{2}):(\d{2})/.exec(timeText);
  return match ? `${match[1] ?? ''}${match[2] ?? ''}` : null;
}

/** Frequencies to pick from: the AO's JTACs' and the recent ones, each MHz once. */
export function frequencyPicks(
  groups: readonly (readonly Frequency[])[],
  max = 8,
): readonly Frequency[] {
  const seen = new Set<string>();
  const out: Frequency[] = [];
  for (const f of groups.flat()) {
    const key = f.mhz.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
    if (out.length >= max) break;
  }
  return out;
}

const RECENT_FREQS = 'slate.recentFreqs';
const LAST_JTAC = 'slate.jtacCallsign';

/** Frequencies used last on this screen (newest first). */
export function recentFrequencies(): Frequency[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENT_FREQS) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (f): f is Frequency =>
        typeof f === 'object' &&
        f !== null &&
        typeof (f as Frequency).mhz === 'number' &&
        ((f as Frequency).label === null || typeof (f as Frequency).label === 'string'),
    );
  } catch {
    return [];
  }
}

export function rememberFrequencies(freqs: readonly Frequency[]): void {
  try {
    const list = frequencyPicks([freqs, recentFrequencies()], 8);
    localStorage.setItem(RECENT_FREQS, JSON.stringify(list));
  } catch {
    // Storage blocked: nothing to remember.
  }
}

export function lastJtacCallsign(): string | null {
  try {
    return localStorage.getItem(LAST_JTAC);
  } catch {
    return null;
  }
}

export function rememberJtacCallsign(callsign: string): void {
  try {
    localStorage.setItem(LAST_JTAC, callsign);
  } catch {
    // Storage blocked: nothing to remember.
  }
}
