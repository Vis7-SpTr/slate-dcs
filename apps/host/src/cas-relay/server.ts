// SPDX-License-Identifier: GPL-3.0-or-later
// The relay's network side (protocol.md §0, §3, §5): WSS with the relay's own
// certificate on one TCP port, a ping every 15 s, and the relay core's tick.
// Used by the standalone `slate-relay` and by host mode.

import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';

import { SESSION_TIMING } from '@slate-dcs/shared';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

import type { Relay, RelayLog } from './relay.js';

/** Path of the relay's WebSocket. */
export const RELAY_PATH = '/relay';
/** Largest frame accepted (flight plans in P3 are the biggest messages). */
const MAX_FRAME = 512 * 1024;

export interface RelayServerOptions {
  relay: Relay;
  port: number;
  /** `0.0.0.0` by default – players connect from the LAN and the internet. */
  host?: string;
  certPem: string;
  keyPem: string;
  log?: RelayLog;
}

export interface RelayServer {
  port: number;
  /** Sends `session.closed` (`shutdown`) to everyone and closes the port. */
  close(): Promise<void>;
}

export async function startRelayServer(options: RelayServerOptions): Promise<RelayServer> {
  const { relay, log } = options;
  const https = createServer({ cert: options.certPem, key: options.keyPem });
  const wss = new WebSocketServer({ server: https, path: RELAY_PATH, maxPayload: MAX_FRAME });
  const sockets = new Map<WebSocket, { alive: boolean }>();

  wss.on('connection', (ws, request) => {
    const state = { alive: true };
    sockets.set(ws, state);
    const conn = relay.connect({
      send: (text) => {
        if (ws.readyState === ws.OPEN) ws.send(text);
      },
      close: () => {
        ws.close(1000);
      },
    });
    log?.debug(`Connection from ${request.socket.remoteAddress ?? '?'}`);
    ws.on('message', (data, isBinary) => {
      state.alive = true;
      if (isBinary) return;
      conn.receive(
        Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Buffer.concat(data as Buffer[]).toString('utf8'),
      );
    });
    ws.on('pong', () => {
      state.alive = true;
      conn.alive();
    });
    ws.on('close', () => {
      sockets.delete(ws);
      conn.closed();
    });
    ws.on('error', (error) => {
      log?.debug(`Socket error: ${error.message}`);
    });
  });

  // Ping every 15 s; a socket that didn't answer the last ping or send
  // anything since is cut (the core marks the participant lost after 45 s).
  let missed = new Map<WebSocket, number>();
  const ping = setInterval(() => {
    const next = new Map<WebSocket, number>();
    for (const [ws, state] of sockets) {
      const count = state.alive ? 0 : (missed.get(ws) ?? 0) + 1;
      if (count * SESSION_TIMING.heartbeatSec >= SESSION_TIMING.lostAfterSec) {
        ws.terminate();
        continue;
      }
      next.set(ws, count);
      state.alive = false;
      ws.ping();
    }
    missed = next;
  }, SESSION_TIMING.heartbeatSec * 1000);
  const tick = setInterval(() => {
    relay.tick();
  }, 1000);

  await new Promise<void>((resolve, reject) => {
    https.once('error', reject);
    https.listen(options.port, options.host ?? '0.0.0.0', () => {
      https.off('error', reject);
      resolve();
    });
  });

  return {
    port: (https.address() as AddressInfo).port,
    close: async () => {
      clearInterval(ping);
      clearInterval(tick);
      relay.shutdown();
      for (const ws of sockets.keys()) ws.terminate();
      await new Promise<void>((resolve) => {
        wss.close(() => {
          https.close(() => {
            resolve();
          });
        });
      });
    },
  };
}
