// SPDX-License-Identifier: GPL-3.0-or-later
// The relay's core (protocol.md §1–§7): handshake, coalition sessions, tokens,
// presence, status routing and flights. It knows nothing about sockets – a transport
// (WSS server, or in-memory links in tests) hands it text frames and pongs.
// The same core runs standalone (`slate-relay`) and inside a host (host mode).
//
// State lives in memory only (decided 21 Oct 2026): after a restart everyone
// joins as a new participant.

import {
  FLIGHT_RULES,
  flightNameKey,
  negotiateProtocol,
  parseMessageText,
  PROTOCOL_VERSION,
  SESSION_TIMING,
  ulid,
} from '@slate-dcs/shared';
import type {
  AircraftInfo,
  Coalition,
  ErrorCode,
  Flight,
  FlightSummary,
  Message,
  Participant,
  SessionJoin,
  StatusUpdate,
} from '@slate-dcs/shared';

import { newFlightId, newPid, newPrivateCode, newToken, readCode } from './codes.js';
import type { RelayCodes } from './codes.js';

/** `from` of messages the relay makes itself. */
export const RELAY_FROM = 'relay';

/** One connection as the transport sees it. */
export interface RelayLink {
  send(text: string): void;
  /** Closes the connection; the transport then calls `closed()`. */
  close(): void;
}

/** What the transport calls for one connection. */
export interface RelayConnection {
  /** One text frame from the host. */
  receive(text: string): void;
  /** A pong (or anything else that proves the connection is alive). */
  alive(): void;
  /** The connection is gone. */
  closed(): void;
}

export interface RelayLog {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

export interface RelayOptions {
  codes: RelayCodes;
  /** Relay name and version for `welcome`, e.g. `slate-relay 0.1.0`. */
  name: string;
  log?: RelayLog;
  now?: () => number;
  /** Messages kept per session for resync (§4.5). */
  replayLimit?: number;
}

/** Rate limit per connection: burst and messages per second. */
const RATE = { burst: 40, perSec: 10 } as const;

interface Conn {
  link: RelayLink;
  state: 'new' | 'ready' | 'closed';
  member: Member | null;
  tokens: number;
  refilledAt: number;
  limitedAt: number;
}

/** A participant as the relay keeps him (§4.3): stays after a disconnect until expiry. */
interface Member {
  pid: string;
  token: string;
  session: Coalition;
  nick: string;
  role: string;
  aircraft: AircraftInfo | null;
  source: SessionJoin['body']['source'];
  presence: 'online' | 'lost' | 'left';
  lastSeen: number;
  conn: Conn | null;
  /** When he was last marked lost (for -1's move-up wait, §7.4). */
  lostAt: number | null;
  flight: FlightRec | null;
  /** Last `status.position` frame derived from his status, for the picture on join. */
  lastPosition: Frame | null;
  /** Last full `status.update` forwarded to his flight. */
  lastFull: Frame | null;
}

/** A frame as sent, with its `seq`. */
interface Frame {
  seq: number;
  text: string;
}

/** A flight as the relay keeps it (§7.1). Only the relay changes it. */
interface FlightRec {
  id: string;
  session: Coalition;
  name: string;
  key: string;
  number: number;
  open: boolean;
  privateCode: string | null;
  /** Position → member. */
  slots: Map<number, Member>;
  /** When the -1 position became free; `null` while it is taken. */
  leadFreeSince: number | null;
}

interface LogEntry {
  seq: number;
  text: string;
  to: ReadonlySet<string>;
}

interface Session {
  id: Coalition;
  seq: number;
  /** Recent messages with `seq`, oldest first, for resync. */
  log: LogEntry[];
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A message as the relay builds it; `v`, `id`, `ts`, `ack` (and `seq`, `rts`) are added on send. */
type Outbound = DistributiveOmit<Message, 'v' | 'id' | 'ts' | 'ack' | 're' | 'seq' | 'rts'> & {
  re?: string | null;
};

export class Relay {
  readonly #codes: RelayCodes;
  readonly #name: string;
  readonly #log: RelayLog | undefined;
  readonly #now: () => number;
  readonly #replayLimit: number;
  readonly #sessions: Record<Coalition, Session> = {
    blue: { id: 'blue', seq: 0, log: [] },
    red: { id: 'red', seq: 0, log: [] },
  };
  readonly #members = new Map<string, Member>();
  readonly #byToken = new Map<string, Member>();
  readonly #conns = new Set<Conn>();
  readonly #flights = new Map<string, FlightRec>();

  constructor(options: RelayOptions) {
    this.#codes = options.codes;
    this.#name = options.name;
    this.#log = options.log;
    this.#now = options.now ?? Date.now;
    this.#replayLimit = options.replayLimit ?? 2000;
  }

  /** A new connection, before `hello`. */
  connect(link: RelayLink): RelayConnection {
    const now = this.#now();
    const conn: Conn = {
      link,
      state: 'new',
      member: null,
      tokens: RATE.burst,
      refilledAt: now,
      limitedAt: 0,
    };
    this.#conns.add(conn);
    return {
      receive: (text) => {
        this.#receive(conn, text);
      },
      alive: () => {
        if (conn.member) conn.member.lastSeen = this.#now();
      },
      closed: () => {
        this.#closed(conn);
      },
    };
  }

  /** Lost detection and token expiry; the transport calls it about once a second. */
  tick(): void {
    const now = this.#now();
    for (const member of [...this.#members.values()]) {
      const quiet = now - member.lastSeen;
      if (member.presence === 'online' && quiet > SESSION_TIMING.lostAfterSec * 1000) {
        this.#log?.info(
          `${this.#who(member)} lost (no pong for ${String(Math.round(quiet / 1000))} s)`,
        );
        this.#setPresence(member, 'lost');
      }
      if (member.presence !== 'online' && quiet > SESSION_TIMING.tokenExpiryHours * 3_600_000) {
        this.#log?.info(`${this.#who(member)} expired`);
        this.#members.delete(member.pid);
        this.#byToken.delete(member.token);
        if (member.presence === 'lost') this.#setPresence(member, 'left');
      }
    }
  }

  /** Ends every connection with `session.closed` (`shutdown`). */
  shutdown(): void {
    for (const conn of [...this.#conns]) {
      if (conn.member) this.#closeWith(conn, 'shutdown');
      else conn.link.close();
    }
  }

  /** Counts for logs and tests. */
  stats(): Record<Coalition, { online: number; lost: number; flights: number }> & {
    connections: number;
  } {
    const count = (session: Coalition, presence: Member['presence']) =>
      [...this.#members.values()].filter((m) => m.session === session && m.presence === presence)
        .length;
    const flights = (session: Coalition) =>
      [...this.#flights.values()].filter((f) => f.session === session).length;
    return {
      blue: {
        online: count('blue', 'online'),
        lost: count('blue', 'lost'),
        flights: flights('blue'),
      },
      red: { online: count('red', 'online'), lost: count('red', 'lost'), flights: flights('red') },
      connections: this.#conns.size,
    };
  }

  // -------------------------------------------------------------------------
  // Inbound

  #receive(conn: Conn, text: string): void {
    if (conn.state === 'closed') return;
    const now = this.#now();
    if (conn.member) conn.member.lastSeen = now;
    if (!this.#allow(conn, now)) return;

    const parsed = parseMessageText(text);
    if (!parsed.ok) {
      this.#error(conn, parsed.code, parsed.detail, parsed.id);
      return;
    }
    const message = parsed.message;

    if (conn.state === 'new') {
      if (message.type !== 'hello') {
        this.#error(conn, 'badMessage', 'Send hello first', message.id);
        return;
      }
      this.#hello(conn, message);
      return;
    }

    switch (message.type) {
      case 'hello':
        this.#error(conn, 'badMessage', 'Already said hello', message.id);
        return;
      case 'session.join':
        this.#join(conn, message);
        return;
      case 'session.switch':
      case 'session.update':
      case 'session.leave':
      case 'status.update':
      case 'flight.create':
      case 'flight.join':
      case 'flight.leave':
      case 'flight.move':
      case 'flight.moveUp': {
        const member = conn.member;
        if (!member) {
          this.#error(conn, 'notJoined', 'Join a session first', message.id);
          return;
        }
        if (message.type === 'session.switch') this.#switch(member, message);
        else if (message.type === 'session.update') this.#update(member, message);
        else if (message.type === 'session.leave') this.#leave(conn, member);
        else if (message.type === 'status.update') this.#status(member, message);
        else this.#flightCommand(member, message);
        return;
      }
      // Built in P2.1–P2.4; until then a host gets a clear answer.
      case 'fuel.call':
      case 'msg.received':
      case 'jtac.onStation':
      case 'jtac.offStation':
      case 'ao.update':
      case 'cm.create':
      case 'cm.update':
      case 'cm.delete':
      case 'cas.checkIn':
      case 'cas.checkOut':
      case 'cas.release':
      case 'cas.sitUpdate':
      case 'cas.sitCopy':
      case 'cas.hold.assign':
      case 'cas.hold.update':
      case 'cas.hold.cancel':
      case 'cas.hold.wilco':
      case 'fm.create':
      case 'fm.update':
      case 'fm.assign':
      case 'fm.unassign':
      case 'fm.brief':
      case 'fm.readbackCorrect':
      case 'fm.ackChange':
      case 'fm.spi':
      case 'fm.correlated':
      case 'fm.clear':
      case 'fm.window':
      case 'fm.windowRevoke':
      case 'fm.waitingBda':
      case 'fm.abort':
      case 'fm.voiceOnly':
      case 'fm.bda':
      case 'fm.ackBda':
      case 'fm.reattack':
      case 'fm.complete':
      case 'fm.cancel':
      case 'fm.delete':
      case 'fm.offerCommand':
      case 'fm.acceptCommand':
      case 'fm.returnCommand':
      case 'fm.reclaim':
      case 'log.request':
        this.#error(
          conn,
          'unsupported',
          `${message.type} is not supported by this relay yet`,
          message.id,
        );
        return;
      case 'relay.receipt':
      case 'error':
      case 'welcome':
      case 'reject':
      case 'session.joined':
      case 'session.state':
      case 'session.presence':
      case 'session.updated':
      case 'session.closed':
      case 'status.position':
      case 'flight.created':
      case 'flight.updated':
      case 'flight.listed':
      case 'flight.closed':
      case 'ao.created':
      case 'ao.updated':
      case 'ao.closed':
      case 'cm.created':
      case 'cm.updated':
      case 'cm.deleted':
      case 'cas.checkedIn':
      case 'cas.checkedOut':
      case 'cas.hold.updated':
      case 'cas.hold.cancelled':
      case 'fm.updated':
      case 'fm.deleted':
      case 'log.entries':
        this.#error(conn, 'forbidden', `Only the relay sends ${message.type}`, message.id);
        return;
      default:
        // Every message type is handled above; a new one fails to compile here.
        this.#error(
          conn,
          'unsupported',
          `Unknown message ${message satisfies never as string}`,
          null,
        );
    }
  }

  /** Token bucket per connection; over the limit → `rateLimited` (at most once a second). */
  #allow(conn: Conn, now: number): boolean {
    conn.tokens = Math.min(
      RATE.burst,
      conn.tokens + ((now - conn.refilledAt) / 1000) * RATE.perSec,
    );
    conn.refilledAt = now;
    if (conn.tokens >= 1) {
      conn.tokens -= 1;
      return true;
    }
    if (now - conn.limitedAt >= 1000) {
      conn.limitedAt = now;
      this.#error(conn, 'rateLimited', 'Too many messages', null);
    }
    return false;
  }

  #hello(conn: Conn, message: Extract<Message, { type: 'hello' }>): void {
    const protocol = negotiateProtocol(message.body.protocols, [PROTOCOL_VERSION]);
    if (protocol === null) {
      this.#direct(conn, {
        type: 'reject',
        from: RELAY_FROM,
        session: '',
        to: { scope: 'relay' },
        body: { reason: 'versionMismatch', supported: [PROTOCOL_VERSION] },
        re: message.id,
      });
      this.#log?.info(
        `Rejected ${message.body.app}: protocols ${message.body.protocols.join(', ')}`,
      );
      conn.state = 'closed';
      conn.link.close();
      return;
    }
    conn.state = 'ready';
    this.#direct(conn, {
      type: 'welcome',
      from: RELAY_FROM,
      session: '',
      to: { scope: 'relay' },
      body: {
        protocol,
        relay: this.#name,
        features: [],
        time: this.#now(),
        heartbeatSec: SESSION_TIMING.heartbeatSec,
      },
      re: message.id,
    });
  }

  #join(conn: Conn, message: Extract<Message, { type: 'session.join' }>): void {
    const body = message.body;
    if (conn.member) {
      this.#error(conn, 'badMessage', 'Already joined – leave first', message.id);
      return;
    }
    const code = readCode(this.#codes, body.code);
    if (code === null) {
      this.#error(conn, 'badCode', 'Unknown session code', message.id);
      return;
    }
    const coalition = code.kind === 'coalition' ? code.coalition : body.coalition;
    if (coalition === null) {
      this.#error(conn, 'badCoalition', 'Pick a coalition to join with the group code', message.id);
      return;
    }

    const now = this.#now();
    const known = body.token === null ? undefined : this.#byToken.get(body.token);
    let member: Member;
    if (known) {
      member = known;
      if (member.conn && member.conn !== conn) this.#closeWith(member.conn, 'replaced');
      this.#byToken.delete(member.token);
      member.token = newToken();
    } else {
      member = {
        pid: newPid((pid) => this.#members.has(pid)),
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
        lastPosition: null,
        lastFull: null,
      };
      this.#members.set(member.pid, member);
    }
    this.#byToken.set(member.token, member);
    const resumed = known !== undefined;
    const moved = resumed && member.session !== coalition;
    if (moved) this.#setPresence(member, 'left');

    const typeChanged = member.aircraft?.type !== body.aircraft?.type;
    member.session = coalition;
    member.nick = body.nick;
    member.role = body.role;
    member.aircraft = body.aircraft;
    member.source = body.source;
    member.lastSeen = now;
    member.conn = conn;
    conn.member = member;
    if (moved) {
      member.lastPosition = null;
      member.lastFull = null;
    }
    // A JTAC is never in a flight (§5): joining in a JTAC slot leaves it.
    if (member.flight && member.role === 'jtac') this.#removeFromFlight(member, null, false);

    this.#direct(conn, {
      type: 'session.joined',
      from: RELAY_FROM,
      session: coalition,
      to: { scope: 'pid', id: member.pid },
      body: { pid: member.pid, token: member.token, resumed, session: coalition, coalition },
      re: message.id,
    });
    this.#sendState(member, resumed && !moved ? body.lastSeq : null);
    const flight = member.flight;
    if (!this.#setPresence(member, 'online', member) && flight && typeChanged) {
      this.#flightChanged(flight, null, member);
    }
    if (flight && typeChanged) this.#listed(flight);
    this.#log?.info(
      `${this.#who(member)} ${resumed ? 'resumed' : 'joined'} (${body.source}${code.kind === 'group' ? ', group code' : ''})`,
    );
  }

  #switch(member: Member, message: Extract<Message, { type: 'session.switch' }>): void {
    const code = readCode(this.#codes, message.body.code);
    if (code === null) {
      this.#error(member.conn, 'badCode', 'Unknown session code', message.id);
      return;
    }
    if (code.kind === 'group') {
      this.#error(member.conn, 'badCoalition', 'Switch with a coalition code', message.id);
      return;
    }
    const same = code.coalition === member.session;
    if (!same) {
      this.#setPresence(member, 'left');
      member.session = code.coalition;
      member.lastPosition = null;
      member.lastFull = null;
    }
    // Answered also when nothing changes, so the host's request doesn't time out.
    this.#direct(member.conn, {
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
    this.#setPresence(member, 'online');
    this.#log?.info(`${this.#who(member)} switched to ${member.session}`);
  }

  /** New nick, role or aircraft while joined (§5): tells the session, and his flight. */
  #update(member: Member, message: Extract<Message, { type: 'session.update' }>): void {
    const body = message.body;
    const typeChanged = member.aircraft?.type !== body.aircraft?.type;
    member.nick = body.nick;
    member.role = body.role;
    member.aircraft = body.aircraft;
    this.#publish(
      this.#sessions[member.session],
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
      this.#inSession(member.session).filter((m) => m !== member),
      true,
    );
    const flight = member.flight;
    if (!flight) return;
    // Joining a JTAC slot leaves the flight (decided 21 Oct 2026).
    if (member.role === 'jtac') {
      this.#removeFromFlight(member, message.id, true);
      this.#log?.info(`${this.#who(member)} took a JTAC slot and left ${this.#display(flight)}`);
    } else if (typeChanged) {
      this.#flightChanged(flight, message.id);
      this.#listed(flight);
    }
  }

  #leave(conn: Conn, member: Member): void {
    this.#setPresence(member, 'left');
    member.conn = null;
    member.lastPosition = null;
    member.lastFull = null;
    conn.member = null;
    this.#log?.info(`${this.#who(member)} left`);
  }

  /**
   * Routes a status package (§6.4): in full to his own flight, as
   * `status.position` to the rest of the session. JTAC check-ins (P2) will add
   * full packages to the JTACs he is checked in with.
   */
  #status(member: Member, message: StatusUpdate): void {
    const session = this.#sessions[member.session];
    const flight = member.flight;
    const mates = flight ? [...flight.slots.values()].filter((m) => m !== member) : [];
    if (flight && mates.length > 0) {
      member.lastFull = this.#forward(
        session,
        {
          ...message,
          from: member.pid,
          session: member.session,
          to: { scope: 'flight', id: flight.id },
        },
        mates,
      );
    }
    const body = message.body;
    if (body.pos !== null) {
      const others = this.#inSession(member.session).filter(
        (m) => m !== member && !mates.includes(m),
      );
      member.lastPosition = this.#publish(
        session,
        {
          type: 'status.position',
          from: RELAY_FROM,
          session: member.session,
          to: { scope: 'session' },
          body: {
            pid: member.pid,
            callsign: this.#callsign(member),
            type: member.aircraft?.type ?? 'unknown',
            pos: body.pos,
            hdg: body.hdg,
            gs: body.gs,
          },
        },
        others,
        false,
      );
    }
    if (message.ack) this.#receipt(member, message.id, session.seq);
  }

  /** `Enfield 1-2` in a flight, else the unit name, else the nick. */
  #callsign(member: Member): string {
    const flight = member.flight;
    if (flight) {
      for (const [pos, m] of flight.slots) {
        if (m === member) return `${this.#display(flight)}-${String(pos)}`;
      }
    }
    return member.aircraft?.unit ?? member.nick;
  }

  // -------------------------------------------------------------------------
  // Flights (§7)

  #flightCommand(
    member: Member,
    message: Extract<
      Message,
      { type: 'flight.create' | 'flight.join' | 'flight.leave' | 'flight.move' | 'flight.moveUp' }
    >,
  ): void {
    const fail = (code: ErrorCode, text: string) => {
      this.#error(member.conn, code, text, message.id);
    };
    if (member.role === 'jtac') {
      fail('forbidden', 'JTACs are not in flights');
      return;
    }
    if (message.type === 'flight.create' || message.type === 'flight.join') {
      if (member.flight) {
        fail('alreadyInFlight', `Already in ${this.#display(member.flight)} – leave it first`);
        return;
      }
      if (message.type === 'flight.create') this.#createFlight(member, message.body, message.id);
      else this.#joinFlight(member, message.body, message.id, fail);
      return;
    }
    const flight = member.flight;
    if (!flight) {
      fail('forbidden', 'Not in a flight');
      return;
    }
    if (message.type === 'flight.leave') {
      this.#removeFromFlight(member, message.id, true);
      this.#log?.info(`${this.#who(member)} left ${this.#display(flight)}`);
    } else if (message.type === 'flight.move') {
      this.#moveMember(flight, member, message.body, message.id, fail);
    } else {
      this.#moveUp(flight, member, message.id, fail);
    }
  }

  #createFlight(member: Member, body: { name: string; open: boolean }, re: string): void {
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
    this.#publish(
      this.#sessions[flight.session],
      {
        type: 'flight.created',
        from: RELAY_FROM,
        session: flight.session,
        to: { scope: 'pid', id: member.pid },
        body: this.#flightView(flight, member),
        re,
      },
      [member],
      true,
    );
    this.#listed(flight);
    this.#log?.info(
      `${this.#who(member)} created ${this.#display(flight)} (${flight.open ? 'open' : 'private'})`,
    );
  }

  #joinFlight(
    member: Member,
    body: { flightId: string } | { privateCode: string },
    re: string,
    fail: (code: ErrorCode, text: string) => void,
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
      fail('flightFull', `${this.#display(flight)} is full`);
      return;
    }
    flight.slots.set(pos, member);
    member.flight = flight;
    this.#flightChanged(flight, re);
    this.#listed(flight);
    this.#log?.info(`${this.#who(member)} joined ${this.#display(flight)} as -${String(pos)}`);
  }

  /**
   * Takes a member out of his flight – a deliberate leave (§7.2, §7.4). -1's
   * position becomes free, and -2 may move up at once. The last one out closes
   * the flight (§7.5). `tell`: the leaver gets the result too.
   */
  #removeFromFlight(member: Member, re: string | null, tell: boolean): void {
    const flight = member.flight;
    if (!flight) return;
    for (const [pos, m] of flight.slots) {
      if (m === member) {
        flight.slots.delete(pos);
        if (pos === 1) flight.leadFreeSince = this.#now();
      }
    }
    member.flight = null;
    member.lastFull = null;
    const extra = tell ? [member] : [];
    if (flight.slots.size === 0) {
      this.#flights.delete(flight.id);
      const to = flight.open ? [...this.#inSession(flight.session), ...extra] : extra;
      this.#publish(
        this.#sessions[flight.session],
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
      this.#log?.info(`${this.#display(flight)} closed`);
      return;
    }
    this.#flightChanged(flight, re, null, extra);
    this.#listed(flight);
  }

  #moveMember(
    flight: FlightRec,
    member: Member,
    body: { pid: string; pos: number },
    re: string,
    fail: (code: ErrorCode, text: string) => void,
  ): void {
    if (this.#inCommand(flight) !== member) {
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
    this.#flightChanged(flight, re);
  }

  /** -2 (or the member in command) takes over -1 once allowed (§7.4). */
  #moveUp(
    flight: FlightRec,
    member: Member,
    re: string,
    fail: (code: ErrorCode, text: string) => void,
  ): void {
    const allowed = this.#moveUpState(flight);
    if (allowed?.pid !== member.pid) {
      fail('forbidden', 'You may not move up to -1');
      return;
    }
    if (this.#now() < allowed.allowedFrom) {
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
    this.#flightChanged(flight, re);
    this.#log?.info(`${this.#who(member)} moved up to -1 in ${this.#display(flight)}`);
  }

  /** Lowest position whose member is online (§7.1). */
  #inCommand(flight: FlightRec): Member | null {
    for (let pos = 1; pos <= FLIGHT_RULES.maxMembers; pos += 1) {
      const m = flight.slots.get(pos);
      if (m?.presence === 'online') return m;
    }
    return null;
  }

  /** Who may take over -1, and from when (§7.4); `null` if nobody may. */
  #moveUpState(flight: FlightRec): Flight['moveUp'] {
    const lead = flight.slots.get(1);
    const candidate = flight.slots.get(2) ?? this.#inCommand(flight);
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

  #display(flight: FlightRec): string {
    return `${flight.name} ${String(flight.number)}`;
  }

  /** The flight object as one member sees it: the private code only for the member in command. */
  #flightView(flight: FlightRec, viewer: Member | null): Flight {
    const inCommand = this.#inCommand(flight);
    return {
      flightId: flight.id,
      name: flight.name,
      number: flight.number,
      display: this.#display(flight),
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

  #summary(flight: FlightRec): FlightSummary {
    return {
      flightId: flight.id,
      display: this.#display(flight),
      memberCount: flight.slots.size,
      types: [
        ...new Set(
          [...flight.slots.values()].flatMap((m) => (m.aircraft ? [m.aircraft.type] : [])),
        ),
      ],
    };
  }

  /** `flight.updated` to every member (each with his own view), plus `extra`, minus `skip`. */
  #flightChanged(
    flight: FlightRec,
    re: string | null,
    skip: Member | null = null,
    extra: readonly Member[] = [],
  ): void {
    const to = [...flight.slots.values(), ...extra].filter((m) => m !== skip);
    this.#publish(
      this.#sessions[flight.session],
      (viewer) => ({
        type: 'flight.updated',
        from: RELAY_FROM,
        session: flight.session,
        to: { scope: 'flight', id: flight.id },
        body: this.#flightView(flight, viewer),
        re,
      }),
      to,
      true,
    );
  }

  /** `flight.listed` to the session, for open flights only. */
  #listed(flight: FlightRec): void {
    if (!flight.open || !this.#flights.has(flight.id)) return;
    this.#publish(
      this.#sessions[flight.session],
      {
        type: 'flight.listed',
        from: RELAY_FROM,
        session: flight.session,
        to: { scope: 'session' },
        body: this.#summary(flight),
      },
      this.#inSession(flight.session),
      true,
    );
  }

  #closed(conn: Conn): void {
    conn.state = 'closed';
    this.#conns.delete(conn);
    const member = conn.member;
    conn.member = null;
    if (member?.conn === conn) {
      member.conn = null;
      if (member.presence === 'online') {
        this.#log?.info(`${this.#who(member)} lost (connection closed)`);
        this.#setPresence(member, 'lost');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Outbound

  /** Everyone in a session who hasn't left (online or lost). */
  #inSession(session: Coalition): Member[] {
    return [...this.#members.values()].filter(
      (m) => m.session === session && m.presence !== 'left',
    );
  }

  #participant(member: Member): Participant {
    return {
      pid: member.pid,
      nick: member.nick,
      role: member.role,
      aircraft: member.aircraft ? { type: member.aircraft.type } : null,
      presence: member.presence,
    };
  }

  /**
   * Changes presence and tells the rest of the session (§5) and his flight.
   * `left` takes him out of his flight (a deliberate leave). `skipFlight`
   * doesn't get the `flight.updated` (he just got the state). Returns `false`
   * if nothing changed.
   */
  #setPresence(
    member: Member,
    presence: Member['presence'],
    skipFlight: Member | null = null,
  ): boolean {
    if (member.presence === presence) return false;
    member.presence = presence;
    member.lostAt = presence === 'lost' ? this.#now() : null;
    const others = [...this.#members.values()].filter(
      (m) => m !== member && m.session === member.session && m.presence !== 'left',
    );
    this.#publish(
      this.#sessions[member.session],
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
      if (presence === 'left') this.#removeFromFlight(member, null, false);
      else this.#flightChanged(flight, null, skipFlight);
    }
    return true;
  }

  /** `session.state`, the replay since `lastSeq` if possible, then the current picture (§4.5). */
  #sendState(member: Member, lastSeq: number | null): void {
    const session = this.#sessions[member.session];
    const members = this.#inSession(member.session).filter((m) => m !== member);
    // He is online from now on; the state already shows it.
    const presence = member.presence;
    member.presence = 'online';
    const own = member.flight ? this.#flightView(member.flight, member) : null;
    member.presence = presence;
    const open = [...this.#flights.values()]
      .filter((f) => f.session === member.session && f.open && f !== member.flight)
      .map((f) => this.#summary(f));
    this.#direct(member.conn, {
      type: 'session.state',
      from: RELAY_FROM,
      session: session.id,
      to: { scope: 'pid', id: member.pid },
      body: {
        asOfSeq: session.seq,
        participants: [
          this.#participant({ ...member, presence: 'online' }),
          ...members.map((m) => this.#participant(m)),
        ],
        flights: own ? [...open, own] : open,
        aos: [],
        mapEntries: [],
        holds: [],
        you: { flight: own, checkIn: null, openMissions: [] },
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
      const status =
        member.flight && other.flight === member.flight
          ? (other.lastFull ?? other.lastPosition)
          : other.lastPosition;
      if (status) catchUp.push(status);
    }
    catchUp.sort((a, b) => a.seq - b.seq);
    for (const entry of catchUp) member.conn?.link.send(entry.text);
  }

  /**
   * A message with `seq` and `rts` to the given members of a session; online
   * ones get it now. `message` may depend on the recipient (one `seq` and ID,
   * e.g. the private code only for the member in command). With `replay`, it
   * is kept for resync. Returns the frame of the last recipient's variant.
   */
  #publish(
    session: Session,
    message: Outbound | ((member: Member) => Outbound),
    to: readonly Member[],
    replay: boolean,
  ): Frame {
    session.seq += 1;
    const seq = session.seq;
    const now = this.#now();
    const base = { v: PROTOCOL_VERSION, id: ulid(now), ts: now, ack: false, re: null };
    const frame = (m: Outbound) => JSON.stringify({ ...base, ...m, seq, rts: now });
    if (typeof message !== 'function') {
      const text = frame(message);
      for (const member of to) member.conn?.link.send(text);
      if (replay) this.#keep(session, { seq, text, to: new Set(to.map((m) => m.pid)) });
      return { seq, text };
    }
    const variants = new Map<string, Set<string>>();
    let text = '';
    for (const member of to) {
      text = frame(message(member));
      member.conn?.link.send(text);
      const pids = variants.get(text) ?? new Set<string>();
      pids.add(member.pid);
      variants.set(text, pids);
    }
    if (replay) for (const [t, pids] of variants) this.#keep(session, { seq, text: t, to: pids });
    return { seq, text };
  }

  /** Forwards a host's message unchanged, with `seq` and `rts` added. */
  #forward(session: Session, message: Message, to: readonly Member[]): Frame {
    session.seq += 1;
    const text = JSON.stringify({ ...message, seq: session.seq, rts: this.#now() });
    for (const member of to) member.conn?.link.send(text);
    return { seq: session.seq, text };
  }

  #keep(session: Session, entry: LogEntry): void {
    session.log.push(entry);
    while (session.log.length > this.#replayLimit) session.log.shift();
  }

  /** A control message to one connection – no `seq`. */
  #direct(conn: Conn | null, message: Outbound): void {
    if (conn === null || conn.state === 'closed') return;
    const now = this.#now();
    conn.link.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id: ulid(now),
        ts: now,
        ack: false,
        re: null,
        ...message,
      }),
    );
  }

  #receipt(member: Member, re: string, seq: number): void {
    this.#direct(member.conn, {
      type: 'relay.receipt',
      from: RELAY_FROM,
      session: member.session,
      to: { scope: 'pid', id: member.pid },
      body: { seq },
      re,
    });
  }

  #error(conn: Conn | null, code: ErrorCode, text: string, re: string | null): void {
    this.#direct(conn, {
      type: 'error',
      from: RELAY_FROM,
      session: conn?.member?.session ?? '',
      to: conn?.member ? { scope: 'pid', id: conn.member.pid } : { scope: 'relay' },
      body: { code, text },
      re,
    });
  }

  #closeWith(conn: Conn, reason: 'replaced' | 'shutdown'): void {
    const member = conn.member;
    this.#direct(conn, {
      type: 'session.closed',
      from: RELAY_FROM,
      session: member?.session ?? '',
      to: member ? { scope: 'pid', id: member.pid } : { scope: 'relay' },
      body: { reason },
    });
    if (member?.conn === conn) member.conn = null;
    conn.member = null;
    conn.state = 'closed';
    conn.link.close();
  }

  #who(member: Member): string {
    return `${member.pid} "${member.nick}" (${member.role}, ${member.session})`;
  }
}
