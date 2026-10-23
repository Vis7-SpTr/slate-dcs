// SPDX-License-Identifier: GPL-3.0-or-later
// LAN access end to end: the host server on localhost plus a LAN listener on
// 127.0.0.2 (stands in for the PC's LAN address).

import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultSlices } from '@slate-dcs/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { CommandDispatcher } from '../commands/dispatcher.js';
import { createHandlers } from '../commands/handlers.js';
import { createHostServer } from '../server/server.js';
import { StateStore } from '../state/store.js';
import { DeviceStore } from './devices.js';
import { Firewall } from './firewall.js';
import { LanAccess } from './lan.js';

const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const quiet = { info: () => undefined, warn: () => undefined };

let dir: string;
let store: StateStore;
let app: FastifyInstance;
let port: number;
let lan: LanAccess;
let lanHost: string;

function makeLan(): LanAccess {
  return new LanAccess({
    store,
    devices: new DeviceStore(join(dir, 'lan.json')),
    firewall: new Firewall({ windows: false }),
    target: app.server,
    port,
    log: quiet,
    lanIps: () => ['127.0.0.2'],
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slate-lan-'));
  store = new StateStore(defaultSlices('test'));
  const options = {
    get lan() {
      return lan;
    },
  };
  app = await createHostServer({
    store,
    dispatcher: new CommandDispatcher(createHandlers(store, options)),
    build: 'test',
    get lan() {
      return lan;
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  port = address.port;
  lanHost = `127.0.0.2:${String(port)}`;
  lan = makeLan();
  await lan.init();
});

afterEach(async () => {
  await lan.close();
  await app.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

interface Answer {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function get(ip: string, path: string, headers: Record<string, string> = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: ip, port, path, headers: { host: `${ip}:${String(port)}`, ...headers } },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function pairDevice(): Promise<string> {
  expect(lan.pair(lanHost)).toEqual({ ok: true });
  const url = new URL(store.get('host').lan.pairing?.url ?? '');
  const answer = await get('127.0.0.2', url.pathname + url.search, { 'user-agent': IPAD });
  expect(answer.status).toBe(200);
  const cookie = String(answer.headers['set-cookie'] ?? '');
  return cookie.split(';')[0] ?? '';
}

describe('LAN access (P1.8)', () => {
  it('listens on the LAN only while switched on', async () => {
    await expect(get('127.0.0.2', '/')).rejects.toThrow();
    expect(await lan.set(true)).toEqual({ ok: true });
    expect(store.get('host').lan).toMatchObject({
      enabled: true,
      state: 'on',
      addresses: [lanHost],
    });
    expect((await get('127.0.0.2', '/lan.css')).status).toBe(200);
    expect(await lan.set(false)).toEqual({ ok: true });
    await expect(get('127.0.0.2', '/')).rejects.toThrow();
    expect(store.get('host').lan.state).toBe('off');
  });

  it('shows an unpaired device only the "not paired" page; localhost stays open', async () => {
    await lan.set(true);
    const answer = await get('127.0.0.2', '/');
    expect(answer.status).toBe(403);
    expect(answer.body).toContain('Not paired');
    expect((await get('127.0.0.2', '/debug')).status).toBe(403);
    expect((await get('127.0.0.1', '/')).status).toBe(200);
    // A foreign Host header on the LAN is refused too (DNS rebinding).
    expect((await get('127.0.0.2', '/', { host: 'evil.example' })).status).toBe(403);
  });

  it('pairs by the QR link: single use, HttpOnly SameSite=Strict cookie, then full access', async () => {
    await lan.set(true);
    expect(lan.pair(lanHost)).toEqual({ ok: true });
    const url = new URL(store.get('host').lan.pairing?.url ?? '');
    expect(url.host).toBe(lanHost);
    const answer = await get('127.0.0.2', url.pathname + url.search, { 'user-agent': IPAD });
    expect(answer.status).toBe(200);
    expect(answer.body).toContain('url=/');
    const setCookie = String(answer.headers['set-cookie']);
    expect(setCookie).toMatch(
      /^slate_device=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict/,
    );
    expect(store.get('host').lan.pairing).toBeNull();
    expect(store.get('host').lan.devices.map((d) => d.name)).toEqual(['iPad · Safari']);

    const again = await get('127.0.0.2', url.pathname + url.search);
    expect(again.status).toBe(403);
    expect(again.body).toContain('Pairing failed');

    const cookie = setCookie.split(';')[0] ?? '';
    expect((await get('127.0.0.2', '/debug', { cookie })).status).toBe(200);
  });

  it('gives a paired device live data over the WebSocket, and cuts it off when removed', async () => {
    await lan.set(true);
    const cookie = await pairDevice();
    const ws = new WebSocket(`ws://${lanHost}/ws`, {
      headers: { cookie, origin: `http://${lanHost}` },
    });
    const first = await new Promise<string>((resolve, reject) => {
      ws.once('message', (data: Buffer) => {
        resolve(data.toString('utf8'));
      });
      ws.once('error', reject);
    });
    expect(JSON.parse(first)).toMatchObject({ t: 'state.snapshot' });

    // A paired device can't end or remove SLATE (P1.9).
    const answer = new Promise<string>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const text = data.toString('utf8');
        if (text.includes('cmd.result')) resolve(text);
      });
    });
    ws.send(
      JSON.stringify({
        t: 'cmd',
        id: '01JABD2K7Q0M3N4P5R6S7T8V9W',
        body: { cmd: 'app.uninstall', args: { wipe: true } },
      }),
    );
    expect(JSON.parse(await answer)).toMatchObject({
      t: 'cmd.result',
      body: { ok: false, error: { code: 'forbidden' } },
    });
    await new Promise((r) => setTimeout(r, 50));
    const device = store.get('host').lan.devices[0];
    expect(device?.connected).toBe(true);

    const closed = new Promise<number>((resolve) => ws.once('close', resolve));
    expect(await lan.remove(device?.id ?? '')).toEqual({ ok: true });
    expect(await closed).toBe(4001);
    expect((await get('127.0.0.2', '/debug', { cookie })).status).toBe(403);
  });

  it('refuses a WebSocket from a foreign origin, even with a valid cookie', async () => {
    await lan.set(true);
    const cookie = await pairDevice();
    const ws = new WebSocket(`ws://${lanHost}/ws`, {
      headers: { cookie, origin: 'http://evil.example' },
    });
    const status = await new Promise<number>((resolve) => {
      ws.once('unexpected-response', (_req, res) => {
        resolve(res.statusCode ?? 0);
      });
      ws.once('error', () => {
        resolve(-1);
      });
    });
    expect(status).toBe(403);
  });

  it('remembers the switch and the devices across a host restart', async () => {
    await lan.set(true);
    const cookie = await pairDevice();
    await lan.close();
    lan = makeLan();
    await lan.init();
    expect(store.get('host').lan.state).toBe('on');
    expect((await get('127.0.0.2', '/debug', { cookie })).status).toBe(200);
  });

  it('refuses pairing while LAN is off or for an address that is not this PC', async () => {
    expect(lan.pair(lanHost)).toMatchObject({ ok: false });
    await lan.set(true);
    expect(lan.pair('10.9.9.9:7792')).toMatchObject({ ok: false });
  });
});
