// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { BRIDGE_VERSION, parseBridgeDatagram } from './bridge.js';

/** An `own` datagram as the export script sends it (values from spike 3.2 run A). */
function own(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: 'own',
    bv: BRIDGE_VERSION,
    mt: 12.5,
    start: 64800,
    type: 'FA-18C_hornet',
    unit: 'New callsign',
    lat: 43.6440653722,
    lon: 43.6647501335,
    altMsl: 1216.8,
    altAgl: 864.8,
    gridHdg: 7.07928150892,
    magHdg: 0.672549221908,
    north: [43.6529136012, 43.6663342096],
    vel: [197.7, 0, 202.0],
    ias: 261.8,
    fuelInt: 1.2077,
    fuelExt: 0,
    payload: [
      {
        st: 1,
        w: [4, 4, 7, 136],
        name: 'AIM-9X',
        count: 1,
        clsid: '{5CE2FF2A-645A-4197-B48D-8720AC69394F}',
      },
      { st: 5, w: [1, 3, 43, 587], name: 'FPU_8A', count: 1, clsid: '{FPU_8A_FUEL_TANK}' },
    ],
    gun: 578,
    cm: { chaff: 60, flare: 60 },
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: 'session',
    bv: BRIDGE_VERSION,
    ev: 'slot',
    running: true,
    mt: 8388.8,
    mission: { name: 'VWA_CAU_2.2.11', theatre: 'Caucasus', date: '2026-10-09', start: 36000 },
    mp: true,
    server: false,
    player: { name: 'Pilot', side: 2, slot: '1000043', unitType: 'FA-18C_hornet' },
    ...overrides,
  };
}

const text = (value: unknown) => JSON.stringify(value);

describe('parseBridgeDatagram', () => {
  it('reads a full own datagram', () => {
    const result = parseBridgeDatagram(text(own()));
    expect(result.ok).toBe(true);
    if (result.ok && result.datagram.t === 'own') {
      expect(result.datagram.payload).toHaveLength(2);
      expect(result.datagram.north).toEqual([43.6529136012, 43.6663342096]);
    }
  });

  it('reads absent fields as null (Lua drops nil values)', () => {
    // JTAC on the F10 map: every own-ship getter returns nil (spike 3.2 run D).
    const result = parseBridgeDatagram(text({ t: 'own', bv: BRIDGE_VERSION, mt: 9233.2 }));
    expect(result).toEqual({
      ok: true,
      datagram: {
        t: 'own',
        bv: BRIDGE_VERSION,
        mt: 9233.2,
        start: null,
        type: null,
        unit: null,
        lat: null,
        lon: null,
        altMsl: null,
        altAgl: null,
        gridHdg: null,
        magHdg: null,
        north: null,
        vel: null,
        ias: null,
        tas: null,
        mach: null,
        vs: null,
        fuelInt: null,
        fuelExt: null,
        payload: null,
        gun: null,
        cm: null,
      },
    });
  });

  it('reads a session datagram and a spectator without a slot', () => {
    expect(parseBridgeDatagram(text(session())).ok).toBe(true);
    const spectator = session({ player: { name: 'Pilot', side: 0 } });
    const result = parseBridgeDatagram(text(spectator));
    expect(result.ok && result.datagram.t === 'session' && result.datagram.player).toEqual({
      name: 'Pilot',
      side: 0,
      slot: null,
      unitType: null,
    });
  });

  it('reads hello and missionCheck', () => {
    expect(
      parseBridgeDatagram(
        text({ t: 'hello', bv: BRIDGE_VERSION, env: 'export', dcs: '2.9.30.28738' }),
      ).ok,
    ).toBe(true);
    expect(parseBridgeDatagram(text({ t: 'hello', bv: BRIDGE_VERSION, env: 'hook' })).ok).toBe(
      true,
    );
    const check = {
      t: 'missionCheck',
      bv: BRIDGE_VERSION,
      coalitions: {
        blue: { groups: 12, units: 30, routed: 10, withFrequency: 8 },
        red: { groups: 0, units: 0, routed: 0, withFrequency: 0 },
      },
    };
    expect(parseBridgeDatagram(text(check)).ok).toBe(true);
  });

  it('reports another bridge version without reading further', () => {
    expect(parseBridgeDatagram(text(own({ bv: 1, lat: 'nonsense' })))).toEqual({
      ok: false,
      reason: 'versionMismatch',
      bv: 1,
    });
  });

  it('reports unknown types (from newer Lua files)', () => {
    const result = parseBridgeDatagram(text({ t: 'radio', bv: BRIDGE_VERSION }));
    expect(result).toMatchObject({ ok: false, reason: 'unknownType' });
  });

  it('reads a chat line (P1.7)', () => {
    const result = parseBridgeDatagram(
      text({ t: 'chat', bv: BRIDGE_VERSION, text: '[SLATE] v1 …', server: true }),
    );
    expect(result).toEqual({
      ok: true,
      datagram: {
        t: 'chat',
        bv: BRIDGE_VERSION,
        text: '[SLATE] v1 …',
        server: true,
        from: null,
        serverId: null,
      },
    });
    expect(parseBridgeDatagram(text({ t: 'chat', bv: BRIDGE_VERSION }))).toMatchObject({
      ok: false,
      reason: 'badDatagram',
    });
  });

  it.each([
    ['not JSON', '{"t":"own"', 'badJson'],
    ['an array', '[1,2]', 'badDatagram'],
    ['no bv', text({ t: 'own', mt: 1 }), 'badDatagram'],
    ['a fractional bv', text(own({ bv: 1.5 })), 'badDatagram'],
  ])('rejects %s', (_name, input, reason) => {
    expect(parseBridgeDatagram(input)).toMatchObject({ ok: false, reason });
  });

  it.each([
    ['latitude out of range', own({ lat: 95 })],
    ['negative model time', own({ mt: -1 })],
    ['a 3-part weapon code', own({ payload: [{ st: 1, w: [4, 4, 7], count: 1 }] })],
    ['station 0', own({ payload: [{ st: 0, w: [4, 4, 7, 136], count: 1 }] })],
    ['negative gun rounds', own({ gun: -1 })],
    ['a bad date', session({ mission: { date: '2026-13-01' } })],
    ['an empty slot ID', session({ player: { slot: '' } })],
    ['side 3', session({ player: { side: 3 } })],
    ['an unknown session event', session({ ev: 'pause' })],
  ])('rejects %s', (_name, datagram) => {
    const result = parseBridgeDatagram(text(datagram));
    expect(result).toMatchObject({ ok: false, reason: 'badDatagram' });
  });
});
