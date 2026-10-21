// SPDX-License-Identifier: GPL-3.0-or-later
// Command handlers (protocol.md §14.7). Host-only commands change the state
// store directly; relay commands answer `notConnected` until the relay
// connection exists (P1.6).

import type { OwnshipOverrides } from '@slate-dcs/shared';

import type { CommandHandlers } from './dispatcher.js';
import { failed } from './dispatcher.js';
import type { StateStore } from '../state/store.js';

const NO_RELAY = 'No relay connection yet – joining sessions and flights comes with P1.6';

export function createHandlers(store: StateStore): CommandHandlers {
  const notConnected = () => failed('notConnected', NO_RELAY);

  /** Applies a change to the ownship overrides and stores the slice. */
  const setOverrides = (change: (overrides: OwnshipOverrides) => void): { ok: true } => {
    const ownship = store.get('ownship');
    change(ownship.overrides);
    store.update({ ownship });
    return { ok: true };
  };

  return {
    // Relay commands – P1.6.
    'session.join': notConnected,
    'session.leave': notConnected,
    'flight.create': notConnected,
    'flight.join': notConnected,
    'flight.leave': notConnected,
    'flight.move': notConnected,
    'flight.moveUp': notConnected,

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

    // Settings – shared by all of the user's screens.
    'settings.set': (changes) => {
      store.update({ settings: { ...store.get('settings'), ...changes } });
      return { ok: true };
    },
  };
}
