// SPDX-License-Identifier: GPL-3.0-or-later
// Demo data for layout tests before the Lua bridge exists (P1.2): a running
// mission on Caucasus and an F/A-18C near Batumi. Started with `--demo`.
// Never used in a real session.

import { BRIDGE_VERSION } from '@slate-dcs/shared';

import type { StateStore } from './state/store.js';

/** 08:30:00 local on the mission's start date. */
const DEMO_MTIME_SEC = 8 * 3600 + 30 * 60;

export function applyDemoState(store: StateStore, now: number = Date.now()): void {
  store.update({
    host: {
      ...store.get('host'),
      bridge: { state: 'receiving', version: BRIDGE_VERSION, dcsVersion: '2.9.30.28738' },
    },
    mission: {
      running: true,
      name: 'SLATE demo',
      theatre: 'Caucasus',
      startDate: '2026-06-21',
      multiplayer: false,
      coalition: 'blue',
      playerName: 'Demo Pilot',
      clock: { mtimeSec: DEMO_MTIME_SEC, sampledAt: now, paused: false },
    },
    // Layout only: in demo mode the dcs.* commands answer notPossible.
    dcs: {
      savedGames: 'C:\\Users\\Demo\\Saved Games',
      folders: [
        {
          name: 'DCS',
          path: 'C:\\Users\\Demo\\Saved Games\\DCS',
          state: 'needsRepair',
          problems: ['blockMissing'],
        },
        {
          name: 'DCS.openbeta',
          path: 'C:\\Users\\Demo\\Saved Games\\DCS.openbeta',
          state: 'notInstalled',
          problems: [],
        },
      ],
      scannedAt: now,
      error: null,
    },
    ownship: {
      ...store.get('ownship'),
      aircraft: { type: 'FA-18C_hornet', unit: 'Enfield 1-1', slot: '1000043' },
      countermeasures: { chaff: 60, flare: 54 },
      airData: { tas: 179.6, mach: 0.55, vs: 2.5 },
      statusAt: now,
      status: {
        pos: { lat: 41.6123, lon: 41.6391, altMsl: 4572.4, altAgl: 4431.0 },
        hdg: 47.3,
        hdgMag: 40.8,
        gs: 180.5,
        ias: 154.2,
        fuel: { internalKg: 3912, externalKg: 1018, source: 'export' },
        armament: {
          stations: [
            { st: 1, name: 'AIM-9X', kind: 'missile', role: 'aa', count: 1, source: 'export' },
            { st: 2, name: 'GBU-12', kind: 'bomb', role: 'ag', count: 2, source: 'export' },
            {
              st: 3,
              name: 'AGM-65F Maverick',
              kind: 'missile',
              role: 'ag',
              count: 1,
              source: 'manual',
            },
            {
              st: 7,
              name: 'AGM-65F Maverick',
              kind: 'missile',
              role: 'ag',
              count: 1,
              source: 'export',
            },
            { st: 8, name: 'GBU-12', kind: 'bomb', role: 'ag', count: 2, source: 'export' },
            { st: 9, name: 'AIM-9X', kind: 'missile', role: 'aa', count: 1, source: 'export' },
          ],
          gun: { rounds: 578, source: 'export' },
          stores: [
            { st: 4, name: 'Litening TGP' },
            { st: 5, name: 'FPU-8A tank' },
          ],
        },
        avail: { pos: true, fuel: true, payload: true },
        reason: 'heartbeat',
      },
    },
  });
}

/**
 * Keeps the demo data "live": refreshes the data age every 2 s, so screens
 * get a steady stream of updates like they will from the bridge. Returns a
 * function that stops it.
 */
export function startDemoTicker(store: StateStore, intervalMs = 2000): () => void {
  const timer = setInterval(() => {
    store.update({ ownship: { ...store.get('ownship'), statusAt: Date.now() } });
  }, intervalMs);
  return () => {
    clearInterval(timer);
  };
}
