// SPDX-License-Identifier: GPL-3.0-or-later
// Command handlers (protocol.md §14.7). Host-only commands change the state
// store directly; relay commands go through the relay client and answer once
// the relay has (P1.6c).

import { CAS_COMMANDS } from '@slate-dcs/shared';
import type { CasCommandName, OwnshipOverrides } from '@slate-dcs/shared';

import type { CommandHandlers } from './dispatcher.js';
import { failed } from './dispatcher.js';
import type { CommandOutcome } from './dispatcher.js';
import type { Updater } from '../app/updates.js';
import type { DcsIntegration } from '../dcs-integration/service.js';
import type { LanAccess } from '../lan/lan.js';
import type { RelayClient } from '../session/client.js';
import type { Discovery } from '../session/discovery.js';
import type { HostMode } from '../session/host-mode.js';
import type { StateStore } from '../state/store.js';

const NO_RELAY = 'Sessions are not available in demo mode';
const NO_DCS = 'DCS folders are not available in demo mode';
const NO_LAN = 'LAN access is not available in demo mode';
const NO_APP = 'Not available in this build';
const NOT_BUILT = 'Not built yet – CAS comes with P2.5';

/** The P2 commands, each answering notPossible until the host builds it (P2.5). */
export function notBuiltHandlers(): Pick<CommandHandlers, CasCommandName> {
  const handler = () => failed('notPossible', NOT_BUILT);
  const handlers = {} as Record<CasCommandName, () => CommandOutcome>;
  for (const name of CAS_COMMANDS) handlers[name] = handler;
  return handlers;
}

/** The app's lifecycle (P1.9): updates, quit, uninstall. */
export interface AppControl {
  readonly updater: Updater;
  quit(): CommandOutcome;
  uninstall(wipe: boolean): Promise<CommandOutcome>;
}

export interface HandlerOptions {
  /**
   * Read at each command, so it can be set after the server started. `null`
   * (demo mode, or not yet): the `dcs.*` commands answer notPossible.
   */
  readonly dcs?: DcsIntegration | null;
  /** Relay client, host mode, discovery; `null` (demo mode): relay commands answer notConnected. */
  readonly relay?: { client: RelayClient; hostMode: HostMode; discovery: Discovery } | null;
  /** LAN access (P1.8); `null` (demo mode, tests): the `lan.*` commands answer notPossible. */
  readonly lan?: LanAccess | null;
  /** The app's lifecycle (P1.9); `null` (tests): the `app.*` commands answer notPossible. */
  readonly app?: AppControl | null;
}

export function createHandlers(store: StateStore, options: HandlerOptions = {}): CommandHandlers {
  const notConnected = () => failed('notConnected', NO_RELAY);

  /** Applies a change to the ownship overrides and stores the slice. */
  const setOverrides = (change: (overrides: OwnshipOverrides) => void): { ok: true } => {
    const ownship = store.get('ownship');
    change(ownship.overrides);
    store.update({ ownship });
    return { ok: true };
  };

  return {
    ...notBuiltHandlers(),
    // Relay commands (P1.6c). The host's own relay (host mode) is joined directly.
    'session.join': (args) => {
      const relay = options.relay;
      if (!relay) return notConnected();
      return relay.client.join(args, relay.hostMode.relayFor(args.address));
    },
    'session.leave': () => options.relay?.client.leave() ?? notConnected(),
    'session.joinAnnounced': (args) =>
      options.relay?.discovery.joinAnnounced(args) ?? notConnected(),
    'session.host': async ({ enabled }) => {
      const relay = options.relay;
      if (!relay) return failed('notPossible', 'Host mode is not available in demo mode');
      if (enabled) return relay.hostMode.start();
      if (relay.client.onOwnRelay) await relay.client.leave();
      return relay.hostMode.stop();
    },
    'flight.create': (args) =>
      options.relay?.client.flight({ cmd: 'flight.create', args }) ?? notConnected(),
    'flight.join': (args) =>
      options.relay?.client.flight({ cmd: 'flight.join', args }) ?? notConnected(),
    'flight.leave': (args) =>
      options.relay?.client.flight({ cmd: 'flight.leave', args }) ?? notConnected(),
    'flight.move': (args) =>
      options.relay?.client.flight({ cmd: 'flight.move', args }) ?? notConnected(),
    'flight.moveUp': (args) =>
      options.relay?.client.flight({ cmd: 'flight.moveUp', args }) ?? notConnected(),

    // Manual own-ship values (§6.2): each wins until cleared; `null` clears.
    'ownship.setPosition': (position) =>
      setOverrides((overrides) => {
        overrides.position = position;
      }),
    'ownship.setFuel': (fuel) =>
      setOverrides((overrides) => {
        overrides.fuel = fuel;
      }),
    'ownship.setStation': (station) =>
      setOverrides((overrides) => {
        overrides.stations = [
          ...overrides.stations.filter((existing) => existing.st !== station.st),
          station,
        ].sort((a, b) => a.st - b.st);
      }),
    'ownship.clearStation': ({ st }) =>
      setOverrides((overrides) => {
        overrides.stations = overrides.stations.filter((existing) => existing.st !== st);
      }),
    'ownship.setGun': (gun) =>
      setOverrides((overrides) => {
        overrides.gun = gun;
      }),

    // DCS user folders (P1.3) – Saved Games\DCS*\Scripts only.
    'dcs.rescan': async () => {
      if (!options.dcs) return failed('notPossible', NO_DCS);
      await options.dcs.rescan();
      return { ok: true };
    },
    'dcs.install': ({ folder }) =>
      options.dcs?.run('install', folder) ?? failed('notPossible', NO_DCS),
    'dcs.repair': ({ folder }) =>
      options.dcs?.run('repair', folder) ?? failed('notPossible', NO_DCS),
    'dcs.remove': ({ folder }) =>
      options.dcs?.run('remove', folder) ?? failed('notPossible', NO_DCS),

    // LAN access and pairing (P1.8).
    'lan.set': ({ enabled }) => options.lan?.set(enabled) ?? failed('notPossible', NO_LAN),
    'lan.pair': ({ address }) => options.lan?.pair(address) ?? failed('notPossible', NO_LAN),
    'lan.cancelPair': () => options.lan?.cancelPair() ?? failed('notPossible', NO_LAN),
    'lan.removeDevice': ({ id }) => options.lan?.remove(id) ?? failed('notPossible', NO_LAN),
    'lan.removeAll': () => options.lan?.removeAll() ?? failed('notPossible', NO_LAN),
    'lan.addFirewallRule': () => options.lan?.addFirewallRule() ?? failed('notPossible', NO_LAN),
    'app.checkUpdate': () => options.app?.updater.check() ?? failed('notPossible', NO_APP),
    'app.installUpdate': () => options.app?.updater.install() ?? failed('notPossible', NO_APP),
    'app.quit': () => options.app?.quit() ?? failed('notPossible', NO_APP),
    'app.uninstall': ({ wipe }) => options.app?.uninstall(wipe) ?? failed('notPossible', NO_APP),

    // Settings – shared by all of the user's screens.
    'settings.set': (changes) => {
      store.update({ settings: { ...store.get('settings'), ...changes } });
      return { ok: true };
    },
  };
}
