// SPDX-License-Identifier: GPL-3.0-or-later
// Check-in, situation update, holds, fuel calls and confirmations
// (protocol.md §1.2, §6.4, §6.5, §9): P2.2.

import type { Message } from '@slate-dcs/shared';
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

function pilot(nick: string): FakeHost {
  const host = new FakeHost(relay);
  host.hello();
  host.join(nick);
  return host;
}

function jtac(nick: string, lat = 42.2, lon = 41.7): FakeHost {
  const host = new FakeHost(relay);
  host.hello();
  host.join(nick, { role: 'jtac', aircraft: { type: 'forward_observer', unit: nick } });
  host.status(lat, lon);
  return host;
}

function aoOf(host: FakeHost) {
  const frames = host.frames.filter(
    (f): f is Extract<Message, { type: 'ao.created' | 'ao.updated' }> =>
      f.type === 'ao.created' || f.type === 'ao.updated',
  );
  const ao = frames.at(-1)?.body;
  if (!ao) throw new Error('no AO');
  return ao;
}

function brief(): Body<'cas.checkIn'>['brief'] {
  return {
    callsign: 'Enfield 1',
    aircraft: [{ pid: 'p_000001', type: 'FA-18C_hornet' }],
    position: { lat: 42.17, lon: 41.68, altMsl: 4572 },
    ordnance: [{ name: 'GBU-12', count: 4 }],
    playtimeMin: 40,
    capabilities: ['tgp', 'laser'],
    abortCode: 'ROMEO',
    missionNumber: null,
    laserCodes: { flight: 1688, perAircraft: {} },
    remarks: '',
  };
}

let nextId = 1;

/** Sends with a chosen `to` – the harness's `send` always addresses the relay. */
function sendTo<T extends Message['type']>(
  host: FakeHost,
  type: T,
  to: Message['to'],
  body: Body<T>,
  extra: { ack?: boolean; re?: string | null } = {},
): string {
  const id = `01JABD2K7Q0M3N4P5R6S7T${String(nextId++).padStart(4, '0')}`;
  host.raw(
    JSON.stringify({
      v: 1,
      id,
      type,
      from: host.pid,
      session: 'blue',
      to,
      ts: clock.now,
      ack: extra.ack ?? false,
      re: extra.re ?? null,
      body,
    }),
  );
  return id;
}

/**
 * Axeman and Pontiac on-station in one AO, a second AO with Hammer, and the
 * flight Enfield 1 (Vis7 -1, Wing -2), not checked in yet.
 */
function scene() {
  const axeman = jtac('Axeman');
  axeman.send('jtac.onStation', { callsign: 'Axeman 11', freqs: [] });
  const ao = aoOf(axeman);
  const pontiac = jtac('Pontiac');
  pontiac.send('jtac.onStation', {
    callsign: 'Pontiac 21',
    freqs: [],
    joinCode: ao.joinCode ?? '',
  });
  const hammer = jtac('Hammer', 43.0, 42.5);
  hammer.send('jtac.onStation', { callsign: 'Hammer 31', freqs: [] });
  const ao2 = aoOf(hammer);
  const lead = pilot('Vis7');
  lead.send('flight.create', { name: 'Enfield', open: true });
  const flightId = lead.last('flight.created')?.body.flightId ?? '';
  const wing = pilot('Wing');
  wing.send('flight.join', { flightId });
  const other = pilot('Other');
  return {
    axeman,
    pontiac,
    hammer,
    lead,
    wing,
    other,
    aoId: ao.aoId,
    joinCode: ao.joinCode ?? '',
    ao2Id: ao2.aoId,
    flightId,
  };
}

function checkIn(host: FakeHost, to: Message['to'], ack = false): string {
  return sendTo(host, 'cas.checkIn', to, { brief: brief() }, { ack });
}

function holdDraft(
  flightId: string,
  extra: Partial<Body<'cas.hold.assign'>> = {},
): Body<'cas.hold.assign'> {
  return {
    flightId,
    point: { lat: 42.25, lon: 41.75 },
    floor: { m: 4572, ref: 'msl' },
    ceiling: { m: 5181, ref: 'msl' },
    turns: 'left',
    shape: 'orbit',
    radiusM: 3704,
    legM: null,
    inboundDeg: null,
    from: 50400,
    until: null,
    visibility: 'ao',
    ...extra,
  };
}

describe('check-in (§9.2)', () => {
  it('lands in the JTAC’s AO with him as primary; both JTACs and the flight hear it', () => {
    const { axeman, pontiac, lead, wing, other, aoId, flightId } = scene();
    const id = checkIn(lead, { scope: 'pid', id: pontiac.pid });
    for (const host of [axeman, pontiac, lead, wing]) {
      expect(host.last('cas.checkedIn')?.body).toMatchObject({
        flightId,
        aoId,
        primary: pontiac.pid,
        brief: { callsign: 'Enfield 1', playtimeMin: 40 },
      });
    }
    expect(lead.last('cas.checkedIn')?.re).toBe(id);
    expect(other.of('cas.checkedIn')).toEqual([]);
  });

  it('sent to the AO, it has no primary JTAC', () => {
    const { axeman, lead, aoId } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    expect(axeman.last('cas.checkedIn')?.body.primary).toBeNull();
  });

  it('only the member in command checks in, never a JTAC or a pilot without a flight', () => {
    const { axeman, wing, other, aoId } = scene();
    for (const host of [wing, other, axeman]) {
      checkIn(host, { scope: 'ao', id: aoId });
      expect(host.last('error')?.body.code).toBe('forbidden');
    }
  });

  it('refuses a target that isn’t a JTAC on-station or an AO', () => {
    const { lead, other } = scene();
    checkIn(lead, { scope: 'pid', id: other.pid });
    expect(lead.last('error')?.body.code).toBe('badCode');
    checkIn(lead, { scope: 'session' });
    expect(lead.last('error')?.body.code).toBe('badMessage');
  });

  it('a check-in to another AO checks the flight out of the old one, and its JTACs are told', () => {
    const { axeman, hammer, lead, aoId, ao2Id } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    checkIn(lead, { scope: 'pid', id: hammer.pid });
    expect(axeman.last('cas.checkedOut')?.body).toMatchObject({ aoId, by: 'flight' });
    expect(hammer.last('cas.checkedIn')?.body).toMatchObject({ aoId: ao2Id, primary: hammer.pid });
  });

  it('to another JTAC of the same AO only the primary changes', () => {
    const { axeman, pontiac, lead } = scene();
    checkIn(lead, { scope: 'pid', id: axeman.pid });
    const first = axeman.last('cas.checkedIn')?.body.checkInId;
    checkIn(lead, { scope: 'pid', id: pontiac.pid });
    expect(axeman.of('cas.checkedOut')).toEqual([]);
    expect(axeman.last('cas.checkedIn')?.body).toMatchObject({
      checkInId: first,
      primary: pontiac.pid,
    });
  });

  it('check-out, release and the reasons', () => {
    const { axeman, lead, wing, aoId, flightId } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    wing.send('cas.checkOut', {});
    expect(wing.last('error')?.body.code).toBe('forbidden');
    lead.send('cas.checkOut', {});
    expect(axeman.last('cas.checkedOut')?.body.by).toBe('flight');
    checkIn(lead, { scope: 'ao', id: aoId });
    axeman.send('cas.release', { flightId });
    expect(lead.last('cas.checkedOut')?.body.by).toBe('jtac');
  });

  it('the AO closing checks its flights out', () => {
    const { axeman, pontiac, lead, aoId } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    axeman.send('jtac.offStation', { aoId });
    pontiac.send('jtac.offStation', { aoId });
    expect(lead.last('cas.checkedOut')?.body.by).toBe('aoClosed');
  });

  it('the primary JTAC going off-station leaves the flight checked in to the AO', () => {
    const { axeman, pontiac, lead, aoId } = scene();
    checkIn(lead, { scope: 'pid', id: pontiac.pid });
    pontiac.send('jtac.offStation', { aoId });
    expect(lead.last('cas.checkedIn')?.body).toMatchObject({ aoId, primary: null });
    expect(lead.of('cas.checkedOut')).toEqual([]);
    expect(axeman.last('cas.checkedIn')?.body.primary).toBeNull();
  });

  it('the flight stays checked in when a member leaves, and is checked out when it closes', () => {
    const { axeman, lead, wing, aoId } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    wing.send('flight.leave', {});
    expect(axeman.of('cas.checkedOut')).toEqual([]);
    lead.send('flight.leave', {});
    expect(axeman.last('cas.checkedOut')?.body.by).toBe('flightClosed');
  });

  it('a pilot joining a checked-in flight gets the check-in and the AO-only entries', () => {
    const { axeman, lead, aoId, flightId } = scene();
    axeman.send('cm.create', {
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
      aoId,
      visibility: 'ao',
    });
    checkIn(lead, { scope: 'ao', id: aoId });
    expect(lead.last('cas.checkedIn')?.body.aoEntries.entries).toMatchObject([
      { label: 'IP SIERRA' },
    ]);
    expect(axeman.last('cas.checkedIn')?.body.aoEntries).toEqual({ entries: [], holds: [] });
    const late = pilot('Late');
    late.send('flight.join', { flightId });
    expect(late.last('cas.checkedIn')?.body.aoEntries.entries).toHaveLength(1);
  });
});

describe('who sees what (§6.4)', () => {
  it('JTACs get the full status of checked-in aircraft only; after check-out positions again', () => {
    const { axeman, pontiac, hammer, lead, aoId } = scene();
    lead.status(42.1, 41.6);
    expect(axeman.of('status.update')).toEqual([]);
    expect(axeman.last('status.position')?.body.pid).toBe(lead.pid);
    checkIn(lead, { scope: 'ao', id: aoId });
    axeman.clear();
    pontiac.clear();
    hammer.clear();
    lead.status(42.1, 41.6, { fuel: { internalKg: 2900, externalKg: 0, source: 'export' } });
    for (const host of [axeman, pontiac]) {
      expect(host.last('status.update')?.body.fuel?.internalKg).toBe(2900);
      expect(host.of('status.position')).toEqual([]);
    }
    expect(hammer.of('status.update')).toEqual([]);
    expect(hammer.last('status.position')).toBeDefined();
    lead.send('cas.checkOut', {});
    axeman.clear();
    lead.status(42.1, 41.6);
    expect(axeman.of('status.update')).toEqual([]);
    expect(axeman.last('status.position')).toBeDefined();
  });

  it('a JTAC who rejoins gets the check-ins and the last full status of the checked-in aircraft', () => {
    const { axeman, lead, wing, aoId } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    lead.status(42.1, 41.6);
    wing.status(42.11, 41.61);
    axeman.clear();
    axeman.reconnect();
    axeman.hello();
    axeman.join('Axeman', { role: 'jtac', aircraft: { type: 'forward_observer', unit: 'Axeman' } });
    expect(axeman.last('session.state')?.body.checkIns).toMatchObject([{ aoId }]);
    const fullFrom = axeman
      .of('status.update')
      .map((f) => f.from)
      .sort();
    expect(fullFrom).toEqual([lead.pid, wing.pid].sort());
  });

  it('a pilot’s snapshot carries his flight’s check-in', () => {
    const { lead, wing, aoId } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    wing.reconnect();
    wing.hello();
    wing.join('Wing');
    expect(wing.last('session.state')?.body.you.checkIn).toMatchObject({ aoId });
  });
});

describe('situation update, COPY and fuel calls (§6.5, §9.3)', () => {
  it('to one flight: the flight and the AO’s JTACs; COPY goes back to the JTACs', () => {
    const { axeman, pontiac, lead, wing, other, aoId, flightId } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    const update = {
      threats: { text: 'SA-8 north', cmIds: [] },
      targets: { text: 'BMP-2', cmIds: [] },
      friendlies: { text: 'South 800 m', cmIds: [] },
      fires: '',
      clearanceAuthority: 'Axeman 11',
      restrictions: '',
      hazards: '',
    };
    const id = sendTo(axeman, 'cas.sitUpdate', { scope: 'flight', id: flightId }, { aoId, update });
    for (const host of [lead, wing, pontiac]) expect(host.last('cas.sitUpdate')?.id).toBe(id);
    expect(other.of('cas.sitUpdate')).toEqual([]);
    sendTo(wing, 'cas.sitCopy', { scope: 'ao', id: aoId }, {}, { re: id });
    expect(axeman.last('cas.sitCopy')).toMatchObject({ from: wing.pid, re: id });
  });

  it('to the AO: every checked-in flight; not to a flight elsewhere', () => {
    const { axeman, hammer, lead, other, aoId } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    const update = {
      threats: { text: '', cmIds: [] },
      targets: { text: '', cmIds: [] },
      friendlies: { text: '', cmIds: [] },
      fires: '',
      clearanceAuthority: '',
      restrictions: '',
      hazards: '',
    };
    sendTo(axeman, 'cas.sitUpdate', { scope: 'ao', id: aoId }, { aoId, update });
    expect(lead.last('cas.sitUpdate')).toBeDefined();
    expect(hammer.of('cas.sitUpdate')).toEqual([]);
    expect(other.of('cas.sitUpdate')).toEqual([]);
    sendTo(hammer, 'cas.sitUpdate', { scope: 'ao', id: aoId }, { aoId, update });
    expect(hammer.last('error')?.body.code).toBe('forbidden');
  });

  it('a JOKER call reaches the flight and the AO’s JTACs, never the sender back', () => {
    const { axeman, lead, wing, other, aoId } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    wing.send('fuel.call', { call: 'joker', internalKg: 1810 }, { ack: true });
    for (const host of [lead, axeman]) {
      expect(host.last('fuel.call')).toMatchObject({ from: wing.pid, body: { call: 'joker' } });
    }
    expect(wing.of('fuel.call')).toEqual([]);
    expect(other.of('fuel.call')).toEqual([]);
    expect(wing.last('relay.receipt')).toBeDefined();
  });
});

describe('holds (§9.4)', () => {
  it('a JTAC holds a checked-in flight; overlapping holds are flagged on both, not blocked', () => {
    const { axeman, pontiac, lead, aoId, flightId } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    const other = pilot('Colt');
    other.send('flight.create', { name: 'Colt', open: true });
    const colt = other.last('flight.created')?.body.flightId ?? '';
    checkIn(other, { scope: 'ao', id: aoId });
    axeman.send('cas.hold.assign', holdDraft(flightId));
    const first = axeman.last('cas.hold.updated')?.body;
    expect(first).toMatchObject({ flightId, aoId, conflicts: [] });
    pontiac.send('cas.hold.assign', holdDraft(colt));
    const second = pontiac.last('cas.hold.updated')?.body;
    expect(second?.conflicts).toEqual([first?.holdId]);
    // The first hold is sent again with its new conflict.
    const firstNow = () =>
      lead
        .of('cas.hold.updated')
        .filter((f) => f.body.holdId === first?.holdId)
        .at(-1)?.body;
    expect(firstNow()?.conflicts).toEqual([second?.holdId]);
    // Stacked above: no conflict any more.
    pontiac.send('cas.hold.update', {
      holdId: second?.holdId ?? '',
      hold: holdDraft(colt, { floor: { m: 5181, ref: 'msl' }, ceiling: { m: 5800, ref: 'msl' } }),
    });
    expect(pontiac.last('cas.hold.updated')?.body.conflicts).toEqual([]);
    expect(firstNow()?.conflicts).toEqual([]);
  });

  it('AO-only holds reach the AO’s audience only; WILCO goes to the JTACs', () => {
    const { axeman, pontiac, lead, wing, other, aoId, flightId } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    axeman.send('cas.hold.assign', holdDraft(flightId));
    const holdId = axeman.last('cas.hold.updated')?.body.holdId ?? '';
    expect(wing.last('cas.hold.updated')?.body.holdId).toBe(holdId);
    expect(other.of('cas.hold.updated')).toEqual([]);
    wing.send('cas.hold.wilco', { holdId });
    expect(pontiac.last('cas.hold.wilco')).toMatchObject({ from: wing.pid, body: { holdId } });
    other.send('cas.hold.wilco', { holdId });
    expect(other.last('error')?.body.code).toBe('forbidden');
  });

  it('a hold needs a checked-in flight of the AO and a point that exists', () => {
    const { axeman, hammer, lead, aoId, flightId } = scene();
    axeman.send('cas.hold.assign', holdDraft(flightId));
    expect(axeman.last('error')?.body.code).toBe('badCode');
    checkIn(lead, { scope: 'ao', id: aoId });
    hammer.send('cas.hold.assign', holdDraft(flightId));
    expect(hammer.last('error')?.body.code).toBe('badCode');
    axeman.send('cas.hold.assign', holdDraft(flightId, { point: { cmId: 'c_nope' } }));
    expect(axeman.last('error')?.body.code).toBe('badCode');
    lead.send('cas.hold.assign', holdDraft(flightId));
    expect(lead.last('error')?.body.code).toBe('forbidden');
  });

  it('on a keyhole point: the keyhole can’t be deleted while the hold uses it', () => {
    const { axeman, lead, aoId, flightId } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    axeman.send('cm.create', {
      kind: 'keyhole',
      shape: 'point',
      geom: { lat: 42.22, lon: 41.74 },
      label: 'HAMMER',
      text: null,
      ringM: null,
      count: null,
      moving: null,
      observedMtime: null,
      block: null,
      aoId,
      visibility: 'ao',
    });
    const cmId = axeman.last('cm.created')?.body.cmId ?? '';
    axeman.send(
      'cas.hold.assign',
      holdDraft(flightId, { point: { cmId, axis: 'A', distanceNm: 8 } }),
    );
    const holdId = axeman.last('cas.hold.updated')?.body.holdId ?? '';
    axeman.send('cm.delete', { cmId });
    expect(axeman.last('error')?.body.code).toBe('inUse');
    axeman.send('cas.hold.cancel', { holdId });
    expect(lead.last('cas.hold.cancelled')?.body).toEqual({ holdId, hidden: false });
    axeman.send('cm.delete', { cmId });
    expect(axeman.last('cm.deleted')?.body.cmId).toBe(cmId);
  });

  it('checking out takes the flight’s holds along', () => {
    const { axeman, lead, aoId, flightId } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    axeman.send('cas.hold.assign', holdDraft(flightId));
    const holdId = axeman.last('cas.hold.updated')?.body.holdId ?? '';
    lead.send('cas.checkOut', {});
    expect(axeman.last('cas.hold.cancelled')?.body).toEqual({ holdId, hidden: false });
    expect(lead.last('cas.hold.cancelled')?.body.holdId).toBe(holdId);
  });

  it('a JTAC joining the AO gets its holds', () => {
    const { axeman, lead, aoId, joinCode, flightId } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    axeman.send('cas.hold.assign', holdDraft(flightId));
    const late = jtac('Late');
    late.send('jtac.onStation', {
      callsign: 'Late 41',
      freqs: [],
      joinCode,
    });
    expect(late.last('cas.hold.updated')?.body.flightId).toBe(flightId);
  });
});

describe('confirmations (§1.2)', () => {
  it('level 1 and 2 for a check-in: receipt, then the JTAC’s app got the relay’s cas.checkedIn', () => {
    const { axeman, lead, aoId } = scene();
    const id = checkIn(lead, { scope: 'ao', id: aoId }, true);
    expect(lead.last('relay.receipt')?.re).toBe(id);
    const frame = axeman.last('cas.checkedIn');
    expect(frame?.ack).toBe(true);
    sendTo(axeman, 'msg.received', { scope: 'relay' }, {}, { re: frame?.id ?? null });
    expect(lead.last('msg.received')).toMatchObject({ from: axeman.pid, re: id });
  });

  it('level 2 for a forwarded message names the original', () => {
    const { axeman, lead, wing, aoId } = scene();
    checkIn(lead, { scope: 'ao', id: aoId });
    const id = wing.send('fuel.call', { call: 'bingo', internalKg: 907 }, { ack: true });
    sendTo(axeman, 'msg.received', { scope: 'relay' }, {}, { re: id });
    sendTo(lead, 'msg.received', { scope: 'relay' }, {}, { re: id });
    expect(
      wing
        .of('msg.received')
        .map((f) => f.from)
        .sort(),
    ).toEqual([axeman.pid, lead.pid].sort());
  });

  it('no receipt for a refused message, no confirmations without ack', () => {
    const { lead, wing, aoId } = scene();
    sendTo(wing, 'cas.checkIn', { scope: 'ao', id: aoId }, { brief: brief() }, { ack: true });
    expect(wing.of('relay.receipt')).toEqual([]);
    checkIn(lead, { scope: 'ao', id: aoId }, false);
    expect(lead.of('relay.receipt')).toEqual([]);
    expect(wing.last('cas.checkedIn')?.ack).toBe(false);
  });
});
