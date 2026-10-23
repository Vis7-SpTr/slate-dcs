// SPDX-License-Identifier: GPL-3.0-or-later
// The relay over real WSS on localhost.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TLSSocket } from 'node:tls';

import { parseMessageText, ulid } from '@slate-dcs/shared';
import type { Message } from '@slate-dcs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { loadRelayFiles } from './config.js';
import type { RelayFiles } from './config.js';
import { Relay } from './relay.js';
import { RELAY_PATH, startRelayServer } from './server.js';
import type { RelayServer } from './server.js';
import { fingerprint } from './tls.js';

let dir: string;
let files: RelayFiles;
let server: RelayServer;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slate-wss-'));
  files = await loadRelayFiles(dir);
  const relay = new Relay({ codes: files.codes, name: 'slate-relay test' });
  server = await startRelayServer({
    relay,
    port: 0,
    host: '127.0.0.1',
    certPem: files.certPem,
    keyPem: files.keyPem,
  });
});
afterEach(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function open(): Promise<{ ws: WebSocket; frames: Message[]; peer: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://127.0.0.1:${String(server.port)}${RELAY_PATH}`, {
      rejectUnauthorized: false,
    });
    const frames: Message[] = [];
    let peer = '';
    ws.on('upgrade', (response) => {
      peer = fingerprint((response.socket as TLSSocket).getPeerCertificate().raw);
    });
    ws.on('message', (data: Buffer) => {
      const parsed = parseMessageText(data.toString('utf8'));
      if (parsed.ok) frames.push(parsed.message);
    });
    ws.on('open', () => {
      resolve({ ws, frames, peer });
    });
    ws.on('error', reject);
  });
}

const send = (ws: WebSocket, type: string, body: unknown) => {
  ws.send(
    JSON.stringify({
      v: 1,
      id: ulid(),
      type,
      from: '',
      session: '',
      to: { scope: 'relay' },
      ts: Date.now(),
      ack: false,
      re: null,
      body,
    }),
  );
};

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i += 1) await new Promise((r) => setTimeout(r, 20));
  expect(check()).toBe(true);
};

describe('relay server', () => {
  it('serves the relay over WSS with its own certificate', async () => {
    const a = await open();
    expect(a.peer).toBe(files.fingerprint);
    send(a.ws, 'hello', { protocols: [1], app: 'test', features: [] });
    send(a.ws, 'session.join', {
      code: files.codes.blue,
      coalition: null,
      token: null,
      lastSeq: null,
      nick: 'Alpha',
      role: 'pilot',
      aircraft: null,
      source: 'manual',
    });
    await until(() => a.frames.some((f) => f.type === 'session.state'));
    expect(a.frames.map((f) => f.type)).toEqual(['welcome', 'session.joined', 'session.state']);
    a.ws.close();
  });

  it('sends session.closed "shutdown" when it closes', async () => {
    const a = await open();
    send(a.ws, 'hello', { protocols: [1], app: 'test', features: [] });
    send(a.ws, 'session.join', {
      code: files.codes.red,
      coalition: null,
      token: null,
      lastSeq: null,
      nick: 'Alpha',
      role: 'pilot',
      aircraft: null,
      source: 'manual',
    });
    await until(() => a.frames.some((f) => f.type === 'session.state'));
    const closed = new Promise((resolve) => a.ws.once('close', resolve));
    await server.close();
    await closed;
    expect(a.frames.at(-1)).toMatchObject({ type: 'session.closed', body: { reason: 'shutdown' } });
    // afterEach closes again – harmless.
    server = { port: 0, close: () => Promise.resolve() };
  });
});
