// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { DEFAULT_PORTS, PROTOCOL_VERSION } from './index.js';

describe('protocol constants', () => {
  it('uses protocol major version 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('uses the default ports from the protocol spec', () => {
    expect(DEFAULT_PORTS).toEqual({ relay: 7790, bridge: 7791, hostUi: 7792 });
  });

  it('uses a different port for every service', () => {
    const ports = Object.values(DEFAULT_PORTS);
    expect(new Set(ports).size).toBe(ports.length);
  });
});
