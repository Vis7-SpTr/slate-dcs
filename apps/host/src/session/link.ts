// SPDX-License-Identifier: GPL-3.0-or-later
// The host's side of a relay connection (protocol.md §3): WSS with a pinned
// certificate fingerprint, or – in host mode, for the host's own relay – a
// direct in-process link to the relay core.

import type { TLSSocket } from 'node:tls';

import { DEFAULT_PORTS, SESSION_TIMING } from '@slate-dcs/shared';
import { WebSocket } from 'ws';

import type { Relay } from '../cas-relay/relay.js';
import { RELAY_PATH } from '../cas-relay/server.js';
import { fingerprint } from '../cas-relay/tls.js';

/** An open link to a relay. */
export interface ClientLink {
  send(text: string): void;
  close(): void;
}

export interface LinkEvents {
  onText(text: string): void;
  /** The link is gone (closed by either side, or dead). */
  onClose(reason: string): void;
}

/** The relay's certificate didn't match the one expected (or none was confirmed yet). */
export class FingerprintError extends Error {
  constructor(readonly fingerprint: string) {
    super(`Relay fingerprint ${fingerprint} not confirmed`);
  }
}

/** `host:port` with the default relay port, host in lower case. */
export function normalizeAddress(address: string): string {
  const trimmed = address.trim().toLowerCase();
  return /:\d+$/.test(trimmed) ? trimmed : `${trimmed}:${String(DEFAULT_PORTS.relay)}`;
}

/** `true` for an address that means this PC. */
export function isLocalAddress(address: string, ownLan: readonly string[] = []): boolean {
  const host = normalizeAddress(address).replace(/:\d+$/, '');
  return (
    ['localhost', '127.0.0.1', '[::1]'].includes(host) ||
    ownLan.some((a) => a.replace(/:\d+$/, '') === host)
  );
}

/**
 * Opens WSS to `address` and checks the relay's certificate: `accept` gets its
 * fingerprint before anything is sent; `false` aborts with a FingerprintError.
 * A relay that sends no ping for 45 s is treated as gone.
 */
export function dialWss(
  address: string,
  accept: (fingerprint: string) => boolean,
  events: LinkEvents,
  timeoutMs = 10_000,
): Promise<ClientLink> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${normalizeAddress(address)}${RELAY_PATH}`, {
      // Self-signed by design; the fingerprint check below is the trust check.
      rejectUnauthorized: false,
      handshakeTimeout: timeoutMs,
    });
    let opened = false;
    let refused: FingerprintError | null = null;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const alive = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        ws.terminate();
      }, SESSION_TIMING.lostAfterSec * 1000);
    };

    ws.on('upgrade', (response) => {
      const raw = (response.socket as TLSSocket).getPeerCertificate().raw;
      const seen = fingerprint(raw);
      if (!accept(seen)) {
        refused = new FingerprintError(seen);
        ws.terminate();
      }
    });
    ws.on('open', () => {
      if (refused) return;
      opened = true;
      alive();
      resolve({
        send: (text) => {
          if (ws.readyState === ws.OPEN) ws.send(text);
        },
        close: () => {
          ws.close(1000);
        },
      });
    });
    ws.on('ping', alive);
    ws.on('message', (data: Buffer, isBinary) => {
      alive();
      if (!isBinary) events.onText(data.toString('utf8'));
    });
    ws.on('error', (error) => {
      if (!opened) reject(refused ?? error);
    });
    ws.on('close', (code) => {
      clearTimeout(watchdog);
      if (!opened) {
        reject(refused ?? new Error(`Connection closed (${String(code)})`));
        return;
      }
      events.onClose(code === 1000 ? 'closed' : `connection lost (${String(code)})`);
    });
  });
}

/**
 * A link to this host's own relay (host mode): no socket, no TLS – the same
 * relay rules apply. Frames are handed over asynchronously, like a socket.
 */
export function dialLocal(relay: Relay, events: LinkEvents): Promise<ClientLink> {
  let open = true;
  let closing = false;
  const conn = relay.connect({
    send: (text) => {
      queueMicrotask(() => {
        if (open) events.onText(text);
      });
    },
    close: () => {
      if (!open) return;
      open = false;
      clearInterval(beat);
      queueMicrotask(() => {
        conn.closed();
        events.onClose('closed by the relay');
      });
    },
  });
  // In place of the WebSocket pong.
  const beat = setInterval(() => {
    conn.alive();
  }, SESSION_TIMING.heartbeatSec * 1000);
  return Promise.resolve({
    send: (text) => {
      queueMicrotask(() => {
        if (open) conn.receive(text);
      });
    },
    // Queued like the frames, so a `session.leave` sent just before still arrives.
    close: () => {
      if (closing) return;
      closing = true;
      clearInterval(beat);
      queueMicrotask(() => {
        if (!open) return;
        open = false;
        conn.closed();
        events.onClose('closed');
      });
    },
  });
}
