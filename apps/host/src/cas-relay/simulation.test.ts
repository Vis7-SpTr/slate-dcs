// SPDX-License-Identifier: GPL-3.0-or-later
// P1.6 "done when": a session with 8 pilots + 2 JTACs (plus a red player) over
// 10 simulated minutes, with heartbeats, status packages, two pilots dropping
// out and coming back with their token – first without flights, then with the
// 8 pilots in two flights of 4. Every frame the relay sends is checked against
// the shared schemas by the harness.

import { SESSION_TIMING, STATUS_TIMING } from '@slate-dcs/shared';
import { describe, expect, it } from 'vitest';

import { Clock, CODES, FakeHost, makeRelay } from './relay-harness.js';

interface Player {
  host: FakeHost;
  nick: string;
  role: 'pilot' | 'jtac';
  /** `false` = JTAC on the F10 map: no own position. */
  hasPosition: boolean;
  online: boolean;
  lat: number;
}

describe('session simulation: 8 pilots + 2 JTACs', () => {
  it('keeps everyone in the picture through heartbeats, drop-outs and rejoins', () => {
    const clock = new Clock();
    const relay = makeRelay(clock);
    const players: Player[] = [];

    const add = (
      nick: string,
      role: Player['role'],
      join: Parameters<FakeHost['join']>[1],
      hasPosition = true,
    ) => {
      const host = new FakeHost(relay);
      host.hello();
      host.join(nick, { role, ...join });
      players.push({ host, nick, role, hasPosition, online: true, lat: 42 + players.length / 10 });
    };

    // Four pilots through discovery (coalition code), four through manual join (group code).
    for (let i = 1; i <= 4; i += 1) {
      add(`Pilot${String(i)}`, 'pilot', { source: 'discovery' });
    }
    for (let i = 5; i <= 8; i += 1) {
      add(`Pilot${String(i)}`, 'pilot', { code: CODES.group, coalition: 'blue' });
    }
    add('JTAC1', 'jtac', { aircraft: { type: 'forward_observer' } }, false);
    add('JTAC2', 'jtac', { aircraft: { type: 'M1043 HMMWV Armament', unit: 'Anvil' } });
    const red = new FakeHost(relay);
    red.hello();
    red.join('RedPilot', { code: CODES.red });

    const blue = players.map((p) => p.host);
    expect(new Set(blue.map((h) => h.pid)).size).toBe(10);
    expect(blue.every((h) => h.last('session.joined')?.body.session === 'blue')).toBe(true);
    expect(relay.stats().blue).toMatchObject({ online: 10, lost: 0 });

    const dropped = [players[2], players[6]] as Player[];
    const pidsBefore = dropped.map((p) => p.host.pid);

    // 10 minutes in 1-second steps.
    for (let sec = 1; sec <= 600; sec += 1) {
      clock.advance(1000);
      if (sec === 180) {
        for (const p of dropped) {
          p.host.drop();
          p.online = false;
        }
      }
      if (sec === 300) {
        for (const p of dropped) {
          p.host.reconnect();
          p.host.hello();
          p.host.join(p.nick, { role: p.role });
          p.online = true;
        }
      }
      for (const p of players) {
        if (!p.online) continue;
        if (sec % SESSION_TIMING.heartbeatSec === 0) p.host.alive();
        if (p.hasPosition && sec % STATUS_TIMING.heartbeatSec === 0) {
          p.lat += 0.001;
          p.host.status(p.lat, 41.6);
        }
      }
      if (sec % 30 === 0) red.status(43, 44);
      relay.tick();
    }

    // The two who dropped out came back as themselves.
    expect(dropped.map((p) => p.host.pid)).toEqual(pidsBefore);
    expect(dropped.every((p) => p.host.last('session.joined')?.body.resumed)).toBe(true);
    expect(relay.stats().blue).toMatchObject({ online: 10, lost: 0 });

    for (const p of players) {
      // Everyone sees every other blue aircraft with a position – and nothing red.
      const seen = new Set(p.host.of('status.position').map((m) => m.body.pid));
      const expected = players.filter((o) => o !== p && o.hasPosition).map((o) => o.host.pid);
      expect([...seen].sort(), p.nick).toEqual(expected.sort());
      expect(seen.has(red.pid)).toBe(false);
      expect(p.host.of('error'), p.nick).toEqual([]);

      // After each snapshot the catch-up comes sorted, then live messages:
      // seq only grows.
      let previous = Infinity;
      for (const f of p.host.frames) {
        if (f.type === 'session.state') previous = -1;
        else if (f.seq !== undefined) {
          expect(f.seq, p.nick).toBeGreaterThan(previous);
          previous = f.seq;
        }
      }
    }

    // Those who stayed saw the drop-outs as lost, then online again.
    const watcher = players[0]?.host;
    for (const p of dropped) {
      const changes = (watcher?.of('session.presence') ?? [])
        .filter((m) => m.body.pid === p.host.pid)
        .map((m) => m.body.presence);
      expect(changes).toEqual(['online', 'lost', 'online']);
    }

    // The returning pilots got the current picture straight after their
    // snapshot: the last position of all 8 other aircraft (JTAC1 has none).
    for (const p of dropped) {
      const frames = p.host.frames;
      const at = frames.findLastIndex((f) => f.type === 'session.state');
      const state = frames[at];
      const asOf = state?.type === 'session.state' ? state.body.asOfSeq : -1;
      const picture = frames
        .slice(at + 1)
        .filter((f) => f.type === 'status.position' && (f.seq ?? Infinity) <= asOf);
      expect(
        new Set(picture.map((f) => f.type === 'status.position' && f.body.pid)).size,
        p.nick,
      ).toBe(8);
    }

    // Red saw only its own session.
    expect(red.last('session.state')?.body.participants.map((x) => x.nick)).toEqual(['RedPilot']);
    expect(red.of('status.position')).toEqual([]);
    expect(red.of('session.presence')).toEqual([]);
  });

  it('keeps two flights of 4 working through drop-outs, a lead leaving and a move-up', () => {
    const clock = new Clock();
    const relay = makeRelay(clock);
    const join = (nick: string, role: 'pilot' | 'jtac' = 'pilot') => {
      const host = new FakeHost(relay);
      host.hello();
      host.join(nick, {
        role,
        ...(role === 'jtac' ? { aircraft: { type: 'forward_observer' } } : {}),
      });
      return host;
    };
    const pilots = Array.from({ length: 8 }, (_, i) => join(`Pilot${String(i + 1)}`));
    const jtacs = [join('JTAC1', 'jtac'), join('JTAC2', 'jtac')];
    const [p1, p2, p3, p4, p5, p6, p7, p8] = pilots as [
      FakeHost,
      FakeHost,
      FakeHost,
      FakeHost,
      FakeHost,
      FakeHost,
      FakeHost,
      FakeHost,
    ];

    p1.send('flight.create', { name: 'Enfield', open: true });
    const enfield = p1.last('flight.created')?.body;
    for (const p of [p2, p3, p4]) p.send('flight.join', { flightId: enfield?.flightId ?? '' });
    p5.send('flight.create', { name: 'Ghost', open: false });
    const ghost = p5.last('flight.created')?.body;
    for (const p of [p6, p7, p8]) p.send('flight.join', { privateCode: ghost?.privateCode ?? '' });
    const flightOf = (p: FakeHost) => p.last('flight.updated')?.body;
    expect(flightOf(p4)?.members.map((m) => m.pos)).toEqual([1, 2, 3, 4]);
    expect(flightOf(p8)?.members.map((m) => m.pos)).toEqual([1, 2, 3, 4]);
    // JTACs see the open flight in the list, never the private one.
    expect(jtacs[0]?.of('flight.listed').map((f) => f.body.display)).toContain('Enfield 1');
    expect(jtacs[0]?.of('flight.listed').map((f) => f.body.display)).not.toContain('Ghost 1');

    const mates = new Map<FakeHost, FakeHost[]>([
      ...[p1, p2, p3, p4].map((p): [FakeHost, FakeHost[]] => [p, [p1, p2, p3, p4]]),
      ...[p5, p6, p7, p8].map((p): [FakeHost, FakeHost[]] => [p, [p5, p6, p7, p8]]),
    ]);
    const online = new Set([...pilots, ...jtacs]);

    for (let sec = 1; sec <= 600; sec += 1) {
      clock.advance(1000);
      if (sec === 120) {
        p1.drop(); // Enfield's lead crashes …
        p6.drop(); // … and Ghost's -2.
        online.delete(p1);
        online.delete(p6);
      }
      if (sec === 240) {
        for (const [p, nick] of [
          [p1, 'Pilot1'],
          [p6, 'Pilot6'],
        ] as const) {
          p.reconnect();
          p.hello();
          p.join(nick);
          online.add(p);
        }
      }
      if (sec === 400) p5.send('flight.leave', {}); // Ghost's lead leaves on purpose …
      if (sec === 401) p6.send('flight.moveUp', {}); // … and -2 moves up at once.
      for (const p of online) {
        if (sec % SESSION_TIMING.heartbeatSec === 0) p.alive();
        if (sec % STATUS_TIMING.heartbeatSec === 0 && !jtacs.includes(p)) p.status(42, 41.6);
      }
      relay.tick();
    }

    // Enfield: the lead came back as -1 and is in command again.
    expect(flightOf(p2)).toMatchObject({ inCommand: p1.pid, moveUp: null });
    expect(flightOf(p2)?.members.map((m) => [m.pid, m.pos])).toEqual(
      [p1, p2, p3, p4].map((p, i) => [p.pid, i + 1]),
    );
    // Ghost: -2 moved up after the lead left; the code went with command.
    expect(flightOf(p7)?.members.map((m) => [m.pid, m.pos])).toEqual([
      [p6.pid, 1],
      [p7.pid, 3],
      [p8.pid, 4],
    ]);
    expect(flightOf(p6)?.privateCode).toBe(ghost?.privateCode);
    expect(flightOf(p7)?.privateCode).toBeNull();

    for (const p of pilots) {
      expect(p.of('error'), 'errors').toEqual([]);
      // Full packages only ever from his own flight.
      const fullFrom = new Set(p.of('status.update').map((m) => m.from));
      const own = (mates.get(p) ?? []).filter((m) => m !== p).map((m) => m.pid);
      expect(
        [...fullFrom].every((pid) => own.includes(pid)),
        'full',
      ).toBe(true);
      expect(fullFrom.size, 'full').toBeGreaterThan(0);
    }
    for (const jtac of jtacs) {
      // JTACs (not checked in – P2) get positions with flight callsigns only.
      expect(jtac.of('status.update')).toEqual([]);
      const callsigns = new Set(jtac.of('status.position').map((m) => m.body.callsign));
      expect(callsigns).toContain('Enfield 1-1');
      expect(callsigns).toContain('Ghost 1-1');
    }
  });
});
