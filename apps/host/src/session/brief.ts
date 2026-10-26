// SPDX-License-Identifier: GPL-3.0-or-later
// The check-in brief draft (protocol.md §9.1): created now, sent later. The
// live fields – callsign, aircraft, position, ordnance – follow the flight and
// the status packages until the lead types over one (`edited`); at sending
// they are refreshed once more. Entered fields stay as typed, laser codes
// included (prefilled from the last brief).

import { CheckInBrief } from '@slate-dcs/shared';
import type { BriefField, CasSlice, StatusUpdate } from '@slate-dcs/shared';

import type { StateStore } from '../state/store.js';

type Brief = CheckInBrief;
type Armament = NonNullable<StatusUpdate['body']['armament']>;

/** Fields the host fills in and refreshes (§9.1); the rest the lead enters. */
export const LIVE_FIELDS = ['callsign', 'aircraft', 'position', 'ordnance'] as const;

/** A brief nobody has typed into yet. */
function empty(live: Pick<Brief, (typeof LIVE_FIELDS)[number]>): Brief {
  return {
    ...live,
    playtimeMin: null,
    capabilities: [],
    abortCode: null,
    missionNumber: null,
    laserCodes: { flight: null, perAircraft: {} },
    remarks: '',
  };
}

/** Totals per weapon over the flight's armament (§9.1): A/G first, then A/A, the gun last. */
export function ordnanceTotals(armaments: readonly (Armament | null)[]): Brief['ordnance'] {
  const totals = new Map<string, { count: number; role: string }>();
  let rounds = 0;
  for (const armament of armaments) {
    if (!armament) continue;
    for (const station of armament.stations) {
      if (station.count <= 0) continue;
      const total = totals.get(station.name) ?? { count: 0, role: station.role };
      total.count += station.count;
      totals.set(station.name, total);
    }
    rounds += armament.gun?.rounds ?? 0;
  }
  const order = (role: string) => (role === 'ag' ? 0 : role === 'aa' ? 1 : 2);
  const list = [...totals]
    .sort(([a, x], [b, y]) => order(x.role) - order(y.role) || a.localeCompare(b))
    .map(([name, { count }]) => ({ name: name.slice(0, 32), count }));
  if (rounds > 0) list.push({ name: 'Gun (rounds)', count: rounds });
  return list.slice(0, 32);
}

export class BriefDraft {
  readonly #store: StateStore;

  constructor(store: StateStore) {
    this.#store = store;
  }

  /** The live fields as they are now; `null` outside a flight (nothing to check in). */
  live(): Pick<Brief, (typeof LIVE_FIELDS)[number]> | null {
    const flight = this.#store.get('flight');
    const own = flight.own;
    if (!own) return null;
    const ownship = this.#store.get('ownship');
    const pos = ownship.status?.pos;
    const members = [...own.members].sort((a, b) => a.pos - b.pos);
    const session = this.#store.get('session');
    const armaments = [
      ownship.status?.armament ?? null,
      ...flight.status
        .filter((s) => s.pid !== session.pid && members.some((m) => m.pid === s.pid))
        .map((s) => s.status.armament),
    ];
    return {
      callsign: own.display.slice(0, 24),
      aircraft: members.map((m) => ({
        pid: m.pid,
        type:
          (m.pid === session.pid ? ownship.aircraft?.type : null) ?? m.aircraft?.type ?? 'unknown',
      })),
      position: pos ? { lat: pos.lat, lon: pos.lon, altMsl: pos.altMsl } : null,
      ordnance: ordnanceTotals(armaments),
    };
  }

  /**
   * Follows the flight (once a second): live fields that weren't typed over.
   * Starts a draft once the player is in a flight; keeps it outside one.
   */
  refresh(): void {
    const live = this.live();
    if (!live) return;
    const cas = this.#store.get('cas');
    const draft = cas.briefDraft ?? { brief: empty(live), edited: [] };
    const brief = { ...draft.brief };
    for (const field of LIVE_FIELDS) {
      if (!draft.edited.includes(field)) Object.assign(brief, { [field]: live[field] });
    }
    if (JSON.stringify(brief) === JSON.stringify(cas.briefDraft?.brief) && cas.briefDraft) return;
    this.#setDraft({ brief, edited: draft.edited });
  }

  /**
   * `cas.setBrief` (§14.7): types over fields (marked edited); `reset` gives
   * fields back to the live values. The result must be a valid brief.
   */
  set(
    changes: Partial<Brief>,
    reset: readonly BriefField[],
  ): { ok: true } | { ok: false; text: string } {
    const live = this.live();
    const current = this.#store.get('cas').briefDraft;
    if (!current && !live) return { ok: false, text: 'Join a flight first' };
    const draft = current ?? { brief: empty(live ?? ({} as never)), edited: [] };
    const brief: Brief = { ...draft.brief, ...changes };
    const edited = new Set([...draft.edited, ...(Object.keys(changes) as BriefField[])]);
    for (const field of reset) {
      edited.delete(field);
      if (live && (LIVE_FIELDS as readonly string[]).includes(field)) {
        Object.assign(brief, { [field]: live[field as (typeof LIVE_FIELDS)[number]] });
      }
    }
    // Only live fields count as "typed over"; the entered ones are always the lead's.
    const marks = [...edited].filter((f) => (LIVE_FIELDS as readonly string[]).includes(f));
    const parsed = CheckInBrief.safeParse(brief);
    if (!parsed.success)
      return { ok: false, text: parsed.error.issues[0]?.message ?? 'Not a valid brief' };
    this.#setDraft({ brief: parsed.data, edited: marks });
    return { ok: true };
  }

  /** The brief as it goes out now: live fields refreshed at the moment of sending (§9.1). */
  forSending(): Brief | null {
    this.refresh();
    const draft = this.#store.get('cas').briefDraft;
    if (!draft || !this.live()) return null;
    const parsed = CheckInBrief.safeParse(draft.brief);
    return parsed.success ? parsed.data : null;
  }

  #setDraft(draft: NonNullable<CasSlice['briefDraft']>): void {
    this.#store.update({ cas: { ...this.#store.get('cas'), briefDraft: draft } });
  }
}
