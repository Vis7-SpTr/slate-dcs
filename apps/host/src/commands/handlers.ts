// SPDX-License-Identifier: GPL-3.0-or-later
// Command handlers (protocol.md §14.7). Host-only commands change the state
// store directly; relay commands go through the relay client and answer once
// the relay has (P1.6c).

import type { OwnshipOverrides } from '@slate-dcs/shared';

import type { CommandHandlers } from './dispatcher.js';
import { failed } from './dispatcher.js';
import type { DcsIntegration } from '../dcs-integration/service.js';
import type { RelayClient } from '../session/client.js';
import type { HostMode } from '../session/host-mode.js';
import type { StateStore } from '../state/store.js';

const NO_RELAY = 'Sessions are not available in demo mode';
const NO_DCS = 'DCS folders are not available in demo mode';

export interface HandlerOptions {
  /**
   * Read at each command, so it can be set after the server started. `null`
   * (demo mode, or not yet): the `dcs.*` commands answer notPossible.
   */
  readonly dcs?: DcsIntegration | null;
  /** Relay client and host mode; `null` (demo mode): relay commands answer notConnected. */
  readonly relay?: { client: RelayClient; hostMode: HostMode } | null;
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
    // Relay commands (P1.6c). The host's own relay (host mode) is joined directly.
    'session.join': (args) => {
      const relay = options.relay;
      if (!relay) return notConnected();
      return relay.client.join(args, relay.hostMode.relayFor(args.address));
    },
    'session.leave': () => options.relay?.client.leave() ?? notConnected(),
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

    // Settings – shared by all of the user's screens.
    'settings.set': (changes) => {
      store.update({ settings: { ...store.get('settings'), ...changes } });
      return { ok: true };
    },
  };
}
