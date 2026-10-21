// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { MessageId } from './envelope.js';
import { ulid } from './ulid.js';

describe('ulid', () => {
  it('makes a valid message ID', () => {
    expect(MessageId.safeParse(ulid()).success).toBe(true);
  });

  it('encodes the time in the first 10 characters', () => {
    expect(ulid(0).slice(0, 10)).toBe('0000000000');
    expect(ulid(1792160000000).slice(0, 10)).toBe(ulid(1792160000000).slice(0, 10));
  });

  it('sorts by time', () => {
    expect(ulid(1792160000000) < ulid(1792160001000)).toBe(true);
  });

  it('makes a different ID every time', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => ulid(1792160000000)));
    expect(ids.size).toBe(1000);
  });
});
