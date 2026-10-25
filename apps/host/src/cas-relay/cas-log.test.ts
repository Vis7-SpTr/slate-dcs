// SPDX-License-Identifier: GPL-3.0-or-later
// The CAS log (protocol.md §12): P2.4, rule by rule – what each area logs,
// the actor and mission time, `log.request` rights and paging. The whole
// sequence with 8 pilots and 2 JTACs is checked in missions.simulation.test.ts.

import { CAS_LOG_RULES } from '@slate-dcs/shared';
import type { Coalition, LogEntry, Message } from '@slate-dcs/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { Clock, FakeHost, makeRelay } from './relay-harness.js';
import type { Relay } from './relay.js';

type Body<T extends Message['type']> = Extract<Message, { type: T }>['body'];
type Content = Pick<Body<'fm.create'>, 'gamePlan' | 'nineLine' | 'remarks'>;

function content(control: 1 | 2 | 3 = 2): Content {
  return {
    gamePlan: { control, method: 'BOT', effects: 'Destroy', ordnance: 'GBU-12', interval: '' },
    nineLine: {
      ipBp: { lat: 42.3, lon: 41.6 },
      headingDeg: 95,
      offset: 'left',
      distanceM: 11100,
      elevationM: 412,
      description: '2x BMP-2',
      location: { lat: 42.2203, lon: 41.7431 },
      locationText: '38T KM 12345 67890',
      mark: { type: 'laser', code: null, source: { kind: 'ownship' }, at: null, text: '' },
      friendlies: { text: '', cmIds: [] },
      egress: 'North',
    },
    remarks: {
      ltl: null,
      finalAttackHeading: null,
      dangerClose: false,
      tot: null,
      restrictions: [],
      hazards: '',
      text: '',
    },
  };
}

let clock: Clock;
let relay: Relay;
let written: { session: Coalition; entry: LogEntry }[];

beforeEach(() => {
  clock = new Clock();
  written = [];
  relay = makeRelay(clock, undefined, {
    append: (session, entry) => {
      written.push({ session, entry });
    },
  });
});

function pilot(nick: string, type = 'FA-18C_hornet'): FakeHost {
  const host = new FakeHost(relay);
  host.hello();
  host.join(nick, { aircraft: { type, unit: nick } });
  return host;
}

function jtac(nick: string): FakeHost {
  const host = new FakeHost(relay);
  host.hello();
  host.join(nick, { role: 'jtac', aircraft: { type: 'forward_observer', unit: nick } });
  host.status(42.2, 41.7);
  return host;
}

function brief(
  callsign: string,
  codes: Body<'cas.checkIn'>['brief']['laserCodes'] = { flight: 1688, perAircraft: {} },
): Body<'cas.checkIn'>['brief'] {
  return {
    callsign,
    aircraft: [
      { pid: 'p_000001', type: 'FA-18C_hornet' },
      { pid: 'p_000002', type: 'FA-18C_hornet' },
    ],
    position: null,
    ordnance: [
      { name: 'GBU-12', count: 4 },
      { name: 'AIM-9X', count: 2 },
    ],
    playtimeMin: 40,
    capabilities: ['tgp', 'laser'],
    abortCode: 'LOBSTER',
    missionNumber: null,
    laserCodes: codes,
    remarks: '',
  };
}

/** `cas.checkIn` addressed to an AO or a JTAC (`to` isn't the relay). */
function checkIn(host: FakeHost, to: Message['to'], b: Body<'cas.checkIn'>['brief']): void {
  host.raw(
    JSON.stringify({
      v: 1,
      id: `01JABD2K7Q0M3N4P5R6S7T${String(Math.floor(Math.random() * 9000) + 1000)}`,
      type: 'cas.checkIn',
      from: host.pid,
      session: 'blue',
      to,
      ts: clock.now,
      ack: false,
      re: null,
      body: { brief: b },
    }),
  );
}

/** Axeman 11 on-station; Enfield 1 (lead + wing) checked in to his AO. */
function scene() {
  const axeman = jtac('Axeman');
  axeman.send('jtac.onStation', { callsign: 'Axeman 11', freqs: [] });
  const ao = axeman.last('ao.created')?.body;
  if (!ao?.joinCode) throw new Error('no AO');
  const lead = pilot('Vis7');
  lead.send('flight.create', { name: 'Enfield', open: true });
  const flightId = lead.last('flight.created')?.body.flightId ?? '';
  const wing = pilot('Wing');
  wing.send('flight.join', { flightId });
  checkIn(lead, { scope: 'pid', id: axeman.pid }, brief('Enfield 1'));
  return { axeman, lead, wing, aoId: ao.aoId, joinCode: ao.joinCode, flightId };
}

const log = () => relay.casLog('blue');
const last = () => log().at(-1);
const kinds = () => log().map((e) => e.kind);

function request(host: FakeHost, body: Body<'log.request'>): Body<'log.entries'> | string {
  host.clear();
  host.send('log.request', body);
  const error = host.last('error');
  if (error) return error.body.code;
  const entries = host.last('log.entries');
  if (!entries) throw new Error('no answer');
  return entries.body;
}

describe('AO entries (§12.2)', () => {
  it('logs on-station, AO changes, off-station and the AO closing', () => {
    const s = scene();
    const pontiac = jtac('Pontiac');
    pontiac.send('jtac.onStation', { callsign: 'Pontiac 21', freqs: [], joinCode: s.joinCode });
    s.axeman.send('ao.update', { aoId: s.aoId, changes: { radiusM: 18_520, name: 'VALLEY' } });
    pontiac.send('jtac.offStation', { aoId: s.aoId });
    const ao = log().filter((e) => e.area === 'ao');
    expect(ao.map((e) => [e.kind, e.summary])).toEqual([
      [
        'jtac.onStation',
        'Axeman 11: on-station – new AO AXEMAN 11 (circle 10 NM, SFC – 20000 ft MSL)',
      ],
      ['jtac.onStation', 'Pontiac 21: on-station in AO AXEMAN 11'],
      [
        'ao.update',
        'Axeman 11: AO VALLEY changed: circle 10 NM, SFC – 20000 ft MSL → circle 10 NM, SFC – 20000 ft MSL, renamed from AO AXEMAN 11',
      ],
      ['jtac.offStation', 'Pontiac 21: off-station from AO VALLEY'],
    ]);
    expect(ao.every((e) => e.aoId === s.aoId)).toBe(true);
    s.lead.send('cas.checkOut', {});
    s.axeman.send('jtac.offStation', { aoId: s.aoId });
    expect(last()).toMatchObject({
      kind: 'ao.closed',
      actor: s.axeman.pid,
      summary: 'Axeman 11: off-station from AO VALLEY – AO VALLEY closed',
    });
  });

  it('a JTAC lost and back is the relay’s entry, with who is in command', () => {
    const s = scene();
    const pontiac = jtac('Pontiac');
    pontiac.send('jtac.onStation', { callsign: 'Pontiac 21', freqs: [], joinCode: s.joinCode });
    s.axeman.drop();
    expect(last()).toMatchObject({
      kind: 'session.presence',
      actor: 'relay',
      actorName: 'Relay',
      summary: 'Axeman 11 lost – Pontiac 21 in command',
    });
  });

  it('the entry has the seq of the message it records and the relay time', () => {
    const axeman = jtac('Axeman');
    clock.advance(5000);
    axeman.send('jtac.onStation', { callsign: 'Axeman 11', freqs: [] });
    expect(log()[0]).toMatchObject({
      seq: axeman.last('ao.created')?.seq,
      rts: clock.now,
      mtime: null,
    });
  });
});

describe('check-in, situation, holds, fuel (§12.2)', () => {
  it('a check-in carries the brief; an update with new codes logs the change', () => {
    const s = scene();
    expect(log().find((e) => e.kind === 'cas.checkIn')).toMatchObject({
      area: 'checkIn',
      actor: s.lead.pid,
      flightId: s.flightId,
      aoId: s.aoId,
      summary:
        'Enfield 1-1: Enfield 1 checked in to AO AXEMAN 11, primary Axeman 11 – 2× F/A-18C · 4× GBU-12, 2× AIM-9X · 40 min · codes 1688 · abort LOBSTER',
    });
    checkIn(
      s.lead,
      { scope: 'ao', id: s.aoId },
      brief('Enfield 1', { flight: 1688, perAircraft: { [s.wing.pid]: 1511 } }),
    );
    expect(log().slice(-2)).toMatchObject([
      { area: 'checkIn', summary: expect.stringContaining('check-in updated') as unknown },
      {
        area: 'situation',
        summary: 'Enfield 1-1: laser codes of Enfield 1: 1688 → 1688 (aircraft 1511)',
      },
    ]);
  });

  it('check-out, release and a flight ending each say why', () => {
    const s = scene();
    s.lead.send('cas.checkOut', {});
    expect(last()).toMatchObject({
      kind: 'cas.checkOut',
      summary: 'Enfield 1-1: Enfield 1 checked out (AO AXEMAN 11)',
    });
    checkIn(s.lead, { scope: 'ao', id: s.aoId }, brief('Enfield 1'));
    s.axeman.send('cas.release', { flightId: s.flightId });
    expect(last()).toMatchObject({
      kind: 'cas.release',
      actor: s.axeman.pid,
      summary: 'Axeman 11: Enfield 1 released – cleared off station (AO AXEMAN 11)',
    });
    checkIn(s.lead, { scope: 'ao', id: s.aoId }, brief('Enfield 1'));
    s.wing.send('flight.leave', {});
    s.lead.send('flight.leave', {});
    expect(last()).toMatchObject({
      kind: 'cas.checkedOut',
      summary: 'Enfield 1-1: Enfield 1 checked out – the flight ended (AO AXEMAN 11)',
    });
  });

  it('situation update and COPY, holds from assign to WILCO and cancel', () => {
    const s = scene();
    s.axeman.raw(
      JSON.stringify({
        v: 1,
        id: '01JABD2K7Q0M3N4P5R6S7T0001',
        type: 'cas.sitUpdate',
        from: s.axeman.pid,
        session: 'blue',
        to: { scope: 'flight', id: s.flightId },
        ts: clock.now,
        ack: false,
        re: null,
        body: {
          aoId: s.aoId,
          update: {
            threats: { text: 'SA-8 north', cmIds: [] },
            targets: { text: '', cmIds: [] },
            friendlies: { text: 'South 2 km', cmIds: [] },
            fires: '',
            clearanceAuthority: '',
            restrictions: '',
            hazards: '',
          },
        },
      }),
    );
    expect(last()).toMatchObject({
      area: 'situation',
      kind: 'cas.sitUpdate',
      flightId: s.flightId,
      summary:
        'Axeman 11: situation update to Enfield 1 – threats: SA-8 north; friendlies: South 2 km',
    });
    s.lead.raw(
      JSON.stringify({
        v: 1,
        id: '01JABD2K7Q0M3N4P5R6S7T0002',
        type: 'cas.sitCopy',
        from: s.lead.pid,
        session: 'blue',
        to: { scope: 'pid', id: s.axeman.pid },
        ts: clock.now,
        ack: false,
        re: '01JABD2K7Q0M3N4P5R6S7T0001',
        body: {},
      }),
    );
    expect(last()).toMatchObject({ kind: 'cas.sitCopy', pid: s.lead.pid });

    const hold: Body<'cas.hold.assign'> = {
      flightId: s.flightId,
      point: { lat: 42.5, lon: 41.5 },
      floor: { m: 4572, ref: 'msl' },
      ceiling: { m: 5182, ref: 'msl' },
      turns: 'left',
      shape: 'orbit',
      radiusM: 5556,
      legM: null,
      inboundDeg: null,
      from: 51_000,
      until: null,
      visibility: 'ao',
    };
    s.axeman.send('cas.hold.assign', hold);
    expect(last()).toMatchObject({
      area: 'situation',
      kind: 'cas.hold.assign',
      summary:
        'Axeman 11: hold assigned: Enfield 1 at N42°30.00′ E041°30.00′, 15000 ft MSL – 17000 ft MSL, orbit 3 NM left turns, 14:10:00 L – open',
    });
    const holdId = s.axeman.last('cas.hold.updated')?.body.holdId ?? '';
    s.lead.send('cas.hold.wilco', { holdId });
    expect(last()).toMatchObject({ kind: 'cas.hold.wilco', summary: 'Enfield 1-1: WILCO hold' });
    s.axeman.send('cas.hold.update', { holdId, hold: { ...hold, turns: 'right' } });
    expect(last()?.summary).toContain('hold changed');
    s.axeman.send('cas.hold.cancel', { holdId });
    expect(last()?.summary).toBe('Axeman 11: hold cancelled for Enfield 1');
  });

  it('fuel calls of checked-in aircraft only, in the cockpit’s unit', () => {
    const s = scene();
    s.wing.send('fuel.call', { call: 'bingo', internalKg: 907.2 });
    expect(last()).toMatchObject({
      area: 'fuel',
      kind: 'fuel.call',
      pid: s.wing.pid,
      summary: 'Enfield 1-2: BINGO – 2000 lbs internal',
    });
    s.lead.send('cas.checkOut', {});
    const count = log().length;
    s.wing.send('fuel.call', { call: 'joker', internalKg: 1500 });
    expect(log()).toHaveLength(count);
  });
});

describe('mission entries (§12.2)', () => {
  function ready() {
    const s = scene();
    s.axeman.send('fm.create', { ...content(), aoId: s.aoId });
    const missionId = s.axeman.last('fm.updated')?.body.missionId ?? '';
    s.axeman.send('fm.assign', { missionId, assignee: { flightId: s.flightId, pids: null } });
    s.axeman.send('fm.brief', { missionId });
    s.axeman.send('fm.readbackCorrect', { missionId });
    return { ...s, missionId };
  }

  it('every step, with the mission, its flight and the lane’s aircraft', () => {
    const s = ready();
    s.axeman.send('fm.correlated', { missionId: s.missionId, pid: s.wing.pid });
    s.axeman.send(
      'fm.clear',
      { missionId: s.missionId, pid: s.wing.pid, kind: 'hot' },
      { mt: 51_000 },
    );
    expect(last()).toMatchObject({
      area: 'mission',
      kind: 'fm.clear',
      actor: s.axeman.pid,
      aoId: s.aoId,
      flightId: s.flightId,
      missionId: s.missionId,
      pid: s.wing.pid,
      mtime: 51_000,
      summary: 'Axeman 11: CLEARED HOT Enfield 1-2 (run 1)',
    });
    s.wing.send('fm.abort', {
      missionId: s.missionId,
      pid: s.wing.pid,
      channel: 'voice',
      reason: 'Winchester',
    });
    expect(last()?.summary).toBe('Enfield 1-2: ABORT Enfield 1-2 (run 1) on voice: Winchester');
    s.axeman.send('fm.voiceOnly', { missionId: s.missionId, on: true });
    s.axeman.send('fm.cancel', { missionId: s.missionId });
    s.axeman.send('fm.delete', { missionId: s.missionId });
    expect(kinds().slice(-3)).toEqual(['fm.voiceOnly', 'fm.cancel', 'fm.delete']);
  });

  it('mission time follows the anchor between messages (§1.4)', () => {
    const s = ready();
    s.axeman.send('fm.voiceOnly', { missionId: s.missionId, on: true }, { mt: 50_000 });
    clock.advance(90_000);
    s.axeman.send('fm.voiceOnly', { missionId: s.missionId, on: false });
    expect(last()?.mtime).toBe(50_090);
  });

  it('a change after the brief: revision, ACK per aircraft', () => {
    const s = ready();
    const changed = content();
    if (changed.nineLine) changed.nineLine.egress = 'West';
    s.axeman.send('fm.update', { ...changed, missionId: s.missionId });
    expect(last()?.summary).toBe('Axeman 11: revision 2: line 9 changed');
    s.wing.send('fm.ackChange', { missionId: s.missionId, rev: 2 });
    expect(last()).toMatchObject({
      kind: 'fm.ackChange',
      pid: s.wing.pid,
      summary: 'Enfield 1-2 acknowledged revision 2',
    });
  });

  it('a Type 3 window revoked is the JTAC’s, an expired one the relay’s', () => {
    const s = scene();
    s.axeman.send('fm.create', { ...content(3), aoId: s.aoId });
    const missionId = s.axeman.last('fm.updated')?.body.missionId ?? '';
    s.axeman.send('fm.assign', {
      missionId,
      assignee: { flightId: s.flightId, pids: [s.lead.pid] },
    });
    s.axeman.send('fm.brief', { missionId });
    s.axeman.send('fm.readbackCorrect', { missionId });
    s.axeman.send('fm.correlated', { missionId, pid: s.lead.pid });
    const window = (until: number) => ({
      pids: null,
      from: 50_000,
      until,
      area: null,
      targets: { text: '', cmIds: [] },
      restrictions: [],
    });
    s.axeman.send('fm.window', { missionId, window: window(50_600) }, { mt: 50_000 });
    expect(kinds().slice(-2)).toEqual(['fm.window', 'fm.windowOpened']);
    s.axeman.send('fm.windowRevoke', { missionId });
    expect(last()).toMatchObject({ kind: 'fm.windowRevoke', actor: s.axeman.pid, pid: s.lead.pid });
    s.axeman.send('fm.window', { missionId, window: window(50_060) }, { mt: 50_000 });
    clock.advance(61_000);
    for (const h of [s.axeman, s.lead, s.wing]) h.alive();
    relay.tick();
    expect(last()).toMatchObject({
      kind: 'fm.windowExpired',
      actor: 'relay',
      summary: 'Type 3 window over for Enfield 1-1',
    });
  });

  it('a pilot leaving takes his lane along; the relay’s abort has no channel', () => {
    const s = ready();
    s.axeman.send('fm.correlated', { missionId: s.missionId, pid: s.wing.pid });
    s.axeman.send('fm.clear', { missionId: s.missionId, pid: s.wing.pid, kind: 'hot' });
    s.wing.send('flight.leave', {});
    expect(
      log()
        .slice(-2)
        .map((e) => e.summary),
    ).toEqual([
      'Enfield 1-2: ABORT Enfield 1-2 (run 1): left the flight',
      'Enfield 1-2 left the mission',
    ]);
  });
});

describe('log.request (§12.3)', () => {
  it('a JTAC gets his AO, a pilot his flight – nobody anything else', () => {
    const s = scene();
    const other = jtac('Pontiac');
    other.send('jtac.onStation', { callsign: 'Pontiac 21', freqs: [] });
    const otherAo = other.last('ao.created')?.body.aoId ?? '';
    const mine = request(s.axeman, { scope: 'ao', id: s.aoId, from: null, to: null });
    if (typeof mine === 'string') throw new Error(mine);
    expect(mine.entries.length).toBeGreaterThan(0);
    expect(mine.entries.every((e) => e.aoId === s.aoId)).toBe(true);
    expect(request(s.axeman, { scope: 'ao', id: otherAo, from: null, to: null })).toBe('forbidden');
    expect(request(s.axeman, { scope: 'flight', id: s.flightId, from: null, to: null })).toBe(
      'forbidden',
    );
    expect(request(s.lead, { scope: 'ao', id: s.aoId, from: null, to: null })).toBe('forbidden');
    const flight = request(s.wing, { scope: 'flight', id: s.flightId, from: null, to: null });
    if (typeof flight === 'string') throw new Error(flight);
    expect(flight.entries.map((e) => e.kind)).toEqual(['cas.checkIn']);
    // Off-station, his AO is no longer his.
    s.axeman.send('jtac.offStation', { aoId: s.aoId });
    expect(request(s.axeman, { scope: 'ao', id: s.aoId, from: null, to: null })).toBe('forbidden');
  });

  it('a pilot never sees another aircraft’s lane or a JTAC warning', () => {
    const s = scene();
    s.axeman.send('fm.create', { ...content(), aoId: s.aoId });
    const missionId = s.axeman.last('fm.updated')?.body.missionId ?? '';
    s.axeman.send('fm.assign', { missionId, assignee: { flightId: s.flightId, pids: null } });
    s.axeman.send('fm.brief', { missionId });
    s.axeman.send('fm.readbackCorrect', { missionId });
    for (const p of [s.lead, s.wing]) {
      s.axeman.send('fm.correlated', { missionId, pid: p.pid });
      s.axeman.send('fm.clear', { missionId, pid: p.pid, kind: 'hot' });
    }
    // Both lase ownship on the flight's code: the JTACs get laser conflict warnings.
    expect(kinds()).toContain('fm.warning');
    const wing = request(s.wing, { scope: 'flight', id: s.flightId, from: null, to: null });
    if (typeof wing === 'string') throw new Error(wing);
    expect(wing.entries.filter((e) => e.kind === 'fm.clear').map((e) => e.pid)).toEqual([
      s.wing.pid,
    ]);
    expect(wing.entries.some((e) => e.kind === 'fm.warning')).toBe(false);
    expect(wing.entries.every((e) => e.pid === null || e.pid === s.wing.pid)).toBe(true);
  });

  it('a seq range, and pages of 500 that never end inside one seq', () => {
    const s = scene();
    // One more entry first, so the 500th entry is the first half of a pair.
    s.axeman.send('fm.create', { ...content(), aoId: s.aoId });
    for (let i = 0; i < 300; i += 1) {
      // Slow enough for the rate limit; everyone keeps answering pings.
      clock.advance(150);
      for (const h of [s.axeman, s.lead, s.wing]) h.alive();
      checkIn(
        s.lead,
        { scope: 'ao', id: s.aoId },
        brief('Enfield 1', { flight: 1111 + (i % 2) * 100, perAircraft: {} }),
      );
    }
    // Each update logs two entries under one seq: check-in and the code change.
    const all = log();
    expect(all.length).toBeGreaterThan(CAS_LOG_RULES.pageSize);
    const first = request(s.axeman, { scope: 'ao', id: s.aoId, from: null, to: null });
    if (typeof first === 'string') throw new Error(first);
    expect(all[CAS_LOG_RULES.pageSize - 1]?.seq).toBe(all[CAS_LOG_RULES.pageSize]?.seq);
    expect(first.entries).toHaveLength(CAS_LOG_RULES.pageSize - 1);
    expect(first.next).not.toBeNull();
    expect(first.entries.at(-1)?.seq).toBeLessThan(first.next ?? 0);
    const second = request(s.axeman, { scope: 'ao', id: s.aoId, from: first.next, to: null });
    if (typeof second === 'string') throw new Error(second);
    expect(second.next).toBeNull();
    expect([...first.entries, ...second.entries]).toEqual(all);
    // A range: from and to are inclusive.
    const a = all[10]?.seq ?? 0;
    const b = all[20]?.seq ?? 0;
    const range = request(s.axeman, { scope: 'ao', id: s.aoId, from: a, to: b });
    if (typeof range === 'string') throw new Error(range);
    expect(range.entries).toEqual(all.filter((e) => e.seq >= a && e.seq <= b));
  });

  it('every entry goes to the log file as it happens', () => {
    scene();
    expect(written.map((w) => w.entry)).toEqual(log());
    expect(written.every((w) => w.session === 'blue')).toBe(true);
  });
});
