// SPDX-License-Identifier: GPL-3.0-or-later
// Flights in the relay (protocol.md §7), incl. -1 leaving or dropping out (§7.4).

import type { Flight, Message } from '@slate-dcs/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { Clock, CODES, FakeHost, makeRelay } from './relay-harness.js';
import type { Relay } from './relay.js';

let clock: Clock;
let relay: Relay;

beforeEach(() => {
  clock = new Clock();
  relay = makeRelay(clock);
});

function joined(nick: string, options: Parameters<FakeHost['join']>[1] = {}): FakeHost {
  const host = new FakeHost(relay);
  host.hello();
  host.join(nick, options);
  return host;
}

/** The latest flight object a host got (created or updated). */
function flightOf(host: FakeHost): Flight | undefined {
  const last = host.frames.findLast(
    (f): f is Extract<Message, { type: 'flight.created' | 'flight.updated' }> =>
      f.type === 'flight.created' || f.type === 'flight.updated',
  );
  return last?.body;
}

const positions = (flight: Flight | undefined) =>
  flight?.members.map((m) => [m.pid, m.pos, m.presence]);

/** A lead with an open flight and `count` wingmen joined in order. */
function openFlight(count: number, name = 'Enfield'): [FakeHost, FakeHost, FakeHost, FakeHost] {
  const lead = joined('Lead');
  lead.send('flight.create', { name, open: true });
  const flightId = flightOf(lead)?.flightId ?? '';
  const hosts = [lead];
  for (let i = 2; i <= count + 1; i += 1) {
    const wing = joined(`Wing${String(i)}`);
    wing.send('flight.join', { flightId });
    hosts.push(wing);
  }
  // Tests only use as many hosts as they asked for.
  return hosts as [FakeHost, FakeHost, FakeHost, FakeHost];
}

function reconnect(host: FakeHost, nick: string, options: Parameters<FakeHost['join']>[1] = {}) {
  host.reconnect();
  host.hello();
  host.join(nick, options);
}

describe('creating (§7.2)', () => {
  it('makes the creator -1 in command and lists an open flight for the session', () => {
    const other = joined('Other');
    const lead = joined('Lead');
    const id = lead.send('flight.create', { name: '  Enfield ', open: true });
    const created = lead.last('flight.created');
    expect(created?.re).toBe(id);
    expect(created?.body).toMatchObject({
      name: 'Enfield',
      number: 1,
      display: 'Enfield 1',
      open: true,
      members: [{ pid: lead.pid, pos: 1, presence: 'online', aircraft: { type: 'FA-18C_hornet' } }],
      inCommand: lead.pid,
      moveUp: null,
      privateCode: null,
    });
    expect(other.last('flight.listed')?.body).toEqual({
      flightId: created?.body.flightId,
      display: 'Enfield 1',
      memberCount: 1,
      types: ['FA-18C_hornet'],
    });
  });

  it('numbers by name, ignoring case and spaces, with the first free number', () => {
    const names = ['Enfield', 'enfield', 'Pontiac', 'ENFIELD'];
    const leads = names.map((name, i) => {
      const host = joined(`L${String(i)}`);
      host.send('flight.create', { name, open: true });
      return host;
    });
    expect(leads.map((h) => flightOf(h)?.display)).toEqual([
      'Enfield 1',
      'enfield 2',
      'Pontiac 1',
      'ENFIELD 3',
    ]);
    leads[1]?.send('flight.leave', {});
    const next = joined('Next');
    next.send('flight.create', { name: 'Enfield', open: true });
    expect(flightOf(next)?.number).toBe(2);
  });

  it('keeps a private flight out of the list and shows its code to the creator only', () => {
    const other = joined('Other');
    const lead = joined('Lead');
    lead.send('flight.create', { name: 'Ghost', open: false });
    expect(flightOf(lead)?.privateCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/);
    expect(other.of('flight.listed')).toEqual([]);
  });

  it('refuses a second flight and any flight for a JTAC', () => {
    const lead = joined('Lead');
    lead.send('flight.create', { name: 'Enfield', open: true });
    lead.send('flight.create', { name: 'Pontiac', open: true });
    expect(lead.last('error')?.body.code).toBe('alreadyInFlight');
    const jtac = joined('JTAC', { role: 'jtac' });
    jtac.send('flight.create', { name: 'Axeman', open: true });
    expect(jtac.last('error')?.body.code).toBe('forbidden');
  });
});

describe('joining', () => {
  it('gives the first free position, never -1, and tells every member', () => {
    const [lead, two, three] = openFlight(2);
    expect(positions(flightOf(three))).toEqual([
      [lead.pid, 1, 'online'],
      [two.pid, 2, 'online'],
      [three.pid, 3, 'online'],
    ]);
    expect(positions(flightOf(lead))).toEqual(positions(flightOf(three)));
    expect(lead.last('flight.listed')?.body.memberCount).toBe(3);
  });

  it('joins a private flight by code only; the code stays with the member in command', () => {
    const lead = joined('Lead');
    lead.send('flight.create', { name: 'Ghost', open: false });
    const flight = flightOf(lead);
    const byId = joined('ById');
    byId.send('flight.join', { flightId: flight?.flightId ?? '' });
    expect(byId.last('error')?.body.code).toBe('badCode');
    const byCode = joined('ByCode');
    byCode.send('flight.join', { privateCode: flight?.privateCode ?? '' });
    expect(flightOf(byCode)?.members).toHaveLength(2);
    expect(flightOf(byCode)?.privateCode).toBeNull();
    expect(flightOf(lead)?.privateCode).toBe(flight?.privateCode);
  });

  it('refuses a full flight, an unknown flight and a flight of the other coalition', () => {
    const hosts = openFlight(3);
    const flightId = flightOf(hosts[0])?.flightId ?? '';
    const fifth = joined('Fifth');
    fifth.send('flight.join', { flightId });
    expect(fifth.last('error')?.body.code).toBe('flightFull');
    fifth.send('flight.join', { flightId: 'f_nope00' });
    expect(fifth.last('error')?.body.code).toBe('badCode');
    const red = joined('Red', { code: CODES.red });
    red.send('flight.join', { flightId });
    expect(red.last('error')?.body.code).toBe('badCode');
  });
});

describe('moving (§7.2, §7.3)', () => {
  it('lets the member in command move to a free position or swap', () => {
    const [lead, two, three] = openFlight(2);
    lead.send('flight.move', { pid: three.pid, pos: 4 });
    expect(positions(flightOf(two))?.map(([, pos]) => pos)).toEqual([1, 2, 4]);
    lead.send('flight.move', { pid: two.pid, pos: 4 });
    expect(positions(flightOf(two))).toEqual([
      [lead.pid, 1, 'online'],
      [three.pid, 2, 'online'],
      [two.pid, 4, 'online'],
    ]);
  });

  it('refuses moves by others, of oneself and of -1 – also for an acting lead', () => {
    const [lead, two, three] = openFlight(2);
    two.send('flight.move', { pid: three.pid, pos: 4 });
    expect(two.last('error')?.body.code).toBe('forbidden');
    lead.send('flight.move', { pid: two.pid, pos: 2 });
    lead.send('flight.move', { pid: lead.pid, pos: 3 });
    expect(lead.of('error')).toHaveLength(1);
    lead.drop();
    // -2 is now in command but may not move -1.
    expect(flightOf(two)?.inCommand).toBe(two.pid);
    two.send('flight.move', { pid: lead.pid, pos: 4 });
    expect(two.last('error')?.body.code).toBe('forbidden');
  });
});

describe('-1 leaves on purpose (§7.4)', () => {
  it('frees -1 at once; -2 may move up straight away', () => {
    const [lead, two, three] = openFlight(2);
    lead.send('flight.leave', {});
    expect(flightOf(lead)?.members.map((m) => m.pid)).not.toContain(lead.pid);
    const flight = flightOf(three);
    expect(flight?.inCommand).toBe(two.pid);
    expect(flight?.moveUp).toEqual({ pid: two.pid, allowedFrom: clock.now });
    three.send('flight.moveUp', {});
    expect(three.last('error')?.body.code).toBe('forbidden');
    two.send('flight.moveUp', {});
    expect(positions(flightOf(three))).toEqual([
      [two.pid, 1, 'online'],
      [three.pid, 3, 'online'],
    ]);
    expect(flightOf(three)?.moveUp).toBeNull();
  });

  it('gives the move-up option to the member in command when there is no -2', () => {
    const [lead, two, three] = openFlight(2);
    two.send('flight.leave', {});
    lead.send('flight.leave', {});
    expect(flightOf(three)?.moveUp?.pid).toBe(three.pid);
  });

  it('gives the old -1 the first free position when he joins again, never -1', () => {
    const [lead, , three] = openFlight(2);
    const flightId = flightOf(lead)?.flightId ?? '';
    lead.send('flight.leave', {});
    lead.send('flight.join', { flightId });
    expect(positions(flightOf(three))?.find(([pid]) => pid === lead.pid)?.[1]).toBe(4);
    expect(flightOf(three)?.members.some((m) => m.pos === 1)).toBe(false);
  });

  it('counts leaving the session and taking a JTAC slot as leaving the flight', () => {
    const [lead, two, three] = openFlight(2);
    lead.send('session.leave', {});
    expect(flightOf(two)?.moveUp?.allowedFrom).toBe(clock.now);
    reconnect(three, 'Wing3', { role: 'jtac', aircraft: { type: 'forward_observer' } });
    expect(flightOf(two)?.members.map((m) => m.pid)).toEqual([two.pid]);
  });
});

describe('-1 drops out (§7.4)', () => {
  it('keeps -1 for him; after 10 minutes -2 may move up and they swap', () => {
    const [lead, two] = openFlight(1);
    lead.drop();
    const lostAt = clock.now;
    expect(flightOf(two)).toMatchObject({
      inCommand: two.pid,
      moveUp: { pid: two.pid, allowedFrom: lostAt + 10 * 60_000 },
    });
    expect(positions(flightOf(two))?.[0]).toEqual([lead.pid, 1, 'lost']);
    clock.advance(9 * 60_000);
    two.alive();
    two.send('flight.moveUp', {});
    expect(two.last('error')?.body.text).toMatch(/Not yet/);
    clock.advance(60_000);
    two.send('flight.moveUp', {});
    expect(positions(flightOf(two))).toEqual([
      [two.pid, 1, 'online'],
      [lead.pid, 2, 'lost'],
    ]);
    reconnect(lead, 'Lead');
    expect(
      lead.last('session.state')?.body.you.flight?.members.map((m) => [m.pos, m.presence]),
    ).toEqual([
      [1, 'online'],
      [2, 'online'],
    ]);
    expect(flightOf(two)?.inCommand).toBe(two.pid);
  });

  it('gives him command back when he returns and nobody moved up', () => {
    const [lead, two] = openFlight(1);
    lead.drop();
    clock.advance(30 * 60_000);
    two.alive();
    reconnect(lead, 'Lead');
    expect(flightOf(two)).toMatchObject({ inCommand: lead.pid, moveUp: null });
  });

  it('frees -1 when his entry expires after 4 h', () => {
    const [lead, two] = openFlight(1);
    lead.drop();
    clock.advance(4 * 3_600_000 + 1000);
    two.alive();
    relay.tick();
    expect(flightOf(two)).toMatchObject({
      members: [{ pid: two.pid, pos: 2 }],
      moveUp: { pid: two.pid, allowedFrom: clock.now },
    });
  });
});

describe('end of a flight (§7.5)', () => {
  it('lives on while members are lost, and closes when the last one leaves', () => {
    const other = joined('Other');
    const [lead, two] = openFlight(1);
    const flightId = flightOf(lead)?.flightId;
    lead.drop();
    two.drop();
    const late = joined('Late');
    expect(late.last('session.state')?.body.flights).toEqual([
      { flightId, display: 'Enfield 1', memberCount: 2, types: ['FA-18C_hornet'] },
    ]);
    reconnect(two, 'Wing2');
    two.send('flight.leave', {});
    reconnect(lead, 'Lead');
    lead.send('flight.leave', {});
    expect(other.last('flight.closed')?.body).toEqual({ flightId });
    expect(lead.last('flight.closed')?.body).toEqual({ flightId });
    expect(relay.stats().blue.flights).toBe(0);
  });

  it('closes a private flight without telling the session', () => {
    const other = joined('Other');
    const lead = joined('Lead');
    lead.send('flight.create', { name: 'Ghost', open: false });
    lead.send('flight.leave', {});
    expect(lead.of('flight.closed')).toHaveLength(1);
    expect(other.of('flight.closed')).toEqual([]);
  });
});

describe('flights in session.state (§4.5)', () => {
  it('lists open flights for a newcomer and gives a returning member his own flight', () => {
    const [lead, two] = openFlight(1);
    const ghost = joined('Ghost');
    ghost.send('flight.create', { name: 'Ghost', open: false });
    const late = joined('Late');
    const state = late.last('session.state')?.body;
    expect(state?.flights.map((f) => f.display)).toEqual(['Enfield 1']);
    expect(state?.you.flight).toBeNull();

    reconnect(two, 'Wing2');
    const own = two.last('session.state')?.body;
    expect(own?.you.flight?.members.map((m) => m.pid)).toEqual([lead.pid, two.pid]);
    expect(own?.you.flight?.members.every((m) => m.presence === 'online')).toBe(true);
  });

  it('leaves the flight when switching coalition', () => {
    const [lead, two] = openFlight(1);
    two.send('session.switch', { code: CODES.red });
    expect(flightOf(lead)?.members.map((m) => m.pid)).toEqual([lead.pid]);
  });
});

describe('status in a flight (§6.4)', () => {
  it('sends the full package to the flight and a position with the flight callsign to the rest', () => {
    const other = joined('Other');
    const [lead, two] = openFlight(1);
    two.status(42.2, 41.7, { fuel: { internalKg: 2900, externalKg: 0, source: 'export' } });
    const full = lead.last('status.update');
    expect(full).toMatchObject({
      from: two.pid,
      to: { scope: 'flight', id: flightOf(lead)?.flightId },
      body: { fuel: { internalKg: 2900 } },
    });
    expect(full?.seq).toBeGreaterThan(0);
    expect(lead.of('status.position')).toEqual([]);
    expect(other.last('status.position')?.body.callsign).toBe('Enfield 1-2');
    expect(other.of('status.update')).toEqual([]);
  });

  it('gives a returning member the last full package of his flight mates', () => {
    const [lead, two] = openFlight(1);
    two.drop();
    lead.status(42, 41, { ias: 150 });
    reconnect(two, 'Wing2');
    const at = two.frames.findLastIndex((f) => f.type === 'session.state');
    const catchUp = two.frames.slice(at + 1).find((f) => f.type === 'status.update');
    expect(catchUp?.type === 'status.update' && catchUp.body.ias).toBe(150);
  });
});
