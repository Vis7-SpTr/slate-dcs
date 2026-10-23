// SPDX-License-Identifier: GPL-3.0-or-later

import { createSocket } from 'node:dgram';

import { describe, expect, it } from 'vitest';

import { startBridgeReceiver } from './receiver.js';

function sendUdp(port: number, text: string): Promise<void> {
  const socket = createSocket('udp4');
  return new Promise((resolve, reject) => {
    socket.send(text, port, '127.0.0.1', (error) => {
      socket.close();
      if (error) reject(error);
      else resolve();
    });
  });
}

describe('startBridgeReceiver', () => {
  it('passes every datagram on as text', async () => {
    const received: string[] = [];
    let arrived = (): void => undefined;
    const done = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const receiver = await startBridgeReceiver({
      port: 0,
      onText: (text) => {
        received.push(text);
        if (received.length === 2) arrived();
      },
    });
    try {
      await sendUdp(receiver.port, '{"t":"hello","bv":4,"env":"export"}');
      await sendUdp(receiver.port, '{"t":"own","bv":4,"mt":1,"unit":"Ünit"}');
      await done;
      expect(received).toEqual([
        '{"t":"hello","bv":4,"env":"export"}',
        '{"t":"own","bv":4,"mt":1,"unit":"Ünit"}',
      ]);
    } finally {
      await receiver.close();
    }
  });

  it('rejects when the port is taken (a second host)', async () => {
    const first = await startBridgeReceiver({ port: 0, onText: () => undefined });
    try {
      await expect(
        startBridgeReceiver({ port: first.port, onText: () => undefined }),
      ).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await first.close();
    }
  });
});
