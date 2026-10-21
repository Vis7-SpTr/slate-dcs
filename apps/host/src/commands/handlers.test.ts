// SPDX-License-Identifier: GPL-3.0-or-later

import { defaultSlices, RELAY_COMMANDS } from '@slate-dcs/shared';
import type { Command } from '@slate-dcs/shared';
import { describe, expect, it } from 'vitest';

import { CommandDispatcher } from './dispatcher.js';
import { createHandlers } from './handlers.js';
import { StateStore } from '../state/store.js';

let counter = 0;
/** A fresh valid ULID per call. */
const nextId = () => `01JABD2K7Q0M3N4P5R6S7T${String(counter++).padStart(4, '0')}`;

function setup() {
  const store = new StateStore(defaultSlices('test'));
  const dispatcher = new CommandDispatcher(createHandlers(store));
  const run = (command: Command) => dispatcher.dispatch(nextId(), command);
  return { store, run };
}

const hellfire = { st: 3, name: 'AGM-114L', kind: 'missile' as const, count: 2 };

describe('settings.set', () => {
  it('changes only the given setting', async () => {
    const { store, run } = setup();
    await expect(run({ cmd: 'settings.set', args: { timeDisplay: 'local' } })).resolves.toEqual({
      ok: true,
    });
    expect(store.get('settings')).toEqual({ timeDisplay: 'local', uiScale: 1 });
  });
});

describe('ownship overrides', () => {
  it('sets and clears a manual position', async () => {
    const { store, run } = setup();
    await run({ cmd: 'ownship.setPosition', args: { lat: 42.17, lon: 41.68, altMsl: 120 } });
    expect(store.get('ownship').overrides.position).toEqual({
      lat: 42.17,
      lon: 41.68,
      altMsl: 120,
    });
    await run({ cmd: 'ownship.setPosition', args: null });
    expect(store.get('ownship').overrides.position).toBeNull();
  });

  it('sets and clears manual fuel and gun rounds', async () => {
    const { store, run } = setup();
    await run({ cmd: 'ownship.setFuel', args: { internalKg: 2900, externalKg: 0 } });
    await run({ cmd: 'ownship.setGun', args: { rounds: 300 } });
    expect(store.get('ownship').overrides).toMatchObject({
      fuel: { internalKg: 2900, externalKg: 0 },
      gun: { rounds: 300 },
    });
    await run({ cmd: 'ownship.setFuel', args: null });
    await run({ cmd: 'ownship.setGun', args: null });
    expect(store.get('ownship').overrides).toMatchObject({ fuel: null, gun: null });
  });

  it('replaces a station edit for the same station and keeps stations sorted', async () => {
    const { store, run } = setup();
    await run({ cmd: 'ownship.setStation', args: hellfire });
    await run({
      cmd: 'ownship.setStation',
      args: { st: 1, name: 'Hydra 70 M229 HE', kind: 'rocket', count: 19 },
    });
    await run({ cmd: 'ownship.setStation', args: { ...hellfire, count: 1 } });
    expect(store.get('ownship').overrides.stations.map((s) => [s.st, s.count])).toEqual([
      [1, 19],
      [3, 1],
    ]);
  });

  it('clears one station edit and leaves the others', async () => {
    const { store, run } = setup();
    await run({ cmd: 'ownship.setStation', args: hellfire });
    await run({ cmd: 'ownship.setStation', args: { ...hellfire, st: 4 } });
    await run({ cmd: 'ownship.clearStation', args: { st: 3 } });
    expect(store.get('ownship').overrides.stations.map((s) => s.st)).toEqual([4]);
  });

  it('clearing a station without an edit is fine', async () => {
    const { run } = setup();
    await expect(run({ cmd: 'ownship.clearStation', args: { st: 7 } })).resolves.toEqual({
      ok: true,
    });
  });
});

describe('relay commands before the relay exists', () => {
  const examples: Command[] = [
    {
      cmd: 'session.join',
      args: {
        address: 'relay.example.org:7790',
        code: 'BLUE-7K3Q9XPM',
        coalition: null,
        nick: 'Vis7',
        role: 'pilot',
      },
    },
    { cmd: 'session.leave', args: {} },
    { cmd: 'flight.create', args: { name: 'Enfield', open: true } },
    { cmd: 'flight.join', args: { flightId: 'f_1' } },
    { cmd: 'flight.leave', args: {} },
    { cmd: 'flight.move', args: { pid: 'p_1', pos: 2 } },
    { cmd: 'flight.moveUp', args: {} },
  ];

  it('covers every relay command', () => {
    expect(examples.map((c) => c.cmd).sort()).toEqual([...RELAY_COMMANDS].sort());
  });

  it.each(examples)('$cmd answers notConnected and changes nothing', async (command) => {
    const { store, run } = setup();
    const outcome = await run(command);
    expect(outcome).toMatchObject({ ok: false, error: { code: 'notConnected' } });
    expect(store.seq).toBe(0);
  });
});
