// SPDX-License-Identifier: GPL-3.0-or-later
// The host's relay client (protocol.md §3–§7, §14): joins a session, keeps the
// `session`, `flight` and `traffic` slices up to date from what the relay
// sends, sends the own status package by the interval rule (§6.3) and the own
// slot changes (`session.update`, §5), runs the relay commands of the screens
// and rejoins with its token when the link drops. A join from the server's
// announcement (discovery, §2) tries the LAN address first, then the public
// one, and follows a coalition change with `session.switch` (§5).
//
// CAS (P2.5): every CAS message goes into the `cas`, `missions` and
// `fuelCalls` slices (cas-state.ts); CAS commands go out with `ack: true`
// and their ticks are kept (§1.2); received `ack` messages are confirmed with
// `msg.received`. Every message carries the mission time `mt` (§1.4). The
// check-in brief draft, JOKER/BINGO and the CAS log copy live in brief.ts,
// fuel-calls.ts and cas-log-copy.ts.

import {
  parseMessageText,
  PROTOCOL_VERSION,
  statusSendReason,
  UI_TIMING,
  ulid,
  weaponsCount,
} from '@slate-dcs/shared';
import type {
  AircraftInfo,
  Address,
  CasCommandName,
  Coalition,
  Command,
  Flight,
  Message,
  SessionSlice,
  StatusSample,
  TrafficSlice,
} from '@slate-dcs/shared';

import { failed } from '../commands/dispatcher.js';
import type { CommandOutcome } from '../commands/dispatcher.js';
import type { Relay } from '../cas-relay/relay.js';
import type { StateStore } from '../state/store.js';
import { BriefDraft } from './brief.js';
import { CasLogCopy } from './cas-log-copy.js';
import type { LogScope } from './cas-log-copy.js';
import { CasState } from './cas-state.js';
import type { Me } from './cas-state.js';
import { FuelCalls } from './fuel-calls.js';
import { dialLocal, dialWss, FingerprintError, normalizeAddress } from './link.js';
import type { ClientLink, LinkEvents } from './link.js';
import type { TokenStore } from './tokens.js';

export interface ClientLog {
  info(message: string): void;
  warn(message: string): void;
}

export interface RelayClientOptions {
  store: StateStore;
  tokens: TokenStore;
  log: ClientLog;
  /** App name for `hello`, e.g. `slate-host 0.1.0`. */
  app: string;
  now?: () => number;
  /** Replaceable for tests. */
  dial?: typeof dialWss;
}

type JoinArgs = Extract<Command, { cmd: 'session.join' }>['args'];
type FlightCommand = Extract<
  Command,
  { cmd: 'flight.create' | 'flight.join' | 'flight.leave' | 'flight.move' | 'flight.moveUp' }
>;
export type CasCommand = Extract<Command, { cmd: CasCommandName }>;

/** DCS slots that make a player a JTAC (§5: joining one leaves the flight). */
const JTAC_SLOTS = new Set(['forward_observer', 'artillery_commander', 'observer']);

/**
 * The role rule (§5, from P2): the slot decides while there is one – a JTAC
 * slot makes a JTAC, any other slot a pilot; the role picked at the join
 * applies only without a slot.
 */
export function roleFor(aircraft: AircraftInfo | null, joined: string): string {
  if (!aircraft) return joined;
  return JTAC_SLOTS.has(aircraft.type) ? 'jtac' : 'pilot';
}

/** `msg.received` sent per tick at most – a long replay mustn't hit the rate limit (§1.3). */
const RECEIPTS_PER_TICK = 5;

/** Reconnect delays after the link drops, then the last one again. */
const RECONNECT_MS = [1000, 2000, 5000, 10_000, 20_000, 30_000];

/** A join started by the host from the server's announcement (P1.7). */
export interface DiscoveryTarget {
  /** Tried in this order: the LAN address first, then the public one. */
  addresses: string[];
  /** Token and fingerprint are kept under this one address (the public one, if any). */
  key: string;
}

interface Target {
  join: JoinArgs;
  /** Dial candidates, in order (one for a manual join). */
  addresses: string[];
  /** Address the token and fingerprint are stored under. */
  key: string;
  local: Relay | null;
  source: 'manual' | 'discovery';
}

interface Joined {
  link: ClientLink;
  address: string;
  own: boolean;
  pid: string;
  coalition: Coalition;
  join: JoinArgs;
  /** Last aircraft sent in `session.join` / `session.update`. */
  aircraft: AircraftInfo | null;
  role: string;
}

interface Pending {
  resolve: (outcome: CommandOutcome, reply: Message | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RelayClient {
  readonly #store: StateStore;
  readonly #tokens: TokenStore;
  readonly #log: ClientLog;
  readonly #app: string;
  readonly #now: () => number;
  readonly #dial: typeof dialWss;
  #joined: Joined | null = null;
  /** The session being kept: set from join until leave, so a drop rejoins. */
  #target: Target | null = null;
  /** Relay key of a discovery session the user left on purpose (no auto-join back). */
  #declined: string | null = null;
  #lastSeq: number | null = null;
  #pending = new Map<string, Pending>();
  #lastSent: { sample: StatusSample; at: number } | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;
  /** Bumped on every join/leave, so an old link's events are ignored. */
  #epoch = 0;
  readonly #cas: CasState;
  readonly #brief: BriefDraft;
  readonly #fuel: FuelCalls;
  readonly #logCopy: CasLogCopy;
  /** `msg.received` waiting to go out (§1.2). */
  #receipts: string[] = [];
  /** IDs of recent own `ack` messages: their echoes need no `msg.received`. */
  readonly #ownAck = new Set<string>();

  constructor(options: RelayClientOptions) {
    this.#store = options.store;
    this.#tokens = options.tokens;
    this.#log = options.log;
    this.#app = options.app;
    this.#now = options.now ?? Date.now;
    this.#dial = options.dial ?? dialWss;
    this.#cas = new CasState(this.#store, this.#now);
    this.#brief = new BriefDraft(this.#store);
    this.#fuel = new FuelCalls(this.#store, this.#now);
    this.#logCopy = new CasLogCopy(this.#store, (body) => this.#logRequest(body));
  }

  /** `true` while joined to the relay running in this host. */
  get onOwnRelay(): boolean {
    return this.#joined?.own ?? false;
  }

  /** The session being kept (joined, joining or rejoining), for discovery. */
  get target(): { key: string; source: 'manual' | 'discovery'; code: string } | null {
    const t = this.#target;
    return t ? { key: t.key, source: t.source, code: t.join.code } : null;
  }

  /** Relay key of a discovery session the user left on purpose, if any. */
  get declined(): string | null {
    return this.#declined;
  }

  /**
   * `session.join` from a screen (§14.7), or from discovery with `discovery`
   * set. `local` = this host's own relay (host mode): joined directly, no
   * fingerprint needed.
   */
  async join(
    args: JoinArgs,
    local: Relay | null,
    discovery: DiscoveryTarget | null = null,
  ): Promise<CommandOutcome> {
    if (this.#target) await this.leave();
    this.#declined = null;
    const addresses = discovery
      ? discovery.addresses.map(normalizeAddress)
      : [normalizeAddress(args.address)];
    const key = discovery ? normalizeAddress(discovery.key) : (addresses[0] ?? '');
    this.#target = {
      join: args,
      addresses,
      key,
      local,
      source: discovery ? 'discovery' : 'manual',
    };
    this.#attempt = 0;
    this.#setSession({
      state: 'connecting',
      relay: { address: addresses[0] ?? key, name: null, own: local !== null },
    });
    return this.#connect(true);
  }

  /**
   * Moves to another coalition's session on the same relay (§5), after a
   * re-announce with the other code. While rejoining, the next join uses it.
   */
  async switchTo(code: string): Promise<CommandOutcome> {
    const target = this.#target;
    if (!target) return failed('notConnected', 'Not in a session');
    if (target.join.code === code) return { ok: true };
    const joined = this.#joined;
    if (!joined) {
      target.join = { ...target.join, code, coalition: null };
      return { ok: true };
    }
    const outcome = await this.#request(joined, 'session.switch', { code });
    if (outcome.ok && this.#target === target) {
      target.join = { ...target.join, code, coalition: null };
      joined.join = target.join;
    }
    return outcome;
  }

  /** `session.leave` (§5): deliberate exit; the token is kept for later. */
  leave(): Promise<CommandOutcome> {
    clearTimeout(this.#reconnectTimer);
    this.#epoch += 1;
    const joined = this.#joined;
    if (this.#target?.source === 'discovery') this.#declined = this.#target.key;
    this.#joined = null;
    this.#target = null;
    this.#lastSeq = null;
    if (joined) {
      joined.link.send(this.#frame('session.leave', {}, joined, { scope: 'relay' }));
      joined.link.close();
      this.#log.info(`Left the session on ${joined.address}`);
    }
    this.#failPending('notConnected', 'Left the session');
    this.#reset();
    this.#setSession({ fingerprintCheck: null, error: null });
    return Promise.resolve({ ok: true });
  }

  /** A flight command (§7.2): sent to the relay, answered when it replies. */
  flight(command: FlightCommand): Promise<CommandOutcome> {
    const joined = this.#joined;
    if (!joined) return Promise.resolve(failed('notConnected', 'Not in a session'));
    return this.#request(joined, command.cmd, command.args);
  }

  /**
   * Once a second: the status package by the interval rule (§6.3) and a
   * `session.update` when the own slot changed (§5).
   */
  tick(): void {
    this.#fuel.tick();
    const joined = this.#joined;
    if (!joined) return;
    this.#brief.refresh();
    for (const re of this.#receipts.splice(0, RECEIPTS_PER_TICK)) {
      joined.link.send(this.#frame('msg.received', {}, joined, { scope: 'relay' }, { re }));
    }
    const ownship = this.#store.get('ownship');

    const aircraft = ownship.aircraft;
    const role = roleFor(aircraft, joined.join.role);
    if (JSON.stringify(aircraft) !== JSON.stringify(joined.aircraft) || role !== joined.role) {
      joined.aircraft = aircraft;
      joined.role = role;
      joined.link.send(
        this.#frame('session.update', { nick: joined.join.nick, role, aircraft }, joined, {
          scope: 'relay',
        }),
      );
      this.#setSession({ role });
    }

    const status = ownship.status;
    if (!status) return;
    const sample: StatusSample = {
      hdg: status.hdg,
      altMsl: status.pos?.altMsl ?? null,
      gs: status.gs,
      weaponsCount: weaponsCount(status.armament),
    };
    const now = this.#now();
    const since = this.#lastSent ? (now - this.#lastSent.at) / 1000 : Infinity;
    const reason = statusSendReason(this.#lastSent?.sample ?? null, sample, since);
    if (reason === null) return;
    this.#lastSent = { sample, at: now };
    joined.link.send(
      this.#frame('status.update', { ...status, reason }, joined, { scope: 'session' }),
    );
  }

  /** Ends the link without leaving (host shutdown): the relay keeps our place. */
  close(): void {
    clearTimeout(this.#reconnectTimer);
    this.#logCopy.stop();
    this.#epoch += 1;
    this.#joined?.link.close();
    this.#joined = null;
    this.#target = null;
  }

  // -------------------------------------------------------------------------
  // CAS (P2.5)

  /**
   * A CAS command of a screen (§14.7). The brief draft and the fuel levels are
   * host only; the rest goes to the relay with `ack: true`, its ticks kept in
   * `cas.deliveries`, and answers once the relay has (its reply or receipt).
   */
  async cas(command: CasCommand): Promise<CommandOutcome> {
    switch (command.cmd) {
      case 'cas.setBrief': {
        const result = this.#brief.set(command.args.changes, command.args.reset);
        return result.ok ? { ok: true } : failed('badCommand', result.text);
      }
      case 'fuel.setLevels':
        this.#fuel.setLevels(command.args.jokerKg, command.args.bingoKg);
        return { ok: true };
      case 'fuel.dismiss':
        this.#fuel.dismiss();
        return { ok: true };
      default:
        break;
    }
    const joined = this.#joined;
    if (!joined) return failed('notConnected', 'Not in a session');
    switch (command.cmd) {
      case 'cas.checkIn': {
        // Live fields refreshed now (§9.1); to one JTAC or one AO (§9.2).
        const brief = this.#brief.forSending();
        if (!brief) return failed('notPossible', 'Join a flight first');
        return (await this.#casSend(joined, 'cas.checkIn', { brief }, command.args.target)).outcome;
      }
      case 'cas.sitUpdate': {
        const { aoId, flightId, update } = command.args;
        const to: Address =
          flightId === null ? { scope: 'ao', id: aoId } : { scope: 'flight', id: flightId };
        const sent = await this.#casSend(joined, 'cas.sitUpdate', { aoId, update }, to);
        // The relay doesn't echo it to the sender: his own note.
        if (sent.outcome.ok) {
          this.#cas.note({
            id: sent.id,
            aoId,
            flightId,
            from: joined.pid,
            update,
            receivedAt: this.#now(),
            copied: false,
          });
        }
        return sent.outcome;
      }
      case 'cas.sitCopy': {
        const note = this.#store.get('cas').sitUpdates.find((n) => n.id === command.args.id);
        if (!note) return failed('notPossible', 'No such situation update');
        const sent = await this.#casSend(
          joined,
          'cas.sitCopy',
          {},
          { scope: 'pid', id: note.from },
          note.id,
        );
        if (sent.outcome.ok) this.#cas.copied(note.id);
        return sent.outcome;
      }
      case 'fuel.call': {
        // Never automatic (§6.5): the pilot pressed it; the host adds his internal fuel.
        const internalKg = this.#fuel.internalKg();
        if (internalKg === null) {
          return failed('notPossible', 'No fuel reading yet – enter it on Ownship → Aircraft');
        }
        const flightId = this.#store.get('flight').own?.flightId;
        const to: Address = flightId ? { scope: 'flight', id: flightId } : { scope: 'relay' };
        const sent = await this.#casSend(
          joined,
          'fuel.call',
          { call: command.args.call, internalKg },
          to,
        );
        if (sent.outcome.ok) this.#fuel.sent(command.args.call);
        return sent.outcome;
      }
      case 'log.request': {
        const result = await this.#logCopy.fetch(command.args);
        return typeof result === 'string' ? failed('relayError', result) : { ok: true };
      }
      default:
        // jtac.*, ao.update, cm.*, cas.checkOut, cas.release, cas.hold.*, fm.* – unchanged.
        return (await this.#casSend(joined, command.cmd, command.args, { scope: 'relay' })).outcome;
    }
  }

  /** A CAS message with `ack: true`; its ticks start in `cas.deliveries` (§1.2). */
  #casSend(
    joined: Joined,
    type: string,
    body: unknown,
    to: Address,
    re: string | null = null,
  ): Promise<{ outcome: CommandOutcome; reply: Message | null; id: string }> {
    const id = ulid(this.#now());
    this.#cas.sent(id);
    return this.#send(joined, type, body, to, { ack: true, re, id });
  }

  /** One `log.request` page for the CAS log copy. */
  async #logRequest(
    body: Extract<Message, { type: 'log.request' }>['body'],
  ): Promise<Extract<Message, { type: 'log.entries' }>['body'] | string> {
    const joined = this.#joined;
    if (!joined) return 'Not in a session';
    const { outcome, reply } = await this.#send(joined, 'log.request', body, { scope: 'relay' });
    if (!outcome.ok) return outcome.error.text;
    return reply?.type === 'log.entries' ? reply.body : 'No log entries in the answer';
  }

  #me(): Me | null {
    const joined = this.#joined;
    return joined ? { pid: joined.pid, role: joined.role } : null;
  }

  /** Whose log this player may keep (§12.3): a JTAC his AO, a pilot his flight. */
  #logScope(): LogScope | null {
    const me = this.#me();
    if (!me) return null;
    if (me.role === 'jtac') {
      const ao = this.#cas.myAo(me);
      return ao ? { scope: 'ao', id: ao.aoId } : null;
    }
    const flightId = this.#store.get('flight').own?.flightId;
    return flightId ? { scope: 'flight', id: flightId } : null;
  }

  /** `Enfield 1-2` for a flight mate, a JTAC's callsign, else the nick. */
  #callsign(pid: string): string {
    const own = this.#store.get('flight').own;
    const member = own?.members.find((m) => m.pid === pid);
    if (own && member) return `${own.display}-${String(member.pos)}`;
    for (const ao of this.#store.get('cas').aos) {
      const jtac = ao.jtacs.find((j) => j.pid === pid);
      if (jtac) return jtac.callsign;
    }
    return this.#store.get('session').participants.find((p) => p.pid === pid)?.nick ?? pid;
  }

  // -------------------------------------------------------------------------
  // Connecting

  async #connect(first: boolean): Promise<CommandOutcome> {
    const target = this.#target;
    if (!target) return failed('notConnected', 'Not joining');
    const epoch = ++this.#epoch;
    const { join, local, key, source } = target;
    const known = await this.#tokens.get(key);
    const accepted = join.fingerprint ?? known?.fingerprint ?? null;
    if (first && source === 'discovery' && known && known.fingerprint !== accepted) {
      this.#log.warn(
        `The server announces another fingerprint for ${key} (was ${known.fingerprint}, now ${String(accepted)}) – using the announced one`,
      );
    }
    /** The fingerprint the relay showed (set during the TLS handshake). */
    const seen: { fp: string | null } = { fp: null };
    const events: LinkEvents = {
      onText: (text) => {
        if (epoch === this.#epoch) this.#receive(text);
      },
      onClose: (reason) => {
        if (epoch === this.#epoch) this.#dropped(reason);
      },
    };
    this.#store.update({ host: { ...this.#store.get('host'), relay: { state: 'connecting' } } });

    let link: ClientLink | null = null;
    let address = target.addresses[0] ?? key;
    let error: unknown = null;
    const failures: string[] = [];
    for (const candidate of target.addresses) {
      address = candidate;
      try {
        link = local
          ? await dialLocal(local, events)
          : await this.#dial(
              candidate,
              (fp) => {
                seen.fp = fp;
                return fp === accepted;
              },
              events,
            );
        error = null;
        break;
      } catch (caught) {
        error = caught;
        if (epoch !== this.#epoch || caught instanceof FingerprintError) break;
        failures.push(`${candidate}: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    }
    if (link === null) {
      if (epoch !== this.#epoch) return failed('notConnected', 'Cancelled');
      if (error instanceof FingerprintError && source === 'discovery') {
        // The relay doesn't show what the server announced: never offered to accept.
        const text = `The relay at ${address} doesn't show the fingerprint the server announced – not joined`;
        this.#log.warn(text);
        return this.#joinFailed(first, text);
      }
      if (error instanceof FingerprintError) {
        // First manual connect, or a changed certificate: the user decides (§3.1).
        const changed = known?.fingerprint ?? null;
        this.#target = null;
        this.#setSession({
          state: 'confirmFingerprint',
          fingerprintCheck: { address, fingerprint: error.fingerprint, known: changed },
          error:
            changed !== null && changed !== error.fingerprint
              ? `The relay's fingerprint CHANGED – it was ${changed}. Only accept the new one if the relay owner confirms it.`
              : null,
        });
        this.#setRelayState('notConnected');
        return failed(
          'notPossible',
          changed === null ? 'Confirm the relay fingerprint' : 'The relay fingerprint changed',
        );
      }
      const text = failures.length > 0 ? `Can't reach ${failures.join('; ')}` : 'No address';
      if (first) {
        this.#target = null;
        this.#setSession({ state: 'notJoined', relay: null, error: text });
        this.#setRelayState('notConnected');
        return failed('relayError', text);
      }
      this.#scheduleReconnect(text);
      return failed('relayError', text);
    }

    // Handshake: hello → welcome, then session.join → session.joined (§3, §4).
    const hello = await this.#exchange(link, 'hello', {
      protocols: [PROTOCOL_VERSION],
      app: this.#app,
      features: [],
    });
    if (epoch !== this.#epoch) return failed('notConnected', 'Cancelled');
    if (hello?.type !== 'welcome') {
      link.close();
      const text =
        hello?.type === 'reject'
          ? `The relay speaks protocol ${hello.body.supported.join(', ')}, this SLATE ${String(PROTOCOL_VERSION)} – update SLATE`
          : 'No welcome from the relay';
      return this.#joinFailed(first, text);
    }
    this.#setSession({ relay: { address, name: hello.body.relay, own: local !== null } });

    const aircraft = this.#store.get('ownship').aircraft;
    const role = roleFor(aircraft, join.role);
    const answer = await this.#exchange(link, 'session.join', {
      code: join.code,
      coalition: join.coalition,
      token: known?.token ?? null,
      lastSeq: first ? null : this.#lastSeq,
      nick: join.nick,
      role,
      aircraft,
      source,
    });
    if (epoch !== this.#epoch) return failed('notConnected', 'Cancelled');
    if (answer?.type !== 'session.joined') {
      link.close();
      return this.#joinFailed(
        first,
        answer?.type === 'error' ? answer.body.text : 'No answer to the join',
      );
    }

    const body = answer.body;
    await this.#tokens.set(key, { fingerprint: seen.fp ?? accepted, token: body.token });
    this.#joined = {
      link,
      address,
      own: local !== null,
      pid: body.pid,
      coalition: body.coalition,
      join,
      aircraft,
      role,
    };
    this.#attempt = 0;
    this.#lastSent = null;
    this.#setRelayState('connected');
    this.#setSession({
      state: 'joined',
      pid: body.pid,
      coalition: body.coalition,
      nick: join.nick,
      role,
      fingerprintCheck: null,
      error: null,
    });
    this.#log.info(
      `${body.resumed ? 'Rejoined' : 'Joined'} the ${body.coalition} session on ${address} as ${body.pid}${source === 'discovery' ? ' (from the server announcement)' : ''}`,
    );
    // Frames that came right behind session.joined (state, catch-up).
    for (const text of this.#early.splice(0)) this.#receive(text);
    return { ok: true };
  }

  /** Frames received while the handshake waits; replayed once joined. */
  #early: string[] = [];
  #waiting: { type: string; id: string; resolve: (m: Message | null) => void } | null = null;

  /** Sends one handshake message and waits for the answer to it. */
  #exchange(link: ClientLink, type: string, body: unknown): Promise<Message | null> {
    const id = ulid(this.#now());
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#waiting = null;
        resolve(null);
      }, UI_TIMING.relayTimeoutSec * 1000);
      this.#waiting = {
        type,
        id,
        resolve: (message) => {
          clearTimeout(timer);
          this.#waiting = null;
          resolve(message);
        },
      };
      this.#early = [];
      link.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          id,
          type,
          from: '',
          session: '',
          to: { scope: 'relay' },
          ts: this.#now(),
          ack: false,
          re: null,
          body,
        }),
      );
    });
  }

  #joinFailed(first: boolean, text: string): CommandOutcome {
    if (first) {
      this.#target = null;
      this.#setSession({ state: 'notJoined', relay: null, error: text });
      this.#setRelayState('notConnected');
    } else {
      this.#scheduleReconnect(text);
    }
    return failed('relayError', text);
  }

  #dropped(reason: string): void {
    const joined = this.#joined;
    this.#joined = null;
    this.#failPending('relayError', `Relay link lost: ${reason}`);
    if (!this.#target) return;
    if (joined) this.#log.warn(`Relay link to ${joined.address} lost (${reason}) – rejoining`);
    this.#scheduleReconnect(reason);
  }

  #scheduleReconnect(reason: string): void {
    clearTimeout(this.#reconnectTimer);
    const delay = RECONNECT_MS[Math.min(this.#attempt, RECONNECT_MS.length - 1)] ?? 30_000;
    this.#attempt += 1;
    this.#setSession({ state: 'reconnecting', error: `Relay link lost: ${reason}` });
    this.#setRelayState('connecting');
    this.#reconnectTimer = setTimeout(() => {
      void this.#connect(false);
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Inbound

  #receive(text: string): void {
    const parsed = parseMessageText(text);
    if (!parsed.ok) {
      this.#log.warn(`Bad frame from the relay: ${parsed.detail}`);
      return;
    }
    const message = parsed.message;
    if (message.seq !== undefined) this.#lastSeq = Math.max(this.#lastSeq ?? 0, message.seq);

    if (message.re !== null && this.#waiting?.id === message.re) {
      this.#waiting.resolve(message);
      return;
    }
    if (!this.#joined) {
      // Behind session.joined: kept until the join is complete.
      this.#early.push(text);
      return;
    }
    if (message.re !== null) {
      const pending = this.#pending.get(message.re);
      if (pending) {
        this.#pending.delete(message.re);
        clearTimeout(pending.timer);
        pending.resolve(
          message.type === 'error' ? failed('relayError', message.body.text) : { ok: true },
          message,
        );
      }
    }
    // Level 2 (§1.2): this app got it – unless it is the echo of our own command.
    if (message.ack && message.from !== this.#joined.pid && !this.#ownAck.has(message.re ?? '')) {
      this.#receipts.push(message.id);
    }
    this.#apply(message);
  }

  /** Turns one relay message into slice changes. */
  #apply(message: Message): void {
    const joined = this.#joined;
    if (!joined) return;
    const now = this.#now();
    switch (message.type) {
      case 'session.joined': {
        // After a session.switch (§5): the new session's state follows.
        const { coalition } = message.body;
        if (coalition === joined.coalition) return;
        joined.coalition = coalition;
        this.#log.info(`Switched to the ${coalition} session on ${joined.address}`);
        this.#setSession({ coalition, participants: [] });
        this.#store.update({
          flight: { own: null, open: [], status: [] },
          traffic: { aircraft: [] },
        });
        this.#cas.clear();
        this.#logCopy.reset();
        return;
      }
      case 'session.state': {
        const body = message.body;
        this.#lastSeq = Math.max(this.#lastSeq ?? 0, body.asOfSeq);
        this.#setSession({ participants: body.participants });
        const own = body.you.flight;
        this.#store.update({
          flight: {
            own,
            open: body.flights.flatMap((f) =>
              'members' in f || f.flightId === own?.flightId ? [] : [f],
            ),
            status: [],
          },
          traffic: { aircraft: [] },
        });
        this.#cas.snapshot(body);
        this.#logCopy.changed(() => this.#logScope());
        return;
      }
      case 'session.presence': {
        const { pid, presence, nick, role } = message.body;
        const participants = this.#store.get('session').participants.filter((p) => p.pid !== pid);
        const before = this.#store.get('session').participants.find((p) => p.pid === pid);
        if (presence !== 'left') {
          participants.push({ pid, nick, role, aircraft: before?.aircraft ?? null, presence });
        } else {
          this.#store.update({
            traffic: { aircraft: this.#store.get('traffic').aircraft.filter((a) => a.pid !== pid) },
          });
        }
        this.#setSession({ participants });
        return;
      }
      case 'session.updated': {
        const { pid, nick, role, aircraft } = message.body;
        this.#setSession({
          participants: this.#store
            .get('session')
            .participants.map((p) => (p.pid === pid ? { ...p, nick, role, aircraft } : p)),
        });
        return;
      }
      case 'session.closed': {
        const reason = message.body.reason;
        this.#log.warn(`Relay closed the session: ${reason}`);
        if (reason === 'shutdown') return; // the link closes next → rejoin
        this.#epoch += 1;
        this.#joined = null;
        this.#target = null;
        this.#reset();
        this.#setSession({
          error:
            reason === 'replaced'
              ? 'Joined from another SLATE with the same token – this one was signed out'
              : `Signed out by the relay (${reason})`,
        });
        return;
      }
      case 'status.position': {
        this.#upsertTraffic({ ...message.body, receivedAt: now });
        return;
      }
      case 'status.update': {
        // A flight mate's full package (§6.4).
        const pid = message.from;
        const flight = this.#store.get('flight');
        const pos = flight.own?.members.find((m) => m.pid === pid)?.pos;
        const status = flight.status.filter((s) => s.pid !== pid);
        status.push({ pid, status: message.body, receivedAt: now });
        this.#store.update({ flight: { ...flight, status } });
        const body = message.body;
        if (body.pos && flight.own && pos !== undefined) {
          const type =
            this.#store.get('session').participants.find((p) => p.pid === pid)?.aircraft?.type ??
            'unknown';
          this.#upsertTraffic({
            pid,
            callsign: `${flight.own.display}-${String(pos)}`,
            type,
            pos: body.pos,
            hdg: body.hdg,
            gs: body.gs,
            receivedAt: now,
          });
        }
        return;
      }
      case 'flight.created':
      case 'flight.updated': {
        this.#setOwnFlight(message.body, joined.pid);
        return;
      }
      case 'flight.listed': {
        const flight = this.#store.get('flight');
        if (flight.own?.flightId === message.body.flightId) return;
        const open = flight.open.filter((f) => f.flightId !== message.body.flightId);
        open.push(message.body);
        this.#store.update({ flight: { ...flight, open } });
        return;
      }
      case 'flight.closed': {
        const flight = this.#store.get('flight');
        const mine = flight.own?.flightId === message.body.flightId;
        this.#store.update({
          flight: {
            own: mine ? null : flight.own,
            open: flight.open.filter((f) => f.flightId !== message.body.flightId),
            status: mine ? [] : flight.status,
          },
        });
        return;
      }
      case 'relay.receipt': {
        if (message.re !== null) this.#cas.receipt(message.re);
        return;
      }
      case 'msg.received': {
        if (message.re !== null) this.#cas.received(message.re, message.from);
        return;
      }
      default: {
        const me = this.#me();
        if (me && this.#cas.apply(message, me, (pid) => this.#callsign(pid))) {
          this.#logCopy.changed(() => this.#logScope());
        }
      }
    }
  }

  /** The own flight from `flight.created` / `flight.updated` – or none, if we're not in it. */
  #setOwnFlight(flight: Flight, pid: string): void {
    const slice = this.#store.get('flight');
    const member = flight.members.some((m) => m.pid === pid);
    const mates = new Set(flight.members.map((m) => m.pid));
    this.#store.update({
      flight: {
        own: member ? flight : null,
        open: slice.open.filter((f) => f.flightId !== flight.flightId),
        status: member ? slice.status.filter((s) => mates.has(s.pid)) : [],
      },
    });
  }

  #upsertTraffic(entry: TrafficSlice['aircraft'][number]): void {
    const aircraft = this.#store.get('traffic').aircraft.filter((a) => a.pid !== entry.pid);
    aircraft.push(entry);
    this.#store.update({ traffic: { aircraft } });
  }

  // -------------------------------------------------------------------------
  // Outbound

  /**
   * One envelope. Every message carries the mission time `mt` while a DCS
   * mission runs (§1.4) – the relay's clock for the CAS log and Type 3 windows.
   */
  #frame(
    type: string,
    body: unknown,
    joined: Joined,
    to: Address,
    extra: { ack?: boolean; re?: string | null; id?: string } = {},
  ): string {
    const mt = this.#missionTime();
    return JSON.stringify({
      v: PROTOCOL_VERSION,
      id: extra.id ?? ulid(this.#now()),
      type,
      from: joined.pid,
      session: joined.coalition,
      to,
      ts: this.#now(),
      ack: extra.ack ?? false,
      re: extra.re ?? null,
      ...(mt === null ? {} : { mt }),
      body,
    });
  }

  /** The DCS mission clock now (§0), or `null` without a running mission. */
  #missionTime(): number | null {
    const mission = this.#store.get('mission');
    const clock = mission.clock;
    if (!mission.running || clock === null) return null;
    const elapsed = clock.paused ? 0 : Math.max(0, this.#now() - clock.sampledAt) / 1000;
    return Math.round((clock.mtimeSec + elapsed) * 10) / 10;
  }

  /** Sends a relay command and resolves with its answer (`re`), or `relayTimeout`. */
  async #request(joined: Joined, type: string, body: unknown): Promise<CommandOutcome> {
    return (await this.#send(joined, type, body, { scope: 'relay' })).outcome;
  }

  /**
   * Sends a message and waits for the first answer that names it (`re`): the
   * relay's domain reply, its receipt for an `ack` message, or an error.
   */
  #send(
    joined: Joined,
    type: string,
    body: unknown,
    to: Address,
    extra: { ack?: boolean; re?: string | null; id?: string } = {},
  ): Promise<{ outcome: CommandOutcome; reply: Message | null; id: string }> {
    const id = extra.id ?? ulid(this.#now());
    const text = this.#frame(type, body, joined, to, { ...extra, id });
    if (extra.ack) {
      this.#ownAck.add(id);
      // Kept about as long as the relay keeps its side (§1.2).
      if (this.#ownAck.size > 500) {
        const oldest = this.#ownAck.values().next().value;
        if (oldest !== undefined) this.#ownAck.delete(oldest);
      }
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        resolve({ outcome: failed('relayTimeout', 'No answer from the relay'), reply: null, id });
      }, UI_TIMING.relayTimeoutSec * 1000);
      this.#pending.set(id, {
        resolve: (outcome, reply) => {
          resolve({ outcome, reply, id });
        },
        timer,
      });
      joined.link.send(text);
    });
  }

  #failPending(code: 'notConnected' | 'relayError', text: string): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.resolve(failed(code, text), null);
      this.#pending.delete(id);
    }
  }

  // -------------------------------------------------------------------------
  // Slices

  #setSession(change: Partial<SessionSlice>): void {
    this.#store.update({ session: { ...this.#store.get('session'), ...change } });
  }

  #setRelayState(state: 'notConnected' | 'connecting' | 'connected'): void {
    this.#store.update({ host: { ...this.#store.get('host'), relay: { state } } });
  }

  /** Back to "not in a session"; keeps an error or fingerprint check for the screens. */
  #reset(): void {
    const session = this.#store.get('session');
    this.#store.update({
      session: {
        state: 'notJoined',
        relay: null,
        pid: null,
        coalition: null,
        nick: null,
        role: null,
        participants: [],
        fingerprintCheck: session.fingerprintCheck,
        error: null,
        announced: session.announced,
      },
      flight: { own: null, open: [], status: [] },
      traffic: { aircraft: [] },
    });
    this.#cas.clear();
    this.#logCopy.reset();
    this.#receipts = [];
    this.#setRelayState('notConnected');
  }
}
