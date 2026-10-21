// SPDX-License-Identifier: GPL-3.0-or-later
// P1.6 "done when": a session with 8 pilots + 2 JTACs (plus a red player) over
// 10 simulated minutes, with heartbeats, status packages, two pilots dropping
// out and coming back with their token. Every frame the relay sends is
// checked against the shared schemas by the harness.

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
    expect(relay.stats().blue).toEqual({ online: 10, lost: 0 });

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
    expect(relay.stats().blue).toEqual({ online: 10, lost: 0 });

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
});
