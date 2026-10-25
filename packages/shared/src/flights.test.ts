// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  Flight,
  FLIGHT_RULES,
  FlightClosed,
  FlightCreate,
  FlightJoin,
  FlightLeave,
  FlightListed,
  FlightMove,
  FlightMoveUp,
  FlightName,
  flightNameKey,
  FlightUpdated,
  normalizeFlightCode,
  PrivateFlightCode,
} from './flights.js';
import { parseMessage } from './messages.js';
import { SessionState } from './session.js';
import { envelope } from './test-helpers.js';

const message = (type: string, body: unknown) => ({ ...envelope(), type, body });

/** The example from protocol.md §7.1. */
const flight = {
  flightId: 'f_3k9q2m',
  name: 'Enfield',
  number: 1,
  display: 'Enfield 1',
  open: true,
  members: [
    { pid: 'p_7f3a9c', pos: 1, presence: 'online', aircraft: { type: 'FA-18C_hornet' } },
    { pid: 'p_2b81de', pos: 2, presence: 'lost', aircraft: { type: 'FA-18C_hornet' } },
  ],
  inCommand: 'p_7f3a9c',
  moveUp: null,
  privateCode: null,
};

const member = (pid: string, pos: number, presence = 'online') => ({
  pid,
  pos,
  presence,
  aircraft: { type: 'F-16C_50' },
});

describe('FlightName', () => {
  it.each([
    ['Enfield', 'Enfield'],
    ['  Enfield  ', 'Enfield'],
    ['Pontiac   Two', 'Pontiac Two'],
  ])('turns "%s" into "%s"', (input, expected) => {
    expect(FlightName.parse(input)).toBe(expected);
  });

  it.each(['', '   ', 'x'.repeat(25)])('rejects "%s"', (name) => {
    expect(FlightName.safeParse(name).success).toBe(false);
  });
});

describe('flightNameKey', () => {
  it('ignores case and extra spaces (protocol.md §7.1)', () => {
    expect(flightNameKey(' enfield ')).toBe(flightNameKey('Enfield'));
    expect(flightNameKey('Pontiac  Two')).toBe(flightNameKey('pontiac two'));
  });

  it('keeps different names apart', () => {
    expect(flightNameKey('Enfield')).not.toBe(flightNameKey('Springfield'));
  });
});

describe('PrivateFlightCode and normalizeFlightCode', () => {
  it('accepts K7Q-4XM', () => {
    expect(PrivateFlightCode.safeParse('K7Q-4XM').success).toBe(true);
  });

  it.each(['K7Q4XM', 'k7q-4xm', 'K7Q-4X', 'K7Q-4XMM', 'K7Q-4XU'])('rejects %s', (code) => {
    expect(PrivateFlightCode.safeParse(code).success).toBe(false);
  });

  it.each([
    ['K7Q-4XM', 'K7Q-4XM'],
    ['k7q4xm', 'K7Q-4XM'],
    ['k7q 4xm', 'K7Q-4XM'],
    ['K7Q-4XO', 'K7Q-4X0'],
    ['kiq-lxm', 'K1Q-1XM'],
  ])('turns "%s" into %s', (input, expected) => {
    expect(normalizeFlightCode(input)).toBe(expected);
  });

  it.each(['', 'K7Q4X', 'K7Q4XMM', 'K7Q-4XU', 'K7Q-4X!'])('returns null for "%s"', (input) => {
    expect(normalizeFlightCode(input)).toBeNull();
  });
});

describe('Flight', () => {
  it('accepts the example from protocol.md §7.1', () => {
    expect(Flight.safeParse(flight).success).toBe(true);
  });

  it('accepts a private flight with its code (as the member in command sees it)', () => {
    expect(Flight.safeParse({ ...flight, open: false, privateCode: 'K7Q-4XM' }).success).toBe(true);
  });

  it('accepts a private flight without the code (as other members see it)', () => {
    expect(Flight.safeParse({ ...flight, open: false }).success).toBe(true);
  });

  it('accepts a flight where nobody is online (inCommand null)', () => {
    const allLost = {
      ...flight,
      members: [member('p_a', 1, 'lost'), member('p_b', 2, 'lost')],
      inCommand: null,
    };
    expect(Flight.safeParse(allLost).success).toBe(true);
  });

  it('accepts a free -1 after a deliberate leave: -2 in command and may move up (§7.4)', () => {
    const free = {
      ...flight,
      members: [member('p_b', 2), member('p_c', 3)],
      inCommand: 'p_b',
      moveUp: { pid: 'p_b', allowedFrom: 1792160000000 },
    };
    expect(Flight.safeParse(free).success).toBe(true);
  });

  it('accepts a lost -1 with -2 allowed to move up later (§7.4)', () => {
    const lost = {
      ...flight,
      members: [member('p_a', 1, 'lost'), member('p_b', 2)],
      inCommand: 'p_b',
      moveUp: { pid: 'p_b', allowedFrom: 1792160600000 },
    };
    expect(Flight.safeParse(lost).success).toBe(true);
  });

  it('accepts a full flight of 4', () => {
    const full = {
      ...flight,
      members: [member('p_a', 1), member('p_b', 2), member('p_c', 3), member('p_d', 4)],
      inCommand: 'p_a',
    };
    expect(Flight.safeParse(full).success).toBe(true);
  });

  it.each([
    [
      'a 5th member',
      {
        members: [
          member('p_a', 1),
          member('p_b', 2),
          member('p_c', 3),
          member('p_d', 4),
          member('p_e', 4),
        ],
        inCommand: 'p_a',
      },
    ],
    ['position 0', { members: [member('p_a', 0)], inCommand: 'p_a' }],
    ['position 5', { members: [member('p_a', 5)], inCommand: 'p_a' }],
    [
      'two members on one position',
      { members: [member('p_a', 1), member('p_b', 1)], inCommand: 'p_a' },
    ],
    ['the same member twice', { members: [member('p_a', 1), member('p_a', 2)], inCommand: 'p_a' }],
    ['a member who has left', { members: [member('p_a', 1, 'left')], inCommand: null }],
    ['inCommand not a member', { inCommand: 'p_zzz' }],
    ['inCommand on a lost member', { inCommand: 'p_2b81de' }],
    ['moveUp for someone outside the flight', { moveUp: { pid: 'p_zzz', allowedFrom: 1 } }],
    ['moveUp for -1 himself', { moveUp: { pid: 'p_7f3a9c', allowedFrom: 1 } }],
    ['an open flight with a private code', { privateCode: 'K7Q-4XM' }],
    ['number 0', { number: 0 }],
  ])('rejects %s', (_why, change) => {
    expect(Flight.safeParse({ ...flight, ...change }).success).toBe(false);
  });

  // Each consistency rule must fail for its own reason, not a side effect.
  it.each([
    [
      { members: [member('p_a', 1), member('p_b', 1)], inCommand: 'p_a' },
      'Two members share a position',
    ],
    [
      { members: [member('p_a', 1), member('p_a', 2)], inCommand: 'p_a' },
      'A member is listed twice',
    ],
    [{ inCommand: 'p_zzz' }, 'Not a member'],
    [{ inCommand: 'p_2b81de' }, 'Member is not online'],
    [{ moveUp: { pid: 'p_zzz', allowedFrom: 1 } }, 'Not a member'],
    [{ moveUp: { pid: 'p_7f3a9c', allowedFrom: 1 } }, '-1 cannot move up'],
    [{ privateCode: 'K7Q-4XM' }, 'An open flight has no private code'],
  ])('reports exactly the broken rule (%o)', (change, reason) => {
    const result = Flight.safeParse({ ...flight, ...change });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([reason]);
  });
});

describe('flight messages', () => {
  it('accepts flight.create', () => {
    expect(
      FlightCreate.safeParse(message('flight.create', { name: 'Enfield', open: true })).success,
    ).toBe(true);
  });

  it('rejects flight.create without "open"', () => {
    expect(FlightCreate.safeParse(message('flight.create', { name: 'Enfield' })).success).toBe(
      false,
    );
  });

  it('accepts flight.join by flight ID', () => {
    const result = FlightJoin.safeParse(message('flight.join', { flightId: 'f_3k9q2m' }));
    expect(result.success).toBe(true);
  });

  it('accepts flight.join by private code', () => {
    const result = FlightJoin.safeParse(message('flight.join', { privateCode: 'K7Q-4XM' }));
    expect(result.success).toBe(true);
  });

  it.each([{}, { privateCode: 'k7q4xm' }, { flightId: '' }])(
    'rejects flight.join with %o',
    (body) => {
      expect(FlightJoin.safeParse(message('flight.join', body)).success).toBe(false);
    },
  );

  it.each([2, 3, 4])('accepts flight.move to position %i', (pos) => {
    const result = FlightMove.safeParse(message('flight.move', { pid: 'p_2b81de', pos }));
    expect(result.success).toBe(true);
  });

  it.each([1, 0, 5])('rejects flight.move to position %i (never to -1)', (pos) => {
    const result = FlightMove.safeParse(message('flight.move', { pid: 'p_2b81de', pos }));
    expect(result.success).toBe(false);
  });

  it('accepts flight.leave and flight.moveUp with empty bodies', () => {
    expect(FlightLeave.safeParse(message('flight.leave', {})).success).toBe(true);
    expect(FlightMoveUp.safeParse(message('flight.moveUp', {})).success).toBe(true);
  });

  it('accepts flight.updated with the full flight', () => {
    expect(FlightUpdated.safeParse(message('flight.updated', flight)).success).toBe(true);
  });

  it('rejects flight.updated with an inconsistent flight', () => {
    const broken = { ...flight, inCommand: 'p_zzz' };
    expect(FlightUpdated.safeParse(message('flight.updated', broken)).success).toBe(false);
  });

  it('accepts flight.listed', () => {
    const summary = {
      flightId: 'f_3k9q2m',
      display: 'Enfield 1',
      memberCount: 2,
      types: ['FA-18C_hornet'],
    };
    expect(FlightListed.safeParse(message('flight.listed', summary)).success).toBe(true);
  });

  it('rejects flight.listed with more members than a flight can have', () => {
    const summary = {
      flightId: 'f_3k9q2m',
      display: 'Enfield 1',
      memberCount: FLIGHT_RULES.maxMembers + 1,
      types: [],
    };
    expect(FlightListed.safeParse(message('flight.listed', summary)).success).toBe(false);
  });

  it('accepts flight.closed', () => {
    expect(FlightClosed.safeParse(message('flight.closed', { flightId: 'f_3k9q2m' })).success).toBe(
      true,
    );
  });
});

describe('flights in session.state', () => {
  const state = (flights: unknown[], ownFlight: unknown = null) =>
    message('session.state', {
      asOfSeq: 4190,
      participants: [],
      flights,
      aos: [],
      you: { flight: ownFlight, checkIn: null, openMissions: [] },
    });
  const summary = { flightId: 'f_x', display: 'Pontiac 1', memberCount: 1, types: ['F-16C_50'] };

  it('accepts open flights as summaries plus the own flight in full', () => {
    expect(SessionState.safeParse(state([summary, flight], flight)).success).toBe(true);
  });

  it('keeps the full fields of the own flight', () => {
    const result = SessionState.safeParse(state([flight], flight));
    expect(result.success && result.data.body.you.flight?.members).toHaveLength(2);
  });

  it('rejects a broken entry in the flight list', () => {
    expect(SessionState.safeParse(state([{ flightId: 'f_x' }])).success).toBe(false);
  });
});

describe('parseMessage with flight messages', () => {
  it('recognises flight.create and types its body', () => {
    const result = parseMessage(message('flight.create', { name: ' Enfield ', open: false }));
    expect(result.ok).toBe(true);
    if (result.ok && result.message.type === 'flight.create') {
      expect(result.message.body.name).toBe('Enfield');
    }
  });
});
