// SPDX-License-Identifier: GPL-3.0-or-later
// Check-in (protocol.md §9.1, §9.2), the situation update (§9.3) and fuel
// calls (§6.5). A check-in belongs to the flight and always lands in an AO; a
// JTAC it was sent to is the primary JTAC. Checked-in flights are part of the
// AO's audience: they see its AO-only entries and holds, and its JTACs get
// their full status packages.

import { fuelUnit, unitDisplayName } from '@slate-dcs/shared';
import type { CheckIn, CheckInBrief, ErrorCode, LaserCodes, Message } from '@slate-dcs/shared';

import { RELAY_FROM } from './core.js';
import type { AoRec, CheckInRec, Member, RelayCore } from './core.js';
import type { AoListener, Aos } from './aos.js';
import { aoText } from './cas-log.js';
import type { CasLog } from './cas-log.js';
import type { FlightListener, Flights } from './flights.js';
import type { MapEntries } from './map-entries.js';

type Fail = (code: ErrorCode, text: string) => void;
type CheckOutBy = 'flight' | 'jtac' | 'aoClosed' | 'flightClosed';

/** How a check-out is logged (§12.2): the message behind it and the words. */
const CHECK_OUT_LOG: Record<CheckOutBy, { kind: string; text: string }> = {
  flight: { kind: 'cas.checkOut', text: 'checked out' },
  jtac: { kind: 'cas.release', text: 'released – cleared off station' },
  aoClosed: { kind: 'cas.checkedOut', text: 'checked out – the AO closed' },
  flightClosed: { kind: 'cas.checkedOut', text: 'checked out – the flight ended' },
};

const LB_PER_KG = 2.204_62;

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
  readonly #log: CasLog;
  readonly #listeners: CheckInListener[] = [];
  #aoHolds: AoHolds = () => [];
  #nextId = 1;

  constructor(
    core: RelayCore,
    parts: { aos: Aos; flights: Flights; entries: MapEntries; log: CasLog },
  ) {
    this.#core = core;
    this.#aos = parts.aos;
    this.#flights = parts.flights;
    this.#entries = parts.entries;
    this.#log = parts.log;
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
      const codesBefore = old.brief.laserCodes;
      old.brief = message.body.brief;
      old.primary = primary;
      this.#announce(old, message.id);
      this.#logCheckIn(old, 'check-in updated');
      if (codesText(codesBefore) !== codesText(old.brief.laserCodes)) {
        this.#log.add(ao.session, {
          area: 'situation',
          kind: 'cas.checkIn',
          summary: `laser codes of ${old.brief.callsign}: ${codesText(codesBefore)} → ${codesText(old.brief.laserCodes)}`,
          aoId: ao.id,
          flightId: flight.id,
        });
      }
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
    this.#logCheckIn(rec, `checked in to ${aoText(ao.name)}`);
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
    const flightId = address.scope === 'flight' ? address.id : null;
    const target =
      flightId === null ? `everyone in ${aoText(ao.name)}` : this.#log.flightName(flightId);
    this.#log.add(ao.session, {
      area: 'situation',
      kind: 'cas.sitUpdate',
      summary: `situation update to ${target}${sitText(message.body.update)}`,
      aoId: ao.id,
      flightId,
    });
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
    this.#log.add(ao.session, {
      area: 'situation',
      kind: 'cas.sitCopy',
      summary: 'COPY situation update',
      aoId: ao.id,
      flightId: member.flight?.id ?? null,
      pid: member.pid,
    });
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
    // Logged for checked-in aircraft (§6.5, §12.2), in the cockpit's unit.
    const checkIn = flight?.checkIn;
    if (checkIn) {
      const { call, internalKg } = message.body;
      const lbs = fuelUnit(member.aircraft?.type) === 'lbs';
      const amount = lbs
        ? `${String(Math.round(internalKg * LB_PER_KG))} lbs`
        : `${String(Math.round(internalKg))} kg`;
      this.#log.add(checkIn.ao.session, {
        area: 'fuel',
        kind: 'fuel.call',
        summary: `${call.toUpperCase()} – ${amount} internal`,
        aoId: checkIn.ao.id,
        flightId: checkIn.flight.id,
        pid: member.pid,
      });
    }
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
    this.#log.add(rec.ao.session, {
      area: 'checkIn',
      kind: CHECK_OUT_LOG[by].kind,
      summary: `${rec.brief.callsign} ${CHECK_OUT_LOG[by].text} (${aoText(rec.ao.name)})`,
      aoId: rec.ao.id,
      flightId: rec.flight.id,
    });
    core.log?.info(`${this.#flights.display(rec.flight)} checked out of ${rec.ao.name} (${by})`);
  }

  /** The check-in brief as one log line (§9.1). */
  #logCheckIn(rec: CheckInRec, what: string): void {
    const primary = rec.primary ? `, primary ${this.#log.name(rec.primary)}` : '';
    this.#log.add(rec.ao.session, {
      area: 'checkIn',
      kind: 'cas.checkIn',
      summary: `${rec.brief.callsign} ${what}${primary} – ${briefText(rec.brief)}`,
      aoId: rec.ao.id,
      flightId: rec.flight.id,
    });
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

/** `2× F-16C · 4× GBU-12, 2× AIM-9X · 40 min · codes 1688 · abort LOBSTER`. */
function briefText(brief: CheckInBrief): string {
  const types = new Map<string, number>();
  for (const aircraft of brief.aircraft) {
    const name = unitDisplayName(aircraft.type);
    types.set(name, (types.get(name) ?? 0) + 1);
  }
  const parts = [[...types].map(([name, n]) => `${String(n)}× ${name}`).join(', ')];
  const ordnance = brief.ordnance.filter((o) => o.count > 0);
  if (ordnance.length > 0)
    parts.push(ordnance.map((o) => `${String(o.count)}× ${o.name}`).join(', '));
  if (brief.playtimeMin !== null) parts.push(`${String(brief.playtimeMin)} min`);
  parts.push(`codes ${codesText(brief.laserCodes)}`);
  if (brief.abortCode) parts.push(`abort ${brief.abortCode}`);
  if (brief.missionNumber) parts.push(`mission ${brief.missionNumber}`);
  return parts.join(' · ');
}

/** `1688`, `1688 (1-2: 1511)`, `none`. */
function codesText(codes: LaserCodes): string {
  const own = Object.values(codes.perAircraft);
  const flight = codes.flight === null ? null : String(codes.flight);
  if (own.length === 0) return flight ?? 'none';
  const list = own.map(String).join('/');
  return flight === null ? list : `${flight} (aircraft ${list})`;
}

/** ` – threats: SA-8 at …; targets: …` from the filled fields of a situation update. */
function sitText(update: Extract<Message, { type: 'cas.sitUpdate' }>['body']['update']): string {
  const fields: [string, string][] = [
    ['threats', update.threats.text],
    ['targets', update.targets.text],
    ['friendlies', update.friendlies.text],
    ['fires', update.fires],
    ['clearance authority', update.clearanceAuthority],
    ['restrictions', update.restrictions],
    ['hazards', update.hazards],
  ];
  const filled = fields.filter(([, text]) => text.trim() !== '');
  return filled.length === 0
    ? ''
    : ` – ${filled.map(([name, text]) => `${name}: ${text.trim()}`).join('; ')}`;
}
