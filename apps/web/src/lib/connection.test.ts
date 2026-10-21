// SPDX-License-Identifier: GPL-3.0-or-later

import { defaultSlices } from '@slate-dcs/shared';
import type { Command } from '@slate-dcs/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { HostConnection } from './connection.js';
import type { SocketLike } from './connection.js';

class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

/** Timers that only run when the test says so. */
class FakeTimers {
  now = 0;
  #next = 1;
  readonly #timers = new Map<number, { at: number; callback: () => void }>();

  set = (callback: () => void, ms: number): number => {
    const id = this.#next++;
    this.#timers.set(id, { at: this.now + ms, callback });
    return id;
  };
  clear = (handle: unknown): void => {
    this.#timers.delete(handle as number);
  };
  advance(ms: number): void {
    this.now += ms;
    for (const [id, timer] of [...this.#timers]) {
      if (timer.at <= this.now) {
        this.#timers.delete(id);
        timer.callback();
      }
    }
  }
  get delays(): number[] {
    return [...this.#timers.values()].map((timer) => timer.at - this.now);
  }
}

const BUILD = '0.1.0-test';
const slices = defaultSlices(BUILD);
const snapshot = (seq = 0) => ({ t: 'state.snapshot', seq, body: { build: BUILD, slices } });
const setLocal: Command = { cmd: 'settings.set', args: { timeDisplay: 'local' } };
const localSettings = { timeDisplay: 'local', uiScale: 1 };

let sockets: FakeSocket[];
let timers: FakeTimers;
let builds: string[];
let ids: number;

function connection(): HostConnection {
  return new HostConnection({
    url: 'ws://127.0.0.1:7792/ws',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    setTimer: timers.set,
    clearTimer: timers.clear,
    onHostBuild: (build) => builds.push(build),
    newId: () => `01JABD2K7Q0M3N4P5R6S7T${String(ids++).padStart(4, '0')}`,
  });
}

/** The socket opened last; fails the test if there is none. */
function lastSocket(): FakeSocket {
  const socket = sockets.at(-1);
  if (!socket) throw new Error('No socket was opened');
  return socket;
}

/** Starts a connection and brings it to "connected with snapshot". */
function connected(): { conn: HostConnection; socket: FakeSocket } {
  const conn = connection();
  conn.start();
  const socket = lastSocket();
  socket.open();
  socket.receive(snapshot());
  return { conn, socket };
}

beforeEach(() => {
  sockets = [];
  timers = new FakeTimers();
  builds = [];
  ids = 0;
});

describe('HostConnection – state', () => {
  it('starts as connecting without state', () => {
    const conn = connection();
    conn.start();
    expect(conn.view).toMatchObject({ link: 'connecting', slices: null });
  });

  it('takes the snapshot and reports the host build', () => {
    const { conn } = connected();
    expect(conn.view).toMatchObject({ link: 'connected', seq: 0, hostBuild: BUILD, slices });
    expect(builds).toEqual([BUILD]);
  });

  it('applies the next update and replaces only its slices', () => {
    const { conn, socket } = connected();
    socket.receive({ t: 'state.update', seq: 1, body: { slices: { settings: localSettings } } });
    expect(conn.view.seq).toBe(1);
    expect(conn.view.slices?.settings).toEqual(localSettings);
    expect(conn.view.slices?.host).toEqual(slices.host);
  });

  it('ignores an old update', () => {
    const { conn, socket } = connected();
    socket.receive({ t: 'state.update', seq: 1, body: { slices: { settings: localSettings } } });
    socket.receive({ t: 'state.update', seq: 1, body: { slices: { settings: slices.settings } } });
    expect(conn.view.slices?.settings).toEqual(localSettings);
  });

  it('asks for a snapshot on a gap and ignores updates until it arrives', () => {
    const { conn, socket } = connected();
    socket.receive({ t: 'state.update', seq: 3, body: { slices: { settings: localSettings } } });
    expect(socket.sent).toEqual([{ t: 'state.resync', body: {} }]);
    socket.receive({ t: 'state.update', seq: 4, body: { slices: { settings: localSettings } } });
    expect(conn.view.seq).toBe(0);
    socket.receive(snapshot(4));
    expect(conn.view.seq).toBe(4);
  });

  it('ignores frames it cannot read', () => {
    const { conn, socket } = connected();
    socket.onmessage?.({ data: '{nope' });
    socket.receive({ t: 'state.update', seq: 1, body: { slices: {} } });
    expect(conn.view.seq).toBe(0);
  });

  it('tells subscribers about every change', () => {
    const conn = connection();
    const links: string[] = [];
    conn.subscribe((view) => links.push(view.link));
    conn.start();
    sockets[0]?.open();
    expect(links).toEqual(['connecting', 'connecting', 'connected']);
  });
});

describe('HostConnection – reconnect (protocol.md §14.5)', () => {
  it('reconnects with 0.5, 1, 2, 4, 5, 5 s backoff', () => {
    const conn = connection();
    conn.start();
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      sockets.at(-1)?.drop();
      delays.push(...timers.delays);
      timers.advance(timers.delays[0] ?? 0);
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
    expect(conn.view.link).toBe('connecting');
  });

  it('starts the backoff again after a successful connection', () => {
    const { socket } = connected();
    socket.drop();
    timers.advance(500);
    sockets.at(-1)?.drop();
    expect(timers.delays).toEqual([1000]);
    timers.advance(1000);
    sockets.at(-1)?.open();
    sockets.at(-1)?.drop();
    expect(timers.delays).toEqual([500]);
  });

  it('reconnects at once when the page becomes visible again', () => {
    const { conn, socket } = connected();
    socket.drop();
    expect(sockets).toHaveLength(1);
    conn.wake();
    expect(sockets).toHaveLength(2);
    expect(timers.delays).toEqual([]); // the scheduled reconnect was cancelled
  });

  it('does nothing on wake while connected', () => {
    const { conn } = connected();
    conn.wake();
    expect(sockets).toHaveLength(1);
  });

  it('does not reconnect after stop', () => {
    const { conn } = connected();
    conn.stop();
    expect(timers.delays).toEqual([]);
  });
});

describe('HostConnection – commands', () => {
  it('sends a command with a new ID and keeps it pending', () => {
    const { conn, socket } = connected();
    const id = conn.send(setLocal);
    expect(socket.sent).toEqual([{ t: 'cmd', id, body: setLocal }]);
    expect(conn.view.pending).toEqual([{ id, command: setLocal, state: 'pending' }]);
  });

  it('clears a command when its result arrives', () => {
    const { conn, socket } = connected();
    const id = conn.send(setLocal);
    socket.receive({ t: 'cmd.result', id, body: { ok: true } });
    expect(conn.view.pending).toEqual([]);
    expect(conn.view.lastFailure).toBeNull();
  });

  it('keeps the last failure for the UI', () => {
    const { conn, socket } = connected();
    const id = conn.send(setLocal);
    const error = { code: 'notConnected', text: 'No relay' };
    socket.receive({ t: 'cmd.result', id, body: { ok: false, error } });
    expect(conn.view.lastFailure).toEqual({ id, command: setLocal, error });
    conn.dismissFailure();
    expect(conn.view.lastFailure).toBeNull();
  });

  it('marks a command noAnswer after 5 s and retries it with the same ID', () => {
    const { conn, socket } = connected();
    const id = conn.send(setLocal);
    timers.advance(5000);
    expect(conn.view.pending[0]?.state).toBe('noAnswer');
    conn.retry(id);
    expect(conn.view.pending[0]?.state).toBe('pending');
    expect(socket.sent).toEqual([
      { t: 'cmd', id, body: setLocal },
      { t: 'cmd', id, body: setLocal },
    ]);
  });

  it('re-sends pending commands with their IDs after a reconnect', () => {
    const { conn, socket } = connected();
    const id = conn.send(setLocal);
    socket.drop();
    timers.advance(500);
    const again = lastSocket();
    again.open();
    expect(again.sent).toEqual([]);
    again.receive(snapshot(1));
    expect(again.sent).toEqual([{ t: 'cmd', id, body: setLocal }]);
    expect(conn.view.pending).toHaveLength(1);
  });

  it('holds a command sent while disconnected until the next snapshot', () => {
    const { conn, socket } = connected();
    socket.drop();
    const id = conn.send(setLocal);
    timers.advance(500);
    const again = lastSocket();
    again.open();
    again.receive(snapshot());
    expect(again.sent).toEqual([{ t: 'cmd', id, body: setLocal }]);
  });

  it('ignores a result for a command it does not know', () => {
    const { conn, socket } = connected();
    socket.receive({ t: 'cmd.result', id: '01JABD2K7Q0M3N4P5R6S7T9999', body: { ok: true } });
    expect(conn.view.pending).toEqual([]);
  });
});
