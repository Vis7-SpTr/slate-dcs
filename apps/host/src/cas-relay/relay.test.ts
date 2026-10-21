// SPDX-License-Identifier: GPL-3.0-or-later

import { SESSION_TIMING } from '@slate-dcs/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { Clock, CODES, FakeHost, makeRelay } from './relay-harness.js';
import type { Relay } from './relay.js';

let clock: Clock;
let relay: Relay;

beforeEach(() => {
  clock = new Clock();
  relay = makeRelay(clock);
});

/** A host that said hello and joined. */
function joined(nick: string, options: Parameters<FakeHost['join']>[1] = {}): FakeHost {
  const host = new FakeHost(relay);
  host.hello();
  host.join(nick, options);
  return host;
}

describe('handshake (§3)', () => {
  it('welcomes a host that speaks protocol 1', () => {
    const host = new FakeHost(relay);
    host.hello();
    expect(host.last('welcome')?.body).toEqual({
      protocol: 1,
      relay: 'slate-relay test',
      features: [],
      time: clock.now,
      heartbeatSec: SESSION_TIMING.heartbeatSec,
    });
  });

  it('rejects another protocol major and closes', () => {
    const host = new FakeHost(relay);
    host.hello([2]);
    expect(host.last('reject')?.body).toEqual({ reason: 'versionMismatch', supported: [1] });
    expect(host.closed).toBe(true);
  });

  it('wants hello first, then a join', () => {
    const host = new FakeHost(relay);
    host.join('Vis7');
    expect(host.last('error')?.body.code).toBe('badMessage');
    host.hello();
    host.status(42, 41);
    expect(host.last('error')?.body.code).toBe('notJoined');
  });

  it('answers broken and unknown frames', () => {
    const host = new FakeHost(relay);
    host.raw('not json');
    expect(host.last('error')?.body.code).toBe('badMessage');
    host.hello();
    host.raw(
      JSON.stringify({
        v: 1,
        id: '01JABCXYZ8M3Q4R5S6T7V8W9X0',
        type: 'cas.nineLine',
        from: '',
        session: '',
        to: { scope: 'relay' },
        ts: 1,
        ack: false,
        re: null,
        body: {},
      }),
    );
    expect(host.last('error')?.body).toMatchObject({ code: 'unsupported' });
    expect(host.last('error')?.re).toBe('01JABCXYZ8M3Q4R5S6T7V8W9X0');
  });

  it('refuses messages only the relay sends', () => {
    const host = joined('Vis7');
    host.send('session.presence', { pid: 'p_000000', presence: 'left', nick: 'X', role: 'pilot' });
    expect(host.last('error')?.body.code).toBe('forbidden');
  });
});

describe('joining (§4)', () => {
  it('puts a coalition code into its session and ignores the coalition field', () => {
    const host = joined('Vis7', { code: CODES.red, coalition: 'blue' });
    const joinedMsg = host.last('session.joined');
    expect(joinedMsg?.body).toMatchObject({ resumed: false, session: 'red', coalition: 'red' });
    expect(joinedMsg?.body.pid).toMatch(/^p_[0-9a-f]{6}$/);
    expect(joinedMsg?.body.token).toHaveLength(43);
  });

  it('needs a coalition with the group code', () => {
    const host = joined('Vis7', { code: CODES.group });
    expect(host.last('error')?.body.code).toBe('badCoalition');
    host.join('Vis7', { code: CODES.group, coalition: 'red' });
    expect(host.last('session.joined')?.body.session).toBe('red');
  });

  it('refuses an unknown code', () => {
    const host = joined('Vis7', { code: 'BLUE-0000000X' });
    expect(host.last('error')?.body).toEqual({ code: 'badCode', text: 'Unknown session code' });
    expect(host.of('session.joined')).toEqual([]);
  });

  it('sends session.state with everyone in the session, then presence to the others', () => {
    const a = joined('Alpha');
    const b = joined('Bravo', { role: 'jtac', aircraft: { type: 'forward_observer' } });
    const state = b.last('session.state');
    expect(
      state?.body.participants.map((p) => [p.nick, p.role, p.aircraft?.type, p.presence]),
    ).toEqual([
      ['Bravo', 'jtac', 'forward_observer', 'online'],
      ['Alpha', 'pilot', 'FA-18C_hornet', 'online'],
    ]);
    expect(a.last('session.presence')?.body).toEqual({
      pid: b.pid,
      presence: 'online',
      nick: 'Bravo',
      role: 'jtac',
    });
    // Unit names stay private: only the type is in the participant list.
    expect(JSON.stringify(state?.body.participants)).not.toContain('Alpha 1-1');
  });

  it('keeps the coalitions apart', () => {
    const blue = joined('Blue');
    const red = joined('Red', { code: CODES.red });
    blue.status(42, 41);
    expect(red.of('session.presence')).toEqual([]);
    expect(red.of('status.position')).toEqual([]);
    expect(red.last('session.state')?.body.participants.map((p) => p.nick)).toEqual(['Red']);
  });

  it('resumes with a known token: same pid, new token, old one dead', () => {
    const host = joined('Vis7');
    const { pid, token } = host;
    host.reconnect();
    host.hello();
    host.join('Vis7');
    expect(host.last('session.joined')?.body).toMatchObject({ pid, resumed: true });
    expect(host.token).not.toBe(token);

    const thief = new FakeHost(relay);
    thief.hello();
    thief.token = token;
    thief.join('Thief');
    expect(thief.last('session.joined')?.body).toMatchObject({ resumed: false });
    expect(thief.pid).not.toBe(pid);
  });

  it('lets the newest connection win and closes the older one with "replaced"', () => {
    const first = joined('Vis7');
    const second = new FakeHost(relay);
    second.hello();
    second.token = first.token;
    second.join('Vis7');
    expect(first.last('session.closed')?.body.reason).toBe('replaced');
    expect(first.closed).toBe(true);
    expect(second.last('session.joined')?.body).toMatchObject({ pid: first.pid, resumed: true });
  });

  it('refuses a second join on the same connection', () => {
    const host = joined('Vis7');
    host.join('Vis7');
    expect(host.last('error')?.body.code).toBe('badMessage');
  });
});

describe('presence, switch, leave (§5)', () => {
  it('marks a quiet participant lost after 45 s, and online again on resume', () => {
    const a = joined('Alpha');
    const b = joined('Bravo');
    clock.advance(30_000);
    a.alive();
    clock.advance(20_000);
    relay.tick();
    expect(a.last('session.presence')?.body).toMatchObject({ pid: b.pid, presence: 'lost' });
    expect(b.of('session.presence').filter((p) => p.body.presence === 'lost')).toEqual([]);
    expect(relay.stats().blue).toMatchObject({ online: 1, lost: 1 });

    b.reconnect();
    b.hello();
    b.join('Bravo');
    expect(a.last('session.presence')?.body).toMatchObject({ pid: b.pid, presence: 'online' });
  });

  it('marks a closed connection lost at once', () => {
    const a = joined('Alpha');
    const b = joined('Bravo');
    b.drop();
    expect(a.last('session.presence')?.body).toMatchObject({ pid: b.pid, presence: 'lost' });
  });

  it('forgets a participant 4 h after last seen; his token then starts over', () => {
    const a = joined('Alpha');
    const b = joined('Bravo');
    b.drop();
    clock.advance(4 * 3_600_000 + 1000);
    a.alive();
    relay.tick();
    expect(a.last('session.presence')?.body).toMatchObject({ pid: b.pid, presence: 'left' });
    b.reconnect();
    b.hello();
    const oldPid = b.pid;
    b.join('Bravo');
    expect(b.last('session.joined')?.body.resumed).toBe(false);
    expect(b.pid).not.toBe(oldPid);
  });

  it('switches coalition with the other coalition code', () => {
    const blueMate = joined('Mate');
    const redMate = joined('Enemy', { code: CODES.red });
    const host = joined('Vis7');
    host.send('session.switch', { code: CODES.red });
    expect(host.last('session.joined')?.body).toMatchObject({ session: 'red', resumed: true });
    expect(host.last('session.state')?.body.participants.map((p) => p.nick)).toEqual([
      'Vis7',
      'Enemy',
    ]);
    expect(blueMate.last('session.presence')?.body).toMatchObject({
      pid: host.pid,
      presence: 'left',
    });
    expect(redMate.last('session.presence')?.body).toMatchObject({
      pid: host.pid,
      presence: 'online',
    });
    host.send('session.switch', { code: CODES.group });
    expect(host.last('error')?.body.code).toBe('badCoalition');
  });

  it('leaves on purpose: others see "left", the token can rejoin later', () => {
    const a = joined('Alpha');
    const b = joined('Bravo');
    b.send('session.leave', {});
    expect(a.last('session.presence')?.body).toMatchObject({ pid: b.pid, presence: 'left' });
    b.status(42, 41);
    expect(b.last('error')?.body.code).toBe('notJoined');
    b.join('Bravo');
    expect(b.last('session.joined')?.body).toMatchObject({ pid: b.pid, resumed: true });
  });

  it('sends session.closed "shutdown" to everyone', () => {
    const a = joined('Alpha');
    const b = joined('Bravo', { code: CODES.red });
    relay.shutdown();
    expect([a.last('session.closed')?.body.reason, b.last('session.closed')?.body.reason]).toEqual([
      'shutdown',
      'shutdown',
    ]);
    expect(a.closed && b.closed).toBe(true);
  });
});

describe('resync (§4.5)', () => {
  it('replays what a returning participant missed, in order, after the snapshot', () => {
    const a = joined('Alpha');
    const b = joined('Bravo');
    b.drop();
    const c = joined('Charlie');
    c.send('session.leave', {});
    a.clear();
    b.reconnect();
    b.hello();
    b.join('Bravo');
    const after = b.frames.slice(b.frames.findIndex((f) => f.type === 'session.state') + 1);
    const presence = after.filter((f) => f.type === 'session.presence');
    expect(presence.map((p) => [p.body.pid, p.body.presence])).toEqual([
      [c.pid, 'online'],
      [c.pid, 'left'],
    ]);
    const seqs = presence.map((p) => p.seq ?? 0);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
  });

  it('replays nothing when the relay no longer has the messages', () => {
    relay = makeRelay(clock, 2);
    const a = joined('Alpha');
    a.drop();
    for (const nick of ['C1', 'C2', 'C3']) joined(nick).send('session.leave', {});
    a.reconnect();
    a.hello();
    a.join('Alpha');
    const after = a.frames.slice(a.frames.findIndex((f) => f.type === 'session.state') + 1);
    expect(after.filter((f) => f.type === 'session.presence')).toEqual([]);
  });
});

describe('status (§6.4)', () => {
  it('turns a status package into status.position for the rest of the session', () => {
    const a = joined('Alpha');
    const b = joined('Bravo');
    a.status(42.17, 41.68);
    expect(a.of('status.position')).toEqual([]);
    const position = b.last('status.position');
    expect(position?.body).toEqual({
      pid: a.pid,
      callsign: 'Alpha 1-1',
      type: 'FA-18C_hornet',
      pos: { lat: 42.17, lon: 41.68, altMsl: 3000, altAgl: 2800 },
      hdg: 90,
      gs: 180,
    });
    expect(position?.from).toBe('relay');
    expect(position?.rts).toBe(clock.now);
    // Fuel, armament and IAS stay out of the position picture.
    expect(Object.keys(position?.body ?? {})).not.toContain('fuel');
  });

  it('sends nothing without a position (JTAC on the F10 map)', () => {
    const a = joined('Alpha');
    const jtac = joined('JTAC', { role: 'jtac', aircraft: { type: 'forward_observer' } });
    jtac.status(0, 0, { pos: null, hdg: null, gs: null });
    expect(a.of('status.position')).toEqual([]);
  });

  it('gives a newcomer the current picture right after the snapshot', () => {
    const a = joined('Alpha');
    a.status(42, 41);
    const b = joined('Bravo');
    const after = b.frames.slice(b.frames.findIndex((f) => f.type === 'session.state') + 1);
    expect(after.filter((f) => f.type === 'status.position').map((f) => f.body.pid)).toEqual([
      a.pid,
    ]);
  });

  it('confirms an ack:true package with relay.receipt', () => {
    const a = joined('Alpha');
    const id = a.send(
      'status.update',
      {
        pos: { lat: 42, lon: 41, altMsl: 1, altAgl: null },
        hdg: null,
        hdgMag: null,
        gs: null,
        ias: null,
        fuel: null,
        armament: null,
        avail: { pos: true, fuel: false, payload: false },
        reason: 'event',
      },
      { ack: true },
    );
    expect(a.last('relay.receipt')?.re).toBe(id);
  });

  it('limits a flooding connection', () => {
    const a = joined('Alpha');
    for (let i = 0; i < 60; i += 1) a.status(42, 41);
    expect(a.of('error').map((e) => e.body.code)).toEqual(['rateLimited']);
  });
});
