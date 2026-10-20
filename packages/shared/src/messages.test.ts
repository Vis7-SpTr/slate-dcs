// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { parseMessage, parseMessageText } from './messages.js';
import { envelope, ID_1 } from './test-helpers.js';

const hello = {
  ...envelope({ from: '', session: '' }),
  type: 'hello',
  body: { protocols: [1], app: 'slate-host 0.1.0', features: [] },
};

describe('parseMessage', () => {
  it('returns a typed message for a valid hello', () => {
    const result = parseMessage(hello);
    expect(result.ok).toBe(true);
    if (result.ok && result.message.type === 'hello') {
      // TypeScript knows the body type here – no cast needed.
      expect(result.message.body.protocols).toEqual([1]);
    }
  });

  it('strips unknown fields in the envelope and the body', () => {
    const result = parseMessage({ ...hello, extra: 1, body: { ...hello.body, extra: 2 } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).not.toHaveProperty('extra');
      expect(result.message.body).not.toHaveProperty('extra');
    }
  });

  it('reports versionMismatch for another protocol major', () => {
    const result = parseMessage({ ...hello, v: 2 });
    expect(result).toMatchObject({ ok: false, code: 'versionMismatch', id: ID_1 });
  });

  it('reports unsupported for an unknown message type', () => {
    const result = parseMessage({ ...hello, type: 'cas.somethingNew' });
    expect(result).toMatchObject({ ok: false, code: 'unsupported', id: ID_1 });
  });

  it('reports badMessage for a broken body, with a readable detail', () => {
    const result = parseMessage({ ...hello, body: { ...hello.body, protocols: [] } });
    expect(result).toMatchObject({ ok: false, code: 'badMessage', id: ID_1 });
    if (!result.ok) expect(result.detail).toContain('protocols');
  });

  it('reports badMessage for a broken envelope and still returns the ID', () => {
    const result = parseMessage({ ...hello, ts: 'yesterday' });
    expect(result).toMatchObject({ ok: false, code: 'badMessage', id: ID_1 });
  });

  it('returns id null when the ID itself is broken', () => {
    const result = parseMessage({ ...hello, id: 'nope' });
    expect(result).toMatchObject({ ok: false, code: 'badMessage', id: null });
  });

  it.each([null, 42, 'hello', [], {}])('reports badMessage for %o', (input) => {
    expect(parseMessage(input)).toMatchObject({ ok: false, code: 'badMessage', id: null });
  });
});

describe('parseMessageText', () => {
  it('parses a JSON text frame', () => {
    expect(parseMessageText(JSON.stringify(hello)).ok).toBe(true);
  });

  it('reports badMessage for text that is not JSON', () => {
    expect(parseMessageText('{not json')).toMatchObject({
      ok: false,
      code: 'badMessage',
      id: null,
    });
  });
});
