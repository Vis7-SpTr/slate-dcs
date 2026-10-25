// SPDX-License-Identifier: GPL-3.0-or-later
// Valid CAS objects for tests only – not exported from the package. They
// follow the examples in protocol.md §8–§12.

export const JTAC = 'p_9c11aa';
export const JTAC_2 = 'p_4d2e10';
export const LEAD = 'p_7f3a9c';
export const WING = 'p_2b81de';
export const FLIGHT = 'f_3k9q2m';
export const AO = 'a_4m2k9q';

/** One JTAC of the AO (§8.1). */
export function aoJtac(): Record<string, unknown> {
  return {
    pid: JTAC,
    callsign: 'Axeman 11',
    since: 1792157000000,
    presence: 'online',
    freqs: [{ mhz: 251, label: 'AXEMAN PRI' }],
  };
}

/** protocol.md §8.1. */
export function ao(): Record<string, unknown> {
  return {
    aoId: AO,
    joinCode: 'Q4T-8MZ',
    name: 'AO HAMMER',
    type: 'circle',
    center: { lat: 42.205, lon: 41.71 },
    radiusM: 18520,
    lengthM: null,
    widthM: null,
    headingDeg: null,
    points: null,
    floor: { m: 0, ref: 'sfc' },
    ceiling: { m: 6096, ref: 'msl' },
    jtacs: [aoJtac()],
    inCommand: JTAC,
  };
}

/** A map entry as a host sends it – protocol.md §8.4's threat example. */
export function threatDraft(): Record<string, unknown> {
  return {
    kind: 'threat',
    shape: 'point',
    geom: { lat: 42.2203, lon: 41.7431 },
    label: 'SA-8',
    text: null,
    ringM: 9000,
    count: null,
    moving: null,
    observedMtime: 51000,
    block: null,
    aoId: null,
    visibility: 'coalition',
  };
}

/** A keyhole with ECHO at the target area (§8.5). */
export function keyholeDraft(): Record<string, unknown> {
  return {
    ...threatDraft(),
    kind: 'keyhole',
    label: 'HAMMER',
    ringM: null,
    observedMtime: null,
    aoId: AO,
    visibility: 'ao',
  };
}

/** As the relay sends it. */
export function mapEntry(draft = threatDraft()): Record<string, unknown> {
  return { ...draft, cmId: 'c_51e0b2', author: LEAD };
}

/** protocol.md §9.1. */
export function brief(): Record<string, unknown> {
  return {
    callsign: 'Enfield 1',
    aircraft: [
      { pid: LEAD, type: 'FA-18C_hornet' },
      { pid: WING, type: 'FA-18C_hornet' },
    ],
    position: { lat: 42.1712, lon: 41.6823, altMsl: 4572 },
    ordnance: [
      { name: 'GBU-12', count: 4 },
      { name: 'AIM-9X', count: 4 },
    ],
    playtimeMin: 40,
    capabilities: ['tgp', 'laser', 'datalink'],
    abortCode: 'ROMEO',
    missionNumber: null,
    laserCodes: { flight: 1688, perAircraft: { [WING]: 1687 } },
    remarks: '',
  };
}

/** protocol.md §9.4, the hold on a keyhole point. */
export function holdDraft(): Record<string, unknown> {
  return {
    flightId: FLIGHT,
    point: { cmId: 'c_kh_01', axis: 'A', distanceNm: 8 },
    floor: { m: 4572, ref: 'msl' },
    ceiling: { m: 5181, ref: 'msl' },
    turns: 'left',
    shape: 'racetrack',
    radiusM: null,
    legM: 9260,
    inboundDeg: 270,
    from: 50400,
    until: null,
    visibility: 'ao',
  };
}

export function hold(): Record<string, unknown> {
  return { ...holdDraft(), holdId: 'h_77a1c0', aoId: AO, conflicts: [] };
}

export function sitUpdate(): Record<string, unknown> {
  return {
    threats: { text: 'SA-8 north of the river', cmIds: ['c_51e0b2'] },
    targets: { text: '2x BMP-2 in treeline', cmIds: [] },
    friendlies: { text: 'South 800 m', cmIds: [] },
    fires: 'None',
    clearanceAuthority: 'Axeman 11',
    restrictions: 'No release east of MSR',
    hazards: '',
  };
}

/** The example's 9-line (§10.4). */
export function nineLine(): Record<string, unknown> {
  return content()['nineLine'] as Record<string, unknown>;
}

/** protocol.md §10.4. */
export function content(): Record<string, unknown> {
  return {
    gamePlan: {
      control: 2,
      method: 'BOT',
      effects: 'Destroy',
      ordnance: 'GBU-12 x2',
      interval: '1 min',
    },
    nineLine: {
      ipBp: { cmId: 'c_ip_01' },
      headingDeg: 95,
      offset: 'left',
      distanceM: 11100,
      elevationM: 412,
      description: '2x BMP-2 in treeline',
      location: { lat: 42.2203, lon: 41.7431 },
      locationText: '38T KM 12345 67890',
      mark: {
        type: 'laser',
        code: 1688,
        source: { kind: 'jtac', pid: JTAC },
        at: null,
        text: '',
      },
      friendlies: { text: 'South 800 m', cmIds: ['c_fr_02'] },
      egress: 'North, climb to block',
    },
    remarks: {
      ltl: 210,
      finalAttackHeading: { fromDeg: 60, toDeg: 120 },
      dangerClose: false,
      tot: null,
      restrictions: ['No release east of MSR'],
      hazards: '',
      text: '',
    },
  };
}

/** The example's lanes: the lead cleared hot, the wingman still open. */
export function lanes(): Record<string, unknown>[] {
  return [
    {
      pid: LEAD,
      state: 'cleared',
      spi: { lat: 42.2201, lon: 41.7427, elevM: 410 },
      runs: [
        {
          run: 1,
          clearance: { kind: 'hot', ts: 1792161030000, mtime: 51830, by: JTAC },
          abort: null,
        },
      ],
      bda: null,
      warnings: [],
    },
    { pid: WING, state: 'open', spi: null, runs: [], bda: null, warnings: [] },
  ];
}

/** protocol.md §10.4: lead cleared hot, wingman's lane still open. */
export function mission(): Record<string, unknown> {
  return {
    ...content(),
    missionId: 'm_8d21f0',
    aoId: AO,
    owner: JTAC,
    inCommand: JTAC,
    commandOffer: null,
    revision: 3,
    state: 'readbackCorrect',
    assignee: { flightId: FLIGHT, pids: null },
    changes: [],
    lanes: lanes(),
    window: null,
    voiceOnly: false,
  };
}

export function logEntry(): Record<string, unknown> {
  return {
    seq: 4211,
    rts: 1792161030010,
    mtime: 51830,
    area: 'mission',
    kind: 'fm.clear',
    actor: JTAC,
    actorName: 'Axeman 11',
    summary: 'Axeman 11: CLEARED HOT Enfield 1-1 (run 1)',
    aoId: AO,
    flightId: FLIGHT,
    missionId: 'm_8d21f0',
    pid: LEAD,
  };
}
