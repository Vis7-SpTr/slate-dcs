// SPDX-License-Identifier: GPL-3.0-or-later
// The host's CAS picture (protocol.md §8–§10, §14.3, P2.5): turns what the
// relay sends into the `cas`, `missions` and `fuelCalls` slices. The relay
// already sends each participant only what he may see (a pilot only his own
// lane), so the host keeps what arrives. `session.state` is the truth after
// a (re)join; the catch-up and replay follow it.

import type {
  CasSlice,
  FireMission,
  FuelCallsSlice,
  Message,
  MissionsSlice,
  SessionState,
} from '@slate-dcs/shared';

import type { StateStore } from '../state/store.js';

/** Who this host is in the session: the relay's pid and role. */
export interface Me {
  pid: string;
  role: string;
}

/** Received fuel calls and deliveries kept, newest last. */
const KEEP = 50;

function upsert<T>(list: readonly T[], item: T, same: (a: T) => boolean): T[] {
  const index = list.findIndex(same);
  if (index < 0) return [...list, item];
  return list.map((existing, i) => (i === index ? item : existing));
}

export class CasState {
  readonly #store: StateStore;
  readonly #now: () => number;

  constructor(store: StateStore, now: () => number) {
    this.#store = store;
    this.#now = now;
  }

  get cas(): CasSlice {
    return this.#store.get('cas');
  }

  get missions(): FireMission[] {
    return this.#store.get('missions').missions;
  }

  /** The AO this host works as a JTAC (his pid is in its `jtacs`), if any. */
  myAo(me: Me | null): CasSlice['aos'][number] | null {
    if (!me) return null;
    return this.cas.aos.find((ao) => ao.jtacs.some((jtac) => jtac.pid === me.pid)) ?? null;
  }

  // -------------------------------------------------------------------------
  // Snapshot and reset

  /** After `session.state` (§4.5): AOs, entries, holds, check-ins and missions as the relay has them. */
  snapshot(body: SessionState['body']): void {
    const checkIns = [...body.checkIns];
    const own = body.you.checkIn;
    if (own && !checkIns.some((c) => c.checkInId === own.checkInId)) checkIns.push(own);
    const cas = this.cas;
    // Notes of AOs that are gone go too; the rest stay (a notepad, §9.3).
    const aoIds = new Set(body.aos.map((ao) => ao.aoId));
    this.#set({
      ...cas,
      aos: body.aos,
      mapEntries: body.mapEntries,
      holds: body.holds,
      checkIns,
      sitUpdates: cas.sitUpdates.filter((note) => aoIds.has(note.aoId)),
      holdWilcos: cas.holdWilcos.filter((w) => body.holds.some((h) => h.holdId === w.holdId)),
    });
    // Open missions as the relay has them (§10.9). Closed ones aren't in the
    // snapshot: those this host saw stay, for the debrief, while their AO does.
    const open = body.you.openMissions;
    const closed = this.missions.filter(
      (m) =>
        (m.state === 'complete' || m.state === 'cancelled') &&
        aoIds.has(m.aoId) &&
        !open.some((o) => o.missionId === m.missionId),
    );
    this.#setMissions({ missions: [...open, ...closed] });
  }

  /** Out of the session (leave, switch): the relay's picture goes; the brief draft, notes on fuel and the log stay. */
  clear(): void {
    this.#set({
      ...this.cas,
      aos: [],
      mapEntries: [],
      holds: [],
      checkIns: [],
      sitUpdates: [],
      holdWilcos: [],
    });
    this.#setMissions({ missions: [] });
    this.#setFuel({ ...this.#store.get('fuelCalls'), received: [] });
  }

  // -------------------------------------------------------------------------
  // Relay messages

  /** One relay message; `true` if it was a CAS message (the log copy then looks for new entries). */
  apply(message: Message, me: Me, callsign: (pid: string) => string): boolean {
    const cas = this.cas;
    switch (message.type) {
      case 'ao.created':
      case 'ao.updated': {
        const ao = message.body;
        this.#set({ ...cas, aos: upsert(cas.aos, ao, (a) => a.aoId === ao.aoId) });
        return true;
      }
      case 'ao.closed': {
        // Everything tied to it goes with it (§8.2).
        const aoId = message.body.aoId;
        this.#set({
          ...cas,
          aos: cas.aos.filter((a) => a.aoId !== aoId),
          mapEntries: cas.mapEntries.filter((e) => e.aoId !== aoId),
          holds: cas.holds.filter((h) => h.aoId !== aoId),
          checkIns: cas.checkIns.filter((c) => c.aoId !== aoId),
          sitUpdates: cas.sitUpdates.filter((n) => n.aoId !== aoId),
        });
        this.#setMissions({ missions: this.missions.filter((m) => m.aoId !== aoId) });
        return true;
      }
      case 'cm.created':
      case 'cm.updated': {
        const entry = message.body;
        this.#set({
          ...cas,
          mapEntries: upsert(cas.mapEntries, entry, (e) => e.cmId === entry.cmId),
        });
        return true;
      }
      case 'cm.deleted': {
        const cmId = message.body.cmId;
        this.#set({ ...cas, mapEntries: cas.mapEntries.filter((e) => e.cmId !== cmId) });
        return true;
      }
      case 'cas.checkedIn': {
        // One check-in per flight (§9.2). The flight gets the AO's AO-only entries and holds with it (§8.4).
        const { aoEntries, ...checkIn } = message.body;
        let mapEntries = cas.mapEntries;
        for (const entry of aoEntries.entries) {
          mapEntries = upsert(mapEntries, entry, (e) => e.cmId === entry.cmId);
        }
        let holds = cas.holds;
        for (const hold of aoEntries.holds)
          holds = upsert(holds, hold, (h) => h.holdId === hold.holdId);
        this.#set({
          ...cas,
          checkIns: upsert(cas.checkIns, checkIn, (c) => c.flightId === checkIn.flightId),
          mapEntries,
          holds,
        });
        return true;
      }
      case 'cas.checkedOut': {
        const { flightId, aoId } = message.body;
        const jtacHere = this.myAo(me)?.aoId === aoId;
        // A pilot leaving the AO loses its AO-only entries and holds (§8.4, R5); its JTACs keep theirs.
        this.#set({
          ...cas,
          checkIns: cas.checkIns.filter((c) => c.flightId !== flightId),
          mapEntries: jtacHere
            ? cas.mapEntries
            : cas.mapEntries.filter((e) => !(e.aoId === aoId && e.visibility === 'ao')),
          holds: jtacHere
            ? cas.holds
            : cas.holds.filter((h) => !(h.aoId === aoId && h.visibility === 'ao')),
          sitUpdates: jtacHere ? cas.sitUpdates : cas.sitUpdates.filter((n) => n.aoId !== aoId),
        });
        return true;
      }
      case 'cas.hold.updated': {
        const hold = message.body;
        // A changed hold needs a new WILCO; a changed conflict list alone doesn't.
        const before = cas.holds.find((h) => h.holdId === hold.holdId);
        const same =
          before !== undefined &&
          JSON.stringify({ ...before, conflicts: [] }) ===
            JSON.stringify({ ...hold, conflicts: [] });
        this.#set({
          ...cas,
          holds: upsert(cas.holds, hold, (h) => h.holdId === hold.holdId),
          holdWilcos: same
            ? cas.holdWilcos
            : cas.holdWilcos.filter((w) => w.holdId !== hold.holdId),
        });
        return true;
      }
      case 'cas.hold.cancelled': {
        const holdId = message.body.holdId;
        this.#set({
          ...cas,
          holds: cas.holds.filter((h) => h.holdId !== holdId),
          holdWilcos: cas.holdWilcos.filter((w) => w.holdId !== holdId),
        });
        return true;
      }
      case 'cas.hold.wilco': {
        const { holdId } = message.body;
        this.#set({
          ...cas,
          holdWilcos: upsert(
            cas.holdWilcos,
            { holdId, pid: message.from, at: this.#now() },
            (w) => w.holdId === holdId && w.pid === message.from,
          ),
        });
        return true;
      }
      case 'cas.sitUpdate': {
        // The latest per flight, or for the whole AO (§9.3).
        const to = message.to;
        this.note({
          id: message.id,
          aoId: message.body.aoId,
          flightId: to.scope === 'flight' ? to.id : null,
          from: message.from,
          update: message.body.update,
          receivedAt: this.#now(),
          copied: false,
        });
        return true;
      }
      case 'cas.sitCopy': {
        // A pilot's COPY reaches the AO's JTACs.
        const re = message.re;
        this.#set({
          ...cas,
          sitUpdates: cas.sitUpdates.map((n) => (n.id === re ? { ...n, copied: true } : n)),
        });
        return true;
      }
      case 'fm.updated': {
        const mission = message.body;
        this.#setMissions({
          missions: upsert(this.missions, mission, (m) => m.missionId === mission.missionId),
        });
        return true;
      }
      case 'fm.deleted': {
        const missionId = message.body.missionId;
        this.#setMissions({ missions: this.missions.filter((m) => m.missionId !== missionId) });
        return true;
      }
      case 'fuel.call': {
        // From a flight mate or a checked-in aircraft (§6.5).
        if (message.from === me.pid) return false;
        const fuel = this.#store.get('fuelCalls');
        const call = {
          pid: message.from,
          callsign: callsign(message.from).slice(0, 24),
          call: message.body.call,
          internalKg: message.body.internalKg,
          receivedAt: this.#now(),
        };
        this.#setFuel({ ...fuel, received: [...fuel.received, call].slice(-KEEP) });
        return true;
      }
      default:
        return false;
    }
  }

  // -------------------------------------------------------------------------
  // Confirmations (§1.2)

  /** A CAS message this host sent with `ack: true`: its ticks start empty. */
  sent(
    id: string,
    about: { type: string; ref: string | null; pid: string | null } = {
      type: '',
      ref: null,
      pid: null,
    },
  ): void {
    const cas = this.cas;
    const delivery = { id, ...about, at: this.#now(), relay: false, receivedBy: [] };
    this.#set({ ...cas, deliveries: [...cas.deliveries, delivery].slice(-KEEP) });
  }

  /** Level 1: the relay took it. */
  receipt(id: string): void {
    this.#delivery(id, (d) => ({ ...d, relay: true }));
  }

  /** Level 2: a recipient's app got it. */
  received(id: string, pid: string): void {
    this.#delivery(id, (d) =>
      d.receivedBy.includes(pid) ? d : { ...d, relay: true, receivedBy: [...d.receivedBy, pid] },
    );
  }

  #delivery(
    id: string,
    change: (d: CasSlice['deliveries'][number]) => CasSlice['deliveries'][number],
  ): void {
    const cas = this.cas;
    if (!cas.deliveries.some((d) => d.id === id)) return;
    this.#set({ ...cas, deliveries: cas.deliveries.map((d) => (d.id === id ? change(d) : d)) });
  }

  // -------------------------------------------------------------------------
  // Own sends that the relay doesn't echo back

  /** A situation update kept as a note: received, or sent by this JTAC (the relay doesn't echo it). */
  note(note: CasSlice['sitUpdates'][number]): void {
    const cas = this.cas;
    this.#set({
      ...cas,
      sitUpdates: upsert(
        cas.sitUpdates,
        note,
        (n) => n.aoId === note.aoId && n.flightId === note.flightId,
      ),
    });
  }

  /** This pilot pressed COPY. */
  /** This host sent WILCO for a hold: kept, so its screens stop asking (the relay doesn't echo it). */
  wilcoed(holdId: string, pid: string): void {
    const cas = this.cas;
    this.#set({
      ...cas,
      holdWilcos: upsert(
        cas.holdWilcos,
        { holdId, pid, at: this.#now() },
        (w) => w.holdId === holdId && w.pid === pid,
      ),
    });
  }

  copied(id: string): void {
    const cas = this.cas;
    this.#set({
      ...cas,
      sitUpdates: cas.sitUpdates.map((n) => (n.id === id ? { ...n, copied: true } : n)),
    });
  }

  // -------------------------------------------------------------------------

  #set(cas: CasSlice): void {
    this.#store.update({ cas });
  }

  #setMissions(missions: MissionsSlice): void {
    this.#store.update({ missions });
  }

  #setFuel(fuelCalls: FuelCallsSlice): void {
    this.#store.update({ fuelCalls });
  }
}
