// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { Address, Envelope, MessageId, MessageType } from './envelope.js';
import { envelope, ID_1, ID_2 } from './test-helpers.js';

describe('MessageId', () => {
  it('accepts a ULID', () => {
    expect(MessageId.safeParse(ID_1).success).toBe(true);
  });

  it.each([
    ['too short', '01JABCXYZ8M3Q4R5S6T7V8W9X'],
    ['too long', '01JABCXYZ8M3Q4R5S6T7V8W9X00'],
    ['lower case', '01jabcxyz8m3q4r5s6t7v8w9x0'],
    ['letter I (not Crockford)', '01JABCXYZ8M3Q4R5S6T7V8W9XI'],
    ['letter U (not Crockford)', '01JABCXYZ8M3Q4R5S6T7V8W9XU'],
  ])('rejects an ID that is %s', (_why, id) => {
    expect(MessageId.safeParse(id).success).toBe(false);
  });
});

describe('MessageType', () => {
  it.each([
    'hello',
    'error',
    'session.join',
    'relay.receipt',
    'cas.hold.assign',
    'fm.readbackCorrect',
  ])('accepts "%s"', (type) => {
    expect(MessageType.safeParse(type).success).toBe(true);
  });

  it.each(['', 'Session.join', 'session.', '.join', 'session join', 'session..join', 'fm.9line'])(
    'rejects "%s"',
    (type) => {
      expect(MessageType.safeParse(type).success).toBe(false);
    },
  );
});

describe('Address', () => {
  it.each([
    { scope: 'relay' },
    { scope: 'session' },
    { scope: 'flight', id: 'f_3k9q2m' },
    { scope: 'ao', id: 'Q4T-8MZ' },
    { scope: 'pid', id: 'p_7f3a9c' },
  ])('accepts %o', (address) => {
    expect(Address.safeParse(address).success).toBe(true);
  });

  it.each([{ scope: 'everyone' }, { scope: 'flight' }, { scope: 'pid', id: '' }, {}])(
    'rejects %o',
    (address) => {
      expect(Address.safeParse(address).success).toBe(false);
    },
  );
});

describe('Envelope', () => {
  const valid = { ...envelope(), type: 'session.join', body: {} };

  it('accepts a complete envelope', () => {
    expect(Envelope.safeParse(valid).success).toBe(true);
  });

  it('accepts the fields the relay adds (seq, rts)', () => {
    const result = Envelope.safeParse({ ...valid, seq: 4182, rts: 1792156980200 });
    expect(result.success && result.data.seq).toBe(4182);
  });

  it('accepts empty sender and session before joining', () => {
    expect(Envelope.safeParse({ ...valid, from: '', session: '' }).success).toBe(true);
  });

  it('accepts a reply (re = message ID)', () => {
    expect(Envelope.safeParse({ ...valid, re: ID_2 }).success).toBe(true);
  });

  it('strips unknown fields instead of failing (protocol.md §0)', () => {
    const result = Envelope.safeParse({ ...valid, addedInV1dot5: true });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('addedInV1dot5');
  });

  it.each([
    ['another protocol major', { v: 2 }],
    ['a broken message ID', { id: 'nope' }],
    ['a negative timestamp', { ts: -1 }],
    ['a timestamp with fractions', { ts: 1.5 }],
    ['ack as text', { ack: 'yes' }],
    ['a missing re', { re: undefined }],
    ['a broken address', { to: { scope: 'flight' } }],
  ])('rejects %s', (_why, change) => {
    expect(Envelope.safeParse({ ...valid, ...change }).success).toBe(false);
  });

  it.each(['v', 'id', 'type', 'from', 'session', 'to', 'ts', 'ack'])(
    'rejects an envelope without "%s"',
    (field) => {
      const incomplete = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== field));
      expect(Envelope.safeParse(incomplete).success).toBe(false);
    },
  );
});
