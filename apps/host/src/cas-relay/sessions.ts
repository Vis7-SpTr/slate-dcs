// SPDX-License-Identifier: GPL-3.0-or-later
// Coalition sessions (protocol.md §3–§5): handshake, join with token check,
// coalition switch, slot updates, leaving, presence and expiry, and the
// snapshot plus catch-up a joining host gets (§4.5).

import { negotiateProtocol, PROTOCOL_VERSION, SESSION_TIMING } from '@slate-dcs/shared';
import type { Message } from '@slate-dcs/shared';

import { newPid, newToken, readCode } from './codes.js';
import { RELAY_FROM } from './core.js';
import type { Conn, Member, RelayCore } from './core.js';
import type { Aos } from './aos.js';
import type { CheckIns } from './checkins.js';
import type { Flights } from './flights.js';
import type { Holds } from './holds.js';
import type { MapEntries } from './map-entries.js';

export class Sessions {
  readonly #core: RelayCore;
  readonly #flights: Flights;
  readonly #aos: Aos;
  readonly #entries: MapEntries;
  readonly #checkIns: CheckIns;
  readonly #holds: Holds;

  constructor(
    core: RelayCore,
    parts: { flights: Flights; aos: Aos; entries: MapEntries; checkIns: CheckIns; holds: Holds },
  ) {
    this.#core = core;
    this.#flights = parts.flights;
    this.#aos = parts.aos;
    this.#entries = parts.entries;
    this.#checkIns = parts.checkIns;
    this.#holds = parts.holds;
  }

  hello(conn: Conn, message: Extract<Message, { type: 'hello' }>): void {
    const core = this.#core;
    const protocol = negotiateProtocol(message.body.protocols, [PROTOCOL_VERSION]);
    if (protocol === null) {
      core.direct(conn, {
        type: 'reject',
        from: RELAY_FROM,
        session: '',
        to: { scope: 'relay' },
        body: { reason: 'versionMismatch', supported: [PROTOCOL_VERSION] },
        re: message.id,
      });
      core.log?.info(
        `Rejected ${message.body.app}: protocols ${message.body.protocols.join(', ')}`,
      );
      conn.state = 'closed';
      conn.link.close();
      return;
    }
    conn.state = 'ready';
    core.direct(conn, {
      type: 'welcome',
      from: RELAY_FROM,
      session: '',
      to: { scope: 'relay' },
      body: {
        protocol,
        relay: core.name,
        features: [],
        time: core.now(),
        heartbeatSec: SESSION_TIMING.heartbeatSec,
      },
      re: message.id,
    });
  }

  join(conn: Conn, message: Extract<Message, { type: 'session.join' }>): void {
    const core = this.#core;
    const flights = this.#flights;
    const body = message.body;
    if (conn.member) {
      core.error(conn, 'badMessage', 'Already joined – leave first', message.id);
      return;
    }
    const code = readCode(core.codes, body.code);
    if (code === null) {
      core.error(conn, 'badCode', 'Unknown session code', message.id);
      return;
    }
    const coalition = code.kind === 'coalition' ? code.coalition : body.coalition;
    if (coalition === null) {
      core.error(conn, 'badCoalition', 'Pick a coalition to join with the group code', message.id);
      return;
    }

    const now = core.now();
    const known = body.token === null ? undefined : core.byToken.get(body.token);
    let member: Member;
    if (known) {
      member = known;
      if (member.conn && member.conn !== conn) core.closeWith(member.conn, 'replaced');
      core.byToken.delete(member.token);
      member.token = newToken();
    } else {
      member = {
        pid: newPid((pid) => core.members.has(pid)),
        token: newToken(),
        session: coalition,
        nick: body.nick,
        role: body.role,
        aircraft: body.aircraft,
        source: body.source,
        presence: 'left',
        lastSeen: now,
        conn: null,
        lostAt: null,
        flight: null,
        ao: null,
        lastPos: null,
        lastPosition: null,
        lastFull: null,
      };
      core.members.set(member.pid, member);
    }
    core.byToken.set(member.token, member);
    const resumed = known !== undefined;
    const moved = resumed && member.session !== coalition;
    if (moved) this.setPresence(member, 'left');

    const typeChanged = member.aircraft?.type !== body.aircraft?.type;
    const roleBefore = member.role;
    member.session = coalition;
    member.nick = body.nick;
    member.role = body.role;
    member.aircraft = body.aircraft;
    member.source = body.source;
    member.lastSeen = now;
    member.conn = conn;
    conn.member = member;
    if (moved) {
      member.lastPos = null;
      member.lastPosition = null;
      member.lastFull = null;
    }
    // A JTAC is never in a flight (§5): joining in a JTAC slot leaves it.
    if (member.flight && member.role === 'jtac') flights.remove(member, null, false);

    core.direct(conn, {
      type: 'session.joined',
      from: RELAY_FROM,
      session: coalition,
      to: { scope: 'pid', id: member.pid },
      body: { pid: member.pid, token: member.token, resumed, session: coalition, coalition },
      re: message.id,
    });
    this.#sendState(member, resumed && !moved ? body.lastSeq : null);
    const flight = member.flight;
    if (!this.setPresence(member, 'online', member) && flight && typeChanged) {
      flights.changed(flight, null, member);
    }
    if (flight && typeChanged) flights.listed(flight);
    // Back in an aircraft slot: off-station (§8.2); the join codes he sees change.
    this.#aos.roleChanged(member, roleBefore, null);
    core.log?.info(
      `${core.who(member)} ${resumed ? 'resumed' : 'joined'} (${body.source}${code.kind === 'group' ? ', group code' : ''})`,
    );
  }

  switch(member: Member, message: Extract<Message, { type: 'session.switch' }>): void {
    const core = this.#core;
    const code = readCode(core.codes, message.body.code);
    if (code === null) {
      core.error(member.conn, 'badCode', 'Unknown session code', message.id);
      return;
    }
    if (code.kind === 'group') {
      core.error(member.conn, 'badCoalition', 'Switch with a coalition code', message.id);
      return;
    }
    const same = code.coalition === member.session;
    if (!same) {
      this.setPresence(member, 'left');
      member.session = code.coalition;
      member.lastPos = null;
      member.lastPosition = null;
      member.lastFull = null;
    }
    // Answered also when nothing changes, so the host's request doesn't time out.
    core.direct(member.conn, {
      type: 'session.joined',
      from: RELAY_FROM,
      session: member.session,
      to: { scope: 'pid', id: member.pid },
      body: {
        pid: member.pid,
        token: member.token,
        resumed: true,
        session: member.session,
        coalition: member.session,
      },
      re: message.id,
    });
    if (same) return;
    this.#sendState(member, null);
    this.setPresence(member, 'online');
    core.log?.info(`${core.who(member)} switched to ${member.session}`);
  }

  /** New nick, role or aircraft while joined (§5): tells the session, and his flight. */
  update(member: Member, message: Extract<Message, { type: 'session.update' }>): void {
    const core = this.#core;
    const flights = this.#flights;
    const body = message.body;
    const typeChanged = member.aircraft?.type !== body.aircraft?.type;
    const roleBefore = member.role;
    member.nick = body.nick;
    member.role = body.role;
    member.aircraft = body.aircraft;
    core.publish(
      core.sessions[member.session],
      {
        type: 'session.updated',
        from: RELAY_FROM,
        session: member.session,
        to: { scope: 'session' },
        body: {
          pid: member.pid,
          nick: member.nick,
          role: member.role,
          aircraft: member.aircraft ? { type: member.aircraft.type } : null,
        },
        re: message.id,
      },
      core.inSession(member.session).filter((m) => m !== member),
      true,
    );
    // An aircraft slot takes a JTAC off-station (§8.2).
    this.#aos.roleChanged(member, roleBefore, message.id);
    const flight = member.flight;
    if (!flight) return;
    // Joining a JTAC slot leaves the flight (decided 21 Oct 2026).
    if (member.role === 'jtac') {
      flights.remove(member, message.id, true);
      core.log?.info(`${core.who(member)} took a JTAC slot and left ${flights.display(flight)}`);
    } else if (typeChanged) {
      flights.changed(flight, message.id);
      flights.listed(flight);
    }
  }

  leave(conn: Conn, member: Member): void {
    this.setPresence(member, 'left');
    member.conn = null;
    member.lastPosition = null;
    member.lastFull = null;
    conn.member = null;
    this.#core.log?.info(`${this.#core.who(member)} left`);
  }

  /** The connection is gone: its member is lost (§5). */
  closed(conn: Conn): void {
    conn.state = 'closed';
    this.#core.conns.delete(conn);
    const member = conn.member;
    conn.member = null;
    if (member?.conn === conn) {
      member.conn = null;
      if (member.presence === 'online') {
        this.#core.log?.info(`${this.#core.who(member)} lost (connection closed)`);
        this.setPresence(member, 'lost');
      }
    }
  }

  /** Lost detection and token expiry; the transport calls it about once a second. */
  tick(): void {
    const core = this.#core;
    const now = core.now();
    for (const member of [...core.members.values()]) {
      const quiet = now - member.lastSeen;
      if (member.presence === 'online' && quiet > SESSION_TIMING.lostAfterSec * 1000) {
        core.log?.info(
          `${core.who(member)} lost (no pong for ${String(Math.round(quiet / 1000))} s)`,
        );
        this.setPresence(member, 'lost');
      }
      if (member.presence !== 'online' && quiet > SESSION_TIMING.tokenExpiryHours * 3_600_000) {
        core.log?.info(`${core.who(member)} expired`);
        core.members.delete(member.pid);
        core.byToken.delete(member.token);
        if (member.presence === 'lost') this.setPresence(member, 'left');
      }
    }
  }

  /**
   * Changes presence and tells the rest of the session (§5) and his flight.
   * `left` takes him out of his flight (a deliberate leave). `skipFlight`
   * doesn't get the `flight.updated` (he just got the state). Returns `false`
   * if nothing changed.
   */
  setPresence(
    member: Member,
    presence: Member['presence'],
    skipFlight: Member | null = null,
  ): boolean {
    const core = this.#core;
    if (member.presence === presence) return false;
    member.presence = presence;
    member.lostAt = presence === 'lost' ? core.now() : null;
    const others = [...core.members.values()].filter(
      (m) => m !== member && m.session === member.session && m.presence !== 'left',
    );
    core.publish(
      core.sessions[member.session],
      {
        type: 'session.presence',
        from: RELAY_FROM,
        session: member.session,
        to: { scope: 'session' },
        body: { pid: member.pid, presence, nick: member.nick, role: member.role },
      },
      others,
      true,
    );
    const flight = member.flight;
    if (flight) {
      if (presence === 'left') this.#flights.remove(member, null, false);
      else this.#flights.changed(flight, null, skipFlight);
    }
    // Left = off-station; lost or back changes the AO's command (§8.2, §8.3).
    this.#aos.presenceChanged(member, presence, skipFlight);
    return true;
  }

  /** `session.state`, the replay since `lastSeq` if possible, then the current picture (§4.5). */
  #sendState(member: Member, lastSeq: number | null): void {
    const core = this.#core;
    const flights = this.#flights;
    const session = core.sessions[member.session];
    const members = core.inSession(member.session).filter((m) => m !== member);
    // He is online from now on; the state already shows it.
    const presence = member.presence;
    member.presence = 'online';
    const own = member.flight ? flights.view(member.flight, member) : null;
    const aos = this.#aos.views(member);
    const mapEntries = this.#entries.visibleTo(member);
    const holds = this.#holds.visibleTo(member);
    const checkIns = this.#checkIns.viewsFor(member);
    const checkIn = member.flight?.checkIn ? this.#checkIns.view(member.flight.checkIn) : null;
    member.presence = presence;
    const open = flights
      .all()
      .filter((f) => f.session === member.session && f.open && f !== member.flight)
      .map((f) => flights.summary(f));
    core.direct(member.conn, {
      type: 'session.state',
      from: RELAY_FROM,
      session: session.id,
      to: { scope: 'pid', id: member.pid },
      body: {
        asOfSeq: session.seq,
        participants: [
          core.participant({ ...member, presence: 'online' }),
          ...members.map((m) => core.participant(m)),
        ],
        flights: own ? [...open, own] : open,
        aos,
        mapEntries,
        holds,
        checkIns,
        you: { flight: own, checkIn, openMissions: [] },
      },
    });
    // Catch-up, sorted by seq: what he missed (if the relay still has all of
    // it) and the last status of every aircraft – in full from his own flight,
    // as a position from everyone else. All of it is ≤ asOfSeq.
    const catchUp: { seq: number; text: string }[] = [];
    const first = session.log[0];
    if (
      lastSeq !== null &&
      lastSeq < session.seq &&
      (first === undefined || first.seq <= lastSeq + 1)
    ) {
      catchUp.push(...session.log.filter((e) => e.seq > lastSeq && e.to.has(member.pid)));
    }
    for (const other of members) {
      // In full from his flight mates – and, for a JTAC, from the aircraft checked in to his AO.
      const full =
        (member.flight !== null && other.flight === member.flight) ||
        (member.ao !== null && other.flight?.checkIn?.ao === member.ao);
      const status = full ? (other.lastFull ?? other.lastPosition) : other.lastPosition;
      if (status) catchUp.push(status);
    }
    catchUp.sort((a, b) => a.seq - b.seq);
    for (const entry of catchUp) member.conn?.link.send(entry.text);
  }
}
