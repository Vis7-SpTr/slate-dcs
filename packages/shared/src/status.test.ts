// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { parseMessage } from './messages.js';
import {
  FuelCall,
  headingDifference,
  isStale,
  STATUS_TIMING,
  StatusPosition,
  statusSendReason,
  StatusUpdate,
  weaponsCount,
} from './status.js';
import type { Armament, StatusSample } from './status.js';
import { envelope } from './test-helpers.js';

const message = (type: string, body: unknown) => ({
  ...envelope({ to: { scope: 'session' } }),
  type,
  body,
});

/** The example from protocol.md §6.2. */
const status = {
  pos: { lat: 42.1712, lon: 41.6823, altMsl: 3050.2, altAgl: 2890.0 },
  hdg: 271.4,
  gs: 180.5,
  ias: 160.2,
  fuel: { internalKg: 2900, externalKg: 0, source: 'export' },
  armament: {
    stations: [{ st: 3, name: 'GBU-12', kind: 'bomb', count: 2, source: 'export' }],
    gun: { rounds: 412, source: 'export' },
    stores: [{ st: 5, name: 'FPU-8A' }],
  },
  avail: { pos: true, fuel: true, payload: true },
  reason: 'heartbeat',
};
const parse = (body: unknown) => StatusUpdate.safeParse(message('status.update', body));

describe('status.update', () => {
  it('accepts the example from protocol.md §6.2', () => {
    expect(parse(status).success).toBe(true);
  });

  it('accepts a JTAC on the F10 map: no position, fuel or armament yet', () => {
    const jtac = {
      pos: null,
      hdg: null,
      gs: null,
      ias: null,
      fuel: null,
      armament: null,
      avail: { pos: false, fuel: false, payload: false },
      reason: 'heartbeat',
    };
    expect(parse(jtac).success).toBe(true);
  });

  it('accepts a hand-typed position without AGL', () => {
    expect(parse({ ...status, pos: { ...status.pos, altAgl: null } }).success).toBe(true);
  });

  it('accepts manual and server values next to export values', () => {
    const mixed = {
      ...status,
      fuel: { ...status.fuel, source: 'server' },
      armament: {
        ...status.armament,
        stations: [
          { st: 2, name: 'AIM-9X', kind: 'missile', count: 1, source: 'export' },
          { st: 3, name: 'AGM-114K', kind: 'missile', count: 4, source: 'manual' },
        ],
      },
    };
    expect(parse(mixed).success).toBe(true);
  });

  it('accepts an airframe without gun and an empty station', () => {
    const armament = {
      stations: [{ st: 1, name: 'Hydra 70 M229 HE', kind: 'rocket', count: 0, source: 'export' }],
      gun: null,
      stores: [],
    };
    expect(parse({ ...status, armament }).success).toBe(true);
  });

  it.each([
    ['latitude above 90°', { pos: { ...status.pos, lat: 91 } }],
    ['longitude below -180°', { pos: { ...status.pos, lon: -181 } }],
    ['heading 360° (not normalised)', { hdg: 360 }],
    ['negative heading', { hdg: -1 }],
    ['negative ground speed', { gs: -0.1 }],
    ['negative fuel', { fuel: { ...status.fuel, internalKg: -1 } }],
    ['an unknown value source', { fuel: { ...status.fuel, source: 'guess' } }],
    [
      'a station with an unknown kind',
      {
        armament: {
          ...status.armament,
          stations: [{ ...status.armament.stations[0], kind: 'pod' }],
        },
      },
    ],
    [
      'a fractional weapons count',
      {
        armament: {
          ...status.armament,
          stations: [{ ...status.armament.stations[0], count: 1.5 }],
        },
      },
    ],
    [
      'station 0',
      { armament: { ...status.armament, stations: [{ ...status.armament.stations[0], st: 0 }] } },
    ],
    ['an unknown reason', { reason: 'bored' }],
    ['no avail flags', { avail: undefined }],
  ])('rejects %s', (_why, change) => {
    expect(parse({ ...status, ...change }).success).toBe(false);
  });

  it.each(['pos', 'hdg', 'gs', 'ias', 'fuel', 'armament', 'avail', 'reason'])(
    'rejects a package without "%s" (use null for unknown values)',
    (field) => {
      const incomplete = Object.fromEntries(
        Object.entries(status).filter(([key]) => key !== field),
      );
      expect(parse(incomplete).success).toBe(false);
    },
  );
});

describe('status.position', () => {
  const position = {
    pid: 'p_7f3a9c',
    callsign: 'Enfield 1-1',
    type: 'FA-18C_hornet',
    pos: status.pos,
    hdg: 271.4,
    gs: 180.5,
  };

  it('accepts the datalink-style picture from protocol.md §6.4', () => {
    expect(StatusPosition.safeParse(message('status.position', position)).success).toBe(true);
  });

  it('strips fuel and armament if a relay ever sent them', () => {
    const result = StatusPosition.safeParse(
      message('status.position', { ...position, fuel: status.fuel, armament: status.armament }),
    );
    expect(result.success).toBe(true);
    expect(result.data?.body).not.toHaveProperty('fuel');
    expect(result.data?.body).not.toHaveProperty('armament');
  });

  it('rejects status.position without a position', () => {
    expect(
      StatusPosition.safeParse(message('status.position', { ...position, pos: null })).success,
    ).toBe(false);
  });
});

describe('fuel.call', () => {
  it.each(['joker', 'bingo'])('accepts a %s call', (call) => {
    expect(FuelCall.safeParse(message('fuel.call', { call, internalKg: 1810 })).success).toBe(true);
  });

  it.each([
    { call: 'chicken', internalKg: 500 },
    { call: 'joker', internalKg: -1 },
    { call: 'joker' },
  ])('rejects %o', (body) => {
    expect(FuelCall.safeParse(message('fuel.call', body)).success).toBe(false);
  });
});

describe('headingDifference', () => {
  it.each([
    [10, 20, 10],
    [355, 5, 10],
    [5, 355, 10],
    [0, 180, 180],
    [90, 90, 0],
    [359.5, 0.5, 1],
  ])('between %d° and %d° is %d°', (a, b, expected) => {
    expect(headingDifference(a, b)).toBeCloseTo(expected);
  });
});

describe('weaponsCount', () => {
  const armament: Armament = {
    stations: [
      { st: 2, name: 'AIM-9X', kind: 'missile', count: 1, source: 'export' },
      { st: 3, name: 'GBU-12', kind: 'bomb', count: 2, source: 'export' },
    ],
    gun: { rounds: 412, source: 'export' },
    stores: [{ st: 5, name: 'FPU-8A' }],
  };

  it('adds up all stations but not the gun or the stores', () => {
    expect(weaponsCount(armament)).toBe(3);
  });

  it('is null without armament', () => {
    expect(weaponsCount(null)).toBeNull();
  });
});

describe('statusSendReason (interval rule, protocol.md §6.3)', () => {
  const base: StatusSample = { hdg: 270, altMsl: 3000, gs: 180, weaponsCount: 4 };

  it('sends the first package at once', () => {
    expect(statusSendReason(null, base, 0)).toBe('heartbeat');
  });

  it('sends nothing when nothing changed and the heartbeat is not due', () => {
    expect(statusSendReason(base, base, 19)).toBeNull();
  });

  it('sends a heartbeat after 20 s', () => {
    expect(statusSendReason(base, base, 20)).toBe('heartbeat');
  });

  it('sends at once when the weapons count changes, even 1 s after the last package', () => {
    expect(statusSendReason(base, { ...base, weaponsCount: 3 }, 1)).toBe('event');
  });

  it.each<[string, Partial<StatusSample>, Partial<StatusSample>]>([
    ['heading by more than 10°', { hdg: 281 }, {}],
    ['heading across north (355° → 10°)', { hdg: 10 }, { hdg: 355 }],
    ['altitude by more than 500 ft', { altMsl: 3000 + 153 }, {}],
    ['ground speed by more than 20 kt', { gs: 180 + 10.4 }, {}],
  ])('sends early when the %s changed', (_why, change, before) => {
    expect(statusSendReason({ ...base, ...before }, { ...base, ...change }, 5)).toBe('change');
  });

  it.each([
    ['heading by exactly 10°', { hdg: 280 }],
    ['altitude by 499 ft', { altMsl: 3000 + 499 * 0.3048 }],
    ['ground speed by 19 kt', { gs: 180 + 19 * (1852 / 3600) }],
  ])('does not send early when the %s changed', (_why, change) => {
    expect(statusSendReason(base, { ...base, ...change }, 10)).toBeNull();
  });

  it('waits at least 5 s between early sends', () => {
    expect(statusSendReason(base, { ...base, hdg: 300 }, 4.9)).toBeNull();
  });

  it('treats a value that appears or disappears as a change', () => {
    expect(statusSendReason({ ...base, hdg: null }, base, 5)).toBe('change');
    expect(statusSendReason(base, { ...base, gs: null }, 5)).toBe('change');
  });

  it('uses the thresholds from the spec', () => {
    expect(STATUS_TIMING.altitudeM).toBeCloseTo(152.4);
    expect(STATUS_TIMING.speedMs).toBeCloseTo(10.289, 3);
  });
});

describe('isStale', () => {
  const last = 1792160000000;

  it('is not stale at exactly 60 s', () => {
    expect(isStale(last, last + 60_000)).toBe(false);
  });

  it('is stale after 60 s', () => {
    expect(isStale(last, last + 60_001)).toBe(true);
  });
});

describe('parseMessage with status messages', () => {
  it('recognises status.update and types its body', () => {
    const result = parseMessage(message('status.update', status));
    expect(result.ok).toBe(true);
    if (result.ok && result.message.type === 'status.update') {
      expect(result.message.body.armament?.stations[0]?.name).toBe('GBU-12');
    }
  });
});
