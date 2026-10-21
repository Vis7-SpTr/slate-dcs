// SPDX-License-Identifier: GPL-3.0-or-later
// The relay's core (protocol.md §1–§6): handshake, coalition sessions, tokens,
// presence and status routing. It knows nothing about sockets – a transport
// (WSS server, or in-memory links in tests) hands it text frames and pongs.
// The same core runs standalone (`slate-relay`) and inside a host (host mode).
//
// State lives in memory only (decided 21 Oct 2026): after a restart everyone
// joins as a new participant.
//
// Flights (§7) come in P1.6b; until then their messages answer `unsupported`.

import {
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
  Message,
  Participant,
  SessionJoin,
  StatusUpdate,
} from '@slate-dcs/shared';

import { newPid, newToken, readCode } from './codes.js';
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
  /** Last `status.position` frame derived from his status, for the picture on join. */
  lastPosition: { seq: number; text: string } | null;
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
  stats(): Record<Coalition, { online: number; lost: number }> & { connections: number } {
    const count = (session: Coalition, presence: Member['presence']) =>
      [...this.#members.values()].filter((m) => m.session === session && m.presence === presence)
        .length;
    return {
      blue: { online: count('blue', 'online'), lost: count('blue', 'lost') },
      red: { online: count('red', 'online'), lost: count('red', 'lost') },
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
      case 'session.leave':
      case 'status.update':
        if (!conn.member) {
          this.#error(conn, 'notJoined', 'Join a session first', message.id);
          return;
        }
        if (message.type === 'session.switch') this.#switch(conn.member, message);
        else if (message.type === 'session.leave') this.#leave(conn, conn.member);
        else this.#status(conn.member, message);
        return;
      case 'flight.create':
      case 'flight.join':
      case 'flight.leave':
      case 'flight.move':
      case 'flight.moveUp':
      case 'fuel.call':
      case 'msg.received':
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
      case 'session.closed':
      case 'status.position':
      case 'flight.created':
      case 'flight.updated':
      case 'flight.listed':
      case 'flight.closed':
        this.#error(conn, 'forbidden', `Only the relay sends ${message.type}`, message.id);
        return;
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
        lastPosition: null,
      };
      this.#members.set(member.pid, member);
    }
    this.#byToken.set(member.token, member);
    const resumed = known !== undefined;
    const moved = resumed && member.session !== coalition;
    if (moved) this.#setPresence(member, 'left');

    member.session = coalition;
    member.nick = body.nick;
    member.role = body.role;
    member.aircraft = body.aircraft;
    member.source = body.source;
    member.lastSeen = now;
    member.conn = conn;
    conn.member = member;
    if (moved) member.lastPosition = null;

    this.#direct(conn, {
      type: 'session.joined',
      from: RELAY_FROM,
      session: coalition,
      to: { scope: 'pid', id: member.pid },
      body: { pid: member.pid, token: member.token, resumed, session: coalition, coalition },
      re: message.id,
    });
    this.#sendState(member, resumed && !moved ? body.lastSeq : null);
    this.#setPresence(member, 'online');
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
    if (code.coalition === member.session) return;
    this.#setPresence(member, 'left');
    member.session = code.coalition;
    member.lastPosition = null;
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
    this.#sendState(member, null);
    this.#setPresence(member, 'online');
    this.#log?.info(`${this.#who(member)} switched to ${member.session}`);
  }

  #leave(conn: Conn, member: Member): void {
    this.#setPresence(member, 'left');
    member.conn = null;
    member.lastPosition = null;
    conn.member = null;
    this.#log?.info(`${this.#who(member)} left`);
  }

  /** Stores the status and sends the datalink picture to the rest of the session (§6.4). */
  #status(member: Member, message: StatusUpdate): void {
    const body = message.body;
    if (body.pos === null) return;
    const recipients = this.#inSession(member.session).filter((m) => m !== member);
    member.lastPosition = this.#publish(
      this.#sessions[member.session],
      {
        type: 'status.position',
        from: RELAY_FROM,
        session: member.session,
        to: { scope: 'session' },
        body: {
          pid: member.pid,
          callsign: member.aircraft?.unit ?? member.nick,
          type: member.aircraft?.type ?? 'unknown',
          pos: body.pos,
          hdg: body.hdg,
          gs: body.gs,
        },
      },
      recipients,
      false,
    );
    if (message.ack) this.#receipt(member, message.id, this.#sessions[member.session].seq);
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

  /** Changes presence and tells the rest of the session (§5). */
  #setPresence(member: Member, presence: Member['presence']): void {
    if (member.presence === presence) return;
    member.presence = presence;
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
  }

  /** `session.state`, the replay since `lastSeq` if possible, then the current picture (§4.5). */
  #sendState(member: Member, lastSeq: number | null): void {
    const session = this.#sessions[member.session];
    const members = this.#inSession(member.session).filter((m) => m !== member);
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
        flights: [],
        aos: [],
        you: { flight: null, checkIns: [], openMissions: [] },
      },
    });
    // Catch-up, sorted by seq: what he missed (if the relay still has all of
    // it) and the last position of every aircraft. All of it is ≤ asOfSeq.
    const catchUp: { seq: number; text: string }[] = [];
    const first = session.log[0];
    if (
      lastSeq !== null &&
      lastSeq < session.seq &&
      (first === undefined || first.seq <= lastSeq + 1)
    ) {
      catchUp.push(...session.log.filter((e) => e.seq > lastSeq && e.to.has(member.pid)));
    }
    for (const other of members) if (other.lastPosition) catchUp.push(other.lastPosition);
    catchUp.sort((a, b) => a.seq - b.seq);
    for (const entry of catchUp) member.conn?.link.send(entry.text);
  }

  /**
   * A message with `seq` and `rts` to the given members of a session; online
   * ones get it now. With `replay`, it is kept for resync. Returns the frame.
   */
  #publish(
    session: Session,
    message: Outbound,
    to: readonly Member[],
    replay: boolean,
  ): { seq: number; text: string } {
    session.seq += 1;
    const now = this.#now();
    const text = JSON.stringify({
      v: PROTOCOL_VERSION,
      id: ulid(now),
      ts: now,
      ack: false,
      re: null,
      ...message,
      seq: session.seq,
      rts: now,
    });
    for (const member of to) member.conn?.link.send(text);
    if (replay) {
      session.log.push({ seq: session.seq, text, to: new Set(to.map((m) => m.pid)) });
      if (session.log.length > this.#replayLimit) session.log.shift();
    }
    return { seq: session.seq, text };
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
