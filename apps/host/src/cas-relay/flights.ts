// SPDX-License-Identifier: GPL-3.0-or-later
// Flights (protocol.md §7): create, join, leave, move, move up, command and
// the end of a flight. Membership and positions are relay state – only this
// part changes them, and it tells the members with `flight.updated`.

import { FLIGHT_RULES, flightNameKey } from '@slate-dcs/shared';
import type { ErrorCode, Flight, FlightSummary, Message } from '@slate-dcs/shared';

import { newFlightId, newPrivateCode } from './codes.js';
import { RELAY_FROM } from './core.js';
import type { FlightRec, Member, RelayCore } from './core.js';

/** The flight messages a host sends. */
export type FlightCommand = Extract<
  Message,
  { type: 'flight.create' | 'flight.join' | 'flight.leave' | 'flight.move' | 'flight.moveUp' }
>;

type Fail = (code: ErrorCode, text: string) => void;

export class Flights {
  readonly #core: RelayCore;
  readonly #flights = new Map<string, FlightRec>();

  constructor(core: RelayCore) {
    this.#core = core;
  }

  /** All flights, for counts and the session state. */
  all(): FlightRec[] {
    return [...this.#flights.values()];
  }

  command(member: Member, message: FlightCommand): void {
    const fail: Fail = (code, text) => {
      this.#core.error(member.conn, code, text, message.id);
    };
    if (member.role === 'jtac') {
      fail('forbidden', 'JTACs are not in flights');
      return;
    }
    if (message.type === 'flight.create' || message.type === 'flight.join') {
      if (member.flight) {
        fail('alreadyInFlight', `Already in ${this.display(member.flight)} – leave it first`);
        return;
      }
      if (message.type === 'flight.create') this.#create(member, message.body, message.id);
      else this.#join(member, message.body, message.id, fail);
      return;
    }
    const flight = member.flight;
    if (!flight) {
      fail('forbidden', 'Not in a flight');
      return;
    }
    if (message.type === 'flight.leave') {
      this.remove(member, message.id, true);
      this.#core.log?.info(`${this.#core.who(member)} left ${this.display(flight)}`);
    } else if (message.type === 'flight.move') {
      this.#move(flight, member, message.body, message.id, fail);
    } else {
      this.#moveUp(flight, member, message.id, fail);
    }
  }

  #create(member: Member, body: { name: string; open: boolean }, re: string): void {
    const key = flightNameKey(body.name);
    const taken = new Set(
      [...this.#flights.values()]
        .filter((f) => f.session === member.session && f.key === key)
        .map((f) => f.number),
    );
    let number = 1;
    while (taken.has(number)) number += 1;
    const codes = new Set([...this.#flights.values()].map((f) => f.privateCode));
    const flight: FlightRec = {
      id: newFlightId((id) => this.#flights.has(id)),
      session: member.session,
      name: body.name,
      key,
      number,
      open: body.open,
      privateCode: body.open ? null : newPrivateCode((code) => codes.has(code)),
      slots: new Map([[1, member]]),
      leadFreeSince: null,
    };
    this.#flights.set(flight.id, flight);
    member.flight = flight;
    this.#core.publish(
      this.#core.sessions[flight.session],
      {
        type: 'flight.created',
        from: RELAY_FROM,
        session: flight.session,
        to: { scope: 'pid', id: member.pid },
        body: this.view(flight, member),
        re,
      },
      [member],
      true,
    );
    this.listed(flight);
    this.#core.log?.info(
      `${this.#core.who(member)} created ${this.display(flight)} (${flight.open ? 'open' : 'private'})`,
    );
  }

  #join(
    member: Member,
    body: { flightId: string } | { privateCode: string },
    re: string,
    fail: Fail,
  ): void {
    const found =
      'flightId' in body
        ? this.#flights.get(body.flightId)
        : [...this.#flights.values()].find((f) => f.privateCode === body.privateCode);
    // Only flights of his own session; a private flight only by its code.
    const flight = found?.session === member.session ? found : undefined;
    if (!flight || ('flightId' in body && !flight.open)) {
      fail('badCode', 'No such flight');
      return;
    }
    let pos = 2;
    while (pos <= FLIGHT_RULES.maxMembers && flight.slots.has(pos)) pos += 1;
    if (pos > FLIGHT_RULES.maxMembers) {
      fail('flightFull', `${this.display(flight)} is full`);
      return;
    }
    flight.slots.set(pos, member);
    member.flight = flight;
    this.changed(flight, re);
    this.listed(flight);
    this.#core.log?.info(
      `${this.#core.who(member)} joined ${this.display(flight)} as -${String(pos)}`,
    );
  }

  /**
   * Takes a member out of his flight – a deliberate leave (§7.2, §7.4). -1's
   * position becomes free, and -2 may move up at once. The last one out closes
   * the flight (§7.5). `tell`: the leaver gets the result too.
   */
  remove(member: Member, re: string | null, tell: boolean): void {
    const flight = member.flight;
    if (!flight) return;
    for (const [pos, m] of flight.slots) {
      if (m === member) {
        flight.slots.delete(pos);
        if (pos === 1) flight.leadFreeSince = this.#core.now();
      }
    }
    member.flight = null;
    member.lastFull = null;
    const extra = tell ? [member] : [];
    if (flight.slots.size === 0) {
      this.#flights.delete(flight.id);
      const to = flight.open ? [...this.#core.inSession(flight.session), ...extra] : extra;
      this.#core.publish(
        this.#core.sessions[flight.session],
        {
          type: 'flight.closed',
          from: RELAY_FROM,
          session: flight.session,
          to: { scope: 'session' },
          body: { flightId: flight.id },
          re,
        },
        [...new Set(to)],
        true,
      );
      this.#core.log?.info(`${this.display(flight)} closed`);
      return;
    }
    this.changed(flight, re, null, extra);
    this.listed(flight);
  }

  #move(
    flight: FlightRec,
    member: Member,
    body: { pid: string; pos: number },
    re: string,
    fail: Fail,
  ): void {
    if (this.inCommand(flight) !== member) {
      fail('forbidden', 'Only the member in command moves members');
      return;
    }
    const from = [...flight.slots].find(([, m]) => m.pid === body.pid);
    if (!from) {
      fail('forbidden', 'Not a member of this flight');
      return;
    }
    const [fromPos, mover] = from;
    const occupant = flight.slots.get(body.pos);
    // Never his own position, never to or from -1 (the schema keeps targets at 2–4).
    if (mover === member || occupant === member || fromPos === 1) {
      fail('forbidden', 'Not your own position, and never to or from -1');
      return;
    }
    // A move to his own position changes nothing, but still gets its answer.
    if (fromPos !== body.pos) {
      flight.slots.delete(fromPos);
      if (occupant) flight.slots.set(fromPos, occupant);
      flight.slots.set(body.pos, mover);
    }
    this.changed(flight, re);
  }

  /** -2 (or the member in command) takes over -1 once allowed (§7.4). */
  #moveUp(flight: FlightRec, member: Member, re: string, fail: Fail): void {
    const allowed = this.#moveUpState(flight);
    if (allowed?.pid !== member.pid) {
      fail('forbidden', 'You may not move up to -1');
      return;
    }
    if (this.#core.now() < allowed.allowedFrom) {
      fail('forbidden', 'Not yet – -1 may still come back');
      return;
    }
    const fromPos = [...flight.slots].find(([, m]) => m === member)?.[0];
    if (fromPos === undefined) return;
    const lead = flight.slots.get(1);
    flight.slots.delete(fromPos);
    // A lost -1 swaps with the mover, so he is still in the flight when he returns.
    if (lead) flight.slots.set(fromPos, lead);
    flight.slots.set(1, member);
    flight.leadFreeSince = null;
    this.changed(flight, re);
    this.#core.log?.info(`${this.#core.who(member)} moved up to -1 in ${this.display(flight)}`);
  }

  /** Lowest position whose member is online (§7.1). */
  inCommand(flight: FlightRec): Member | null {
    for (let pos = 1; pos <= FLIGHT_RULES.maxMembers; pos += 1) {
      const m = flight.slots.get(pos);
      if (m?.presence === 'online') return m;
    }
    return null;
  }

  /** Who may take over -1, and from when (§7.4); `null` if nobody may. */
  #moveUpState(flight: FlightRec): Flight['moveUp'] {
    const lead = flight.slots.get(1);
    const candidate = flight.slots.get(2) ?? this.inCommand(flight);
    if (!candidate || candidate === lead) return null;
    if (!lead) {
      return flight.leadFreeSince === null
        ? null
        : { pid: candidate.pid, allowedFrom: flight.leadFreeSince };
    }
    if (lead.presence === 'lost' && lead.lostAt !== null) {
      return {
        pid: candidate.pid,
        allowedFrom: lead.lostAt + FLIGHT_RULES.moveUpAfterLostMin * 60_000,
      };
    }
    return null;
  }

  display(flight: FlightRec): string {
    return `${flight.name} ${String(flight.number)}`;
  }

  /** `Enfield 1-2` in a flight, else the unit name, else the nick. */
  callsign(member: Member): string {
    const flight = member.flight;
    if (flight) {
      for (const [pos, m] of flight.slots) {
        if (m === member) return `${this.display(flight)}-${String(pos)}`;
      }
    }
    return member.aircraft?.unit ?? member.nick;
  }

  /** The flight object as one member sees it: the private code only for the member in command. */
  view(flight: FlightRec, viewer: Member | null): Flight {
    const inCommand = this.inCommand(flight);
    return {
      flightId: flight.id,
      name: flight.name,
      number: flight.number,
      display: this.display(flight),
      open: flight.open,
      members: [...flight.slots]
        .sort(([a], [b]) => a - b)
        .map(([pos, m]) => ({
          pid: m.pid,
          pos,
          presence: m.presence === 'online' ? 'online' : 'lost',
          aircraft: m.aircraft ? { type: m.aircraft.type } : null,
        })),
      inCommand: inCommand?.pid ?? null,
      moveUp: this.#moveUpState(flight),
      privateCode: viewer !== null && viewer === inCommand ? flight.privateCode : null,
    };
  }

  summary(flight: FlightRec): FlightSummary {
    return {
      flightId: flight.id,
      display: this.display(flight),
      memberCount: flight.slots.size,
      types: [
        ...new Set(
          [...flight.slots.values()].flatMap((m) => (m.aircraft ? [m.aircraft.type] : [])),
        ),
      ],
    };
  }

  /** `flight.updated` to every member (each with his own view), plus `extra`, minus `skip`. */
  changed(
    flight: FlightRec,
    re: string | null,
    skip: Member | null = null,
    extra: readonly Member[] = [],
  ): void {
    const to = [...flight.slots.values(), ...extra].filter((m) => m !== skip);
    this.#core.publish(
      this.#core.sessions[flight.session],
      (viewer) => ({
        type: 'flight.updated',
        from: RELAY_FROM,
        session: flight.session,
        to: { scope: 'flight', id: flight.id },
        body: this.view(flight, viewer),
        re,
      }),
      to,
      true,
    );
  }

  /** `flight.listed` to the session, for open flights only. */
  listed(flight: FlightRec): void {
    if (!flight.open || !this.#flights.has(flight.id)) return;
    this.#core.publish(
      this.#core.sessions[flight.session],
      {
        type: 'flight.listed',
        from: RELAY_FROM,
        session: flight.session,
        to: { scope: 'session' },
        body: this.summary(flight),
      },
      this.#core.inSession(flight.session),
      true,
    );
  }
}
