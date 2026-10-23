// SPDX-License-Identifier: GPL-3.0-or-later

import { defaultSlices } from '@slate-dcs/shared';
import type { Command, Slices } from '@slate-dcs/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandDispatcher } from '../commands/dispatcher.js';
import { createHandlers } from '../commands/handlers.js';
import { StateStore } from '../state/store.js';
import { DcsBridge } from './service.js';
import { emptyOwn, hornetOwn, hornetSession, text, vehicleOwn } from './test-data.js';

const T0 = Date.UTC(2026, 9, 21, 18, 0, 0);

let counter = 0;
const nextId = () => `01JABD2K7Q0M3N4P5R6S7T${String(counter++).padStart(4, '0')}`;

function setup() {
  const store = new StateStore(defaultSlices('test'));
  const logs: { level: string; message: string }[] = [];
  const log = {
    info: (message: string) => logs.push({ level: 'info', message }),
    warn: (message: string) => logs.push({ level: 'warn', message }),
    debug: (message: string) => logs.push({ level: 'debug', message }),
  };
  const bridge = new DcsBridge({ store, log });
  const updates: Partial<Slices>[] = [];
  store.subscribe((change) => updates.push(change.slices));
  const dispatcher = new CommandDispatcher(createHandlers(store));
  const run = (command: Command) => dispatcher.dispatch(nextId(), command);
  /** Sends a datagram and lets `ms` pass afterwards. */
  const send = (datagram: Record<string, unknown>, ms = 0) => {
    bridge.handleText(text(datagram));
    vi.advanceTimersByTime(ms);
  };
  const messages = (level?: string) =>
    logs.filter((l) => level === undefined || l.level === level).map((l) => l.message);
  return { store, bridge, updates, run, send, messages };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DcsBridge – own-ship data', () => {
  it('fills host, mission and ownship from the first own datagram at once', () => {
    const { store, bridge, updates, send } = setup();
    expect(bridge.state).toBe('waiting');
    send(hornetOwn());

    expect(bridge.state).toBe('receiving');
    expect(updates).toHaveLength(1);
    expect(store.get('host').bridge).toEqual({ state: 'receiving', version: 4, dcsVersion: null });
    expect(store.get('mission')).toMatchObject({
      running: true,
      clock: { mtimeSec: 64800, sampledAt: T0, paused: false },
    });
    const ownship = store.get('ownship');
    expect(ownship.aircraft).toEqual({ type: 'FA-18C_hornet', unit: 'New callsign' });
    expect(ownship.statusAt).toBe(T0);
    expect(ownship.status?.hdg).toBeCloseTo(45.61, 1);
    expect(ownship.status?.hdgMag).toBeCloseTo(38.53, 1);
    expect(ownship.status?.fuel?.internalKg).toBe(4900);
    expect(ownship.countermeasures).toEqual({ chaff: 60, flare: 60 });
  });

  it('publishes routine updates at most every 500 ms, latest wins', () => {
    const { store, updates, send } = setup();
    for (let i = 0; i < 8; i += 1) {
      send(hornetOwn({ mt: i * 0.25, altMsl: 1000 + i }), 250);
    }
    vi.advanceTimersByTime(500);
    const ownshipUpdates = updates.filter((u) => u.ownship !== undefined);
    expect(ownshipUpdates.length).toBeGreaterThanOrEqual(4);
    expect(ownshipUpdates.length).toBeLessThanOrEqual(5);
    expect(store.get('ownship').status?.pos?.altMsl).toBe(1007);
  });

  it('publishes a weapon release at once', () => {
    const { store, send } = setup();
    send(hornetOwn(), 100);
    const payload = (hornetOwn()['payload'] as { st: number; count: number }[]).map((s) =>
      s.st === 9 ? { ...s, count: 0 } : s,
    );
    send(hornetOwn({ mt: 0.1, payload }));
    expect(store.get('ownship').status?.armament?.stations.find((s) => s.st === 9)?.count).toBe(0);
  });

  it('logs payload changes and an own-ship summary every 10 s', () => {
    const { bridge, send, messages } = setup();
    send(hornetOwn());
    expect(messages('info')).toContainEqual(
      expect.stringMatching(/^Payload: 1 AIM-9X ×1 · 2 AGM-65F Maverick ×1 .* 5 FPU-8A tank$/),
    );
    bridge.tick();
    expect(messages('info')).toContainEqual(
      expect.stringMatching(
        /^Own: F\/A-18C, 43\.6441 43\.6648, 3992 ft, 039°M, 046°T, GS 549 kt, IAS 509 kt, fuel 4900\+1018 kg, 9 weapons, gun 578, clock 18:00:00L$/,
      ),
    );
    const before = messages('info').length;
    vi.advanceTimersByTime(5000);
    bridge.tick();
    expect(messages('info')).toHaveLength(before);
    vi.advanceTimersByTime(5000);
    bridge.tick();
    // The clock in the summary is the current mission time, not the last sample.
    expect(messages('info').at(-1)).toMatch(/, clock 18:00:10L$/);
  });

  it('warns once about an airframe without a fuel capacity', () => {
    const { store, send, messages } = setup();
    send(hornetOwn({ type: 'Su-25T' }));
    send(hornetOwn({ type: 'Su-25T', mt: 0.25 }));
    expect(store.get('ownship').status?.fuel).toBeNull();
    expect(messages('warn').filter((m) => m.includes('Su-25T'))).toHaveLength(1);
  });
});

describe('DcsBridge – mission and clock', () => {
  it('fills the mission from the hook and takes the slot from it', () => {
    const { store, send, messages } = setup();
    send(hornetSession());
    expect(store.get('mission')).toEqual({
      running: true,
      name: 'VWA_CAU_2.2.11',
      theatre: 'Caucasus',
      startDate: '2026-10-09',
      multiplayer: true,
      coalition: 'blue',
      playerName: 'Pilot',
      clock: { mtimeSec: 36000 + 8388.825, sampledAt: T0, paused: false },
    });
    expect(store.get('ownship').aircraft).toEqual({ type: 'FA-18C_hornet', slot: '1000043' });
    expect(messages('info')).toContain(
      'Mission: VWA_CAU_2.2.11 – Caucasus, 2026-10-09, start 10:00:00 local, multiplayer',
    );

    send(hornetOwn({ mt: 8389, start: 36000 }));
    expect(store.get('ownship').aircraft).toEqual({
      type: 'FA-18C_hornet',
      unit: 'New callsign',
      slot: '1000043',
    });
  });

  it('stays waiting while a loaded mission hasn\u2019t started (briefing)', () => {
    const { store, bridge, send } = setup();
    send(hornetSession({ ev: 'load', running: false }));
    expect(bridge.state).toBe('waiting');
    expect(store.get('mission')).toMatchObject({ running: false, name: 'VWA_CAU_2.2.11' });
    vi.advanceTimersByTime(30_000);
    bridge.tick();
    expect(bridge.state).toBe('waiting');
    send(hornetSession({ ev: 'start' }));
    expect(bridge.state).toBe('receiving');
  });

  it('only republishes the clock when it drifts more than 0.5 s', () => {
    const { updates, send } = setup();
    for (let i = 0; i < 20; i += 1) send(hornetOwn({ mt: i * 0.25 }), 250);
    expect(updates.filter((u) => u.mission !== undefined)).toHaveLength(1);

    send(hornetOwn({ mt: 60 })); // e.g. time acceleration in single player
    vi.advanceTimersByTime(500);
    const missions = updates.filter((u) => u.mission !== undefined);
    expect(missions).toHaveLength(2);
    expect(missions[1]?.mission?.clock?.mtimeSec).toBe(64800 + 60);
  });

  it('marks the clock paused while model time stands still, and resumes', () => {
    const { store, send, messages } = setup();
    send(hornetOwn({ mt: 100 }), 250);
    for (let i = 0; i < 8; i += 1) send(hornetOwn({ mt: 100.25 }), 250);
    vi.advanceTimersByTime(500);
    expect(store.get('mission').clock).toMatchObject({ mtimeSec: 64800 + 100.25, paused: true });
    expect(messages('info')).toContain('Mission paused');

    send(hornetOwn({ mt: 100.5 }));
    vi.advanceTimersByTime(500);
    expect(store.get('mission').clock?.paused).toBe(false);
    expect(messages('info')).toContain('Mission resumed');
  });

  it('keeps the clock from the hook for a JTAC on the F10 map', () => {
    const { store, send } = setup();
    send(
      hornetSession({
        player: {
          name: 'JTAC',
          side: 2,
          slot: 'forward_observer_blue_4',
          unitType: 'forward_observer',
        },
      }),
    );
    send(emptyOwn(9233.2));
    expect(store.get('ownship').aircraft).toEqual({
      type: 'forward_observer',
      slot: 'forward_observer_blue_4',
    });
    expect(store.get('ownship').status).toMatchObject({ pos: null, avail: { pos: false } });
    expect(store.get('mission').clock?.mtimeSec).toBeCloseTo(36000 + 9233.2, 1);
  });

  it('ends the mission on the hook’s stop and ignores leftover own datagrams', () => {
    const { store, bridge, send, messages } = setup();
    send(hornetSession());
    send(hornetOwn({ mt: 8389, start: 36000 }), 100);
    send({ ...hornetSession(), ev: 'stop', running: false });

    expect(bridge.state).toBe('waiting');
    expect(store.get('mission')).toMatchObject({ running: false, name: null, clock: null });
    expect(store.get('ownship')).toMatchObject({
      aircraft: null,
      status: null,
      countermeasures: null,
    });
    expect(messages('info')).toContain('Mission ended');

    send(hornetOwn({ mt: 8389.2 }), 500);
    expect(store.get('mission').running).toBe(false);
    vi.advanceTimersByTime(2000);
    send(hornetOwn({ mt: 0 }));
    expect(store.get('mission').running).toBe(true);
  });

  it('turns stale when data stops without a mission end, and recovers', () => {
    const { store, bridge, send, messages } = setup();
    send(hornetOwn());
    vi.advanceTimersByTime(9000);
    bridge.tick();
    expect(bridge.state).toBe('receiving');
    vi.advanceTimersByTime(2000);
    bridge.tick();
    expect(bridge.state).toBe('stale');
    expect(store.get('host').bridge.state).toBe('stale');
    expect(store.get('mission')).toMatchObject({ running: false, clock: null });
    expect(store.get('ownship').status).not.toBeNull(); // last data stays, with its age
    expect(messages('warn')).toContainEqual(expect.stringContaining('DCS data stopped'));

    send(hornetOwn({ mt: 11 }));
    expect(store.get('host').bridge.state).toBe('receiving');
    expect(store.get('mission').running).toBe(true);
  });
});

describe('DcsBridge – overrides', () => {
  it('rebuilds the status right after an ownship command', async () => {
    const { store, run, send } = setup();
    send(hornetOwn());
    await run({ cmd: 'ownship.setGun', args: { rounds: 100 } });
    await Promise.resolve();
    expect(store.get('ownship').status?.armament?.gun).toEqual({ rounds: 100, source: 'manual' });
  });

  it('shows a manual position with no DCS running at all', async () => {
    const { store, run } = setup();
    await run({ cmd: 'ownship.setPosition', args: { lat: 42.1, lon: 41.7, altMsl: 150 } });
    await Promise.resolve();
    expect(store.get('ownship').status?.pos).toEqual({
      lat: 42.1,
      lon: 41.7,
      altMsl: 150,
      altAgl: null,
    });
    expect(store.get('ownship').statusAt).toBe(T0);
  });

  it('never loses an override set between two throttled publishes', async () => {
    const { store, run, send } = setup();
    send(hornetOwn(), 100);
    send(hornetOwn({ mt: 0.1 }));
    await run({ cmd: 'ownship.setGun', args: { rounds: 50 } });
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(store.get('ownship').overrides.gun).toEqual({ rounds: 50 });
  });

  it('clears overrides when the own aircraft changes', async () => {
    const { store, run, send } = setup();
    send(hornetOwn());
    await run({ cmd: 'ownship.setGun', args: { rounds: 100 } });
    await Promise.resolve();
    send(vehicleOwn());
    expect(store.get('ownship').overrides.gun).toBeNull();
    expect(store.get('ownship').aircraft?.type).toBe('MaxxPro_MRAP');
  });
});

describe('DcsBridge – versions and bad data', () => {
  it('records the DCS version from hello', () => {
    const { store, send, messages } = setup();
    send({ t: 'hello', bv: 4, env: 'export', dcs: '2.9.30.28738' });
    expect(store.get('host').bridge).toEqual({
      state: 'waiting',
      version: 4,
      dcsVersion: '2.9.30.28738',
    });
    expect(messages('info')).toContain('Lua bridge: export script v4, DCS 2.9.30.28738');
  });

  it('reports Lua files of another version once and ignores their data', () => {
    const { store, bridge, send, messages } = setup();
    // Lua files of the first version (before the magnetic heading).
    send(hornetOwn({ bv: 1 }));
    send(hornetOwn({ bv: 1, mt: 1 }));
    expect(store.get('host').bridge.version).toBe(1);
    expect(bridge.state).toBe('waiting');
    expect(store.get('ownship').status).toBeNull();
    expect(messages('warn').filter((m) => m.includes('are version 1'))).toHaveLength(1);
  });

  it('warns about the first 5 bad datagrams, then logs them as debug', () => {
    const { bridge, messages } = setup();
    for (let i = 0; i < 7; i += 1) bridge.handleText('{"t":"own","bv":4}');
    expect(messages('warn')).toHaveLength(5);
    expect(messages('debug')).toHaveLength(2);
  });

  it('logs the mission check counts', () => {
    const { send, messages } = setup();
    send({
      t: 'missionCheck',
      bv: 4,
      coalitions: { blue: { groups: 12, units: 30, routed: 10, withFrequency: 8 } },
    });
    expect(messages('info')).toContain(
      'Mission data seen by DCS.getCurrentMission(): blue 12 groups/30 units (10 with route, 8 with frequency)',
    );
  });
});
