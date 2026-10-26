// SPDX-License-Identifier: GPL-3.0-or-later
// Fire-mission helpers (P2.6b): rights, slots, lasers and correlation.

import { defaultSlices, MissionContent } from '@slate-dcs/shared';
import type { Ao, CheckIn, FireMission, Lane, Slices } from '@slate-dcs/shared';
import { describe, expect, it } from 'vitest';

import {
  clearConflicts,
  emptyContent,
  laneLaser,
  laneSlots,
  missionRights,
  missionSlots,
  pendingAcks,
  spiOffset,
  stepReady,
} from './missions.js';

const JTAC = 'p_9c11aa';
const JTAC_2 = 'p_4d2e10';
const LEAD = 'p_7f3a9c';
const WING = 'p_2b81de';
const AO = 'a_4m2k9q';

const ao: Ao = {
  aoId: AO,
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
  jtacs: [
    { pid: JTAC, callsign: 'Axeman 11', since: 1, presence: 'online', freqs: [] },
    { pid: JTAC_2, callsign: 'Axeman 12', since: 2, presence: 'online', freqs: [] },
  ],
  inCommand: JTAC,
};

function checkIn(flightId: string, flight: number, perAircraft: Record<string, number>): CheckIn {
  return {
    checkInId: `ci_${flightId}`,
    flightId,
    aoId: AO,
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
      laserCodes: { flight, perAircraft },
      remarks: '',
    },
  };
}

function lane(pid: string, state: Lane['state'], extra: Partial<Lane> = {}): Lane {
  return { pid, state, spi: null, runs: [], bda: null, warnings: [], ...extra };
}

function mission(change: Partial<FireMission> = {}): FireMission {
  const content = emptyContent();
  return {
    ...content,
    nineLine: content.nineLine && {
      ...content.nineLine,
      location: { lat: 42.2203, lon: 41.7431 },
      mark: { type: 'laser', code: null, source: { kind: 'ownship' }, at: null, text: '' },
    },
    missionId: 'm_1',
    aoId: AO,
    owner: JTAC,
    inCommand: JTAC,
    commandOffer: null,
    revision: 1,
    state: 'readbackCorrect',
    assignee: { flightId: 'f_1', pids: null },
    changes: [],
    lanes: [lane(LEAD, 'correlated'), lane(WING, 'open')],
    window: null,
    voiceOnly: false,
    ...change,
  };
}

function slices(pid: string, change: (s: Slices) => void = () => undefined): Slices {
  const s = defaultSlices('test');
  s.session = {
    ...s.session,
    pid,
    role: pid === JTAC || pid === JTAC_2 ? 'jtac' : 'pilot',
  };
  s.cas = { ...s.cas, aos: [ao], checkIns: [checkIn('f_1', 1688, { [WING]: 1511 })] };
  s.mission = { ...s.mission, running: true, theatre: 'Caucasus' };
  change(s);
  return s;
}

describe('rights and the mission’s action row (§10.2, §10.3)', () => {
  it('the JTAC in command steps, the other JTAC may only abort, a pilot nothing', () => {
    const m = mission();
    expect(missionRights(slices(JTAC), m)).toMatchObject({
      jtac: true,
      inCommand: true,
      owner: true,
    });
    expect(missionRights(slices(JTAC_2), m)).toMatchObject({ jtac: true, inCommand: false });
    expect(missionRights(slices(LEAD), m)).toMatchObject({ jtac: false, inCommand: false });
    expect(missionRights(slices(JTAC_2), mission({ commandOffer: JTAC_2 })).offered).toBe(true);
    // A closed mission: nobody is in command of it any more; the owner still deletes.
    const closed = missionRights(slices(JTAC), mission({ state: 'complete' }));
    expect(closed).toMatchObject({ inCommand: false, owner: true, open: false });
  });

  it('next step and the step back by state', () => {
    const rights = missionRights(slices(JTAC), mission());
    const slots = (state: FireMission['state']) => missionSlots(mission({ state }), rights);
    expect(slots('draft')).toMatchObject({ next: 'assign', back: null });
    expect(slots('assigned')).toMatchObject({ next: 'brief', back: 'unassign' });
    expect(slots('briefed')).toMatchObject({ next: 'readbackCorrect', back: 'unassign' });
    expect(slots('readbackCorrect')).toMatchObject({ next: 'complete', back: 'replan' });
    const other = missionRights(slices(JTAC_2), mission());
    expect(missionSlots(mission(), other)).toEqual({
      edit: false,
      next: null,
      back: null,
      cancel: false,
    });
    expect(stepReady(mission({ gamePlan: null }), 'assign')).toBe(false);
    expect(stepReady(mission({ nineLine: null }), 'brief')).toBe(false);
  });
});

describe('lane buttons in fixed slots (§10.3, §10.6)', () => {
  const inCommand = missionRights(slices(JTAC), mission());
  const other = missionRights(slices(JTAC_2), mission());

  it('one step at a time; ABORT only while cleared, for every JTAC of the AO', () => {
    const slots = (state: Lane['state'], rights = inCommand, m = mission()) =>
      laneSlots(m, lane(LEAD, state), rights);
    expect(slots('open')).toEqual({ first: 'correlated', second: null, abort: false });
    expect(slots('correlated')).toEqual({ first: 'hot', second: 'dry', abort: false });
    expect(slots('cleared')).toEqual({ first: 'waitingBda', second: null, abort: true });
    expect(slots('waitingBda')).toEqual({ first: 'bda', second: 'reattack', abort: false });
    expect(slots('bda')).toEqual({ first: null, second: 'reattack', abort: false });
    expect(slots('cleared', other)).toEqual({ first: null, second: null, abort: true });
    expect(slots('correlated', other)).toEqual({ first: null, second: null, abort: false });
  });

  it('a Type 3 lane is cleared by the window, not by CLEARED HOT', () => {
    const base = mission();
    const type3 = mission({ gamePlan: base.gamePlan && { ...base.gamePlan, control: 3 } });
    expect(laneSlots(type3, lane(LEAD, 'correlated'), inCommand)).toEqual({
      first: null,
      second: null,
      abort: false,
    });
  });

  it('nothing before the readback', () => {
    expect(
      laneSlots(mission({ state: 'briefed' }), lane(LEAD, 'open'), inCommand).first,
    ).toBeNull();
  });
});

describe('lasers (§9.5, §10.6)', () => {
  it('ownship lasing uses the aircraft’s own code, else the flight’s', () => {
    const s = slices(JTAC);
    expect(laneLaser(s, mission(), LEAD)).toEqual({ code: 1688, source: LEAD });
    expect(laneLaser(s, mission(), WING)).toEqual({ code: 1511, source: WING });
  });

  it('clearing warns about the same code from another source, never about the same laser', () => {
    // m_2: Colt cleared on 1688 with its own laser. Enfield lead on 1688 too → conflict.
    const colt: FireMission = mission({
      missionId: 'm_2',
      assignee: { flightId: 'f_2', pids: null },
      lanes: [lane('p_6f1a33', 'cleared')],
    });
    const s = slices(JTAC, (x) => {
      x.cas.checkIns.push(checkIn('f_2', 1688, {}));
      x.missions = { ...x.missions, missions: [mission(), colt] };
    });
    expect(clearConflicts(s, mission(), LEAD)).toEqual([{ missionId: 'm_2', pid: 'p_6f1a33' }]);
    // The wing lases for himself on his own code 1511 – no clash.
    expect(clearConflicts(s, mission(), WING)).toEqual([]);
    // Both guiding on the JTAC's laser is one laser, not a conflict.
    const jtacMark = (m: FireMission): FireMission => ({
      ...m,
      nineLine: m.nineLine && {
        ...m.nineLine,
        mark: {
          type: 'laser',
          code: 1688,
          source: { kind: 'jtac', pid: JTAC },
          at: null,
          text: '',
        },
      },
    });
    const shared = slices(JTAC, (x) => {
      x.cas.checkIns.push(checkIn('f_2', 1688, {}));
      x.missions = { ...x.missions, missions: [jtacMark(mission()), jtacMark(colt)] };
    });
    expect(clearConflicts(shared, jtacMark(mission()), LEAD)).toEqual([]);
  });
});

describe('correlation and changes', () => {
  it('the SPI from line 6 in metres and grid degrees', () => {
    // 500 m grid-east of the target is about 7° clockwise from true east at Caucasus.
    const m = mission({
      lanes: [lane(LEAD, 'open', { spi: { lat: 42.2203, lon: 41.7491, elevM: null } })],
    });
    const [first] = m.lanes;
    if (!first) throw new Error('no lane');
    const offset = spiOffset(slices(JTAC), m, first);
    expect(offset?.distanceM).toBeGreaterThan(480);
    expect(offset?.distanceM).toBeLessThan(500);
    expect(offset?.bearingDeg).toBeGreaterThan(80);
    expect(offset?.bearingDeg).toBeLessThan(86);
    expect(spiOffset(slices(JTAC), m, lane(WING, 'open'))).toBeNull();
  });

  it('who still has to acknowledge a change', () => {
    const m = mission({
      changes: [{ rev: 2, fields: ['nineLine.egress'], old: {}, ackedBy: [LEAD] }],
    });
    expect(pendingAcks(m, 2)).toEqual([WING]);
    expect(pendingAcks(m, 9)).toEqual([]);
  });

  it('a new mission’s content is valid as it is', () => {
    expect(MissionContent.safeParse(emptyContent()).success).toBe(true);
  });
});
