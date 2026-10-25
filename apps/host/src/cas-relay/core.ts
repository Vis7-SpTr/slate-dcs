// SPDX-License-Identifier: GPL-3.0-or-later
// The relay's session core: the state every part shares (connections,
// participants, coalition sessions) and the way messages go out – `seq`, the
// replay buffer, direct control messages. The parts on top (sessions.ts,
// status.ts, flights.ts; AOs, check-ins, missions and the log in P2) use it;
// relay.ts wires them together.
//
// State lives in memory only (decided 21 Oct 2026): after a restart everyone
// joins as a new participant. The one exception is the CAS log, which is also
// written to disk (cas-log-file.ts, decided 25 Oct 2026 – D7).

import { PROTOCOL_VERSION, ulid } from '@slate-dcs/shared';
import type {
  AircraftInfo,
  Altitude,
  AoType,
  CheckInBrief,
  Coalition,
  ErrorCode,
  Frequency,
  Hold,
  LatLon,
  LogEntry as CasLogEntry,
  MapEntry,
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

/** Where the CAS log goes besides memory: the JSONL files (cas-log-file.ts, §12.1). */
export interface CasLogSink {
  append(session: Coalition, entry: CasLogEntry): void;
}

export interface RelayOptions {
  codes: RelayCodes;
  /** Relay name and version for `welcome`, e.g. `slate-relay 0.1.0`. */
  name: string;
  log?: RelayLog;
  now?: () => number;
  /** Messages kept per session for resync (§4.5). */
  replayLimit?: number;
  /** The CAS log's files; without one the log lives in memory only (tests). */
  casLog?: CasLogSink;
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
  /** The AO a JTAC is on-station in – one at a time (§8.2). */
  ao: AoRec | null;
  /** Last position from his status (a JTAC's default AO centre, §8.2). */
  lastPos: LatLon | null;
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
  /** The flight's check-in – at most one, always in an AO (§9.2). */
  checkIn: CheckInRec | null;
}

/** A flight's check-in (§9.2). It belongs to the flight, not to who sent it. */
export interface CheckInRec {
  id: string;
  flight: FlightRec;
  ao: AoRec;
  /** The JTAC it was sent to; `null` when sent to the AO or he went off-station. */
  primary: Member | null;
  brief: CheckInBrief;
  since: number;
}

/** A hold as the relay keeps it (§9.4). */
export interface HoldRec {
  hold: Hold;
  session: Coalition;
  ao: AoRec;
}

/** One JTAC working an AO, in the order they joined (§8.3). */
export interface AoJtacRec {
  member: Member;
  callsign: string;
  /** When he joined the AO – relay time. */
  since: number;
  freqs: Frequency[];
}

/** An AO's area (§8.1): the fields its type doesn't use are `null`. */
export interface AoArea {
  type: AoType;
  center: LatLon | null;
  radiusM: number | null;
  lengthM: number | null;
  widthM: number | null;
  headingDeg: number | null;
  points: LatLon[] | null;
  floor: Altitude;
  ceiling: Altitude;
}

/** An AO as the relay keeps it (§8.1). Only the relay changes it. */
export interface AoRec {
  id: string;
  joinCode: string;
  session: Coalition;
  name: string;
  area: AoArea;
  /** In the order they joined; the first online one is in command (§8.3). */
  jtacs: AoJtacRec[];
}

/** A map entry as the relay keeps it (§8.4). */
export interface CmRec {
  entry: MapEntry;
  session: Coalition;
}

/** The relay's mission clock for a session (§1.4): a host's `mt` and when it arrived. */
export interface MissionClock {
  mt: number;
  /** Relay time when it arrived. */
  at: number;
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
  /** The newest mission-time anchor from a host in this session (§1.4); `null` before any. */
  clock: MissionClock | null;
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
    blue: { id: 'blue', seq: 0, log: [], clock: null },
    red: { id: 'red', seq: 0, log: [], clock: null },
  };
  readonly members = new Map<string, Member>();
  readonly byToken = new Map<string, Member>();
  readonly conns = new Set<Conn>();
  /** Errors sent so far – the relay sends a receipt only for a message that caused none. */
  errorCount = 0;
  /** The host message being handled; its confirmations go back to its sender (§1.2). */
  #current: { member: Member; id: string; type: string; ack: boolean } | null = null;
  /** Frame ID → the command it came from and who sent it, for level-2 confirmations. */
  readonly #confirms = new Map<string, { sender: string; command: string }>();

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

  /**
   * Keeps a host's mission time as the session's clock anchor (§1.4). The
   * relay's own receive time is used, not the host's `ts`, so PC clock
   * differences don't count.
   */
  anchor(session: Coalition, mt: number | null | undefined): void {
    if (mt === null || mt === undefined) return;
    this.sessions[session].clock = { mt, at: this.now() };
  }

  /** Mission time now on a session's clock (§1.4), or `null` without an anchor. */
  missionTime(session: Coalition): number | null {
    const clock = this.sessions[session].clock;
    return clock === null ? null : clock.mt + (this.now() - clock.at) / 1000;
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
    const id = ulid(now);
    const base = { v: PROTOCOL_VERSION, id, ts: now, ack: false, re: null };
    // Made from a command that wants confirmations: they go back to its sender (§1.2).
    const current = this.#current;
    const frame = (m: Outbound) => {
      const confirm = current !== null && current.ack && m.re === current.id;
      if (confirm) this.#remember(id, current.member.pid, current.id);
      return JSON.stringify({ ...base, ...m, ack: confirm, seq, rts: now });
    };
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
  forward(session: Session, message: Message, to: readonly Member[], replay = false): Frame {
    session.seq += 1;
    const seq = session.seq;
    const text = JSON.stringify({ ...message, seq, rts: this.now() });
    for (const member of to) member.conn?.link.send(text);
    if (message.ack) this.#remember(message.id, message.from, message.id);
    if (replay) this.#keep(session, { seq, text, to: new Set(to.map((m) => m.pid)) });
    return { seq, text };
  }

  /** Runs the handling of one host message, so its confirmations can find their way back. */
  handling(member: Member, message: Message, handle: () => void): void {
    this.#current = { member, id: message.id, type: message.type, ack: message.ack };
    try {
      handle();
    } finally {
      this.#current = null;
    }
  }

  /** Sender and type of the host message being handled; `null` on the relay's own events (tick). */
  get handled(): { member: Member; type: string } | null {
    const current = this.#current;
    return current === null ? null : { member: current.member, type: current.type };
  }

  /** Who wants to hear that a frame was received, and for which command (§1.2). */
  confirmation(frameId: string): { sender: string; command: string } | null {
    return this.#confirms.get(frameId) ?? null;
  }

  #remember(frameId: string, sender: string, command: string): void {
    this.#confirms.set(frameId, { sender, command });
    // Kept about as long as the replay buffer; oldest first out.
    while (this.#confirms.size > 4 * this.#replayLimit) {
      const oldest = this.#confirms.keys().next().value;
      if (oldest === undefined) break;
      this.#confirms.delete(oldest);
    }
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
    this.errorCount += 1;
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
