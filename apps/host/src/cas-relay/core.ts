// SPDX-License-Identifier: GPL-3.0-or-later
// The relay's session core: the state every part shares (connections,
// participants, coalition sessions) and the way messages go out – `seq`, the
// replay buffer, direct control messages. The parts on top (sessions.ts,
// status.ts, flights.ts; AOs, check-ins, missions and the log in P2) use it;
// relay.ts wires them together.
//
// State lives in memory only (decided 21 Oct 2026): after a restart everyone
// joins as a new participant.

import { PROTOCOL_VERSION, ulid } from '@slate-dcs/shared';
import type {
  AircraftInfo,
  Coalition,
  ErrorCode,
  Message,
  Participant,
  SessionJoin,
} from '@slate-dcs/shared';

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
export const RATE = { burst: 40, perSec: 10 } as const;

export interface Conn {
  link: RelayLink;
  state: 'new' | 'ready' | 'closed';
  member: Member | null;
  tokens: number;
  refilledAt: number;
  limitedAt: number;
}

/** A participant as the relay keeps him (§4.3): stays after a disconnect until expiry. */
export interface Member {
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
export interface Frame {
  seq: number;
  text: string;
}

/** A flight as the relay keeps it (§7.1). Only the relay changes it. */
export interface FlightRec {
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

/** A message kept for resync, with who got it. */
export interface LogEntry {
  seq: number;
  text: string;
  to: ReadonlySet<string>;
}

export interface Session {
  id: Coalition;
  seq: number;
  /** Recent messages with `seq`, oldest first, for resync. */
  log: LogEntry[];
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A message as the relay builds it; `v`, `id`, `ts`, `ack` (and `seq`, `rts`) are added on send. */
export type Outbound = DistributiveOmit<
  Message,
  'v' | 'id' | 'ts' | 'ack' | 're' | 'seq' | 'rts'
> & {
  re?: string | null;
};

/** The shared state and the outbound side. Only the relay's own parts use it. */
export class RelayCore {
  readonly codes: RelayCodes;
  readonly name: string;
  readonly log: RelayLog | undefined;
  readonly now: () => number;
  readonly #replayLimit: number;
  readonly sessions: Record<Coalition, Session> = {
    blue: { id: 'blue', seq: 0, log: [] },
    red: { id: 'red', seq: 0, log: [] },
  };
  readonly members = new Map<string, Member>();
  readonly byToken = new Map<string, Member>();
  readonly conns = new Set<Conn>();

  constructor(options: RelayOptions) {
    this.codes = options.codes;
    this.name = options.name;
    this.log = options.log;
    this.now = options.now ?? Date.now;
    this.#replayLimit = options.replayLimit ?? 2000;
  }

  /** Everyone in a session who hasn't left (online or lost). */
  inSession(session: Coalition): Member[] {
    return [...this.members.values()].filter((m) => m.session === session && m.presence !== 'left');
  }

  participant(member: Member): Participant {
    return {
      pid: member.pid,
      nick: member.nick,
      role: member.role,
      aircraft: member.aircraft ? { type: member.aircraft.type } : null,
      presence: member.presence,
    };
  }

  who(member: Member): string {
    return `${member.pid} "${member.nick}" (${member.role}, ${member.session})`;
  }

  /**
   * A message with `seq` and `rts` to the given members of a session; online
   * ones get it now. `message` may depend on the recipient (one `seq` and ID,
   * e.g. the private code only for the member in command). With `replay`, it
   * is kept for resync. Returns the frame of the last recipient's variant.
   */
  publish(
    session: Session,
    message: Outbound | ((member: Member) => Outbound),
    to: readonly Member[],
    replay: boolean,
  ): Frame {
    session.seq += 1;
    const seq = session.seq;
    const now = this.now();
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
  forward(session: Session, message: Message, to: readonly Member[]): Frame {
    session.seq += 1;
    const text = JSON.stringify({ ...message, seq: session.seq, rts: this.now() });
    for (const member of to) member.conn?.link.send(text);
    return { seq: session.seq, text };
  }

  #keep(session: Session, entry: LogEntry): void {
    session.log.push(entry);
    while (session.log.length > this.#replayLimit) session.log.shift();
  }

  /** A control message to one connection – no `seq`. */
  direct(conn: Conn | null, message: Outbound): void {
    if (conn === null || conn.state === 'closed') return;
    const now = this.now();
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

  receipt(member: Member, re: string, seq: number): void {
    this.direct(member.conn, {
      type: 'relay.receipt',
      from: RELAY_FROM,
      session: member.session,
      to: { scope: 'pid', id: member.pid },
      body: { seq },
      re,
    });
  }

  error(conn: Conn | null, code: ErrorCode, text: string, re: string | null): void {
    this.direct(conn, {
      type: 'error',
      from: RELAY_FROM,
      session: conn?.member?.session ?? '',
      to: conn?.member ? { scope: 'pid', id: conn.member.pid } : { scope: 'relay' },
      body: { code, text },
      re,
    });
  }

  closeWith(conn: Conn, reason: 'replaced' | 'shutdown'): void {
    const member = conn.member;
    this.direct(conn, {
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
}
