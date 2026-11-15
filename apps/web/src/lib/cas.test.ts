// SPDX-License-Identifier: GPL-3.0-or-later
// The screens' CAS helpers (P2.6): who the user is, names, positions and
// point references, times, ticks, missions and lasers.

import { defaultSlices, distanceM } from '@slate-dcs/shared';
import type { Ao, CheckIn, Delivery, FireMission, Hold, MapEntry, Slices } from '@slate-dcs/shared';
import { describe, expect, it } from 'vitest';

import {
  callsignOf,
  casWho,
  deliveryOf,
  entryName,
  holdOverlaps,
  laserUses,
  linkedEntries,
  parseMissionTime,
  pointText,
  sharedCodes,
  sortedMissions,
  tickLevel,
} from './cas.js';

const JTAC = 'p_9c11aa';
const LEAD = 'p_7f3a9c';
const WING = 'p_2b81de';

const ao: Ao = {
  aoId: 'a_4m2k9q',
  joinCode: 'Q4T-8MZ',
  name: 'AO HAMMER',
  type: 'circle',
  center: { lat: 42.2, lon: 41.7 },
  radiusM: 18_520,
  lengthM: null,
  widthM: null,
  headingDeg: null,
  points: null,
  floor: { m: 0, ref: 'sfc' },
  ceiling: { m: 6096, ref: 'msl' },
  jtacs: [{ pid: JTAC, callsign: 'Axeman 11', since: 1, presence: 'online', freqs: [] }],
  inCommand: JTAC,
};

const keyhole: MapEntry = {
  cmId: 'c_kh_01',
  author: JTAC,
  kind: 'keyhole',
  shape: 'point',
  geom: { lat: 43.644_065_372_2, lon: 43.664_750_133_5 },
  label: 'ROCK',
  text: null,
  ringM: null,
  count: null,
  moving: null,
  observedMtime: null,
  block: null,
  aoId: ao.aoId,
  visibility: 'ao',
};

function checkIn(codes: CheckIn['brief']['laserCodes']): CheckIn {
  return {
    checkInId: 'ci_1',
    flightId: 'f_3k9q2m',
    aoId: ao.aoId,
    primary: JTAC,
    since: 1,
    brief: {
      callsign: 'Enfield 1',
      aircraft: [
        { pid: LEAD, type: 'FA-18C_hornet' },
        { pid: WING, type: 'FA-18C_hornet' },
      ],
      position: null,
      ordnance: [],
      playtimeMin: 40,
      capabilities: [],
      abortCode: null,
      missionNumber: null,
      laserCodes: codes,
      remarks: '',
    },
  };
}

function slices(change: (s: Slices) => void = () => undefined): Slices {
  const s = defaultSlices('test');
  s.session = { ...s.session, pid: JTAC, role: 'jtac', state: 'joined' };
  s.cas = {
    ...s.cas,
    aos: [ao],
    mapEntries: [keyhole],
    checkIns: [checkIn({ flight: 1688, perAircraft: {} })],
  };
  s.mission = {
    ...s.mission,
    running: true,
    theatre: 'Caucasus',
    clock: { mtimeSec: 8 * 3600 + 30 * 60, sampledAt: 0, paused: false },
  };
  change(s);
  return s;
}

describe('who and names', () => {
  it('a JTAC on-station: his AO, in command, MGRS', () => {
    const who = casWho(slices());
    expect(who).toMatchObject({ jtac: true, aoCommand: true });
    expect(who.ao?.aoId).toBe(ao.aoId);
    expect(who.style.formats).toEqual(['mgrs']);
  });

  it('a pilot in a Viper: no AO, DDM', () => {
    const who = casWho(
      slices((s) => {
        s.session = { ...s.session, pid: LEAD, role: 'pilot' };
        s.ownship = { ...s.ownship, aircraft: { type: 'F-16C_50', unit: 'Colt 1-1', slot: '1' } };
      }),
    );
    expect(who).toMatchObject({ jtac: false, ao: null, aoCommand: false });
    expect(who.style.formats).toEqual(['ddm']);
  });

  it('callsigns: the JTAC’s, an aircraft by its place in the check-in, else the pid', () => {
    const s = slices();
    expect(callsignOf(s, JTAC)).toBe('Axeman 11');
    expect(callsignOf(s, WING)).toBe('Enfield 1-2');
    expect(callsignOf(s, 'p_000000')).toBe('p_000000');
  });
});

describe('point references (§8.5)', () => {
  it('a keyhole point lies along grid north at grid NM', () => {
    const s = slices();
    const p = pointText(s, { cmId: keyhole.cmId, axis: 'A', distanceNm: 1000 / 1852 });
    expect(p.name).toBe('KEYHOLE ROCK – ALPHA 0.5');
    // DCS's own point 1 km grid-north of ECHO (spike 3.2).
    const north = { lat: 43.652_913_601_2, lon: 43.666_334_209_6 };
    expect(p.at && distanceM(p.at, north)).toBeLessThan(2);
    expect(pointText(s, { cmId: keyhole.cmId })).toMatchObject({ name: 'KEYHOLE ROCK' });
    expect(pointText(s, { lat: 1, lon: 2 })).toEqual({ name: null, at: { lat: 1, lon: 2 } });
    expect(pointText(s, { cmId: 'c_gone' }).at).toBeNull();
  });
});

describe('typed times (§0)', () => {
  it('in the user’s clock setting, on the day closest to now', () => {
    // Caucasus: UTC+4. The clock is at 08:30 local = 04:30 Z.
    const zulu = slices();
    expect(parseMissionTime(zulu, '0445', 0)).toBe(8 * 3600 + 45 * 60);
    expect(parseMissionTime(zulu, '04:45:30', 0)).toBe(8 * 3600 + 45 * 60 + 30);
    const local = slices((s) => {
      s.settings = { ...s.settings, timeDisplay: 'local' };
    });
    expect(parseMissionTime(local, '0845', 0)).toBe(8 * 3600 + 45 * 60);
    // On the mission's first day there is no yesterday: 23:50 is tonight.
    expect(parseMissionTime(local, '2350', 0)).toBe(23 * 3600 + 50 * 60);
    // A day later, 23:50 is closer as yesterday than as tonight.
    const dayTwo = slices((s) => {
      s.settings = { ...s.settings, timeDisplay: 'local' };
      s.mission = {
        ...s.mission,
        clock: { mtimeSec: 86_400 + 8 * 3600, sampledAt: 0, paused: false },
      };
    });
    expect(parseMissionTime(dayTwo, '2350', 0)).toBe(23 * 3600 + 50 * 60);
    expect(parseMissionTime(dayTwo, '0815', 0)).toBe(86_400 + 8 * 3600 + 15 * 60);
    expect(parseMissionTime(local, '2561', 0)).toBeNull();
    expect(parseMissionTime(local, 'soon', 0)).toBeNull();
  });
});

describe('ticks (§1.2)', () => {
  const d = (extra: Partial<Delivery>): Delivery => ({
    id: '01JABD2K7Q0M3N4P5R6S7T8V9W',
    type: 'fm.clear',
    ref: 'm_1',
    pid: LEAD,
    at: 0,
    relay: false,
    receivedBy: [],
    ...extra,
  });

  it('sent, at the relay, delivered to the right one, acknowledged by a person', () => {
    expect(tickLevel(null, null, false)).toBe('none');
    expect(tickLevel(d({}), [LEAD], false)).toBe('sent');
    expect(tickLevel(d({ relay: true }), [LEAD], false)).toBe('relay');
    expect(tickLevel(d({ relay: true, receivedBy: [WING] }), [LEAD], false)).toBe('relay');
    expect(tickLevel(d({ relay: true, receivedBy: [LEAD] }), [LEAD], false)).toBe('delivered');
    expect(tickLevel(d({ relay: true, receivedBy: [WING] }), null, false)).toBe('delivered');
    expect(tickLevel(null, null, true)).toBe('acknowledged');
  });

  it('the newest delivery about a mission and lane', () => {
    const s = slices((x) => {
      x.cas = {
        ...x.cas,
        deliveries: [
          d({ id: '01JABD2K7Q0M3N4P5R6S7T8V9A' }),
          d({ id: '01JABD2K7Q0M3N4P5R6S7T8V9B', pid: WING }),
          d({ id: '01JABD2K7Q0M3N4P5R6S7T8V9C' }),
        ],
      };
    });
    expect(deliveryOf(s, 'fm.clear', 'm_1', LEAD)?.id).toBe('01JABD2K7Q0M3N4P5R6S7T8V9C');
    expect(deliveryOf(s, ['fm.clear'], 'm_1', WING)?.id).toBe('01JABD2K7Q0M3N4P5R6S7T8V9B');
    expect(deliveryOf(s, 'fm.abort', 'm_1')).toBeNull();
  });
});

describe('missions and lasers', () => {
  const m = (missionId: string, state: FireMission['state']) =>
    ({ missionId, state }) as FireMission;

  it('missions needing action first, closed last', () => {
    expect(
      sortedMissions([
        m('a', 'complete'),
        m('b', 'draft'),
        m('c', 'readbackCorrect'),
        m('d', 'briefed'),
      ]).map((x) => x.missionId),
    ).toEqual(['c', 'd', 'b', 'a']);
  });

  it('codes in the AO, the same code twice flagged', () => {
    const s = slices((x) => {
      x.cas = {
        ...x.cas,
        checkIns: [
          checkIn({ flight: 1688, perAircraft: { [WING]: 1511 } }),
          {
            ...checkIn({ flight: 1511, perAircraft: {} }),
            checkInId: 'ci_2',
            flightId: 'f_8h2w4n',
          },
        ],
      };
    });
    const uses = laserUses(s);
    expect(uses.map((u) => [u.code, u.kind])).toEqual([
      [1511, 'aircraft'],
      [1511, 'flight'],
      [1688, 'flight'],
    ]);
    expect([...sharedCodes(uses)]).toEqual([1511]);
  });
});

describe('hold overlap before sending (§9.4)', () => {
  const NM = 1852;
  const hold: Hold = {
    holdId: 'h_000001',
    aoId: ao.aoId,
    conflicts: [],
    flightId: 'f_3k9q2m',
    point: { cmId: keyhole.cmId, axis: 'A', distanceNm: 8 },
    floor: { m: 4572, ref: 'msl' },
    ceiling: { m: 5181, ref: 'msl' },
    turns: 'left',
    shape: 'orbit',
    radiusM: 2 * NM,
    legM: null,
    inboundDeg: null,
    from: null,
    until: null,
    visibility: 'ao',
  };
  const s = slices((x) => {
    x.cas = { ...x.cas, holds: [hold] };
  });

  it('the same point and block overlaps; a stacked block and the hold itself do not', () => {
    expect(holdOverlaps(s, ao.aoId, hold, null).map((h) => h.holdId)).toEqual(['h_000001']);
    expect(holdOverlaps(s, ao.aoId, hold, 'h_000001')).toEqual([]);
    const above = { ...hold, floor: { m: 5500, ref: 'msl' as const } };
    expect(holdOverlaps(s, ao.aoId, { ...above, ceiling: { m: 6000, ref: 'msl' } }, null)).toEqual(
      [],
    );
    expect(holdOverlaps(s, 'a_other0', hold, null)).toEqual([]);
  });
});

describe('links to map entries (§9.3, §10.4)', () => {
  const enemy: MapEntry = {
    ...keyhole,
    cmId: 'c_en_01',
    kind: 'enemy',
    label: 'BMP-2',
    count: 2,
  };

  it('names an entry with its count, and skips entries this user cannot see', () => {
    expect(entryName(enemy)).toBe('ENEMY 2x BMP-2');
    const s = slices((x) => {
      x.cas = { ...x.cas, mapEntries: [keyhole, enemy] };
    });
    const linked = linkedEntries(s, ['c_en_01', 'c_gone']);
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ cmId: 'c_en_01', name: 'ENEMY 2x BMP-2' });
    expect(linked[0]?.at).not.toBeNull();
  });
});
