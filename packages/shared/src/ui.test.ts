// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { defaultSlices, SLICE_SCHEMAS } from './slices.js';
import { ID_1 } from './test-helpers.js';
import {
  Command,
  CommandResult,
  parseHostMessage,
  parseScreenMessage,
  reconnectDelayMs,
  RELAY_COMMANDS,
  RelayAddress,
  SLICE_NAMES,
  StateResync,
  StateSnapshot,
  StateUpdate,
  UI_TIMING,
  updateAction,
} from './ui.js';

const slices = defaultSlices('0.1.0+3f2c1ab');
const snapshot = { t: 'state.snapshot', seq: 0, body: { build: '0.1.0+3f2c1ab', slices } };
const cmd = (name: string, args: unknown) => ({ t: 'cmd', id: ID_1, body: { cmd: name, args } });
const localSettings = { timeDisplay: 'local', uiScale: 1.25, speeds: ['ias', 'gs'] };

describe('state.snapshot', () => {
  it('accepts the state of a host that just started', () => {
    expect(StateSnapshot.safeParse(snapshot).success).toBe(true);
  });

  it('has a schema for every slice name', () => {
    expect(Object.keys(SLICE_SCHEMAS).sort()).toEqual([...SLICE_NAMES].sort());
  });

  it.each(SLICE_NAMES)('rejects a snapshot without the "%s" slice', (name) => {
    const incomplete = Object.fromEntries(Object.entries(slices).filter(([n]) => n !== name));
    expect(
      StateSnapshot.safeParse({ ...snapshot, body: { ...snapshot.body, slices: incomplete } })
        .success,
    ).toBe(false);
  });

  it('rejects a slice with broken contents', () => {
    const broken = { ...slices, settings: { timeDisplay: 'pc', uiScale: 1 } };
    expect(
      StateSnapshot.safeParse({ ...snapshot, body: { ...snapshot.body, slices: broken } }).success,
    ).toBe(false);
  });

  it.each([
    ['no build version', { body: { build: '', slices } }],
    ['a negative seq', { seq: -1 }],
    ['no seq', { seq: undefined }],
  ])('rejects a snapshot with %s', (_why, change) => {
    expect(StateSnapshot.safeParse({ ...snapshot, ...change }).success).toBe(false);
  });
});

describe('state.update', () => {
  it('accepts an update of one slice', () => {
    const update = { t: 'state.update', seq: 1, body: { slices: { settings: localSettings } } };
    expect(StateUpdate.safeParse(update).success).toBe(true);
  });

  it('accepts an update of several slices at once (one event, one update)', () => {
    const update = {
      t: 'state.update',
      seq: 7,
      body: { slices: { flight: slices.flight, session: slices.session } },
    };
    expect(StateUpdate.safeParse(update).success).toBe(true);
  });

  it('rejects an update that changes no slice', () => {
    expect(StateUpdate.safeParse({ t: 'state.update', seq: 1, body: { slices: {} } }).success).toBe(
      false,
    );
  });

  it('rejects an update with broken slice contents', () => {
    const update = { t: 'state.update', seq: 1, body: { slices: { flight: { own: 'x' } } } };
    expect(StateUpdate.safeParse(update).success).toBe(false);
  });

  it('rejects an update with seq 0 (only a snapshot can carry 0)', () => {
    const update = { t: 'state.update', seq: 0, body: { slices: { settings: localSettings } } };
    expect(StateUpdate.safeParse(update).success).toBe(false);
  });

  it('strips slice names it does not know', () => {
    const result = StateUpdate.safeParse({
      t: 'state.update',
      seq: 2,
      body: { slices: { settings: localSettings, somethingNew: 1 } },
    });
    expect(result.success && Object.keys(result.data.body.slices)).toEqual(['settings']);
  });
});

describe('state.resync', () => {
  it('accepts an empty resync request', () => {
    expect(StateResync.safeParse({ t: 'state.resync', body: {} }).success).toBe(true);
  });
});

describe('commands (protocol.md §14.7)', () => {
  it.each([
    [
      'session.join',
      {
        address: 'slate-grp.dyndns.org:7790',
        code: 'GROUP-4H7K2M9Q',
        coalition: 'blue',
        nick: 'Vis7',
        role: 'pilot',
      },
    ],
    [
      'session.join',
      {
        address: '192.168.1.20',
        code: 'BLUE-7K3Q9XPM',
        coalition: null,
        nick: 'Vis7',
        role: 'jtac',
      },
    ],
    ['session.leave', {}],
    ['flight.create', { name: 'Enfield', open: true }],
    ['flight.join', { flightId: 'f_3k9q2m' }],
    ['flight.join', { privateCode: 'K7Q-4XM' }],
    ['flight.leave', {}],
    ['flight.move', { pid: 'p_2b81de', pos: 3 }],
    ['flight.moveUp', {}],
    ['ownship.setPosition', { lat: 42.17, lon: 41.68, altMsl: 120 }],
    ['ownship.setPosition', null],
    ['ownship.setFuel', { internalKg: 2900, externalKg: 1500 }],
    ['ownship.setFuel', null],
    ['ownship.setStation', { st: 3, name: 'AGM-114L', kind: 'missile', role: 'ag', count: 2 }],
    ['ownship.clearStation', { st: 3 }],
    ['ownship.setGun', { rounds: 300 }],
    ['ownship.setGun', null],
    ['lan.set', { enabled: true }],
    ['lan.pair', { address: '192.168.1.20:7792' }],
    ['lan.cancelPair', {}],
    ['lan.removeDevice', { id: 'd_3f2c1a' }],
    ['lan.removeAll', {}],
    ['lan.addFirewallRule', {}],
    ['session.host', { enabled: true }],
    ['session.host', { enabled: false }],
    [
      'session.join',
      {
        address: '127.0.0.1:7790',
        code: 'SLATE-H81C5R2N',
        coalition: 'blue',
        nick: 'Vis7',
        role: 'pilot',
        fingerprint: 'NZ5N-SEHR-0N1A-CA2G-QN0B-WFQE-30',
      },
    ],
    ['dcs.rescan', {}],
    ['dcs.install', { folder: 'DCS' }],
    ['dcs.repair', { folder: 'DCS.openbeta' }],
    ['dcs.remove', { folder: 'DCS' }],
    ['settings.set', { timeDisplay: 'local' }],
    ['settings.set', { uiScale: 1.25 }],
    ['settings.set', { timeDisplay: 'zulu', uiScale: 1 }],
    ['settings.set', { speeds: ['ias', 'tas', 'mach'] }],
    ['settings.set', { speeds: [] }],
  ])('accepts %s %o', (name, args) => {
    expect(Command.safeParse({ cmd: name, args }).success).toBe(true);
  });

  it.each([
    [
      'session.join with a hand-typed code',
      'session.join',
      { address: 'a.b:7790', code: 'blue 7k3q9xpm', coalition: null, nick: 'V', role: 'pilot' },
    ],
    [
      'session.join with port 70000',
      'session.join',
      { address: 'a.b:70000', code: 'BLUE-7K3Q9XPM', coalition: null, nick: 'V', role: 'pilot' },
    ],
    ['flight.move to -1', 'flight.move', { pid: 'p_2b81de', pos: 1 }],
    ['flight.create without a name', 'flight.create', { open: true }],
    ['ownship.setPosition at latitude 95°', 'ownship.setPosition', { lat: 95, lon: 0, altMsl: 0 }],
    ['ownship.setFuel with negative fuel', 'ownship.setFuel', { internalKg: -1, externalKg: 0 }],
    [
      'ownship.setStation without kind',
      'ownship.setStation',
      { st: 3, name: 'AGM-114L', count: 2 },
    ],
    ['ownship.setGun with fractional rounds', 'ownship.setGun', { rounds: 1.5 }],
    [
      'session.join with a broken fingerprint',
      'session.join',
      {
        address: 'a.b',
        code: 'BLUE-7K3Q9XPM',
        coalition: null,
        nick: 'V',
        role: 'pilot',
        fingerprint: 'NZ5N-SEHR',
      },
    ],
    ['session.host without enabled', 'session.host', {}],
    ['dcs.install without a folder', 'dcs.install', {}],
    ['dcs.remove with an empty folder name', 'dcs.remove', { folder: '' }],
    ['settings.set with nothing to set', 'settings.set', {}],
    ['settings.set with an unknown time display', 'settings.set', { timeDisplay: 'pc' }],
    ['settings.set with UI scale 10', 'settings.set', { uiScale: 10 }],
    ['settings.set with an unknown speed', 'settings.set', { speeds: ['cas'] }],
    ['settings.set with a speed twice', 'settings.set', { speeds: ['ias', 'ias'] }],
  ])('rejects %s', (_why, name, args) => {
    expect(Command.safeParse({ cmd: name, args }).success).toBe(false);
  });

  it('forwards exactly the session and flight commands to the relay', () => {
    expect([...RELAY_COMMANDS].sort()).toEqual(
      [
        'flight.create',
        'flight.join',
        'flight.leave',
        'flight.move',
        'flight.moveUp',
        'session.join',
        'session.leave',
      ].sort(),
    );
  });
});

describe('RelayAddress', () => {
  it.each(['slate-grp.dyndns.org:7790', '192.168.1.20:7790', 'localhost', ' relay.example.org '])(
    'accepts "%s"',
    (address) => {
      expect(RelayAddress.safeParse(address).success).toBe(true);
    },
  );

  it.each([
    '',
    'http://relay.example.org',
    'relay.example.org:0',
    'relay example.org',
    'relay:port',
  ])('rejects "%s"', (address) => {
    expect(RelayAddress.safeParse(address).success).toBe(false);
  });
});

describe('cmd.result', () => {
  it('accepts a success', () => {
    expect(CommandResult.safeParse({ t: 'cmd.result', id: ID_1, body: { ok: true } }).success).toBe(
      true,
    );
  });

  it('accepts a failure with a known code', () => {
    const result = {
      t: 'cmd.result',
      id: ID_1,
      body: { ok: false, error: { code: 'forbidden', text: 'Not in command' } },
    };
    expect(CommandResult.safeParse(result).success).toBe(true);
  });

  it.each([
    ['a failure without error', { ok: false }],
    ['an unknown error code', { ok: false, error: { code: 'oops', text: '' } }],
  ])('rejects %s', (_why, body) => {
    expect(CommandResult.safeParse({ t: 'cmd.result', id: ID_1, body }).success).toBe(false);
  });
});

describe('parseScreenMessage (host side)', () => {
  it('returns a typed command', () => {
    const result = parseScreenMessage(cmd('flight.create', { name: ' Enfield ', open: false }));
    expect(result.ok).toBe(true);
    if (result.ok && result.message.t === 'cmd' && result.message.body.cmd === 'flight.create') {
      expect(result.message.body.args.name).toBe('Enfield');
    }
  });

  it('accepts a JSON text frame', () => {
    expect(parseScreenMessage(JSON.stringify({ t: 'state.resync', body: {} })).ok).toBe(true);
  });

  it('answers unknownCommand for a command it does not know', () => {
    expect(parseScreenMessage(cmd('fp.push', {}))).toMatchObject({
      ok: false,
      reply: { id: ID_1, code: 'unknownCommand' },
    });
  });

  it('answers badCommand for a known command with broken arguments', () => {
    expect(parseScreenMessage(cmd('flight.move', { pid: 'p_1', pos: 1 }))).toMatchObject({
      ok: false,
      reply: { id: ID_1, code: 'badCommand' },
    });
  });

  it.each([
    ['text that is not JSON', '{nope'],
    ['a command without ID', { t: 'cmd', body: { cmd: 'flight.leave', args: {} } }],
    ['a command with a broken ID', { t: 'cmd', id: 'x', body: { cmd: 'flight.leave', args: {} } }],
    ['an unknown message type', { t: 'state.snapshot', seq: 0, body: {} }],
    ['null', null],
  ])('drops %s without a reply', (_why, input) => {
    expect(parseScreenMessage(input)).toMatchObject({ ok: false, reply: null });
  });
});

describe('parseHostMessage (screen side)', () => {
  it('returns a typed snapshot', () => {
    const result = parseHostMessage(snapshot);
    expect(result.ok && result.message.t === 'state.snapshot' && result.message.body.build).toBe(
      '0.1.0+3f2c1ab',
    );
  });

  it('rejects a frame a screen would send', () => {
    expect(parseHostMessage({ t: 'state.resync', body: {} }).ok).toBe(false);
  });

  it('rejects text that is not JSON', () => {
    expect(parseHostMessage('{nope')).toEqual({ ok: false, detail: 'Not valid JSON' });
  });
});

describe('updateAction (protocol.md §14.4)', () => {
  it.each([
    [10, 11, 'apply'],
    [10, 10, 'ignore'],
    [10, 3, 'ignore'],
    [10, 12, 'resync'],
    [0, 1, 'apply'],
  ])('after seq %i, an update with seq %i → %s', (last, incoming, expected) => {
    expect(updateAction(last, incoming)).toBe(expected);
  });
});

describe('reconnectDelayMs (protocol.md §14.5)', () => {
  it.each([
    [0, 500],
    [1, 1000],
    [2, 2000],
    [3, 4000],
    [4, 5000],
    [20, 5000],
  ])('attempt %i waits %i ms', (attempt, expected) => {
    expect(reconnectDelayMs(attempt)).toBe(expected);
  });

  it('never waits longer than the maximum', () => {
    expect(reconnectDelayMs(1000)).toBe(UI_TIMING.reconnectMaxMs);
  });
});
