// SPDX-License-Identifier: GPL-3.0-or-later
// Holds and the holding stack (protocol.md §9.4). A JTAC of the AO assigns a
// hold to a checked-in flight – also after the fact. Overlaps (area and
// altitude block) are flagged on both holds, never blocked. Visibility works
// like map entries: `ao` = the AO's JTACs and checked-in aircraft.

import { holdsConflict } from '@slate-dcs/shared';
import type { ErrorCode, Hold, Message, PointRef } from '@slate-dcs/shared';

import { RELAY_FROM } from './core.js';
import type { AoRec, HoldRec, Member, RelayCore } from './core.js';
import type { Aos } from './aos.js';
import type { CheckIns } from './checkins.js';
import type { Flights } from './flights.js';
import type { MapEntries } from './map-entries.js';

type Fail = (code: ErrorCode, text: string) => void;
type Draft = Extract<Message, { type: 'cas.hold.assign' }>['body'];

export class Holds {
  readonly #core: RelayCore;
  readonly #aos: Aos;
  readonly #flights: Flights;
  readonly #entries: MapEntries;
  readonly #holds = new Map<string, HoldRec>();
  #nextId = 1;

  constructor(
    core: RelayCore,
    parts: { aos: Aos; flights: Flights; checkIns: CheckIns; entries: MapEntries },
  ) {
    this.#core = core;
    this.#aos = parts.aos;
    this.#flights = parts.flights;
    this.#entries = parts.entries;
    parts.aos.listen({
      // A JTAC joining gets the AO's AO-only holds; leaving, they disappear for him.
      joined: (member, ao) => {
        for (const rec of this.#inAo(ao, 'ao')) this.#updated(rec, [member], null);
      },
      left: (member, ao, stays) => {
        if (!stays) return;
        for (const rec of this.#inAo(ao, 'ao')) {
          if (!this.viewers(rec).includes(member)) this.#cancelled(rec, [member], true, null);
        }
      },
      // Hosts drop the AO's holds with `ao.closed`.
      closed: (ao) => {
        for (const rec of this.#inAo(ao)) this.#holds.delete(rec.hold.holdId);
      },
    });
    // A flight leaving the AO takes its holds with it.
    parts.checkIns.listen({
      checkedOut: (checkIn) => {
        for (const rec of this.#inAo(checkIn.ao)) {
          if (rec.hold.flightId !== checkIn.flight.id) continue;
          const to = [...this.viewers(rec), ...checkIn.flight.slots.values()];
          this.#holds.delete(rec.hold.holdId);
          this.#cancelled(rec, to, false, null);
          this.#restack(checkIn.ao, null);
        }
      },
    });
    parts.checkIns.holdsFrom((ao) => this.#inAo(ao, 'ao').map((rec) => rec.hold));
    parts.entries.addInUseCheck((cmId) =>
      [...this.#holds.values()].some(
        (rec) => 'cmId' in rec.hold.point && rec.hold.point.cmId === cmId,
      ),
    );
  }

  /** Who may see a hold: the AO's audience, or the coalition (§9.4). */
  viewers(rec: HoldRec): Member[] {
    return rec.hold.visibility === 'coalition'
      ? this.#core.inSession(rec.session)
      : this.#aos.audience(rec.ao);
  }

  /** Every hold he may see, for `session.state`. */
  visibleTo(member: Member): Hold[] {
    return [...this.#holds.values()]
      .filter((rec) => rec.session === member.session && this.viewers(rec).includes(member))
      .map((rec) => rec.hold);
  }

  // -------------------------------------------------------------------------
  // Messages

  assign(member: Member, message: Extract<Message, { type: 'cas.hold.assign' }>): void {
    const fail: Fail = (code, text) => {
      this.#core.error(member.conn, code, text, message.id);
    };
    const ao = this.#jtacAo(member, fail);
    if (!ao || !this.#draftOk(member, ao, message.body, fail)) return;
    const rec: HoldRec = {
      hold: {
        ...message.body,
        holdId: `h_${String(this.#nextId++)}`,
        aoId: ao.id,
        conflicts: [],
      },
      session: ao.session,
      ao,
    };
    this.#holds.set(rec.hold.holdId, rec);
    this.#restack(ao, rec);
    this.#updated(rec, withMember(this.viewers(rec), member), message.id);
  }

  /** The hold's new content in full; any JTAC of its AO. */
  update(member: Member, message: Extract<Message, { type: 'cas.hold.update' }>): void {
    const fail: Fail = (code, text) => {
      this.#core.error(member.conn, code, text, message.id);
    };
    const rec = this.#own(member, message.body.holdId, fail);
    if (!rec || !this.#draftOk(member, rec.ao, message.body.hold, fail)) return;
    const before = this.viewers(rec);
    rec.hold = { ...message.body.hold, holdId: rec.hold.holdId, aoId: rec.ao.id, conflicts: [] };
    this.#restack(rec.ao, rec);
    const after = this.viewers(rec);
    this.#cancelled(
      rec,
      before.filter((m) => !after.includes(m) && m !== member),
      true,
      null,
    );
    this.#updated(rec, withMember(after, member), message.id);
  }

  cancel(member: Member, message: Extract<Message, { type: 'cas.hold.cancel' }>): void {
    const fail: Fail = (code, text) => {
      this.#core.error(member.conn, code, text, message.id);
    };
    const rec = this.#own(member, message.body.holdId, fail);
    if (!rec) return;
    const to = withMember(this.viewers(rec), member);
    this.#holds.delete(rec.hold.holdId);
    this.#cancelled(rec, to, false, message.id);
    this.#restack(rec.ao, null);
  }

  /** WILCO from the hold's flight – to the AO's JTACs, unchanged. */
  wilco(member: Member, message: Extract<Message, { type: 'cas.hold.wilco' }>): void {
    const rec = this.#holds.get(message.body.holdId);
    if (!rec || member.flight?.id !== rec.hold.flightId) {
      this.#core.error(member.conn, 'forbidden', 'Not your flight’s hold', message.id);
      return;
    }
    const core = this.#core;
    const jtacs = rec.ao.jtacs.map((jtac) => jtac.member).filter((m) => m.presence !== 'left');
    core.forward(
      core.sessions[rec.session],
      { ...message, from: member.pid, session: member.session },
      jtacs,
      true,
    );
  }

  // -------------------------------------------------------------------------

  /** A JTAC on-station: his AO. */
  #jtacAo(member: Member, fail: Fail): AoRec | null {
    if (member.role !== 'jtac' || !member.ao) {
      fail('forbidden', 'Only a JTAC on-station assigns holds');
      return null;
    }
    return member.ao;
  }

  /** The hold, if it is in his AO. */
  #own(member: Member, holdId: string, fail: Fail): HoldRec | null {
    const rec = this.#holds.get(holdId);
    if (rec?.session !== member.session) {
      fail('badCode', 'No such hold');
      return null;
    }
    if (member.role !== 'jtac' || member.ao !== rec.ao) {
      fail('forbidden', 'Only a JTAC of its AO');
      return null;
    }
    return rec;
  }

  /** The flight is checked in to this AO, and the point refers to an IP/CP or keyhole (§8.5). */
  #draftOk(member: Member, ao: AoRec, draft: Draft, fail: Fail): boolean {
    const flight = this.#flights.all().find((f) => f.id === draft.flightId);
    if (flight?.checkIn?.ao !== ao) {
      fail('badCode', 'That flight is not checked in to your AO');
      return false;
    }
    if (!this.#pointOk(member, draft.point)) {
      fail('badCode', 'The hold point refers to no IP, CP or keyhole');
      return false;
    }
    return true;
  }

  #pointOk(member: Member, point: PointRef): boolean {
    if ('lat' in point) return true;
    const rec = this.#entries.get(point.cmId);
    if (rec?.session !== member.session) return false;
    const keyholeRef = 'axis' in point && point.axis !== undefined;
    return keyholeRef
      ? rec.entry.kind === 'keyhole'
      : ['ip', 'cp', 'keyhole'].includes(rec.entry.kind);
  }

  #inAo(ao: AoRec, visibility?: 'ao'): HoldRec[] {
    return [...this.#holds.values()].filter(
      (rec) => rec.ao === ao && (visibility === undefined || rec.hold.visibility === visibility),
    );
  }

  /**
   * Works out every hold's conflicts in the AO again (§9.4); holds other than
   * `changed` whose list changed are sent out.
   */
  #restack(ao: AoRec, changed: HoldRec | null): void {
    const lookup = (cmId: string) => {
      const entry = this.#entries.get(cmId)?.entry;
      return entry?.shape === 'point' ? entry.geom : null;
    };
    const holds = this.#inAo(ao);
    for (const rec of holds) {
      const conflicts = holds
        .filter((other) => other !== rec && holdsConflict(rec.hold, other.hold, lookup))
        .map((other) => other.hold.holdId);
      const same =
        conflicts.length === rec.hold.conflicts.length &&
        conflicts.every((id) => rec.hold.conflicts.includes(id));
      rec.hold = { ...rec.hold, conflicts };
      if (!same && rec !== changed) this.#updated(rec, this.viewers(rec), null);
    }
  }

  #updated(rec: HoldRec, to: readonly Member[], re: string | null): void {
    if (to.length === 0) return;
    const core = this.#core;
    core.publish(
      core.sessions[rec.session],
      {
        type: 'cas.hold.updated',
        from: RELAY_FROM,
        session: rec.session,
        to: { scope: 'ao', id: rec.ao.id },
        body: rec.hold,
        re,
      },
      [...new Set(to)],
      true,
    );
  }

  #cancelled(rec: HoldRec, to: readonly Member[], hidden: boolean, re: string | null): void {
    if (to.length === 0) return;
    const core = this.#core;
    core.publish(
      core.sessions[rec.session],
      {
        type: 'cas.hold.cancelled',
        from: RELAY_FROM,
        session: rec.session,
        to: { scope: 'ao', id: rec.ao.id },
        body: { holdId: rec.hold.holdId, hidden },
        re,
      },
      [...new Set(to)].filter((m) => m.presence !== 'left'),
      true,
    );
  }
}

/** The list plus `member`, once. */
function withMember(list: readonly Member[], member: Member): Member[] {
  return list.includes(member) ? [...list] : [...list, member];
}
