// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { isAllowedHost, isAllowedOrigin } from './access.js';

describe('isAllowedHost', () => {
  it.each(['127.0.0.1:7792', 'localhost:7792', 'LOCALHOST:7792', '[::1]:7792'])(
    'accepts %s',
    (host) => {
      expect(isAllowedHost(host, 7792)).toBe(true);
    },
  );

  it.each([
    ['another port', '127.0.0.1:7793'],
    ['no port', 'localhost'],
    ['a foreign name (DNS rebinding)', 'evil.example:7792'],
    ['a LAN address (not yet, P1.8)', '192.168.1.20:7792'],
    ['no Host header', undefined],
  ])('refuses %s', (_why, host) => {
    expect(isAllowedHost(host, 7792)).toBe(false);
  });
});

describe('isAllowedOrigin', () => {
  it.each(['http://127.0.0.1:7792', 'http://localhost:7792', 'http://[::1]:7792'])(
    'accepts %s',
    (origin) => {
      expect(isAllowedOrigin(origin, 7792)).toBe(true);
    },
  );

  it('accepts a request without Origin (a local program, not a website)', () => {
    expect(isAllowedOrigin(undefined, 7792)).toBe(true);
  });

  it.each([
    ['a website', 'https://evil.example'],
    ['https on the same port', 'https://127.0.0.1:7792'],
    ['another port', 'http://127.0.0.1:8080'],
    ['a file page', 'null'],
  ])('refuses %s', (_why, origin) => {
    expect(isAllowedOrigin(origin, 7792)).toBe(false);
  });
});
