// SPDX-License-Identifier: GPL-3.0-or-later
// Bridge datagrams for tests, built from real spike-3.2 samples. Tests only.

import { BRIDGE_VERSION } from '@slate-dcs/shared';

/**
 * F/A-18C in single player (spike 3.2 run A, first sample): 2× AIM-9X,
 * 2× AGM-65F, 2× BRU-33 Rockeye, AIM-120C, Litening, one FPU-8A, gun 578.
 * Heading 045.6° true (DCS grid) / 038.5° magnetic, internal fuel full plus
 * ~1018 kg in the tank.
 */
export function hornetOwn(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: 'own',
    bv: BRIDGE_VERSION,
    mt: 0,
    start: 64800,
    type: 'FA-18C_hornet',
    unit: 'New callsign',
    lat: 43.6440653722,
    lon: 43.6647501335,
    altMsl: 1216.81689453,
    altAgl: 864.83380127,
    gridHdg: 7.07928150892,
    magHdg: 0.672549221908,
    north: [43.6529136012, 43.6663342096],
    vel: [197.706451416, 0, 201.982437134],
    ias: 261.777947529,
    tas: 282.638885498,
    mach: 0.827642619915,
    vs: 0,
    fuelInt: 1.20775508881,
    fuelExt: 0,
    payload: [
      {
        st: 1,
        w: [4, 4, 7, 136],
        name: 'AIM-9X',
        count: 1,
        clsid: '{5CE2FF2A-645A-4197-B48D-8720AC69394F}',
      },
      { st: 2, w: [4, 4, 8, 271], name: 'AGM-65F Maverick', count: 1, clsid: 'LAU_117_AGM_65F' },
      { st: 3, w: [4, 5, 38, 45], name: 'Mk20 Rockeye', count: 2, clsid: '{BRU33_2X_ROCKEYE}' },
      { st: 4, w: [4, 15, 44, 425], name: 'aaq-28LEFT litening', count: 1, clsid: '{AAQ-28_LEFT}' },
      { st: 5, w: [1, 3, 43, 587], name: 'FPU_8A', count: 1, clsid: '{FPU_8A_FUEL_TANK}' },
      {
        st: 6,
        w: [4, 4, 7, 106],
        name: 'AIM-120C',
        count: 1,
        clsid: '{40EF17B7-F508-45de-8566-6FFECC0C1AB8}',
      },
      { st: 7, w: [4, 5, 38, 45], name: 'Mk20 Rockeye', count: 2, clsid: '{BRU33_2X_ROCKEYE}' },
      { st: 8, w: [4, 4, 8, 271], name: 'AGM-65F Maverick', count: 1, clsid: 'LAU_117_AGM_65F' },
      {
        st: 9,
        w: [4, 4, 7, 136],
        name: 'AIM-9X',
        count: 1,
        clsid: '{5CE2FF2A-645A-4197-B48D-8720AC69394F}',
      },
    ],
    gun: 578,
    cm: { chaff: 60, flare: 60 },
    ...overrides,
  };
}

/**
 * JTAC in the MaxxPro MRAP (spike 3.2 run D, single player): no IAS, no
 * magnetic heading, no engine, no payload; heading 360° true (DCS grid).
 */
export function vehicleOwn(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: 'own',
    bv: BRIDGE_VERSION,
    mt: 4.073,
    start: 28800,
    type: 'MaxxPro_MRAP',
    unit: 'New callsign',
    lat: 42.188864836,
    lon: 41.6405331682,
    altMsl: 0.736520325506,
    altAgl: 0.5,
    gridHdg: 6.28318478802,
    north: [42.1977687591, 41.6417553622],
    vel: [-0.00106046465226, -1.08949458599, -0.001667108736],
    tas: 1.08949637413,
    ...overrides,
  };
}

/** JTAC/Operator slot on the F10 map (spike 3.2 run D): every own-ship getter is nil. */
export function emptyOwn(
  mt: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { t: 'own', bv: BRIDGE_VERSION, mt, start: 36000, ...overrides };
}

/** The hook's session datagram: group server, Hornet slot (spike 3.2 run B). */
export function hornetSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: 'session',
    bv: BRIDGE_VERSION,
    ev: 'slot',
    running: true,
    mt: 8388.825,
    mission: { name: 'VWA_CAU_2.2.11', theatre: 'Caucasus', date: '2026-10-09', start: 36000 },
    mp: true,
    server: false,
    player: { name: 'Pilot', side: 2, slot: '1000043', unitType: 'FA-18C_hornet' },
    ...overrides,
  };
}

export const text = (value: unknown): string => JSON.stringify(value);
