// SPDX-License-Identifier: GPL-3.0-or-later
// UDP receiver for the Lua bridge (protocol.md §6.1): 127.0.0.1 only, so
// nothing outside this PC can send own-ship data to the host.

import { createSocket } from 'node:dgram';
import type { Socket } from 'node:dgram';

export interface BridgeReceiver {
  /** The UDP port actually bound (useful with port 0 in tests). */
  readonly port: number;
  close(): Promise<void>;
}

export interface BridgeReceiverOptions {
  port: number;
  /** Default `127.0.0.1`. */
  host?: string;
  /** Called with every datagram's text. */
  onText(text: string): void;
  /** Errors after the socket is bound (rare; e.g. the network stack). */
  onError?(error: Error): void;
}

/**
 * Binds the UDP socket. Rejects if the port can't be bound – e.g. another
 * SLATE host is already running (`EADDRINUSE`).
 */
export async function startBridgeReceiver(options: BridgeReceiverOptions): Promise<BridgeReceiver> {
  const socket: Socket = createSocket({ type: 'udp4' });
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => {
      socket.close();
      reject(error);
    };
    socket.once('error', failed);
    socket.bind(options.port, options.host ?? '127.0.0.1', () => {
      socket.off('error', failed);
      resolve();
    });
  });
  socket.on('error', (error) => {
    options.onError?.(error);
  });
  socket.on('message', (message) => {
    options.onText(message.toString('utf8'));
  });

  return {
    port: socket.address().port,
    close: () =>
      new Promise<void>((resolve) => {
        socket.close(() => {
          resolve();
        });
      }),
  };
}
