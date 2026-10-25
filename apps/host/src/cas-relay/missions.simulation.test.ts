// SPDX-License-Identifier: GPL-3.0-or-later
// P2.3 done-when (roadmap): 8 pilots in two flights of 4 and 2 JTACs run
// Type 2 and Type 3 missions – aborts on app and voice by JTAC and pilot, a
// line 6 change while cleared, re-attack and replan, a command handover, a
// JTAC dropping out, a flight checking out (mission back to draft and
// reassigned), reconnects with resync. Through all of it no pilot ever
// receives another aircraft's lane or clearance.

import type { FireMission, Message } from '@slate-dcs/shared';
import { describe, expect, it } from 'vitest';

import { Clock, FakeHost, makeRelay } from './relay-harness.js';

type Body<T extends Message['type']> = Extract<Message, { type: T }>['body'];

describe('CAS simulation: 8 pilots, 2 JTACs (P2.3)', () => {
  it('runs the whole sequence and never shows a pilot someone else’s lane', () => {
    const clock = new Clock();
    const relay = makeRelay(clock);
    const hosts: FakeHost[] = [];
    let id = 1;

    const raw = <T extends Message['type']>(
      host: FakeHost,
      type: T,
      to: Message['to'],
      body: Body<T>,
      mt?: number,
    ) => {
      host.raw(
        JSON.stringify({
          v: 1,
          id: `01JABD2K7Q0M3N4P5R6S9T${String(id++).padStart(4, '0')}`,
          type,
          from: host.pid,
          session: 'blue',
          to,
          ts: clock.now,
          ack: true,
          re: null,
          ...(mt === undefined ? {} : { mt }),
          body,
        }),
      );
    };
    const join = (nick: string, jtac = false, type = 'FA-18C_hornet') => {
      const host = new FakeHost(relay);
      host.hello();
      host.join(
        nick,
        jtac
          ? { role: 'jtac', aircraft: { type: 'forward_observer', unit: nick } }
          : { aircraft: { type, unit: nick } },
      );
      hosts.push(host);
      return host;
    };
    const rejoin = (host: FakeHost, nick: string, jtac = false, type = 'FA-18C_hornet') => {
      host.reconnect();
      host.hello();
      host.join(
        nick,
        jtac
          ? { role: 'jtac', aircraft: { type: 'forward_observer', unit: nick } }
          : { aircraft: { type, unit: nick } },
      );
    };
    /** A minute passes; everyone answers pings. */
    const minute = () => {
      clock.advance(60_000);
      for (const host of hosts) if (!host.closed) host.alive();
      relay.tick();
    };
    const seen = (host: FakeHost, missionId: string): FireMission | undefined =>
      host
        .of('fm.updated')
        .filter((f) => f.body.missionId === missionId)
        .at(-1)?.body;
    const ok = (host: FakeHost) => {
      const error = host.last('error');
      if (error) throw new Error(`${host.pid}: ${error.body.code} ${error.body.text}`);
    };

    // --- 2 JTACs in one AO -------------------------------------------------
    const axeman = join('Axeman', true);
    axeman.status(42.2, 41.7);
    axeman.send('jtac.onStation', { callsign: 'Axeman 11', freqs: [{ mhz: 251, label: 'PRI' }] });
    const ao = axeman.last('ao.created')?.body;
    if (!ao?.joinCode) throw new Error('no AO');
    const pontiac = join('Pontiac', true);
    pontiac.status(42.21, 41.71);
    pontiac.send('jtac.onStation', { callsign: 'Pontiac 21', freqs: [], joinCode: ao.joinCode });

    // --- 8 pilots in two flights of 4 --------------------------------------
    const enfield = ['Enfield1', 'Enfield2', 'Enfield3', 'Enfield4'].map((n) => join(n));
    const colt = ['Colt1', 'Colt2', 'Colt3', 'Colt4'].map((n) => join(n, false, 'F-16C_50'));
    const pilots = [...enfield, ...colt];
    const [e1, e2, e3, e4] = enfield as [FakeHost, FakeHost, FakeHost, FakeHost];
    const [c1, c2] = colt as [FakeHost, FakeHost, FakeHost, FakeHost];
    e1.send('flight.create', { name: 'Enfield', open: true });
    const enfieldId = e1.last('flight.created')?.body.flightId ?? '';
    for (const p of enfield.slice(1)) p.send('flight.join', { flightId: enfieldId });
    c1.send('flight.create', { name: 'Colt', open: true });
    const coltId = c1.last('flight.created')?.body.flightId ?? '';
    for (const p of colt.slice(1)) p.send('flight.join', { flightId: coltId });

    const brief = (callsign: string, code: number): Body<'cas.checkIn'>['brief'] => ({
      callsign,
      aircraft: [{ pid: 'p_000001', type: 'FA-18C_hornet' }],
      position: null,
      ordnance: [{ name: 'GBU-12', count: 8 }],
      playtimeMin: 45,
      capabilities: ['tgp', 'laser'],
      abortCode: 'ROMEO',
      missionNumber: null,
      laserCodes: { flight: code, perAircraft: {} },
      remarks: '',
    });
    raw(e1, 'cas.checkIn', { scope: 'pid', id: axeman.pid }, { brief: brief('Enfield 1', 1688) });
    raw(c1, 'cas.checkIn', { scope: 'pid', id: pontiac.pid }, { brief: brief('Colt 1', 1511) });
    for (const p of pilots) p.status(42.1, 41.6);
    ok(e1);
    ok(c1);

    const content = (control: 1 | 2 | 3) => ({
      gamePlan: {
        control,
        method: 'BOT' as const,
        effects: 'Destroy',
        ordnance: 'GBU-12',
        interval: '',
      },
      nineLine: {
        ipBp: { lat: 42.3, lon: 41.6 },
        headingDeg: 95,
        offset: 'left' as const,
        distanceM: 11100,
        elevationM: 412,
        description: '2x BMP-2',
        location: { lat: 42.2203, lon: 41.7431 },
        locationText: '38T KM 12345 67890',
        mark: {
          type: 'laser' as const,
          code: null,
          source: { kind: 'ownship' as const },
          at: null,
          text: '',
        },
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
    });

    // --- Type 2 for Enfield (whole flight) --------------------------------
    axeman.send('fm.create', { ...content(2), aoId: ao.aoId });
    const m1 = seen(axeman, axeman.last('fm.updated')?.body.missionId ?? '')?.missionId ?? '';
    axeman.send('fm.assign', { missionId: m1, assignee: { flightId: enfieldId, pids: null } });
    axeman.send('fm.brief', { missionId: m1 });
    axeman.send('fm.readbackCorrect', { missionId: m1 });
    for (const p of [e1, e2]) {
      p.send('fm.spi', { missionId: m1, spi: { lat: 42.2201, lon: 41.7427, elevM: 410 } });
      axeman.send('fm.correlated', { missionId: m1, pid: p.pid });
      raw(
        axeman,
        'fm.clear',
        { scope: 'relay' },
        { missionId: m1, pid: p.pid, kind: 'hot' },
        51800,
      );
    }
    ok(axeman);
    expect(seen(e1, m1)?.lanes).toMatchObject([{ pid: e1.pid, state: 'cleared' }]);
    expect(seen(e3, m1)?.lanes).toMatchObject([{ pid: e3.pid, state: 'open' }]);
    // Pilot aborts his own attack in the app; the second JTAC aborts on voice.
    e2.send('fm.abort', { missionId: m1, pid: e2.pid, channel: 'app', reason: 'Lost the target' });
    pontiac.send('fm.abort', {
      missionId: m1,
      pid: e1.pid,
      channel: 'voice',
      reason: 'Friendlies close',
    });
    ok(e2);
    ok(pontiac);
    expect(
      seen(axeman, m1)
        ?.lanes.slice(0, 2)
        .map((l) => l.state),
    ).toEqual(['correlated', 'correlated']);
    // Cleared again, then line 6 changes while the lead is cleared.
    axeman.send('fm.clear', { missionId: m1, pid: e1.pid, kind: 'hot' });
    const moved = content(2);
    moved.nineLine.location = { lat: 42.225, lon: 41.75 };
    moved.nineLine.locationText = '38T KM 12500 68000';
    axeman.send('fm.update', { ...moved, missionId: m1 });
    expect(seen(e1, m1)).toMatchObject({
      state: 'briefed',
      lanes: [{ state: 'open', runs: [{}, { abort: { reason: 'rbChange' } }] }],
    });
    // New readback, attack, BDA, re-attack, replan, complete.
    axeman.send('fm.readbackCorrect', { missionId: m1 });
    axeman.send('fm.correlated', { missionId: m1, pid: e1.pid });
    axeman.send('fm.clear', { missionId: m1, pid: e1.pid, kind: 'hot' });
    axeman.send('fm.waitingBda', { missionId: m1, pid: e1.pid });
    axeman.send('fm.bda', {
      missionId: m1,
      pid: e1.pid,
      target: '2x BMP-2',
      effect: 'damaged',
      location: null,
      mtime: null,
      remarks: '',
    });
    e1.send('fm.ackBda', { missionId: m1 });
    axeman.send('fm.reattack', { missionId: m1, pid: e1.pid, to: 'attack' });
    axeman.send('fm.clear', { missionId: m1, pid: e1.pid, kind: 'dry' });
    axeman.send('fm.reattack', { missionId: m1, to: 'replan' });
    ok(axeman);
    expect(seen(e1, m1)?.state).toBe('assigned');

    // --- Command handover, then the given JTAC drops out ------------------
    axeman.send('fm.offerCommand', { missionId: m1, pid: pontiac.pid });
    pontiac.send('fm.acceptCommand', { missionId: m1 });
    pontiac.send('fm.brief', { missionId: m1 });
    ok(pontiac);
    pontiac.drop();
    expect(seen(axeman, m1)?.inCommand).toBe(axeman.pid);
    minute();
    rejoin(pontiac, 'Pontiac', true);
    expect(pontiac.last('session.state')?.body.you.openMissions.map((m) => m.missionId)).toContain(
      m1,
    );
    axeman.send('fm.readbackCorrect', { missionId: m1 });
    axeman.send('fm.complete', { missionId: m1 });
    ok(axeman);

    // --- Type 3 for Colt 1-1 and 1-2, then Colt checks out ----------------
    pontiac.send('fm.create', { ...content(3), aoId: ao.aoId });
    const m2 = pontiac.last('fm.updated')?.body.missionId ?? '';
    pontiac.send('fm.assign', {
      missionId: m2,
      assignee: { flightId: coltId, pids: [c1.pid, c2.pid] },
    });
    pontiac.send('fm.brief', { missionId: m2 });
    pontiac.send('fm.readbackCorrect', { missionId: m2 });
    for (const p of [c1, c2]) pontiac.send('fm.correlated', { missionId: m2, pid: p.pid });
    raw(
      pontiac,
      'fm.window',
      { scope: 'relay' },
      {
        missionId: m2,
        window: {
          pids: null,
          from: 52000,
          until: 52120,
          area: null,
          targets: { text: 'Armour', cmIds: [] },
          restrictions: [],
        },
      },
      52000,
    );
    ok(pontiac);
    expect(seen(c2, m2)).toMatchObject({
      window: { pids: [c2.pid] },
      lanes: [{ state: 'cleared' }],
    });
    minute();
    minute();
    expect(seen(c1, m2)).toMatchObject({ window: null, lanes: [{ state: 'correlated' }] });
    c1.send('cas.checkOut', {});
    expect(seen(pontiac, m2)).toMatchObject({ state: 'draft', lanes: [] });
    expect(c2.last('fm.deleted')?.body).toEqual({ missionId: m2, hidden: true });
    pontiac.send('fm.assign', {
      missionId: m2,
      assignee: { flightId: enfieldId, pids: [e3.pid, e4.pid] },
    });
    ok(pontiac);

    // --- A pilot reconnects with his last seq: replay, his lane only ------
    e4.drop();
    pontiac.send('fm.brief', { missionId: m2 });
    pontiac.send('fm.readbackCorrect', { missionId: m2 });
    rejoin(e4, 'Enfield4');
    expect(seen(e4, m2)).toMatchObject({ state: 'readbackCorrect', lanes: [{ pid: e4.pid }] });

    // --- The invariant, over every frame every pilot got -------------------
    let checked = 0;
    for (const p of pilots) {
      for (const frame of p.frames) {
        const missions =
          frame.type === 'fm.updated'
            ? [frame.body]
            : frame.type === 'session.state'
              ? frame.body.you.openMissions
              : [];
        for (const m of missions) {
          checked += 1;
          expect(m.lanes.every((lane) => lane.pid === p.pid)).toBe(true);
          expect(m.window === null || m.window.pids.every((pid) => pid === p.pid)).toBe(true);
          expect(m.lanes.every((lane) => lane.warnings.length === 0)).toBe(true);
          expect(m.changes.every((c) => c.ackedBy.every((pid) => pid === p.pid))).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    // Colt 3 and 4: in the assigned flight, so they saw M2 – but never a lane (§10.1).
    for (const p of colt.slice(2)) {
      expect(p.of('fm.updated').length).toBeGreaterThan(0);
      expect(
        p.of('fm.updated').every((f) => f.body.missionId === m2 && f.body.lanes.length === 0),
      ).toBe(true);
    }
  });
});
