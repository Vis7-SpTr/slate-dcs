// SPDX-License-Identifier: GPL-3.0-or-later
// LAN access (P1.8, architecture.md §1.1): while the switch is on, the host
// also listens on this PC's LAN IPv4 addresses, on the same port as on
// localhost. Requests that come in there need a paired device's cookie –
// except the pairing link itself. Localhost stays trusted without pairing.
//
// The LAN listeners are plain HTTP servers that hand their requests and
// WebSocket upgrades to the Fastify server, so there is only one app.

import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { Socket } from 'node:net';

import type { LanState } from '@slate-dcs/shared';

import { failed } from '../commands/dispatcher.js';
import type { CommandOutcome } from '../commands/dispatcher.js';
import type { StateStore } from '../state/store.js';
import type { DeviceRecord, DeviceStore } from './devices.js';
import type { Firewall } from './firewall.js';

export const DEVICE_COOKIE = 'slate_device';
/** Cookie lifetime: effectively "until removed" – the host drops it after 90 unused days. */
const COOKIE_MAX_AGE_S = 10 * 365 * 24 * 3600;
/** LAN addresses are looked up again this often (DHCP, Wi-Fi switch). */
const REFRESH_MS = 30_000;

export interface LanLog {
  info(message: string): void;
  warn(message: string): void;
}

export interface LanOptions {
  store: StateStore;
  devices: DeviceStore;
  firewall: Firewall;
  /** The Fastify server that serves localhost; LAN requests are handed to it. */
  target: Server;
  port: number;
  log: LanLog;
  /** This PC's LAN IPv4 addresses; replaceable for tests. */
  lanIps?: () => string[];
}

/** IPv4 addresses of the network interfaces, without loopback. */
export function lanIpv4(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

/** One cookie's value from a Cookie header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

export class LanAccess {
  readonly #o: LanOptions;
  readonly #listeners = new Map<string, Server>();
  /** Sockets accepted by a LAN listener – everything else came in on localhost. */
  readonly #lanSockets = new WeakSet<Socket>();
  readonly #openSockets = new Set<Socket>();
  /** Open screens per paired device, for "connected" and for closing on removal. */
  readonly #screens = new Map<string, Set<{ close(): void }>>();
  #refresh: ReturnType<typeof setInterval> | undefined;
  #pairTimer: ReturnType<typeof setTimeout> | undefined;
  #firewall: LanState['firewall'] = 'unknown';
  #error: string | null = null;

  constructor(options: LanOptions) {
    this.#o = options;
  }

  /** Reads the saved switch and devices; listens if LAN was on (decided 23 Oct 2026). */
  async init(): Promise<void> {
    await this.#o.devices.load();
    if (this.#o.devices.enabled) await this.#start();
    this.#publish();
  }

  // -------------------------------------------------------------------------
  // Commands

  async set(enabled: boolean): Promise<CommandOutcome> {
    await this.#o.devices.setEnabled(enabled);
    if (enabled) await this.#start();
    else await this.#stop();
    this.#publish();
    return this.#error !== null && enabled ? failed('notPossible', this.#error) : { ok: true };
  }

  pair(address: string): CommandOutcome {
    if (!this.#o.devices.enabled) return failed('notPossible', 'Switch LAN access on first');
    if (!this.#addresses().includes(address)) {
      return failed('notPossible', `${address} is not one of this PC's LAN addresses`);
    }
    const { secret, expiresAt } = this.#o.devices.startPairing();
    clearTimeout(this.#pairTimer);
    this.#pairTimer = setTimeout(
      () => {
        this.#publish();
      },
      expiresAt - Date.now() + 50,
    );
    this.#publish({ url: `http://${address}/pair?s=${secret}`, expiresAt });
    return { ok: true };
  }

  cancelPair(): CommandOutcome {
    this.#o.devices.cancelPairing();
    clearTimeout(this.#pairTimer);
    this.#publish(null);
    return { ok: true };
  }

  async remove(id: string): Promise<CommandOutcome> {
    if (!(await this.#o.devices.remove(id))) return failed('notPossible', 'No such device');
    this.#closeScreens(id);
    this.#o.log.info(`Removed paired device ${id}`);
    this.#publish();
    return { ok: true };
  }

  async removeAll(): Promise<CommandOutcome> {
    const ids = this.#o.devices.devices.map((d) => d.id);
    await this.#o.devices.removeAll();
    for (const id of ids) this.#closeScreens(id);
    this.#o.log.info('Removed all paired devices');
    this.#publish();
    return { ok: true };
  }

  async addFirewallRule(): Promise<CommandOutcome> {
    const error = await this.#o.firewall.addRule(this.#o.port);
    await this.#checkFirewall();
    this.#publish();
    return error === null ? { ok: true } : failed('notPossible', error);
  }

  // -------------------------------------------------------------------------
  // Gate for the HTTP server

  /** `true` if the request came in on a LAN listener. */
  isLan(socket: Socket): boolean {
    return this.#lanSockets.has(socket);
  }

  /** `Host` values accepted on the LAN listeners, e.g. `192.168.1.20:7792`. */
  hosts(): ReadonlySet<string> {
    return new Set(this.#listeners.keys());
  }

  /** The paired device for a request, from its cookie. */
  device(request: IncomingMessage): DeviceRecord | null {
    return this.#o.devices.verify(readCookie(request.headers.cookie, DEVICE_COOKIE));
  }

  /** Handles `/pair?s=…`: the `Set-Cookie` value on success, or `null`. */
  async handlePairing(secret: string, userAgent: string | undefined): Promise<string | null> {
    const result = await this.#o.devices.pair(secret, userAgent);
    if (!result) return null;
    clearTimeout(this.#pairTimer);
    this.#o.log.info(`Paired ${result.device.name} (${result.device.id})`);
    this.#publish(null);
    return `${DEVICE_COOKIE}=${result.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${String(COOKIE_MAX_AGE_S)}`;
  }

  /** A paired device's screen connected; returns the function to call when it closes. */
  attach(id: string, screen: { close(): void }): () => void {
    const set = this.#screens.get(id) ?? new Set();
    set.add(screen);
    this.#screens.set(id, set);
    this.#publish();
    return () => {
      set.delete(screen);
      if (set.size === 0) this.#screens.delete(id);
      this.#publish();
    };
  }

  /** Stops listening (host shutdown); the switch stays as it is. Waits for lan.json writes. */
  async close(): Promise<void> {
    await this.#stop();
    await this.#o.devices.idle();
  }

  // -------------------------------------------------------------------------

  async #start(): Promise<void> {
    this.#error = null;
    await this.#sync();
    clearInterval(this.#refresh);
    this.#refresh = setInterval(() => {
      void this.#sync().then(() => {
        this.#publish();
      });
    }, REFRESH_MS);
    await this.#checkFirewall();
  }

  async #stop(): Promise<void> {
    clearInterval(this.#refresh);
    clearTimeout(this.#pairTimer);
    this.#o.devices.cancelPairing();
    const servers = [...this.#listeners.values()];
    this.#listeners.clear();
    // Switching LAN off ends every LAN connection at once, screens included.
    for (const socket of this.#openSockets) socket.destroy();
    this.#openSockets.clear();
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => {
              resolve();
            });
          }),
      ),
    );
    if (servers.length > 0) this.#o.log.info('LAN access off');
  }

  /** Listens on every current LAN address, and stops on ones that went away. */
  async #sync(): Promise<void> {
    const wanted = new Set(
      (this.#o.lanIps ?? lanIpv4)().map((ip) => `${ip}:${String(this.#o.port)}`),
    );
    for (const [address, server] of this.#listeners) {
      if (!wanted.has(address)) {
        server.close();
        this.#listeners.delete(address);
      }
    }
    const errors: string[] = [];
    for (const address of wanted) {
      if (this.#listeners.has(address)) continue;
      const ip = address.slice(0, address.lastIndexOf(':'));
      try {
        this.#listeners.set(address, await this.#listen(ip));
        this.#o.log.info(`LAN access on http://${address}/`);
      } catch (error) {
        errors.push(`${address}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.#error =
      errors.length > 0
        ? `Can't listen on ${errors.join('; ')}`
        : wanted.size === 0
          ? 'This PC has no LAN address – is it connected to a network?'
          : null;
    if (this.#error) this.#o.log.warn(this.#error);
  }

  #listen(ip: string): Promise<Server> {
    const server = createServer((request, response) => {
      this.#o.target.emit('request', request, response);
    });
    server.on('upgrade', (request, socket, head) => {
      this.#o.target.emit('upgrade', request, socket, head);
    });
    server.on('connection', (socket) => {
      this.#lanSockets.add(socket);
      this.#openSockets.add(socket);
      socket.once('close', () => this.#openSockets.delete(socket));
    });
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.#o.port, ip, () => {
        server.off('error', reject);
        resolve(server);
      });
    });
  }

  async #checkFirewall(): Promise<void> {
    const ips = [...this.#listeners.keys()].map((a) => a.slice(0, a.lastIndexOf(':')));
    this.#firewall = await this.#o.firewall.check(this.#o.port, ips);
  }

  #closeScreens(id: string): void {
    for (const screen of this.#screens.get(id) ?? []) screen.close();
    this.#screens.delete(id);
  }

  #addresses(): string[] {
    return [...this.#listeners.keys()].sort();
  }

  /** Writes `host.lan`; `pairing` undefined = keep the open one if still valid. */
  #publish(pairing?: LanState['pairing']): void {
    const host = this.#o.store.get('host');
    const devices = this.#o.devices;
    const keep =
      pairing === undefined && devices.pairingOpen && host.lan.pairing !== null
        ? host.lan.pairing
        : null;
    const enabled = devices.enabled;
    this.#o.store.update({
      host: {
        ...host,
        lan: {
          enabled,
          state: !enabled ? 'off' : this.#listeners.size > 0 ? 'on' : 'failed',
          port: this.#o.port,
          addresses: this.#addresses(),
          error: enabled ? this.#error : null,
          firewall: enabled ? this.#firewall : 'unknown',
          pairing: enabled ? (pairing ?? keep) : null,
          devices: devices.devices.map((d) => ({
            id: d.id,
            name: d.name,
            pairedAt: d.pairedAt,
            lastSeen: d.lastSeen,
            connected: this.#screens.has(d.id),
          })),
        },
      },
    });
  }
}
