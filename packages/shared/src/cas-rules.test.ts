// SPDX-License-Identifier: GPL-3.0-or-later
// The rules inside the CAS objects (protocol.md §8–§10).

import { describe, expect, it } from 'vitest';

import { Ao, JtacOnStation } from './aos.js';
import {
  ao,
  aoJtac,
  brief,
  hold,
  holdDraft,
  JTAC,
  keyholeDraft,
  lanes,
  LEAD,
  mission,
  nineLine,
  threatDraft,
  WING,
} from './cas-fixtures.js';
import { CheckInBrief, HoldDraft } from './checkins.js';
import { MapEntryDraft } from './map-entries.js';
import { FireMission, Mark } from './missions.js';
import { SessionState } from './session.js';
import { envelope } from './test-helpers.js';

describe('AO (§8.1)', () => {
  it('accepts the circle example', () => {
    expect(Ao.safeParse(ao()).success).toBe(true);
  });

  it('accepts a rotated square and a polygon', () => {
    const square = {
      ...ao(),
      type: 'square',
      radiusM: null,
      lengthM: 20000,
      widthM: 10000,
      headingDeg: 45,
    };
    const polygon = {
      ...ao(),
      type: 'polygon',
      center: null,
      radiusM: null,
      points: [
        { lat: 42.1, lon: 41.6 },
        { lat: 42.3, lon: 41.6 },
        { lat: 42.2, lon: 41.9 },
      ],
    };
    expect(Ao.safeParse(square).success).toBe(true);
    expect(Ao.safeParse(polygon).success).toBe(true);
  });

  it.each([
    ['a circle without a radius', { radiusM: null }],
    [
      'a circle with polygon points',
      {
        points: [
          { lat: 1, lon: 1 },
          { lat: 2, lon: 2 },
          { lat: 3, lon: 1 },
        ],
      },
    ],
    ['a square without its heading', { type: 'square', radiusM: null, lengthM: 1, widthM: 1 }],
    ['a floor above the ceiling', { floor: { m: 7000, ref: 'msl' } }],
    ['a JTAC listed twice', { jtacs: [aoJtac(), aoJtac()] }],
    ['a lost JTAC in command', { jtacs: [{ ...aoJtac(), presence: 'lost' }] }],
    [
      'more than six frequencies',
      {
        jtacs: [
          {
            ...aoJtac(),
            freqs: Array(7).fill({ mhz: 251, label: null }),
          },
        ],
      },
    ],
  ])('rejects %s', (_why, change) => {
    expect(Ao.safeParse({ ...ao(), ...change }).success).toBe(false);
  });

  it('accepts an AO whose JTACs are all lost – nobody in command', () => {
    const lost = { ...aoJtac(), presence: 'lost' };
    expect(Ao.safeParse({ ...ao(), jtacs: [lost], inCommand: null }).success).toBe(true);
  });
});

describe('jtac.onStation (§8.2)', () => {
  const on = (body: unknown) =>
    JtacOnStation.safeParse({ ...envelope(), type: 'jtac.onStation', body });
  const base = { callsign: 'Axeman 11', freqs: [] };

  it('joins by join code, or makes a new AO with or without a spec', () => {
    expect(on({ ...base, joinCode: 'Q4T-8MZ' }).success).toBe(true);
    expect(on(base).success).toBe(true);
    expect(on({ ...base, ao: { name: 'AO ANVIL', radiusM: 9260 } }).success).toBe(true);
  });

  it('refuses a mistyped join code instead of making a new AO', () => {
    expect(on({ ...base, joinCode: 'Q4T8MZ' }).success).toBe(false);
  });
});

describe('map entries (§8.4, §8.5)', () => {
  it('accepts a threat and a keyhole', () => {
    expect(MapEntryDraft.safeParse(threatDraft()).success).toBe(true);
    expect(MapEntryDraft.safeParse(keyholeDraft()).success).toBe(true);
  });

  it('accepts an RFA area with its restriction and a ROZ with its block', () => {
    const area = {
      shape: 'polygon',
      geom: [
        { lat: 42.1, lon: 41.6 },
        { lat: 42.3, lon: 41.6 },
        { lat: 42.2, lon: 41.9 },
      ],
    };
    const rfa = {
      ...keyholeDraft(),
      ...area,
      kind: 'rfa',
      label: null,
      text: 'No unguided ordnance',
    };
    const roz = {
      ...rfa,
      kind: 'roz',
      text: null,
      block: { floor: { m: 0, ref: 'sfc' }, ceiling: { m: 3048, ref: 'msl' } },
    };
    expect(MapEntryDraft.safeParse(rfa).success).toBe(true);
    expect(MapEntryDraft.safeParse(roz).success).toBe(true);
  });

  it('accepts an enemy marker with count and movement', () => {
    const enemy = {
      ...threatDraft(),
      kind: 'enemy',
      label: 'BMP-2',
      ringM: null,
      count: 2,
      moving: false,
    };
    expect(MapEntryDraft.safeParse(enemy).success).toBe(true);
  });

  it.each([
    [
      'a keyhole as a line',
      {
        ...keyholeDraft(),
        shape: 'line',
        geom: [
          { lat: 1, lon: 1 },
          { lat: 2, lon: 2 },
        ],
      },
    ],
    ['a keyhole without an AO', { ...keyholeDraft(), aoId: null }],
    ['a keyhole without a name', { ...keyholeDraft(), label: null }],
    ['a ring on an IP', { ...keyholeDraft(), kind: 'ip', label: 'IP SIERRA', ringM: 5000 }],
    ['a count on a threat', { ...threatDraft(), count: 3 }],
    [
      'a ROZ without a block',
      {
        ...keyholeDraft(),
        kind: 'roz',
        shape: 'circle',
        geom: { center: { lat: 1, lon: 1 }, radiusM: 1000 },
      },
    ],
    [
      'a line with one point',
      { ...keyholeDraft(), kind: 'fscl', shape: 'line', geom: [{ lat: 1, lon: 1 }] },
    ],
  ])('rejects %s', (_why, entry) => {
    expect(MapEntryDraft.safeParse(entry).success).toBe(false);
  });
});

describe('check-in brief (§9.1)', () => {
  it('accepts the example', () => {
    expect(CheckInBrief.safeParse(brief()).success).toBe(true);
  });

  it.each([
    ['an invalid flight laser code', { laserCodes: { flight: 1999, perAircraft: {} } }],
    ['an invalid own code', { laserCodes: { flight: 1688, perAircraft: { [WING]: 2688 } } }],
    ['five aircraft', { aircraft: Array(5).fill({ pid: LEAD, type: 'F-16C_50' }) }],
    ['an unknown capability', { capabilities: ['xray'] }],
  ])('rejects %s', (_why, change) => {
    expect(CheckInBrief.safeParse({ ...brief(), ...change }).success).toBe(false);
  });
});

describe('holds (§9.4)', () => {
  it('accepts a racetrack on a keyhole point and an orbit on an IP', () => {
    expect(HoldDraft.safeParse(holdDraft()).success).toBe(true);
    const orbit = {
      ...holdDraft(),
      point: { cmId: 'c_ip_01' },
      shape: 'orbit',
      radiusM: 5556,
      legM: null,
      inboundDeg: null,
    };
    expect(HoldDraft.safeParse(orbit).success).toBe(true);
  });

  it.each([
    ['an orbit without a radius', { shape: 'orbit', legM: null, inboundDeg: null }],
    ['a racetrack without an inbound course', { inboundDeg: null }],
    ['a block upside down', { floor: { m: 6000, ref: 'msl' } }],
    ['an end before the start', { from: 50400, until: 50000 }],
    ['a quadrant instead of a point', { point: { cmId: 'c_kh_01', axis: 'AB', distanceNm: 8 } }],
  ])('rejects %s', (_why, change) => {
    expect(HoldDraft.safeParse({ ...holdDraft(), ...change }).success).toBe(false);
  });

  it('the relay adds ID, AO and conflicts', () => {
    expect(hold()).toMatchObject({ holdId: 'h_77a1c0', conflicts: [] });
  });
});

describe('line 7 – mark (§10.4)', () => {
  const mark = (change: Record<string, unknown>) =>
    Mark.safeParse({
      type: 'laser',
      code: 1688,
      source: { kind: 'jtac', pid: JTAC },
      at: null,
      text: '',
      ...change,
    });

  it('accepts a JTAC laser, ownship lasing, smoke at a keyhole point and no mark', () => {
    expect(mark({}).success).toBe(true);
    expect(mark({ code: null, source: { kind: 'ownship' } }).success).toBe(true);
    expect(
      mark({
        type: 'smoke',
        code: null,
        source: null,
        at: { cmId: 'c_kh', axis: 'A', distanceNm: 2 },
        text: 'red',
      }).success,
    ).toBe(true);
    expect(mark({ type: 'none', code: null, source: null }).success).toBe(true);
  });

  it.each([
    ['a laser without who marks', { source: null }],
    ['a JTAC laser without a code', { code: null }],
    ['ownship lasing with one code', { source: { kind: 'ownship' } }],
    ['smoke with a code', { type: 'smoke', source: null }],
    ['IR with a code', { type: 'ir' }],
  ])('rejects %s', (_why, change) => {
    expect(mark(change).success).toBe(false);
  });
});

describe('fire mission (§10.3, §10.4)', () => {
  it('accepts the example and a fresh draft', () => {
    expect(FireMission.safeParse(mission()).success).toBe(true);
    const draft = { ...mission(), state: 'draft', assignee: null, lanes: [], revision: 1 };
    expect(FireMission.safeParse(draft).success).toBe(true);
  });

  it('accepts a change waiting for the wingman', () => {
    const changes = [
      {
        rev: 3,
        fields: ['nineLine.description'],
        old: { 'nineLine.description': 'BMP-2' },
        ackedBy: [LEAD],
      },
    ];
    expect(FireMission.safeParse({ ...mission(), changes }).success).toBe(true);
  });

  it.each([
    ['lanes before the readback', { state: 'briefed' }],
    ['an assigned mission without an assignee', { state: 'assigned', assignee: null, lanes: [] }],
    ['two lanes for one aircraft', { lanes: [lanes()[0], lanes()[0]] }],
    ['a command offer to the JTAC in command', { commandOffer: JTAC }],
    ['a change without fields', { changes: [{ rev: 3, fields: [], old: {}, ackedBy: [] }] }],
  ])('rejects %s', (_why, change) => {
    expect(FireMission.safeParse({ ...mission(), ...change }).success).toBe(false);
  });

  it('a pilot’s view has one lane and no warnings', () => {
    const own = lanes().filter((lane) => lane['pid'] === WING);
    expect(FireMission.safeParse({ ...mission(), lanes: own }).success).toBe(true);
  });

  it('keeps line 6 as coordinates and as passed', () => {
    expect(nineLine()).toMatchObject({
      locationText: '38T KM 12345 67890',
      location: { lat: 42.2203 },
    });
  });
});

describe('session.state (§4.5)', () => {
  const base = { asOfSeq: 4190, participants: [], flights: [] };

  it('still reads a P1 relay’s snapshot, with the new parts empty', () => {
    const body = { ...base, aos: [], you: { flight: null, checkIns: [], openMissions: [] } };
    const parsed = SessionState.parse({ ...envelope(), type: 'session.state', body });
    expect(parsed.body).toMatchObject({ mapEntries: [], holds: [], you: { checkIn: null } });
  });

  it('reads AOs, entries, holds, the check-in and missions', () => {
    const body = {
      ...base,
      aos: [ao()],
      mapEntries: [{ ...keyholeDraft(), cmId: 'c_kh_01', author: JTAC }],
      holds: [hold()],
      you: {
        flight: null,
        checkIn: {
          checkInId: 'ci_1',
          flightId: 'f_3k9q2m',
          aoId: 'a_4m2k9q',
          primary: null,
          brief: brief(),
          since: 1,
        },
        openMissions: [mission()],
      },
    };
    expect(SessionState.safeParse({ ...envelope(), type: 'session.state', body }).success).toBe(
      true,
    );
  });
});
