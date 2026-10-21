// SPDX-License-Identifier: GPL-3.0-or-later
// Connects the host connection to Svelte: one reactive view of the host
// state for every component, plus build-version handling (protocol.md §14.6).

import { UI_WEBSOCKET_PATH } from '@slate-dcs/shared';
import type { Command } from '@slate-dcs/shared';

import { HostConnection } from './connection.js';
import type { ConnectionView, SocketLike } from './connection.js';

/** sessionStorage key: the host build this screen already reloaded for once. */
const RELOADED_FOR = 'slate.reloadedForBuild';

class HostStore {
  /** The latest connection view; replaced as a whole on every change. */
  view: ConnectionView = $state.raw({
    link: 'connecting',
    slices: null,
    seq: 0,
    hostBuild: null,
    pending: [],
    lastFailure: null,
  });

  /** `true` if the host runs another build and reloading once didn't help. */
  reloadNeeded = $state(false);

  readonly #connection = new HostConnection({
    url: `ws://${location.host}${UI_WEBSOCKET_PATH}`,
    // The browser WebSocket has everything SocketLike needs; its handler types
    // only differ in the event parameter, which the connection doesn't use.
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (handle) => {
      window.clearTimeout(handle as number);
    },
    onHostBuild: (build) => {
      this.#checkBuild(build);
    },
  });

  start(): void {
    this.#connection.subscribe((view) => {
      this.view = view;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.#connection.wake();
    });
    this.#connection.start();
  }

  send(command: Command): string {
    return this.#connection.send(command);
  }

  retry(id: string): void {
    this.#connection.retry(id);
  }

  dismissFailure(): void {
    this.#connection.dismissFailure();
  }

  /** Pending entry of a command, if it's still waiting. */
  pendingOf(id: string | null) {
    return id === null ? undefined : this.view.pending.find((entry) => entry.id === id);
  }

  #checkBuild(hostBuild: string): void {
    if (hostBuild === __SLATE_BUILD__) {
      safeStorage(() => {
        sessionStorage.removeItem(RELOADED_FOR);
      });
      this.reloadNeeded = false;
      return;
    }
    // Reload once to pick up the new UI; if that didn't help, ask the user.
    const alreadyReloaded = safeStorage(() => sessionStorage.getItem(RELOADED_FOR)) === hostBuild;
    if (alreadyReloaded) {
      this.reloadNeeded = true;
    } else {
      safeStorage(() => {
        sessionStorage.setItem(RELOADED_FOR, hostBuild);
      });
      location.reload();
    }
  }
}

/** Storage can be unavailable (private mode, blocked site data); never fail on it. */
function safeStorage<T>(action: () => T): T | undefined {
  try {
    return action();
  } catch {
    return undefined;
  }
}

export const host = new HostStore();
