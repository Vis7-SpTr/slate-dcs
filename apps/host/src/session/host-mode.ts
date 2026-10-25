// SPDX-License-Identifier: GPL-3.0-or-later
// Host mode (architecture.md §1.3): this host runs a relay for the group –
// for tests, small ad-hoc sessions and when the server PC is off. The relay
// is the same core as the standalone `slate-relay`, with its files in
// <data dir>\relay. The host itself joins it like any other participant,
// over a direct in-process link.

import { join } from 'node:path';

import type { HostSlice } from '@slate-dcs/shared';

import { failed } from '../commands/dispatcher.js';
import type { CommandOutcome } from '../commands/dispatcher.js';
import { CAS_LOG_FOLDER, CasLogFiles, pruneCasLogs } from '../cas-relay/cas-log-file.js';
import { lanAddresses, loadRelayFiles } from '../cas-relay/config.js';
import { Relay } from '../cas-relay/relay.js';
import type { RelayLog } from '../cas-relay/relay.js';
import { startRelayServer } from '../cas-relay/server.js';
import type { RelayServer } from '../cas-relay/server.js';
import type { StateStore } from '../state/store.js';
import { isLocalAddress, normalizeAddress } from './link.js';

export interface HostModeOptions {
  store: StateStore;
  dataDir: string;
  /** Relay name for `welcome`, e.g. `slate-host 0.1.0 (host mode)`. */
  name: string;
  log: RelayLog;
  /** Overrides the port in relay.json (tests). */
  port?: number;
  /** `0.0.0.0` by default. */
  bind?: string;
}

export class HostMode {
  readonly #options: HostModeOptions;
  #relay: Relay | null = null;
  #server: RelayServer | null = null;
  #casLog: CasLogFiles | null = null;

  constructor(options: HostModeOptions) {
    this.#options = options;
  }

  /** TCP port of the running relay, or `null`. */
  get port(): number | null {
    return this.#server?.port ?? null;
  }

  /** The running relay if `address` is this PC on its port – for the direct link. */
  relayFor(address: string): Relay | null {
    const server = this.#server;
    if (!this.#relay || !server) return null;
    const normalized = normalizeAddress(address);
    const port = Number(/:(\d+)$/.exec(normalized)?.[1]);
    return port === server.port && isLocalAddress(normalized, lanAddresses(server.port))
      ? this.#relay
      : null;
  }

  async start(): Promise<CommandOutcome> {
    if (this.#server) return { ok: true };
    const { log } = this.#options;
    this.#set({ state: 'starting', error: null });
    try {
      const files = await loadRelayFiles(join(this.#options.dataDir, 'relay'));
      // The CAS log like a standalone relay's (§12.1): <data>\relay\cas-log.
      const logDir = join(files.dir, CAS_LOG_FOLDER);
      await pruneCasLogs(logDir, files.logRetentionDays).catch((error: unknown) => {
        log.warn(`CAS log: can't remove old files: ${String(error)}`);
      });
      const casLog = await CasLogFiles.open(logDir, Date.now(), log);
      const relay = new Relay({ codes: files.codes, name: this.#options.name, log, casLog });
      const server = await startRelayServer({
        relay,
        port: this.#options.port ?? files.port,
        host: this.#options.bind ?? '0.0.0.0',
        certPem: files.certPem,
        keyPem: files.keyPem,
        log,
      }).catch(async (error: unknown) => {
        await casLog.close();
        throw error;
      });
      this.#casLog = casLog;
      this.#relay = relay;
      this.#server = server;
      this.#set({
        state: 'on',
        port: server.port,
        addresses: lanAddresses(server.port),
        codes: files.codes,
        fingerprint: files.fingerprint,
        error: null,
      });
      log.info(
        `Host mode on: relay on TCP ${String(server.port)}, fingerprint ${files.fingerprint}`,
      );
      return { ok: true };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const busy = (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
      const message = busy
        ? 'The relay port is in use – is a slate-relay or another host mode already running?'
        : text;
      this.#set({ state: 'failed', error: message });
      log.warn(`Host mode failed: ${text}`);
      return failed('notPossible', message);
    }
  }

  async stop(): Promise<CommandOutcome> {
    const server = this.#server;
    const casLog = this.#casLog;
    this.#server = null;
    this.#relay = null;
    this.#casLog = null;
    if (server) {
      await server.close();
      await casLog?.close();
      this.#options.log.info('Host mode off');
    }
    this.#set({
      state: 'off',
      port: null,
      addresses: [],
      codes: null,
      fingerprint: null,
      error: null,
    });
    return { ok: true };
  }

  #set(change: Partial<HostSlice['relayHost']>): void {
    const host = this.#options.store.get('host');
    this.#options.store.update({ host: { ...host, relayHost: { ...host.relayHost, ...change } } });
  }
}
