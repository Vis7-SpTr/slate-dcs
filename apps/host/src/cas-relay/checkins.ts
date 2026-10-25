// SPDX-License-Identifier: GPL-3.0-or-later
// Check-in (protocol.md §9.1, §9.2), the situation update (§9.3) and fuel
// calls (§6.5). A check-in belongs to the flight and always lands in an AO; a
// JTAC it was sent to is the primary JTAC. Checked-in flights are part of the
// AO's audience: they see its AO-only entries and holds, and its JTACs get
// their full status packages.

import type { CheckIn, ErrorCode, Message } from '@slate-dcs/shared';

import { RELAY_FROM } from './core.js';
import type { AoRec, CheckInRec, Member, RelayCore } from './core.js';
import type { AoListener, Aos } from './aos.js';
import type { FlightListener, Flights } from './flights.js';
import type { MapEntries } from './map-entries.js';

type Fail = (code: ErrorCode, text: string) => void;
type CheckOutBy = 'flight' | 'jtac' | 'aoClosed' | 'flightClosed';

/** What a check-in brings along for the flight: the AO's AO-only holds (holds.ts). */
export type AoHolds = (ao: AoRec) => Extract<Message, { type: 'cas.hold.updated' }>['body'][];

/** What other parts need to know about check-ins (holds now, missions in P2.3). */
export interface CheckInListener {
  /** The flight is no longer checked in to this AO. */
  checkedOut?(rec: CheckInRec, by: CheckOutBy): void;
}

export class CheckIns {
  readonly #core: RelayCore;
  readonly #aos: Aos;
  readonly #flights: Flights;
  readonly #entries: MapEntries;
  readonly #listeners: CheckInListener[] = [];
  #aoHolds: AoHolds = () => [];
  #nextId = 1;

  constructor(core: RelayCore, parts: { aos: Aos; flights: Flights; entries: MapEntries }) {
    this.#core = core;
    this.#aos = parts.aos;
    this.#flights = parts.flights;
    this.#entries = parts.entries;
    const onAo: AoListener = {
      left: (member, ao) => {
        this.#jtacLeft(member, ao);
      },
      closed: (ao) => {
        for (const rec of this.inAo(ao)) this.#checkOut(rec, 'aoClosed', null);
      },
    };
    const onFlight: FlightListener = {
      // A pilot joining a checked-in flight gets its check-in and AO-only entries.
      joined: (member, flight) => {
        if (flight.checkIn) this.#announce(flight.checkIn, null, [member]);
      },
      // The flight ended: checked out (§7.2).
      closed: (flight) => {
        if (flight.checkIn) this.#checkOut(flight.checkIn, 'flightClosed', null);
      },
    };
    this.#aos.listen(onAo);
    this.#flights.listen(onFlight);
    // Checked-in flights count as "in the AO" (§1.1).
    this.#aos.addAudience((ao) => this.inAo(ao).flatMap((rec) => [...rec.flight.slots.values()]));
  }

  listen(listener: CheckInListener): void {
    this.#listeners.push(listener);
  }

  /** Where the AO's AO-only holds come from (holds.ts, which is made after this part). */
  holdsFrom(aoHolds: AoHolds): void {
    this.#aoHolds = aoHolds;
  }

  /** The check-ins of one AO. */
  inAo(ao: AoRec): CheckInRec[] {
    return this.#flights
      .all()
      .flatMap((flight) => (flight.checkIn?.ao === ao ? [flight.checkIn] : []));
  }

  /** The JTACs who get a member's full status: those of the AO his flight is checked in to (§6.4). */
  jtacsOf(member: Member): Member[] {
    const ao = member.flight?.checkIn?.ao;
    return ao ? ao.jtacs.map((jtac) => jtac.member).filter((m) => m.presence !== 'left') : [];
  }

  view(rec: CheckInRec): CheckIn {
    return {
      checkInId: rec.id,
      flightId: rec.flight.id,
      aoId: rec.ao.id,
      primary: rec.primary?.pid ?? null,
      brief: rec.brief,
      since: rec.since,
    };
  }

  /** For `session.state`: a JTAC's check-ins of his AO; nothing for a pilot. */
  viewsFor(member: Member): CheckIn[] {
    return member.ao ? this.inAo(member.ao).map((rec) => this.view(rec)) : [];
  }

  // -------------------------------------------------------------------------
  // Messages

  /** `cas.checkIn` (§9.2): the member in command only; `to` = one JTAC or one AO. */
  checkIn(member: Member, message: Extract<Message, { type: 'cas.checkIn' }>): void {
    const fail: Fail = (code, text) => {
      this.#core.error(member.conn, code, text, message.id);
    };
    const flight = member.flight;
    if (member.role === 'jtac' || !flight) {
      fail('forbidden', 'Check in as a flight');
      return;
    }
    if (this.#flights.inCommand(flight) !== member) {
      fail('forbidden', 'Only the member in command checks the flight in');
      return;
    }
    const target = this.#target(member, message.to, fail);
    if (!target) return;
    const { ao, primary } = target;
    const old = flight.checkIn;
    if (old && old.ao !== ao) this.#checkOut(old, 'flight', null);
    if (old?.ao === ao) {
      old.brief = message.body.brief;
      old.primary = primary;
      this.#announce(old, message.id);
      return;
    }
    const rec: CheckInRec = {
      id: `ci_${String(this.#nextId++)}`,
      flight,
      ao,
      primary,
      brief: message.body.brief,
      since: this.#core.now(),
    };
    flight.checkIn = rec;
    this.#announce(rec, message.id);
    this.#core.log?.info(`${this.#flights.display(flight)} checked in to ${ao.name}`);
  }

  /** `cas.checkOut`: the member in command takes the flight out of its AO. */
  checkOut(member: Member, message: Extract<Message, { type: 'cas.checkOut' }>): void {
    const flight = member.flight;
    if (!flight?.checkIn || this.#flights.inCommand(flight) !== member) {
      this.#core.error(
        member.conn,
        'forbidden',
        'Not in command of a checked-in flight',
        message.id,
      );
      return;
    }
    this.#checkOut(flight.checkIn, 'flight', message.id);
  }

  /** `cas.release`: "cleared off station" – a JTAC of the flight's AO. */
  release(member: Member, message: Extract<Message, { type: 'cas.release' }>): void {
    const rec = this.#flights.all().find((f) => f.id === message.body.flightId)?.checkIn;
    if (rec?.ao !== member.ao) {
      this.#core.error(
        member.conn,
        'forbidden',
        'That flight is not checked in to your AO',
        message.id,
      );
      return;
    }
    this.#checkOut(rec, 'jtac', message.id);
  }

  /**
   * `cas.sitUpdate` (§9.3): a JTAC of the AO to one checked-in flight (`to:
   * flight`) or to everyone in the AO (`to: ao`). Forwarded unchanged; the
   * AO's other JTACs get it too, so both see what was passed.
   */
  sitUpdate(member: Member, message: Extract<Message, { type: 'cas.sitUpdate' }>): void {
    const fail: Fail = (code, text) => {
      this.#core.error(member.conn, code, text, message.id);
    };
    const ao = member.ao;
    if (ao?.id !== message.body.aoId) {
      fail('forbidden', 'Not on-station in this AO');
      return;
    }
    const jtacs = ao.jtacs.map((jtac) => jtac.member);
    const address = message.to;
    let to: Member[];
    if (address.scope === 'ao' && address.id === ao.id) {
      to = this.#aos.audience(ao);
    } else if (address.scope === 'flight') {
      const flight = this.#flights.all().find((f) => f.id === address.id);
      if (flight?.checkIn?.ao !== ao) {
        fail('badCode', 'That flight is not checked in to your AO');
        return;
      }
      to = [...flight.slots.values(), ...jtacs];
    } else {
      fail('badMessage', 'Send a situation update to a flight or to the AO');
      return;
    }
    this.#forward(member, message, to);
  }

  /** `cas.sitCopy` (pilot, `re` = the update): COPY, to the JTACs of his flight's AO. */
  sitCopy(member: Member, message: Extract<Message, { type: 'cas.sitCopy' }>): void {
    const ao = member.flight?.checkIn?.ao;
    if (!ao || message.re === null) {
      this.#core.error(
        member.conn,
        'forbidden',
        'Not checked in, or no update to copy',
        message.id,
      );
      return;
    }
    this.#forward(
      member,
      message,
      ao.jtacs.map((jtac) => jtac.member),
    );
  }

  /**
   * `fuel.call` (§6.5): never sent automatically. To his flight and the JTACs
   * of the AO it is checked in to; forwarded unchanged.
   */
  fuelCall(member: Member, message: Extract<Message, { type: 'fuel.call' }>): void {
    const flight = member.flight;
    const mates = flight ? [...flight.slots.values()] : [];
    const to = [...mates, ...this.jtacsOf(member)];
    if (to.filter((m) => m !== member).length === 0) {
      this.#core.error(member.conn, 'forbidden', 'Nobody to tell – not in a flight', message.id);
      return;
    }
    this.#forward(member, message, to);
  }

  // -------------------------------------------------------------------------
  // Events

  /** A JTAC went off-station: flights he was primary for stay checked in to the AO. */
  #jtacLeft(member: Member, ao: AoRec): void {
    for (const rec of this.inAo(ao)) {
      if (rec.primary === member) {
        rec.primary = null;
        this.#announce(rec, null);
      }
    }
  }

  // -------------------------------------------------------------------------

  /** Where `to` points: a JTAC on-station (his AO, him as primary) or an AO of the session. */
  #target(
    member: Member,
    to: Message['to'],
    fail: Fail,
  ): { ao: AoRec; primary: Member | null } | null {
    if (to.scope === 'pid') {
      const jtac = this.#core.members.get(to.id);
      if (jtac?.session !== member.session || !jtac.ao) {
        fail('badCode', 'That JTAC is not on-station');
        return null;
      }
      return { ao: jtac.ao, primary: jtac };
    }
    if (to.scope === 'ao') {
      const ao = this.#aos.get(to.id);
      if (ao?.session !== member.session) {
        fail('badCode', 'No such AO');
        return null;
      }
      return { ao, primary: null };
    }
    fail('badMessage', 'Check in to a JTAC or an AO');
    return null;
  }

  /**
   * `cas.checkedIn` to the AO's JTACs and the flight – or only to `only`.
   * The flight gets the AO's AO-only entries and holds with it (§8.4).
   */
  #announce(rec: CheckInRec, re: string | null, only?: readonly Member[]): void {
    const core = this.#core;
    const crew = [...rec.flight.slots.values()];
    const jtacs = rec.ao.jtacs.map((jtac) => jtac.member);
    const to = only ?? [...new Set([...jtacs, ...crew])];
    const extras = { entries: this.#entries.aoOnly(rec.ao), holds: this.#aoHolds(rec.ao) };
    core.publish(
      core.sessions[rec.ao.session],
      (viewer) => ({
        type: 'cas.checkedIn',
        from: RELAY_FROM,
        session: rec.ao.session,
        to: { scope: 'ao', id: rec.ao.id },
        body: {
          ...this.view(rec),
          aoEntries: crew.includes(viewer) ? extras : { entries: [], holds: [] },
        },
        re,
      }),
      to.filter((m) => m.presence !== 'left'),
      true,
    );
  }

  #checkOut(rec: CheckInRec, by: CheckOutBy, re: string | null): void {
    const core = this.#core;
    const crew = [...rec.flight.slots.values()];
    const jtacs = rec.ao.jtacs.map((jtac) => jtac.member);
    if (rec.flight.checkIn === rec) rec.flight.checkIn = null;
    for (const listener of this.#listeners) listener.checkedOut?.(rec, by);
    core.publish(
      core.sessions[rec.ao.session],
      {
        type: 'cas.checkedOut',
        from: RELAY_FROM,
        session: rec.ao.session,
        to: { scope: 'ao', id: rec.ao.id },
        body: { checkInId: rec.id, flightId: rec.flight.id, aoId: rec.ao.id, by },
        re,
      },
      [...new Set([...jtacs, ...crew])].filter((m) => m.presence !== 'left'),
      true,
    );
    core.log?.info(`${this.#flights.display(rec.flight)} checked out of ${rec.ao.name} (${by})`);
  }

  /** Forwards a host message unchanged, kept for the replay; the sender doesn't get it back. */
  #forward(member: Member, message: Message, to: readonly Member[]): void {
    const core = this.#core;
    const recipients = [...new Set(to)].filter((m) => m !== member && m.presence !== 'left');
    core.forward(
      core.sessions[member.session],
      { ...message, from: member.pid, session: member.session },
      recipients,
      true,
    );
  }
}
