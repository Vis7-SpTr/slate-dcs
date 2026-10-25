// SPDX-License-Identifier: GPL-3.0-or-later
// Test support: in-memory hosts talking to a Relay core. Every frame the relay
// sends is checked against the shared schemas.

import { parseMessageText, PROTOCOL_VERSION, ulid } from '@slate-dcs/shared';
import type { Message, StatusUpdate } from '@slate-dcs/shared';

import type { RelayCodes } from './codes.js';
import type { CasLogSink } from './core.js';
import { Relay } from './relay.js';
import type { RelayConnection } from './relay.js';

export const CODES: RelayCodes = {
  blue: 'BLUE-7K3Q9XPM',
  red: 'RED-4D2AQX7M',
  group: 'SLATE-H81C5R2N',
};

/** A fake clock the relay and the test share. */
export class Clock {
  now = 1_792_600_000_000;
  advance(ms: number): void {
    this.now += ms;
  }
}

export function makeRelay(clock: Clock, replayLimit?: number, casLog?: CasLogSink): Relay {
  return new Relay({
    codes: CODES,
    name: 'slate-relay test',
    now: () => clock.now,
    ...(replayLimit === undefined ? {} : { replayLimit }),
    ...(casLog === undefined ? {} : { casLog }),
  });
}

type Body<T extends Message['type']> = Extract<Message, { type: T }>['body'];

/** One host: connects, sends envelopes, collects (validated) frames. */
export class FakeHost {
  readonly frames: Message[] = [];
  closed = false;
  pid = '';
  token: string | null = null;
  lastSeq: number | null = null;
  readonly #relay: Relay;
  #conn: RelayConnection;

  constructor(relay: Relay) {
    this.#relay = relay;
    this.#conn = this.#open();
  }

  #open(): RelayConnection {
    this.closed = false;
    const conn = this.#relay.connect({
      send: (text) => {
        const parsed = parseMessageText(text);
        if (!parsed.ok) throw new Error(`Relay sent an invalid frame: ${parsed.detail}\n${text}`);
        const message = parsed.message;
        this.frames.push(message);
        if (message.seq !== undefined) this.lastSeq = Math.max(this.lastSeq ?? 0, message.seq);
        if (message.type === 'session.joined') {
          this.pid = message.body.pid;
          this.token = message.body.token;
        }
        if (message.type === 'session.state') {
          this.lastSeq = Math.max(this.lastSeq ?? 0, message.body.asOfSeq);
        }
      },
      close: () => {
        if (this.closed) return;
        this.closed = true;
        conn.closed();
      },
    });
    return conn;
  }

  /** Drops the connection (as a crash or network loss would) and opens a new one. */
  reconnect(): void {
    this.drop();
    this.#conn = this.#open();
  }

  /** The connection goes away without a goodbye. */
  drop(): void {
    if (!this.closed) {
      this.closed = true;
      this.#conn.closed();
    }
  }

  alive(): void {
    this.#conn.alive();
  }

  raw(text: string): void {
    this.#conn.receive(text);
  }

  send<T extends Message['type']>(
    type: T,
    body: Body<T>,
    extra: { ack?: boolean; mt?: number | null } = {},
  ): string {
    const id = ulid();
    this.raw(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id,
        type,
        from: this.pid,
        session: '',
        to: { scope: 'relay' },
        ts: Date.now(),
        ack: extra.ack ?? false,
        re: null,
        ...(extra.mt === undefined ? {} : { mt: extra.mt }),
        body,
      }),
    );
    return id;
  }

  hello(protocols: number[] = [PROTOCOL_VERSION]): void {
    this.send('hello', { protocols, app: 'slate-host test', features: [] });
  }

  join(nick: string, options: Partial<Body<'session.join'>> & { code?: string } = {}): void {
    this.send('session.join', {
      code: CODES.blue,
      coalition: null,
      token: this.token,
      lastSeq: this.lastSeq,
      nick,
      role: 'pilot',
      aircraft: { type: 'FA-18C_hornet', unit: `${nick} 1-1` },
      source: 'manual',
      ...options,
    });
  }

  status(lat: number, lon: number, extra: Partial<StatusUpdate['body']> = {}): void {
    this.send('status.update', {
      pos: { lat, lon, altMsl: 3000, altAgl: 2800 },
      hdg: 90,
      hdgMag: 84,
      gs: 180,
      ias: 160,
      fuel: null,
      armament: null,
      avail: { pos: true, fuel: false, payload: false },
      reason: 'heartbeat',
      ...extra,
    });
  }

  of<T extends Message['type']>(type: T): Extract<Message, { type: T }>[] {
    return this.frames.filter((f): f is Extract<Message, { type: T }> => f.type === type);
  }

  last<T extends Message['type']>(type: T): Extract<Message, { type: T }> | undefined {
    return this.of(type).at(-1);
  }

  clear(): void {
    this.frames.length = 0;
  }
}
