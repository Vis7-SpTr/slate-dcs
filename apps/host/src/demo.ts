// SPDX-License-Identifier: GPL-3.0-or-later
// Demo data for layout tests before the Lua bridge exists (P1.2): a running
// mission on Caucasus and an F/A-18C near Batumi. Started with `--demo`.
// Never used in a real session.

import type { StateStore } from './state/store.js';

/** 08:30:00 local on the mission's start date. */
const DEMO_MTIME_SEC = 8 * 3600 + 30 * 60;

export function applyDemoState(store: StateStore, now: number = Date.now()): void {
  store.update({
    host: { ...store.get('host'), bridge: { state: 'receiving' } },
    mission: {
      running: true,
      theatre: 'Caucasus',
      startDate: '2026-06-21',
      clock: { mtimeSec: DEMO_MTIME_SEC, sampledAt: now },
    },
    ownship: {
      ...store.get('ownship'),
      statusAt: now,
      status: {
        pos: { lat: 41.6123, lon: 41.6391, altMsl: 4572.4, altAgl: 4431.0 },
        hdg: 47.3,
        gs: 180.5,
        ias: 154.2,
        fuel: { internalKg: 3912, externalKg: 1452, source: 'export' },
        armament: {
          stations: [
            { st: 1, name: 'AIM-9X', kind: 'missile', count: 1, source: 'export' },
            { st: 2, name: 'GBU-12', kind: 'bomb', count: 2, source: 'export' },
            { st: 3, name: 'AGM-65F Maverick', kind: 'missile', count: 1, source: 'manual' },
            { st: 7, name: 'AGM-65F Maverick', kind: 'missile', count: 1, source: 'export' },
            { st: 8, name: 'GBU-12', kind: 'bomb', count: 2, source: 'export' },
            { st: 9, name: 'AIM-9X', kind: 'missile', count: 1, source: 'export' },
          ],
          gun: { rounds: 578, source: 'export' },
          stores: [
            { st: 4, name: 'Litening TGP' },
            { st: 5, name: 'FPU-8A' },
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
