// SPDX-License-Identifier: GPL-3.0-or-later
// P2 host ↔ UI: the CAS slices and commands (protocol.md §14).

import { describe, expect, it } from 'vitest';

import { AO, brief, content, FLIGHT, mission } from './cas-fixtures.js';
import { defaultCasSlices } from './cas-slices.js';
import { FM_COMMANDS } from './missions.js';
import { defaultSlices } from './slices.js';
import { ID_1 } from './test-helpers.js';
import {
  CAS_COMMANDS,
  Command,
  parseScreenMessage,
  RELAY_COMMANDS,
  Slices,
  StateUpdate,
} from './ui.js';

const cmd = (name: string, args: unknown) => ({ t: 'cmd', id: ID_1, body: { cmd: name, args } });

describe('CAS slices', () => {
  it('a new host has every slice, the CAS ones empty', () => {
    const slices = defaultSlices('0.2.0-dev');
    expect(Slices.safeParse(slices).success).toBe(true);
    expect(slices).toMatchObject(defaultCasSlices());
  });

  it('an update can carry missions, the check-in draft and fuel calls', () => {
    const cas = {
      ...defaultCasSlices().cas,
      briefDraft: { brief: brief(), edited: ['playtimeMin', 'abortCode'] },
      deliveries: [{ id: ID_1, relay: true, receivedBy: ['p_9c11aa'] }],
    };
    const fuelCalls = {
      jokerKg: 1360,
      bingoKg: 907,
      prompt: 'joker',
      sent: [],
      received: [
        {
          pid: 'p_2b81de',
          callsign: 'Enfield 1-2',
          call: 'joker',
          internalKg: 1350,
          receivedAt: 1,
        },
      ],
    };
    const update = StateUpdate.safeParse({
      t: 'state.update',
      seq: 5,
      body: { slices: { cas, missions: { missions: [mission()] }, fuelCalls } },
    });
    expect(update.success).toBe(true);
  });

  it('refuses a brief draft that marks an unknown field as edited', () => {
    const cas = { ...defaultCasSlices().cas, briefDraft: { brief: brief(), edited: ['colour'] } };
    expect(
      StateUpdate.safeParse({ t: 'state.update', seq: 5, body: { slices: { cas } } }).success,
    ).toBe(false);
  });
});

describe('CAS commands', () => {
  it('every relay mission message is also a command', () => {
    const names = new Set(Command.options.map((option) => option.shape.cmd.value));
    for (const message of FM_COMMANDS) expect(names.has(message.shape.type.value)).toBe(true);
  });

  it('lists the CAS commands apart; none of them is wired to the relay yet', () => {
    expect(CAS_COMMANDS).toContain('cas.checkIn');
    expect(CAS_COMMANDS).toContain('fm.clear');
    expect(CAS_COMMANDS).toContain('fuel.setLevels');
    for (const name of CAS_COMMANDS) expect(RELAY_COMMANDS.has(name)).toBe(false);
  });

  it.each([
    ['cas.checkIn', { target: { scope: 'ao', id: AO } }],
    ['cas.checkIn', { target: { scope: 'pid', id: 'p_9c11aa' } }],
    ['cas.setBrief', { changes: { playtimeMin: 35 }, reset: ['ordnance'] }],
    ['cas.sitCopy', { id: ID_1 }],
    [
      'cas.sitUpdate',
      {
        aoId: AO,
        flightId: null,
        update: {
          threats: { text: '', cmIds: [] },
          targets: { text: '', cmIds: [] },
          friendlies: { text: '', cmIds: [] },
          fires: '',
          clearanceAuthority: '',
          restrictions: '',
          hazards: '',
        },
      },
    ],
    ['fuel.call', { call: 'bingo' }],
    ['fuel.setLevels', { jokerKg: null, bingoKg: 907 }],
    ['jtac.onStation', { callsign: 'Axeman 11', freqs: [], joinCode: 'Q4T-8MZ' }],
    ['fm.create', { ...content(), aoId: AO }],
    ['fm.assign', { missionId: 'm_1', assignee: { flightId: FLIGHT, pids: null } }],
    ['log.request', { scope: 'flight', id: FLIGHT, from: 10, to: null }],
  ])('accepts %s', (name, args) => {
    expect(parseScreenMessage(cmd(name, args))).toMatchObject({ ok: true });
  });

  it.each([
    ['cas.checkIn', { target: { scope: 'flight', id: FLIGHT } }],
    ['cas.setBrief', { changes: { playtimeMin: -5 }, reset: [] }],
    ['fuel.call', { call: 'chicken' }],
    ['fm.clear', { missionId: 'm_1', pid: 'p_1', kind: 'maybe' }],
  ])('answers badCommand for a broken %s', (name, args) => {
    expect(parseScreenMessage(cmd(name, args))).toMatchObject({
      ok: false,
      reply: { code: 'badCommand' },
    });
  });
});
