// SPDX-License-Identifier: GPL-3.0-or-later
// Fire missions (protocol.md §10): P2.3, rule by rule. The whole sequence with
// 8 pilots and 2 JTACs is in missions.simulation.test.ts.

import type { FireMission, Message } from '@slate-dcs/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { Clock, FakeHost, makeRelay } from './relay-harness.js';
import type { Relay } from './relay.js';

let clock: Clock;
let relay: Relay;

beforeEach(() => {
  clock = new Clock();
  relay = makeRelay(clock);
});

type Body<T extends Message['type']> = Extract<Message, { type: T }>['body'];
type Content = Pick<Body<'fm.create'>, 'gamePlan' | 'nineLine' | 'remarks'>;

let nextId = 1;
function sendTo<T extends Message['type']>(
  host: FakeHost,
  type: T,
  to: Message['to'],
  body: Body<T>,
  extra: { mt?: number } = {},
): string {
  const id = `01JABD2K7Q0M3N4P5R6S8T${String(nextId++).padStart(4, '0')}`;
  host.raw(
    JSON.stringify({
      v: 1,
      id,
      type,
      from: host.pid,
      session: 'blue',
      to,
      ts: clock.now,
      ack: false,
      re: null,
      ...(extra.mt === undefined ? {} : { mt: extra.mt }),
      body,
    }),
  );
  return id;
}

function pilot(nick: string): FakeHost {
  const host = new FakeHost(relay);
  host.hello();
  host.join(nick);
  return host;
}

function jtac(nick: string): FakeHost {
  const host = new FakeHost(relay);
  host.hello();
  host.join(nick, { role: 'jtac', aircraft: { type: 'forward_observer', unit: nick } });
  host.status(42.2, 41.7);
  return host;
}

export function content(control: 1 | 2 | 3 = 2, extra: Partial<Content> = {}): Content {
  return {
    gamePlan: {
      control,
      method: 'BOT',
      effects: 'Destroy',
      ordnance: 'GBU-12 x2',
      interval: '1 min',
    },
    nineLine: {
      ipBp: { lat: 42.3, lon: 41.6 },
      headingDeg: 95,
      offset: 'left',
      distanceM: 11100,
      elevationM: 412,
      description: '2x BMP-2 in treeline',
      location: { lat: 42.2203, lon: 41.7431 },
      locationText: '38T KM 12345 67890',
      mark: { type: 'laser', code: null, source: { kind: 'ownship' }, at: null, text: '' },
      friendlies: { text: 'South 800 m', cmIds: [] },
      egress: 'North',
    },
    remarks: {
      ltl: null,
      finalAttackHeading: null,
      dangerClose: false,
      tot: null,
      restrictions: ['No release east of MSR'],
      hazards: '',
      text: '',
    },
    ...extra,
  };
}

function brief(codes: Body<'cas.checkIn'>['brief']['laserCodes']): Body<'cas.checkIn'>['brief'] {
  return {
    callsign: 'Enfield 1',
    aircraft: [{ pid: 'p_000001', type: 'FA-18C_hornet' }],
    position: null,
    ordnance: [],
    playtimeMin: 40,
    capabilities: ['tgp', 'laser'],
    abortCode: null,
    missionNumber: null,
    laserCodes: codes,
    remarks: '',
  };
}

/** Time passes; the hosts keep answering pings, then the relay's clock ticks. */
function pass(ms: number, hosts: FakeHost[]): void {
  clock.advance(ms);
  for (const host of hosts) host.alive();
  relay.tick();
}

/** The mission as one host last saw it. */
function seen(host: FakeHost, missionId?: string): FireMission | undefined {
  return host
    .of('fm.updated')
    .filter((f) => missionId === undefined || f.body.missionId === missionId)
    .at(-1)?.body;
}

/** Axeman (creator) and Pontiac in one AO; Enfield 1 = lead + wing, checked in. */
function scene(
  codes: Body<'cas.checkIn'>['brief']['laserCodes'] = { flight: 1688, perAircraft: {} },
) {
  const axeman = jtac('Axeman');
  axeman.send('jtac.onStation', { callsign: 'Axeman 11', freqs: [] });
  const ao = axeman.last('ao.created')?.body;
  if (!ao?.joinCode) throw new Error('no AO');
  const pontiac = jtac('Pontiac');
  pontiac.send('jtac.onStation', { callsign: 'Pontiac 21', freqs: [], joinCode: ao.joinCode });
  const lead = pilot('Vis7');
  lead.send('flight.create', { name: 'Enfield', open: true });
  const flightId = lead.last('flight.created')?.body.flightId ?? '';
  const wing = pilot('Wing');
  wing.send('flight.join', { flightId });
  sendTo(lead, 'cas.checkIn', { scope: 'ao', id: ao.aoId }, { brief: brief(codes) });
  return { axeman, pontiac, lead, wing, aoId: ao.aoId, joinCode: ao.joinCode, flightId };
}

function create(host: FakeHost, aoId: string, c: Content = content()): string {
  host.send('fm.create', { ...c, aoId });
  const id = seen(host)?.missionId;
  if (!id) throw new Error(`no mission: ${JSON.stringify(host.last('error')?.body)}`);
  return id;
}

/** Created, assigned to the whole flight, briefed, read back. */
function readBack(s: ReturnType<typeof scene>, c: Content = content()): string {
  const missionId = create(s.axeman, s.aoId, c);
  s.axeman.send('fm.assign', { missionId, assignee: { flightId: s.flightId, pids: null } });
  s.axeman.send('fm.brief', { missionId });
  s.axeman.send('fm.readbackCorrect', { missionId });
  return missionId;
}

describe('create and assign (§10.1)', () => {
  it('a draft is seen by the AO’s JTACs only', () => {
    const s = scene();
    const missionId = create(s.axeman, s.aoId);
    expect(seen(s.pontiac, missionId)).toMatchObject({
      state: 'draft',
      owner: s.axeman.pid,
      inCommand: s.axeman.pid,
      lanes: [],
    });
    expect(s.lead.of('fm.updated')).toEqual([]);
    s.lead.send('fm.create', { ...content(), aoId: s.aoId });
    expect(s.lead.last('error')?.body.code).toBe('forbidden');
  });

  it('assigning the flight gives every member a lane; each pilot sees only his', () => {
    const s = scene();
    const missionId = create(s.axeman, s.aoId);
    s.axeman.send('fm.assign', { missionId, assignee: { flightId: s.flightId, pids: null } });
    expect(seen(s.axeman, missionId)?.lanes.map((l) => l.pid)).toEqual([s.lead.pid, s.wing.pid]);
    expect(seen(s.lead, missionId)?.lanes.map((l) => l.pid)).toEqual([s.lead.pid]);
    expect(seen(s.wing, missionId)?.lanes.map((l) => l.pid)).toEqual([s.wing.pid]);
  });

  it('an aircraft assignment gives lanes only to those aircraft', () => {
    const s = scene();
    const missionId = create(s.axeman, s.aoId);
    s.axeman.send('fm.assign', {
      missionId,
      assignee: { flightId: s.flightId, pids: [s.wing.pid] },
    });
    expect(seen(s.axeman, missionId)?.lanes.map((l) => l.pid)).toEqual([s.wing.pid]);
    expect(seen(s.lead, missionId)?.lanes).toEqual([]);
  });

  it('needs a checked-in flight and a game plan; the 9-line before the brief', () => {
    const s = scene();
    const other = pilot('Colt');
    other.send('flight.create', { name: 'Colt', open: true });
    const colt = other.last('flight.created')?.body.flightId ?? '';
    const missionId = create(s.axeman, s.aoId, content(2, { gamePlan: null, nineLine: null }));
    s.axeman.send('fm.assign', { missionId, assignee: { flightId: colt, pids: null } });
    expect(s.axeman.last('error')?.body.code).toBe('badCode');
    s.axeman.send('fm.assign', { missionId, assignee: { flightId: s.flightId, pids: null } });
    expect(s.axeman.last('error')?.body.code).toBe('badMessage');
    s.axeman.send('fm.update', { ...content(2, { nineLine: null }), missionId });
    s.axeman.send('fm.assign', { missionId, assignee: { flightId: s.flightId, pids: null } });
    s.axeman.send('fm.brief', { missionId });
    expect(s.axeman.last('error')?.body.code).toBe('badMessage');
  });
});

describe('the attack (§10.3, §10.6, §10.7)', () => {
  it('correlate, clear hot, waiting BDA, BDA, re-attack, again, complete – per aircraft', () => {
    const s = scene();
    const missionId = readBack(s);
    expect(seen(s.lead, missionId)?.state).toBe('readbackCorrect');
    s.lead.send('fm.spi', { missionId, spi: { lat: 42.2201, lon: 41.7427, elevM: 410 } });
    s.axeman.send('fm.clear', { missionId, pid: s.lead.pid, kind: 'hot' });
    expect(s.axeman.last('error')?.body).toMatchObject({
      code: 'forbidden',
      text: 'That lane is open',
    });
    s.axeman.send('fm.correlated', { missionId, pid: s.lead.pid });
    sendTo(
      s.axeman,
      'fm.clear',
      { scope: 'relay' },
      { missionId, pid: s.lead.pid, kind: 'hot' },
      { mt: 51830 },
    );
    const lane = seen(s.lead, missionId)?.lanes[0];
    expect(lane).toMatchObject({
      state: 'cleared',
      spi: { elevM: 410 },
      runs: [{ run: 1, clearance: { kind: 'hot', mtime: 51830, by: s.axeman.pid } }],
    });
    // The wingman never sees the lead's clearance.
    expect(seen(s.wing, missionId)?.lanes).toMatchObject([{ pid: s.wing.pid, state: 'open' }]);
    s.axeman.send('fm.waitingBda', { missionId, pid: s.lead.pid });
    s.axeman.send('fm.bda', {
      missionId,
      pid: s.lead.pid,
      target: '2x BMP-2',
      effect: 'damaged',
      location: null,
      mtime: 51900,
      remarks: '',
    });
    s.lead.send('fm.ackBda', { missionId });
    expect(seen(s.axeman, missionId)?.lanes[0]?.bda).toMatchObject({
      effect: 'damaged',
      acked: true,
    });
    s.axeman.send('fm.reattack', { missionId, pid: s.lead.pid, to: 'attack' });
    s.axeman.send('fm.clear', { missionId, pid: s.lead.pid, kind: 'hot' });
    expect(seen(s.lead, missionId)?.lanes[0]?.runs.map((r) => r.run)).toEqual([1, 2]);
    s.axeman.send('fm.waitingBda', { missionId, pid: s.lead.pid });
    s.axeman.send('fm.complete', { missionId });
    expect(seen(s.wing, missionId)?.state).toBe('complete');
  });

  it('any JTAC aborts any lane; a pilot only his own', () => {
    const s = scene();
    const missionId = readBack(s);
    for (const pilotHost of [s.lead, s.wing]) {
      s.axeman.send('fm.correlated', { missionId, pid: pilotHost.pid });
      s.axeman.send('fm.clear', { missionId, pid: pilotHost.pid, kind: 'hot' });
    }
    s.pontiac.send('fm.abort', {
      missionId,
      pid: s.lead.pid,
      channel: 'voice',
      reason: 'Friendlies',
    });
    expect(seen(s.lead, missionId)?.lanes[0]).toMatchObject({
      state: 'correlated',
      runs: [{ abort: { by: s.pontiac.pid, channel: 'voice', reason: 'Friendlies' } }],
    });
    s.lead.send('fm.abort', { missionId, pid: s.wing.pid, channel: 'app', reason: 'x' });
    expect(s.lead.last('error')?.body.code).toBe('forbidden');
    s.wing.send('fm.abort', { missionId, pid: s.wing.pid, channel: 'app', reason: 'Lost SPI' });
    expect(seen(s.wing, missionId)?.lanes[0]?.state).toBe('correlated');
  });

  it('only the JTAC in command moves steps', () => {
    const s = scene();
    const missionId = readBack(s);
    s.pontiac.send('fm.correlated', { missionId, pid: s.lead.pid });
    expect(s.pontiac.last('error')?.body.code).toBe('forbidden');
  });
});

describe('changes after the readback (§10.5)', () => {
  it('line 6 changed while cleared: abort with rbChange, back to briefed, every lane open', () => {
    const s = scene();
    const missionId = readBack(s);
    s.axeman.send('fm.correlated', { missionId, pid: s.lead.pid });
    s.axeman.send('fm.clear', { missionId, pid: s.lead.pid, kind: 'hot' });
    const moved = content();
    if (moved.nineLine) moved.nineLine.location = { lat: 42.23, lon: 41.75 };
    s.axeman.send('fm.update', { ...moved, missionId });
    const m = seen(s.lead, missionId);
    expect(m).toMatchObject({ state: 'briefed', revision: 2 });
    expect(m?.lanes[0]).toMatchObject({
      state: 'open',
      runs: [{ abort: { by: 'relay', reason: 'rbChange' } }],
    });
    expect(m?.changes).toMatchObject([
      {
        rev: 2,
        fields: ['nineLine.location'],
        old: { 'nineLine.location': { lat: 42.2203, lon: 41.7431 } },
      },
    ]);
  });

  it('another change only needs each pilot’s ACK; a pilot sees only his own', () => {
    const s = scene();
    const missionId = readBack(s);
    const changed = content();
    if (changed.nineLine) changed.nineLine.description = '3x BMP-2';
    s.axeman.send('fm.update', { ...changed, missionId });
    expect(seen(s.lead, missionId)?.state).toBe('readbackCorrect');
    s.wing.send('fm.ackChange', { missionId, rev: 2 });
    expect(seen(s.axeman, missionId)?.changes[0]?.ackedBy).toEqual([s.wing.pid]);
    expect(seen(s.lead, missionId)?.changes[0]?.ackedBy).toEqual([]);
    expect(seen(s.wing, missionId)?.changes[0]?.ackedBy).toEqual([s.wing.pid]);
  });

  it('no change list before the brief', () => {
    const s = scene();
    const missionId = create(s.axeman, s.aoId);
    s.axeman.send('fm.update', { ...content(1), missionId });
    expect(seen(s.axeman, missionId)).toMatchObject({ revision: 2, changes: [] });
  });
});

describe('Type 3 window (§10.6)', () => {
  it('clears the correlated lanes while open; expired = not cleared', () => {
    const s = scene();
    const missionId = readBack(s, content(3));
    s.axeman.send('fm.correlated', { missionId, pid: s.lead.pid });
    s.axeman.send('fm.clear', { missionId, pid: s.lead.pid, kind: 'hot' });
    expect(s.axeman.last('error')?.body.code).toBe('badMessage');
    const window = {
      pids: null,
      from: 51000,
      until: 51300,
      area: null,
      targets: { text: 'Armour in the treeline', cmIds: [] },
      restrictions: [],
    };
    sendTo(s.axeman, 'fm.window', { scope: 'relay' }, { missionId, window }, { mt: 51000 });
    expect(seen(s.lead, missionId)).toMatchObject({
      window: { pids: [s.lead.pid], by: s.axeman.pid },
      lanes: [{ state: 'cleared', runs: [{ clearance: { kind: 'window' } }] }],
    });
    // The wingman wasn't correlated: not in the window, and he doesn't see it.
    expect(seen(s.wing, missionId)?.window).toBeNull();
    pass(301_000, [s.axeman, s.pontiac, s.lead, s.wing]);
    expect(seen(s.lead, missionId)).toMatchObject({
      window: null,
      lanes: [{ state: 'correlated' }],
    });
  });

  it('a window in the future opens at its time; revoke ends it at once', () => {
    const s = scene();
    const missionId = readBack(s, content(3));
    s.axeman.send('fm.correlated', { missionId, pid: s.lead.pid });
    const window = {
      pids: [s.lead.pid],
      from: 51060,
      until: 51600,
      area: { center: { lat: 42.22, lon: 41.74 }, radiusM: 3704 },
      targets: { text: '', cmIds: [] },
      restrictions: [],
    };
    sendTo(s.axeman, 'fm.window', { scope: 'relay' }, { missionId, window }, { mt: 51000 });
    expect(seen(s.lead, missionId)?.lanes[0]?.state).toBe('correlated');
    pass(61_000, [s.axeman, s.pontiac, s.lead, s.wing]);
    expect(seen(s.lead, missionId)?.lanes[0]?.state).toBe('cleared');
    s.axeman.send('fm.windowRevoke', { missionId });
    expect(seen(s.lead, missionId)).toMatchObject({
      window: null,
      lanes: [{ state: 'correlated' }],
    });
  });

  it('needs a mission clock', () => {
    const s = scene();
    const missionId = readBack(s, content(3));
    s.axeman.send('fm.correlated', { missionId, pid: s.lead.pid });
    const window = {
      pids: null,
      from: 51000,
      until: 51300,
      area: null,
      targets: { text: '', cmIds: [] },
      restrictions: [],
    };
    s.axeman.send('fm.window', { missionId, window });
    expect(s.axeman.last('error')?.body.code).toBe('badMessage');
  });
});

describe('command (§10.2)', () => {
  it('offer, accept, give back, reclaim – a JTAC given command can’t pass it on', () => {
    const s = scene();
    const missionId = create(s.axeman, s.aoId);
    s.pontiac.send('fm.offerCommand', { missionId, pid: s.axeman.pid });
    expect(s.pontiac.last('error')?.body.code).toBe('forbidden');
    s.axeman.send('fm.offerCommand', { missionId, pid: s.pontiac.pid });
    expect(seen(s.pontiac, missionId)?.commandOffer).toBe(s.pontiac.pid);
    s.pontiac.send('fm.acceptCommand', { missionId });
    expect(seen(s.axeman, missionId)).toMatchObject({
      inCommand: s.pontiac.pid,
      commandOffer: null,
    });
    s.pontiac.send('fm.returnCommand', { missionId });
    expect(seen(s.axeman, missionId)?.inCommand).toBe(s.axeman.pid);
    s.axeman.send('fm.offerCommand', { missionId, pid: s.pontiac.pid });
    s.pontiac.send('fm.acceptCommand', { missionId });
    s.axeman.send('fm.reclaim', { missionId });
    expect(seen(s.pontiac, missionId)?.inCommand).toBe(s.axeman.pid);
  });

  it('a lost JTAC’s missions go to the owner, else to the AO’s JTAC in command; they stay there', () => {
    const s = scene();
    const missionId = create(s.axeman, s.aoId);
    s.axeman.send('fm.offerCommand', { missionId, pid: s.pontiac.pid });
    s.pontiac.send('fm.acceptCommand', { missionId });
    s.pontiac.drop();
    expect(seen(s.axeman, missionId)?.inCommand).toBe(s.axeman.pid);
    // Now the owner himself drops out: the AO's next JTAC in command takes it.
    const other = create(s.axeman, s.aoId);
    s.pontiac.reconnect();
    s.pontiac.hello();
    s.pontiac.join('Pontiac', {
      role: 'jtac',
      aircraft: { type: 'forward_observer', unit: 'Pontiac' },
    });
    s.axeman.drop();
    expect(seen(s.pontiac, other)?.inCommand).toBe(s.pontiac.pid);
    s.axeman.reconnect();
    s.axeman.hello();
    s.axeman.join('Axeman', {
      role: 'jtac',
      aircraft: { type: 'forward_observer', unit: 'Axeman' },
    });
    expect(seen(s.pontiac, other)?.inCommand).toBe(s.pontiac.pid);
    // The returning owner gets every mission of his AO in the snapshot.
    expect(
      s.axeman
        .last('session.state')
        ?.body.you.openMissions.map((m) => m.missionId)
        .sort(),
    ).toEqual([missionId, other].sort());
  });

  it('only the owner deletes; an entry line 1 refers to can’t be deleted', () => {
    const s = scene();
    s.axeman.send('cm.create', {
      kind: 'ip',
      shape: 'point',
      geom: { lat: 42.3, lon: 41.6 },
      label: 'IP SIERRA',
      text: null,
      ringM: null,
      count: null,
      moving: null,
      observedMtime: null,
      block: null,
      aoId: s.aoId,
      visibility: 'ao',
    });
    const cmId = s.axeman.last('cm.created')?.body.cmId ?? '';
    const c = content();
    if (c.nineLine) c.nineLine.ipBp = { cmId };
    const missionId = create(s.axeman, s.aoId, c);
    s.axeman.send('cm.delete', { cmId });
    expect(s.axeman.last('error')?.body.code).toBe('inUse');
    s.pontiac.send('fm.delete', { missionId });
    expect(s.pontiac.last('error')?.body.code).toBe('forbidden');
    s.axeman.send('fm.delete', { missionId });
    expect(s.pontiac.last('fm.deleted')?.body).toEqual({ missionId, hidden: false });
  });
});

describe('the flight changes (§10.1, §7.2)', () => {
  it('a check-out sends the mission back to draft; it can go to another flight', () => {
    const s = scene();
    const missionId = readBack(s);
    s.lead.send('cas.checkOut', {});
    expect(seen(s.axeman, missionId)).toMatchObject({ state: 'draft', assignee: null, lanes: [] });
    expect(s.wing.last('fm.deleted')?.body).toEqual({ missionId, hidden: true });
    const colt = pilot('Colt');
    colt.send('flight.create', { name: 'Colt', open: true });
    const coltId = colt.last('flight.created')?.body.flightId ?? '';
    sendTo(
      colt,
      'cas.checkIn',
      { scope: 'ao', id: s.aoId },
      { brief: brief({ flight: 1511, perAircraft: {} }) },
    );
    s.axeman.send('fm.assign', { missionId, assignee: { flightId: coltId, pids: null } });
    expect(seen(colt, missionId)?.state).toBe('assigned');
  });

  it('a member leaving takes his lane along; a new one gets a lane', () => {
    const s = scene();
    const missionId = readBack(s);
    s.wing.send('flight.leave', {});
    expect(seen(s.axeman, missionId)?.lanes.map((l) => l.pid)).toEqual([s.lead.pid]);
    expect(s.wing.last('fm.deleted')?.body).toEqual({ missionId, hidden: true });
    const late = pilot('Late');
    late.send('flight.join', { flightId: s.flightId });
    expect(seen(late, missionId)?.lanes).toMatchObject([{ pid: late.pid, state: 'open' }]);
  });
});

describe('laser deconfliction (§10.6)', () => {
  it('two lasers with one code active in the AO are flagged for the JTACs only', () => {
    const s = scene({ flight: 1688, perAircraft: {} });
    const ownship = readBack(s);
    const buddy = content();
    if (buddy.nineLine)
      buddy.nineLine.mark = {
        type: 'laser',
        code: 1688,
        source: { kind: 'jtac', pid: s.pontiac.pid },
        at: null,
        text: '',
      };
    const second = readBack(s, buddy);
    s.axeman.send('fm.correlated', { missionId: ownship, pid: s.lead.pid });
    s.axeman.send('fm.clear', { missionId: ownship, pid: s.lead.pid, kind: 'hot' });
    s.axeman.send('fm.correlated', { missionId: second, pid: s.wing.pid });
    s.axeman.send('fm.clear', { missionId: second, pid: s.wing.pid, kind: 'hot' });
    const wingLane = seen(s.axeman, second)?.lanes.find((l) => l.pid === s.wing.pid);
    expect(wingLane?.warnings).toContainEqual({ kind: 'laserConflict', code: 1688, with: ownship });
    const leadLane = seen(s.axeman, ownship)?.lanes.find((l) => l.pid === s.lead.pid);
    expect(leadLane?.warnings).toEqual([{ kind: 'laserConflict', code: 1688, with: second }]);
    expect(seen(s.lead, ownship)?.lanes[0]?.warnings).toEqual([]);
  });

  it('a line 7 code that isn’t the aircraft’s weapon code is flagged', () => {
    const s = scene({ flight: 1511, perAircraft: {} });
    const buddy = content();
    if (buddy.nineLine)
      buddy.nineLine.mark = {
        type: 'laser',
        code: 1688,
        source: { kind: 'jtac', pid: s.axeman.pid },
        at: null,
        text: '',
      };
    const missionId = readBack(s, buddy);
    expect(seen(s.axeman, missionId)?.lanes[0]?.warnings).toEqual([
      { kind: 'codeMismatch', code: 1688, weaponCode: 1511 },
    ]);
  });
});
