// SPDX-License-Identifier: GPL-3.0-or-later
// The relay (protocol.md §1–§13): one object per relay that a transport (the
// WSS server, host mode, or in-memory links in tests) hands text frames and
// pongs. It checks each message, applies the rate limit and passes it to its
// part: sessions.ts (handshake, join, presence), status.ts, flights.ts – on
// top of the shared state and outbound side in core.ts. The same relay runs
// standalone (`slate-relay`) and inside a host (host mode).

import { parseMessageText } from '@slate-dcs/shared';
import type { Coalition, Message } from '@slate-dcs/shared';

import { RATE, RelayCore } from './core.js';
import type { Conn, Member, RelayConnection, RelayLink, RelayOptions } from './core.js';
import { Aos } from './aos.js';
import { CheckIns } from './checkins.js';
import { Flights } from './flights.js';
import { Holds } from './holds.js';
import { MapEntries } from './map-entries.js';
import { Sessions } from './sessions.js';
import { StatusRouter } from './status.js';

export { RELAY_FROM } from './core.js';
export type { RelayConnection, RelayLink, RelayLog, RelayOptions } from './core.js';

/** Messages a host sends once it has joined a session. */
type JoinedMessage = Exclude<
  Message,
  {
    type:
      | 'hello'
      | 'session.join'
      | 'relay.receipt'
      | 'error'
      | 'welcome'
      | 'reject'
      | 'session.joined'
      | 'session.state'
      | 'session.presence'
      | 'session.updated'
      | 'session.closed'
      | 'status.position'
      | 'flight.created'
      | 'flight.updated'
      | 'flight.listed'
      | 'flight.closed'
      | 'ao.created'
      | 'ao.updated'
      | 'ao.closed'
      | 'cm.created'
      | 'cm.updated'
      | 'cm.deleted'
      | 'cas.checkedIn'
      | 'cas.checkedOut'
      | 'cas.hold.updated'
      | 'cas.hold.cancelled'
      | 'fm.updated'
      | 'fm.deleted'
      | 'log.entries'
      | `fm.${string}`
      | 'log.request';
  }
>;

export class Relay {
  readonly #core: RelayCore;
  readonly #flights: Flights;
  readonly #aos: Aos;
  readonly #entries: MapEntries;
  readonly #checkIns: CheckIns;
  readonly #holds: Holds;
  readonly #sessions: Sessions;
  readonly #status: StatusRouter;

  constructor(options: RelayOptions) {
    this.#core = new RelayCore(options);
    this.#flights = new Flights(this.#core);
    this.#aos = new Aos(this.#core);
    this.#entries = new MapEntries(this.#core, this.#aos);
    const parts = { aos: this.#aos, flights: this.#flights, entries: this.#entries };
    this.#checkIns = new CheckIns(this.#core, parts);
    this.#holds = new Holds(this.#core, { ...parts, checkIns: this.#checkIns });
    this.#sessions = new Sessions(this.#core, {
      ...parts,
      checkIns: this.#checkIns,
      holds: this.#holds,
    });
    this.#status = new StatusRouter(this.#core, {
      flights: this.#flights,
      checkIns: this.#checkIns,
    });
  }

  /** A new connection, before `hello`. */
  connect(link: RelayLink): RelayConnection {
    const now = this.#core.now();
    const conn: Conn = {
      link,
      state: 'new',
      member: null,
      tokens: RATE.burst,
      refilledAt: now,
      limitedAt: 0,
    };
    this.#core.conns.add(conn);
    return {
      receive: (text) => {
        this.#receive(conn, text);
      },
      alive: () => {
        if (conn.member) conn.member.lastSeen = this.#core.now();
      },
      closed: () => {
        this.#sessions.closed(conn);
      },
    };
  }

  /** Lost detection and token expiry; the transport calls it about once a second. */
  tick(): void {
    this.#sessions.tick();
  }

  /** Ends every connection with `session.closed` (`shutdown`). */
  shutdown(): void {
    for (const conn of [...this.#core.conns]) {
      if (conn.member) this.#core.closeWith(conn, 'shutdown');
      else conn.link.close();
    }
  }

  /** The session's mission time from the hosts' clock anchor (§1.4), or `null` without one. */
  missionTime(session: Coalition): number | null {
    return this.#core.missionTime(session);
  }

  /** Counts for logs and tests. */
  stats(): Record<Coalition, { online: number; lost: number; flights: number }> & {
    connections: number;
  } {
    const members = [...this.#core.members.values()];
    const count = (session: Coalition, presence: Member['presence']) =>
      members.filter((m) => m.session === session && m.presence === presence).length;
    const flights = (session: Coalition) =>
      this.#flights.all().filter((f) => f.session === session).length;
    return {
      blue: {
        online: count('blue', 'online'),
        lost: count('blue', 'lost'),
        flights: flights('blue'),
      },
      red: { online: count('red', 'online'), lost: count('red', 'lost'), flights: flights('red') },
      connections: this.#core.conns.size,
    };
  }

  // -------------------------------------------------------------------------
  // Inbound

  #receive(conn: Conn, text: string): void {
    if (conn.state === 'closed') return;
    const now = this.#core.now();
    if (conn.member) conn.member.lastSeen = now;
    if (!this.#allow(conn, now)) return;

    const parsed = parseMessageText(text);
    if (!parsed.ok) {
      this.#core.error(conn, parsed.code, parsed.detail, parsed.id);
      return;
    }
    const message = parsed.message;
    // Every host message may carry the sender's mission time (§1.4).
    if (conn.member) this.#core.anchor(conn.member.session, message.mt);

    if (conn.state === 'new') {
      if (message.type !== 'hello') {
        this.#core.error(conn, 'badMessage', 'Send hello first', message.id);
        return;
      }
      this.#sessions.hello(conn, message);
      return;
    }

    switch (message.type) {
      case 'hello':
        this.#core.error(conn, 'badMessage', 'Already said hello', message.id);
        return;
      case 'session.join':
        this.#sessions.join(conn, message);
        return;
      // Built in P2.3–P2.4; until then a host gets a clear answer.
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
        this.#core.error(
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
        this.#core.error(conn, 'forbidden', `Only the relay sends ${message.type}`, message.id);
        return;
      default: {
        const member = conn.member;
        if (!member) {
          this.#core.error(conn, 'notJoined', 'Join a session first', message.id);
          return;
        }
        // Level 1 (§1.2): a receipt for every `ack` message that was taken without an error.
        const errors = this.#core.errorCount;
        this.#core.handling(member, message, () => {
          this.#joined(conn, member, message);
        });
        if (message.ack && this.#core.errorCount === errors && conn.member === member) {
          this.#core.receipt(member, message.id, this.#core.sessions[member.session].seq);
        }
      }
    }
  }

  /** A message from a host that joined, by its part. */
  #joined(conn: Conn, member: Member, message: JoinedMessage): void {
    switch (message.type) {
      case 'session.switch':
        this.#sessions.switch(member, message);
        return;
      case 'session.update':
        this.#sessions.update(member, message);
        return;
      case 'session.leave':
        this.#sessions.leave(conn, member);
        return;
      case 'status.update':
        this.#status.route(member, message);
        return;
      case 'flight.create':
      case 'flight.join':
      case 'flight.leave':
      case 'flight.move':
      case 'flight.moveUp':
        this.#flights.command(member, message);
        return;
      case 'jtac.onStation':
        this.#aos.onStation(member, message);
        return;
      case 'jtac.offStation':
        this.#aos.offStation(member, message);
        return;
      case 'ao.update':
        this.#aos.update(member, message);
        return;
      case 'cm.create':
        this.#entries.create(member, message);
        return;
      case 'cm.update':
        this.#entries.update(member, message);
        return;
      case 'cm.delete':
        this.#entries.delete(member, message);
        return;
      case 'cas.checkIn':
        this.#checkIns.checkIn(member, message);
        return;
      case 'cas.checkOut':
        this.#checkIns.checkOut(member, message);
        return;
      case 'cas.release':
        this.#checkIns.release(member, message);
        return;
      case 'cas.sitUpdate':
        this.#checkIns.sitUpdate(member, message);
        return;
      case 'cas.sitCopy':
        this.#checkIns.sitCopy(member, message);
        return;
      case 'fuel.call':
        this.#checkIns.fuelCall(member, message);
        return;
      case 'cas.hold.assign':
        this.#holds.assign(member, message);
        return;
      case 'cas.hold.update':
        this.#holds.update(member, message);
        return;
      case 'cas.hold.cancel':
        this.#holds.cancel(member, message);
        return;
      case 'cas.hold.wilco':
        this.#holds.wilco(member, message);
        return;
      case 'msg.received':
        this.#received(member, message);
        return;
      default:
        // Every message type is handled; a new one fails to compile here.
        this.#core.error(
          conn,
          'unsupported',
          `Unknown message ${message satisfies never as string}`,
          null,
        );
    }
  }

  /**
   * Level 2 (§1.2): a recipient's app got a message. It names the message it
   * received; the relay passes it on to whoever sent the command behind it.
   */
  #received(member: Member, message: Extract<Message, { type: 'msg.received' }>): void {
    const core = this.#core;
    const target = message.re === null ? null : core.confirmation(message.re);
    if (!target || target.sender === member.pid) return;
    const sender = core.members.get(target.sender);
    if (sender?.session !== member.session || sender.presence === 'left') return;
    core.publish(
      core.sessions[member.session],
      {
        type: 'msg.received',
        from: member.pid,
        session: member.session,
        to: { scope: 'pid', id: sender.pid },
        body: {},
        re: target.command,
      },
      [sender],
      true,
    );
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
      this.#core.error(conn, 'rateLimited', 'Too many messages', null);
    }
    return false;
  }
}
