// SPDX-License-Identifier: GPL-3.0-or-later
// The screen's side of the host ↔ UI protocol (protocol.md §14): snapshot,
// updates, resync on gaps, reconnect with backoff, commands with IDs that are
// re-sent after a reconnect. Plain TypeScript, so it can be tested without a
// browser; host.svelte.ts connects it to the UI.

import {
  parseHostMessage,
  reconnectDelayMs,
  UI_TIMING,
  ulid,
  updateAction,
} from '@slate-dcs/shared';
import type { Command, HostToScreen, Slices, UiErrorCode } from '@slate-dcs/shared';

/** State of the link to the host. */
export type LinkState = 'connecting' | 'connected' | 'disconnected';

/** A command waiting for its `cmd.result`. */
export interface PendingCommand {
  readonly id: string;
  readonly command: Command;
  /** `noAnswer` after 5 s without a result; the screen offers a retry. */
  readonly state: 'pending' | 'noAnswer';
}

/** The last command the host refused. */
export interface CommandFailure {
  readonly id: string;
  readonly command: Command;
  readonly error: { code: UiErrorCode; text: string };
}

/** Everything the UI needs from the connection; a new object on every change. */
export interface ConnectionView {
  readonly link: LinkState;
  /** `null` until the first snapshot arrives. */
  readonly slices: Slices | null;
  readonly seq: number;
  readonly hostBuild: string | null;
  readonly pending: readonly PendingCommand[];
  readonly lastFailure: CommandFailure | null;
}

/** The parts of the browser WebSocket used here. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface ConnectionOptions {
  url: string;
  createSocket: (url: string) => SocketLike;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Called with the host's build version on every snapshot (§14.6). */
  onHostBuild?: (build: string) => void;
  newId?: () => string;
}

const OPEN = 1;

export class HostConnection {
  readonly #options: ConnectionOptions;
  readonly #listeners = new Set<(view: ConnectionView) => void>();
  readonly #pendingTimers = new Map<string, unknown>();
  #view: ConnectionView = {
    link: 'connecting',
    slices: null,
    seq: 0,
    hostBuild: null,
    pending: [],
    lastFailure: null,
  };
  #socket: SocketLike | null = null;
  #attempt = 0;
  #reconnectTimer: unknown = null;
  #waitingForSnapshot = true;
  #stopped = true;

  constructor(options: ConnectionOptions) {
    this.#options = options;
  }

  get view(): ConnectionView {
    return this.#view;
  }

  /** Calls `listener` now and on every change; returns an unsubscribe function. */
  subscribe(listener: (view: ConnectionView) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#view);
    return () => this.#listeners.delete(listener);
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    this.#cancelReconnect();
    const socket = this.#socket;
    this.#socket = null;
    socket?.close();
  }

  /** The page became visible again (iPad Safari, §14.5): reconnect at once. */
  wake(): void {
    if (this.#stopped || this.#view.link === 'connected') return;
    this.#cancelReconnect();
    this.#attempt = 0;
    this.#connect();
  }

  /** Sends a command; returns its ID. It stays pending until `cmd.result`. */
  send(command: Command): string {
    const id = (this.#options.newId ?? ulid)();
    this.#set({ pending: [...this.#view.pending, { id, command, state: 'pending' }] });
    this.#sendCommand(id, command);
    return id;
  }

  /** Re-sends a command that got no answer, with the same ID (§14.5). */
  retry(id: string): void {
    const entry = this.#view.pending.find((pending) => pending.id === id);
    if (!entry) return;
    this.#setPendingState(id, 'pending');
    this.#sendCommand(id, entry.command);
  }

  dismissFailure(): void {
    this.#set({ lastFailure: null });
  }

  // -------------------------------------------------------------------------

  #connect(): void {
    this.#set({ link: 'connecting' });
    this.#waitingForSnapshot = true;
    const socket = this.#options.createSocket(this.#options.url);
    this.#socket = socket;

    socket.onopen = () => {
      if (socket !== this.#socket) return;
      this.#attempt = 0;
      this.#set({ link: 'connected' });
    };
    socket.onclose = () => {
      if (socket !== this.#socket) return;
      this.#socket = null;
      this.#waitingForSnapshot = true;
      this.#set({ link: 'disconnected' });
      if (!this.#stopped) this.#scheduleReconnect();
    };
    socket.onmessage = (event) => {
      if (socket !== this.#socket || typeof event.data !== 'string') return;
      const parsed = parseHostMessage(event.data);
      if (parsed.ok) this.#handle(parsed.message);
    };
  }

  #handle(message: HostToScreen): void {
    switch (message.t) {
      case 'state.snapshot': {
        this.#waitingForSnapshot = false;
        this.#set({ slices: message.body.slices, seq: message.seq, hostBuild: message.body.build });
        this.#options.onHostBuild?.(message.body.build);
        // Re-send everything still pending, with the original IDs (§14.5).
        for (const entry of this.#view.pending) {
          this.#setPendingState(entry.id, 'pending');
          this.#sendCommand(entry.id, entry.command);
        }
        return;
      }
      case 'state.update': {
        if (this.#waitingForSnapshot || this.#view.slices === null) return;
        const action = updateAction(this.#view.seq, message.seq);
        if (action === 'apply') {
          this.#set({ slices: { ...this.#view.slices, ...message.body.slices }, seq: message.seq });
        } else if (action === 'resync') {
          this.#waitingForSnapshot = true;
          this.#socket?.send(JSON.stringify({ t: 'state.resync', body: {} }));
        }
        return;
      }
      case 'cmd.result': {
        const entry = this.#view.pending.find((pending) => pending.id === message.id);
        if (!entry) return;
        this.#clearPendingTimer(message.id);
        const pending = this.#view.pending.filter((other) => other.id !== message.id);
        const body = message.body;
        this.#set(
          body.ok
            ? { pending }
            : { pending, lastFailure: { id: entry.id, command: entry.command, error: body.error } },
        );
        return;
      }
    }
  }

  #sendCommand(id: string, command: Command): void {
    this.#clearPendingTimer(id);
    this.#pendingTimers.set(
      id,
      this.#options.setTimer(() => {
        this.#pendingTimers.delete(id);
        this.#setPendingState(id, 'noAnswer');
      }, UI_TIMING.pendingTimeoutSec * 1000),
    );
    if (this.#socket?.readyState === OPEN && !this.#waitingForSnapshot) {
      this.#socket.send(JSON.stringify({ t: 'cmd', id, body: command }));
    }
    // Otherwise it goes out with the next snapshot.
  }

  #setPendingState(id: string, state: PendingCommand['state']): void {
    this.#set({
      pending: this.#view.pending.map((entry) => (entry.id === id ? { ...entry, state } : entry)),
    });
  }

  #clearPendingTimer(id: string): void {
    const timer = this.#pendingTimers.get(id);
    if (timer !== undefined) this.#options.clearTimer(timer);
    this.#pendingTimers.delete(id);
  }

  #scheduleReconnect(): void {
    const delay = reconnectDelayMs(this.#attempt);
    this.#attempt += 1;
    this.#reconnectTimer = this.#options.setTimer(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delay);
  }

  #cancelReconnect(): void {
    if (this.#reconnectTimer !== null) this.#options.clearTimer(this.#reconnectTimer);
    this.#reconnectTimer = null;
  }

  #set(change: Partial<ConnectionView>): void {
    this.#view = { ...this.#view, ...change };
    for (const listener of this.#listeners) listener(this.#view);
  }
}
