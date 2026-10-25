// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { parseMessage } from './messages.js';
import { SESSION_TIMING } from './protocol.js';
import {
  normalizeSessionCode,
  SessionClosed,
  SessionCode,
  SessionJoin,
  SessionJoined,
  SessionLeave,
  SessionPresence,
  SessionState,
  SessionSwitch,
  Token,
} from './session.js';
import { envelope, ID_2 } from './test-helpers.js';

/** 43 characters of base64url = 256 bits. */
const TOKEN_1 = 'q2VtR8aYwZ0bN3kLmP7xS1dF5gH9jK2lQ4wE6rT8yU0';
const TOKEN_2 = 'Zx8_aB-cD3eF4gH5iJ6kL7mN8oP9qR0sT1uV2wX3yZ4';

const message = (type: string, body: unknown, overrides: Record<string, unknown> = {}) => ({
  ...envelope(overrides),
  type,
  body,
});

describe('SessionCode', () => {
  it.each(['BLUE-7K3Q9XPM', 'RED-00000000', 'GROUP-ZZZZZZZZ'])('accepts %s', (code) => {
    expect(SessionCode.safeParse(code).success).toBe(true);
  });

  it.each([
    ['lower case', 'blue-7k3q9xpm'],
    ['no dash', 'BLUE7K3Q9XPM'],
    ['7 characters', 'BLUE-7K3Q9XP'],
    ['9 characters', 'BLUE-7K3Q9XPMM'],
    ['letter O in the code', 'BLUE-7K3Q9XPO'],
    ['letter U in the code', 'BLUE-7K3Q9XPU'],
    ['no prefix', '-7K3Q9XPM'],
  ])('rejects a code with %s', (_why, code) => {
    expect(SessionCode.safeParse(code).success).toBe(false);
  });
});

describe('normalizeSessionCode', () => {
  it.each([
    ['BLUE-7K3Q9XPM', 'BLUE-7K3Q9XPM'],
    ['blue-7k3q9xpm', 'BLUE-7K3Q9XPM'],
    ['blue7k3q9xpm', 'BLUE-7K3Q9XPM'],
    ['  blue 7k3q 9xpm ', 'BLUE-7K3Q9XPM'],
    ['BLUE-7K3Q9XPO', 'BLUE-7K3Q9XP0'],
    ['blue-ilk3q9xp', 'BLUE-11K3Q9XP'],
  ])('turns "%s" into %s', (input, expected) => {
    expect(normalizeSessionCode(input)).toBe(expected);
  });

  it('keeps the letter L in the prefix', () => {
    expect(normalizeSessionCode('blue-llllllll')).toBe('BLUE-11111111');
  });

  it.each(['', 'BLUE', 'BLUE-7K3Q9XP', 'BLUE-7K3Q9XPU', '1234-7K3Q9XPM', 'BLUE-7K3Q9XP!'])(
    'returns null for "%s"',
    (input) => {
      expect(normalizeSessionCode(input)).toBeNull();
    },
  );
});

describe('Token', () => {
  it('accepts a 43-character base64url token', () => {
    expect(TOKEN_1).toHaveLength(43);
    expect(Token.safeParse(TOKEN_1).success).toBe(true);
    expect(Token.safeParse(TOKEN_2).success).toBe(true);
  });

  it.each([
    ['too short', TOKEN_1.slice(1)],
    ['with padding', `${TOKEN_1}=`],
    ['standard base64 characters', `${TOKEN_1.slice(1)}+`],
  ])('rejects a token %s', (_why, token) => {
    expect(Token.safeParse(token).success).toBe(false);
  });
});

describe('session.join', () => {
  /** The example from protocol.md §4.2. */
  const join = {
    code: 'BLUE-7K3Q9XPM',
    coalition: null,
    token: TOKEN_1,
    lastSeq: 4182,
    nick: 'Vis7',
    role: 'pilot',
    aircraft: { type: 'FA-18C_hornet', unit: 'Enfield 1-1', slot: '1234' },
    source: 'discovery',
  };
  const parse = (body: unknown) =>
    SessionJoin.safeParse(message('session.join', body, { from: '', session: '' }));

  it('accepts the example from protocol.md §4.2', () => {
    expect(parse(join).success).toBe(true);
  });

  it('accepts a first join: no token, no lastSeq, no slot yet, group code + coalition', () => {
    const first = {
      ...join,
      code: 'GROUP-4H7K2M9Q',
      coalition: 'red',
      token: null,
      lastSeq: null,
      aircraft: null,
      source: 'manual',
    };
    expect(parse(first).success).toBe(true);
  });

  it('accepts a JTAC slot with only the unit type', () => {
    expect(parse({ ...join, role: 'jtac', aircraft: { type: 'forward_observer' } }).success).toBe(
      true,
    );
  });

  it('trims the nick', () => {
    const result = parse({ ...join, nick: '  Vis7  ' });
    expect(result.success && result.data.body.nick).toBe('Vis7');
  });

  it.each([
    ['a code typed by hand (not normalised)', { code: 'blue 7k3q9xpm' }],
    ['a coalition other than blue/red', { coalition: 'neutral' }],
    ['a broken token', { token: 'abc' }],
    ['a negative lastSeq', { lastSeq: -1 }],
    ['an empty nick', { nick: '   ' }],
    ['a nick over 32 characters', { nick: 'x'.repeat(33) }],
    ['a role with a space', { role: 'pilot jtac' }],
    ['an aircraft without type', { aircraft: { unit: 'Enfield 1-1' } }],
    ['an unknown source', { source: 'magic' }],
  ])('rejects %s', (_why, change) => {
    expect(parse({ ...join, ...change }).success).toBe(false);
  });

  it.each(['code', 'coalition', 'token', 'lastSeq', 'nick', 'role', 'aircraft', 'source'])(
    'rejects a join without "%s"',
    (field) => {
      const incomplete = Object.fromEntries(Object.entries(join).filter(([key]) => key !== field));
      expect(parse(incomplete).success).toBe(false);
    },
  );
});

describe('session.joined', () => {
  /** The example from protocol.md §4.4. */
  const joined = {
    pid: 'p_7f3a9c',
    token: TOKEN_2,
    resumed: true,
    session: 'blue',
    coalition: 'blue',
  };
  const parse = (body: unknown) =>
    SessionJoined.safeParse(message('session.joined', body, { re: ID_2 }));

  it('accepts the example from protocol.md §4.4', () => {
    expect(parse(joined).success).toBe(true);
  });

  it.each([
    ['no token', { token: null }],
    ['an empty pid', { pid: '' }],
    ['resumed as text', { resumed: 'true' }],
  ])('rejects %s', (_why, change) => {
    expect(parse({ ...joined, ...change }).success).toBe(false);
  });
});

describe('session.state', () => {
  /** The example from protocol.md §4.5. */
  const state = {
    asOfSeq: 4190,
    participants: [
      {
        pid: 'p_7f3a9c',
        nick: 'Vis7',
        role: 'pilot',
        aircraft: { type: 'FA-18C_hornet' },
        presence: 'online',
      },
    ],
    flights: [],
    aos: [],
    you: { flight: null, checkIn: null, openMissions: [] },
  };
  const parse = (body: unknown) => SessionState.safeParse(message('session.state', body));

  it('accepts the example from protocol.md §4.5', () => {
    expect(parse(state).success).toBe(true);
  });

  it('accepts a participant without aircraft (no slot yet)', () => {
    const participant = { ...state.participants[0], aircraft: null, presence: 'lost' };
    expect(parse({ ...state, participants: [participant] }).success).toBe(true);
  });

  it('only shares the aircraft type with the session, not unit or slot', () => {
    const participant = {
      ...state.participants[0],
      aircraft: { type: 'FA-18C_hornet', unit: 'Enfield 1-1', slot: '1234' },
    };
    const result = parse({ ...state, participants: [participant] });
    expect(result.success && result.data.body.participants[0]?.aircraft).toEqual({
      type: 'FA-18C_hornet',
    });
  });

  it('accepts a flight plan in "you"', () => {
    expect(parse({ ...state, you: { ...state.you, flightPlan: null } }).success).toBe(true);
  });

  it.each([
    ['no asOfSeq', { asOfSeq: undefined }],
    ['participants not a list', { participants: {} }],
    ['an unknown presence', { participants: [{ ...state.participants[0], presence: 'away' }] }],
    ['no "you"', { you: undefined }],
    ['"you" without open missions', { you: { flight: null, checkIn: null } }],
  ])('rejects %s', (_why, change) => {
    expect(parse({ ...state, ...change }).success).toBe(false);
  });
});

describe('presence, switch, leave, closed', () => {
  it('accepts session.presence', () => {
    const body = { pid: 'p_7f3a9c', presence: 'lost', nick: 'Vis7', role: 'pilot' };
    expect(SessionPresence.safeParse(message('session.presence', body)).success).toBe(true);
  });

  it('rejects session.presence with an unknown presence', () => {
    const body = { pid: 'p_7f3a9c', presence: 'away', nick: 'Vis7', role: 'pilot' };
    expect(SessionPresence.safeParse(message('session.presence', body)).success).toBe(false);
  });

  it('accepts session.switch with a coalition code', () => {
    const msg = message('session.switch', { code: 'RED-4H7K2M9Q' });
    expect(SessionSwitch.safeParse(msg).success).toBe(true);
  });

  it('rejects session.switch without a code', () => {
    expect(SessionSwitch.safeParse(message('session.switch', {})).success).toBe(false);
  });

  it('accepts session.leave with an empty body', () => {
    expect(SessionLeave.safeParse(message('session.leave', {})).success).toBe(true);
  });

  it.each(['replaced', 'expired', 'kicked', 'shutdown', 'somethingNew'])(
    'accepts session.closed with reason "%s"',
    (reason) => {
      expect(SessionClosed.safeParse(message('session.closed', { reason })).success).toBe(true);
    },
  );

  it('rejects session.closed without a reason', () => {
    expect(SessionClosed.safeParse(message('session.closed', {})).success).toBe(false);
  });
});

describe('parseMessage with session messages', () => {
  it('recognises session.switch and types its body', () => {
    const result = parseMessage(
      message('session.switch', { code: 'RED-4H7K2M9Q' }, { session: 'blue' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.message.type === 'session.switch') {
      expect(result.message.body.code).toBe('RED-4H7K2M9Q');
    }
  });

  it('reports badMessage for a session.join with a broken body', () => {
    expect(parseMessage(message('session.join', { code: 'nope' }))).toMatchObject({
      ok: false,
      code: 'badMessage',
    });
  });
});

describe('SESSION_TIMING', () => {
  it('marks a participant lost only after several missed heartbeats', () => {
    expect(SESSION_TIMING.lostAfterSec).toBeGreaterThanOrEqual(3 * SESSION_TIMING.heartbeatSec);
  });
});
