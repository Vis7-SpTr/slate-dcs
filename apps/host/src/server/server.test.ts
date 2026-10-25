// SPDX-License-Identifier: GPL-3.0-or-later
// End-to-end: a real host server on a free port, real WebSocket clients
// (roadmap P1.4 "done when").

import { defaultSlices, parseHostMessage } from '@slate-dcs/shared';
import type { HostToScreen } from '@slate-dcs/shared';
import type { FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { createHostServer } from './server.js';
import { CommandDispatcher } from '../commands/dispatcher.js';
import { createHandlers } from '../commands/handlers.js';
import { StateStore } from '../state/store.js';

const BUILD = '0.1.0+test';
const ID_1 = '01JABD2K7Q0M3N4P5R6S7T8V9W';
const ID_2 = '01JABD2K7Q0M3N4P5R6S7T8V9X';

let app: FastifyInstance;
let store: StateStore;
let port: number;

beforeEach(async () => {
  store = new StateStore(defaultSlices(BUILD));
  const dispatcher = new CommandDispatcher(createHandlers(store));
  app = await createHostServer({ store, dispatcher, build: BUILD });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('No port');
  port = address.port;
});

afterEach(async () => {
  await app.close();
});

/** A connected screen that collects every message from the host. */
class Screen {
  readonly messages: HostToScreen[] = [];
  readonly #waiters: (() => void)[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on('message', (data: Buffer) => {
      const parsed = parseHostMessage(data.toString('utf8'));
      if (!parsed.ok) throw new Error(parsed.detail);
      this.messages.push(parsed.message);
      for (const wake of this.#waiters.splice(0)) wake();
    });
  }

  /** Waits until at least `count` messages have arrived. */
  async waitFor(count: number): Promise<HostToScreen[]> {
    while (this.messages.length < count) {
      await new Promise<void>((resolve, reject) => {
        this.#waiters.push(resolve);
        setTimeout(() => {
          reject(new Error(`Timed out waiting for ${count} messages`));
        }, 2000);
      });
    }
    return this.messages;
  }

  send(message: unknown): void {
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }
}

function connect(origin?: string): Promise<Screen> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { origin } : {});
    const screen = new Screen(socket);
    socket.once('open', () => {
      resolve(screen);
    });
    socket.once('unexpected-response', (_request, response) => {
      reject(new Error(`HTTP ${response.statusCode}`));
    });
  });
}

const setLocal = {
  t: 'cmd',
  id: ID_1,
  body: { cmd: 'settings.set', args: { timeDisplay: 'local' } },
};

describe('host server – HTTP', () => {
  it('serves the debug page with a strict content security policy', async () => {
    const response = await app.inject({ url: '/', headers: { host: `127.0.0.1:${port}` } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('answers the health check a second SLATE start looks for (P1.9)', async () => {
    const response = await app.inject({
      url: '/api/health',
      headers: { host: `127.0.0.1:${port}` },
    });
    expect(response.json()).toEqual({ app: 'slate-host', build: BUILD });
  });

  it.each(['/debug.js', '/debug.css'])('serves %s', async (url) => {
    const response = await app.inject({ url, headers: { host: `localhost:${port}` } });
    expect(response.statusCode).toBe(200);
  });

  it('refuses a request with a foreign Host header (DNS rebinding)', async () => {
    // fetch() would drop a custom Host header, so this uses http.request.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = http.get(
        { host: '127.0.0.1', port, path: '/', headers: { host: `evil.example:${port}` } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on('error', reject);
    });
    expect(status).toBe(403);
  });

  it('refuses an injected request with a foreign Host header', async () => {
    const response = await app.inject({ url: '/', headers: { host: 'evil.example' } });
    expect(response.statusCode).toBe(403);
  });
});

describe('host server – screens (protocol.md §14)', () => {
  it('sends a full snapshot with the build version on connect', async () => {
    const screen = await connect(`http://127.0.0.1:${port}`);
    const [snapshot] = await screen.waitFor(1);
    expect(snapshot).toEqual({
      t: 'state.snapshot',
      seq: 0,
      body: { build: BUILD, slices: defaultSlices(BUILD) },
    });
    screen.socket.close();
  });

  it('keeps two screens in sync; cmd.result goes to the sender only', async () => {
    const a = await connect(`http://localhost:${port}`);
    const b = await connect(`http://127.0.0.1:${port}`);
    await a.waitFor(1);
    await b.waitFor(1);

    a.send(setLocal);
    const [, update, result] = await a.waitFor(3);
    const [, updateB] = await b.waitFor(2);

    const expected = {
      t: 'state.update',
      seq: 1,
      body: { slices: { settings: { timeDisplay: 'local', uiScale: 1, speeds: ['ias', 'gs'] } } },
    };
    expect(update).toEqual(expected);
    expect(updateB).toEqual(expected);
    expect(result).toEqual({ t: 'cmd.result', id: ID_1, body: { ok: true } });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(b.messages.some((message) => message.t === 'cmd.result')).toBe(false);
    a.socket.close();
    b.socket.close();
  });

  it('applies a repeated command only once', async () => {
    const screen = await connect();
    await screen.waitFor(1);
    screen.send(setLocal);
    await screen.waitFor(3);
    screen.send(setLocal);
    const messages = await screen.waitFor(4);
    expect(messages[3]).toEqual({ t: 'cmd.result', id: ID_1, body: { ok: true } });
    expect(store.seq).toBe(1);
    screen.socket.close();
  });

  it('gives a reconnecting screen the current state', async () => {
    const first = await connect();
    await first.waitFor(1);
    first.send(setLocal);
    await first.waitFor(3);
    first.socket.close();

    const again = await connect();
    const [snapshot] = await again.waitFor(1);
    expect(snapshot).toMatchObject({
      t: 'state.snapshot',
      seq: 1,
      body: { slices: { settings: { timeDisplay: 'local' } } },
    });
    again.socket.close();
  });

  it('answers state.resync with a fresh snapshot', async () => {
    const screen = await connect();
    await screen.waitFor(1);
    screen.send({ t: 'state.resync', body: {} });
    const [, snapshot] = await screen.waitFor(2);
    expect(snapshot?.t).toBe('state.snapshot');
    screen.socket.close();
  });

  it('answers unknownCommand and badCommand, and drops frames without an ID', async () => {
    const screen = await connect();
    await screen.waitFor(1);
    screen.send({ t: 'cmd', id: ID_1, body: { cmd: 'fp.push', args: {} } });
    screen.send({ t: 'cmd', id: ID_2, body: { cmd: 'settings.set', args: {} } });
    screen.send('{not json');
    screen.send({ t: 'cmd', body: { cmd: 'settings.set', args: { uiScale: 2 } } });
    const messages = await screen.waitFor(3);
    expect(messages.slice(1)).toMatchObject([
      { t: 'cmd.result', id: ID_1, body: { ok: false, error: { code: 'unknownCommand' } } },
      { t: 'cmd.result', id: ID_2, body: { ok: false, error: { code: 'badCommand' } } },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.messages).toHaveLength(3);
    expect(store.seq).toBe(0);
    screen.socket.close();
  });

  it('refuses a WebSocket from a foreign origin', async () => {
    await expect(connect('https://evil.example')).rejects.toThrow('HTTP 403');
  });
});

describe('host server – built web UI', () => {
  let uiDir: string;
  let uiApp: FastifyInstance;
  let headers: { host: string };

  beforeEach(async () => {
    uiDir = mkdtempSync(join(tmpdir(), 'slate-ui-'));
    mkdirSync(join(uiDir, 'assets'));
    writeFileSync(join(uiDir, 'index.html'), '<!doctype html><title>SLATE</title>');
    writeFileSync(join(uiDir, 'assets', 'index-abc123.js'), 'console.log(1);');
    const uiStore = new StateStore(defaultSlices(BUILD));
    uiApp = await createHostServer({
      store: uiStore,
      dispatcher: new CommandDispatcher(createHandlers(uiStore)),
      build: BUILD,
      uiDir,
    });
    await uiApp.listen({ host: '127.0.0.1', port: 0 });
    const address = uiApp.server.address();
    if (address === null || typeof address === 'string') throw new Error('No port');
    headers = { host: `localhost:${address.port}` };
  });

  afterEach(async () => {
    await uiApp.close();
    rmSync(uiDir, { recursive: true, force: true });
  });

  it('serves the built UI at / and keeps index.html fresh', async () => {
    const response = await uiApp.inject({ url: '/', headers });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<title>SLATE</title>');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('lets hashed assets be cached for good', async () => {
    const response = await uiApp.inject({ url: '/assets/index-abc123.js', headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('immutable');
  });

  it('keeps the debug page at /debug', async () => {
    const response = await uiApp.inject({ url: '/debug', headers });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Debug page');
  });

  it('sends the content security policy on every response', async () => {
    for (const url of ['/', '/assets/index-abc123.js', '/debug', '/missing']) {
      const response = await uiApp.inject({ url, headers });
      expect(response.headers['content-security-policy']).toContain("script-src 'self'");
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('still refuses a foreign Host header', async () => {
    const response = await uiApp.inject({ url: '/', headers: { host: 'evil.example' } });
    expect(response.statusCode).toBe(403);
  });
});
