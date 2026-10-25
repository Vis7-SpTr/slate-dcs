// SPDX-License-Identifier: GPL-3.0-or-later
// The CAS log (protocol.md §12). The relay keeps every §12.2 entry per
// coalition session: in memory for `log.request`, and appended to the
// session's JSONL file (cas-log-file.ts, D7) so the log survives a restart.
// The other parts add their entries as things happen; missions are logged
// from what changed (cas-log-missions.ts).
//
// Rights (§12.3): a JTAC gets everything of the AO he is on-station in, a
// pilot his flight's missions and check-ins – and of those only what his
// lane view shows: nothing about another aircraft's lane, no JTAC warnings.

import {
  CAS_LOG_RULES,
  formatTimeOfDay,
  keyholePointName,
  localTimeOfDay,
} from '@slate-dcs/shared';
import type {
  Altitude,
  Coalition,
  LatLon,
  LogArea,
  LogEntry,
  Message,
  PointRef,
} from '@slate-dcs/shared';

import { RELAY_FROM } from './core.js';
import type { CasLogSink, Member, RelayCore } from './core.js';
import type { Flights } from './flights.js';

/** An entry as a part hands it over; the log adds `seq`, the times and the actor. */
export interface LogDraft {
  area: LogArea;
  /** The message type it records (`fm.clear`), or the relay event (`fm.windowExpired`). */
  kind: string;
  /** Without the actor – the log puts `Axeman 11: ` in front. */
  summary: string;
  aoId: string | null;
  flightId?: string | null;
  missionId?: string | null;
  /** The aircraft (lane) it is about. */
  pid?: string | null;
  /** Default: the sender of the message being handled, else the relay. */
  actor?: Member | 'relay';
  /** For the AO's JTACs only (laser warnings) – never in a pilot's export. */
  jtacOnly?: boolean;
}

interface Kept {
  entry: LogEntry;
  jtacOnly: boolean;
}

/** Entries kept in memory per session for `log.request`; the file keeps them all. */
const MEMORY_LIMIT = 50_000;

const FEET = 0.3048;

export class CasLog {
  readonly #core: RelayCore;
  readonly #flights: Flights;
  readonly #sink: CasLogSink | null;
  readonly #limit: number;
  readonly #kept: Record<Coalition, Kept[]> = { blue: [], red: [] };
  /** Last callsign seen per pid and name per flight – for those who have gone since. */
  readonly #names = new Map<string, string>();
  readonly #flightNames = new Map<string, string>();

  constructor(core: RelayCore, flights: Flights, sink: CasLogSink | null, limit = MEMORY_LIMIT) {
    this.#core = core;
    this.#flights = flights;
    this.#sink = sink;
    this.#limit = limit;
  }

  /**
   * Adds an entry. Its `seq` is the session's newest – the message the part
   * just sent; the mission time comes from the session's clock anchor (§1.4).
   */
  add(session: Coalition, draft: LogDraft): void {
    const core = this.#core;
    const actor = draft.actor ?? core.handled?.member ?? 'relay';
    const actorName = actor === 'relay' ? 'Relay' : this.name(actor);
    // `Enfield 1-1: …`, or `Enfield 1-1 sent his SPI` when the entry starts with him.
    const summary =
      actor === 'relay' || draft.summary.startsWith(`${actorName} `)
        ? draft.summary
        : `${actorName}: ${draft.summary}`;
    const entry: LogEntry = {
      seq: core.sessions[session].seq,
      rts: core.now(),
      mtime: core.missionTime(session),
      area: draft.area,
      kind: draft.kind.slice(0, 40),
      actor: actor === 'relay' ? 'relay' : actor.pid,
      actorName: actorName.slice(0, 40),
      summary: clip(summary, 500),
      aoId: draft.aoId,
      flightId: draft.flightId ?? null,
      missionId: draft.missionId ?? null,
      pid: draft.pid ?? null,
    };
    const kept = this.#kept[session];
    kept.push({ entry, jtacOnly: draft.jtacOnly ?? false });
    if (kept.length > this.#limit) kept.splice(0, kept.length - this.#limit);
    this.#sink?.append(session, entry);
  }

  /** The session's entries in memory, oldest first (tests, the relay admin). */
  all(session: Coalition): LogEntry[] {
    return this.#kept[session].map((k) => k.entry);
  }

  // -------------------------------------------------------------------------
  // Names for summaries

  /** A JTAC's callsign in his AO, `Enfield 1-2` in a flight, else as last seen, else his nick. */
  name(member: Member): string {
    const jtac = member.ao?.jtacs.find((j) => j.member === member);
    const live = jtac?.callsign ?? (member.flight ? this.#flights.callsign(member) : null);
    if (live !== null) {
      this.#names.set(member.pid, live);
      return live;
    }
    return this.#names.get(member.pid) ?? member.aircraft?.unit ?? member.nick;
  }

  nameOf(pid: string): string {
    const member = this.#core.members.get(pid);
    return member ? this.name(member) : (this.#names.get(pid) ?? pid);
  }

  /** `Enfield 1`, also after the flight ended. */
  flightName(flightId: string | null | undefined): string {
    if (flightId === null || flightId === undefined) return '–';
    const flight = this.#flights.all().find((f) => f.id === flightId);
    if (!flight) return this.#flightNames.get(flightId) ?? flightId;
    const name = this.#flights.display(flight);
    this.#flightNames.set(flightId, name);
    return name;
  }

  // -------------------------------------------------------------------------
  // log.request (§12.3)

  /**
   * One page of what he may export: a JTAC scope `ao` = his AO, a pilot scope
   * `flight` = his flight. Oldest first, at most `pageSize`; `next` = the
   * `seq` to ask from for the rest. A page never ends inside one `seq`.
   */
  request(member: Member, message: Extract<Message, { type: 'log.request' }>): void {
    const core = this.#core;
    const body = message.body;
    const jtac = member.role === 'jtac';
    const allowed =
      body.scope === 'ao'
        ? jtac && member.ao?.id === body.id
        : !jtac && member.flight?.id === body.id;
    if (!allowed) {
      core.error(member.conn, 'forbidden', 'A JTAC exports his AO, a pilot his flight', message.id);
      return;
    }
    const from = body.from ?? 0;
    const to = body.to ?? Number.POSITIVE_INFINITY;
    const visible = this.#kept[member.session].filter(
      (k) => k.entry.seq >= from && k.entry.seq <= to && this.#may(member, body, k),
    );
    const size = CAS_LOG_RULES.pageSize;
    let page = visible.slice(0, size);
    let next: number | null = null;
    const rest = visible[size];
    if (rest !== undefined) {
      const cut = rest.entry.seq;
      const whole = page.filter((k) => k.entry.seq < cut);
      // More than a page in one seq can't happen; if it did, skip the rest of it.
      page = whole.length > 0 ? whole : page;
      next = whole.length > 0 ? cut : cut + 1;
    }
    core.direct(member.conn, {
      type: 'log.entries',
      from: RELAY_FROM,
      session: member.session,
      to: { scope: 'pid', id: member.pid },
      body: { entries: page.map((k) => k.entry), next },
      re: message.id,
    });
  }

  #may(member: Member, scope: { scope: 'ao' | 'flight'; id: string }, kept: Kept): boolean {
    const entry = kept.entry;
    if (scope.scope === 'ao') return entry.aoId === scope.id;
    return (
      entry.flightId === scope.id &&
      (entry.area === 'mission' || entry.area === 'checkIn') &&
      !kept.jtacOnly &&
      (entry.pid === null || entry.pid === member.pid)
    );
  }
}

// ---------------------------------------------------------------------------
// Text helpers for the parts' summaries

/** `AO AXEMAN 11` – the default name already starts with "AO", a typed one may not. */
export function aoText(name: string): string {
  return /^AO\b/i.test(name) ? name : `AO ${name}`;
}

/** `15000 ft MSL`, `500 ft AGL`, `SFC`. */
export function altText(altitude: Altitude): string {
  if (altitude.ref === 'sfc') return 'SFC';
  const feet = Math.round(altitude.m / FEET / 100) * 100;
  return `${String(feet)} ft ${altitude.ref.toUpperCase()}`;
}

/** Mission time as `14:23:05 L`; `–` without one. */
export function mtText(mtime: number | null): string {
  return mtime === null ? '–' : `${formatTimeOfDay(localTimeOfDay(mtime))} L`;
}

/** `HAMMER`, `ROCK ALPHA 5` (keyhole), `N42°10.12′ E041°41.50′`; `label` = a map entry's name. */
export function pointText(point: PointRef, label: (cmId: string) => string | null): string {
  if ('lat' in point) return latLonText(point);
  const name = label(point.cmId) ?? point.cmId;
  return 'axis' in point && point.axis !== undefined
    ? `${name} ${keyholePointName(point.axis, point.distanceNm)}`
    : name;
}

/** Degrees and decimal minutes: `N42°10.12′ E041°41.50′`. */
export function latLonText(p: LatLon): string {
  const part = (value: number, pos: string, neg: string, width: number) => {
    const abs = Math.abs(value);
    let deg = Math.floor(abs);
    let min = Math.round((abs - deg) * 60 * 100) / 100;
    if (min >= 60) {
      deg += 1;
      min = 0;
    }
    const [whole, frac = '00'] = min.toFixed(2).split('.');
    return `${value < 0 ? neg : pos}${String(deg).padStart(width, '0')}°${(whole ?? '0').padStart(2, '0')}.${frac}′`;
  };
  return `${part(p.lat, 'N', 'S', 2)} ${part(p.lon, 'E', 'W', 3)}`;
}

/** At most `max` characters, with `…` when cut. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
