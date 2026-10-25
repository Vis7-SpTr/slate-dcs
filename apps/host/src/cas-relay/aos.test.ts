// SPDX-License-Identifier: GPL-3.0-or-later
// JTAC on-station, AOs and map entries (protocol.md §8): P2.1.

import { SESSION_TIMING } from '@slate-dcs/shared';
import type { Message } from '@slate-dcs/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { Clock, CODES, FakeHost, makeRelay } from './relay-harness.js';
import type { Relay } from './relay.js';

let clock: Clock;
let relay: Relay;

beforeEach(() => {
  clock = new Clock();
  relay = makeRelay(clock);
});

type Draft = Extract<Message, { type: 'cm.create' }>['body'];

function pilot(nick: string): FakeHost {
  const host = new FakeHost(relay);
  host.hello();
  host.join(nick);
  return host;
}

/** A JTAC in a Combined Arms vehicle at a known position. */
function jtac(nick: string, lat = 42.2, lon = 41.7): FakeHost {
  const host = new FakeHost(relay);
  host.hello();
  host.join(nick, { role: 'jtac', aircraft: { type: 'forward_observer', unit: nick } });
  host.status(lat, lon);
  return host;
}

function onStation(host: FakeHost, callsign: string, extra: Record<string, unknown> = {}): string {
  return host.send('jtac.onStation', {
    callsign,
    freqs: [{ mhz: 251, label: `${callsign.toUpperCase()} PRI` }],
    ...extra,
  });
}

/** The AO as one host last saw it. */
function aoOf(host: FakeHost) {
  const frames = host.frames.filter(
    (f): f is Extract<Message, { type: 'ao.created' | 'ao.updated' }> =>
      f.type === 'ao.created' || f.type === 'ao.updated',
  );
  return frames.at(-1)?.body;
}

function threat(extra: Partial<Draft> = {}): Draft {
  return {
    kind: 'threat',
    shape: 'point',
    geom: { lat: 42.22, lon: 41.74 },
    label: 'SA-8',
    text: null,
    ringM: 9000,
    count: null,
    moving: null,
    observedMtime: 51000,
    block: null,
    aoId: null,
    visibility: 'coalition',
    ...extra,
  } as Draft;
}

function keyhole(aoId: string, visibility: 'ao' | 'coalition' = 'ao'): Draft {
  return threat({
    kind: 'keyhole',
    label: 'HAMMER',
    ringM: null,
    observedMtime: null,
    aoId,
    visibility,
  });
}

/** Two JTACs in one AO and a pilot watching. */
function twoJtacs() {
  const axeman = jtac('Axeman');
  const pontiac = jtac('Pontiac', 42.3, 41.8);
  const vis = pilot('Vis7');
  onStation(axeman, 'Axeman 11');
  const ao = aoOf(axeman);
  if (!ao?.joinCode) throw new Error('no AO');
  onStation(pontiac, 'Pontiac 21', { joinCode: ao.joinCode });
  return { axeman, pontiac, vis, aoId: ao.aoId, joinCode: ao.joinCode };
}

describe('on-station and AOs (§8.1, §8.2)', () => {
  it('makes a 10 NM circle around the JTAC, SFC to FL200 – the creator in command', () => {
    const axeman = jtac('Axeman');
    const vis = pilot('Vis7');
    const id = onStation(axeman, 'Axeman 11');
    const created = axeman.last('ao.created');
    expect(created?.re).toBe(id);
    expect(created?.body).toMatchObject({
      name: 'AO AXEMAN 11',
      type: 'circle',
      center: { lat: 42.2, lon: 41.7 },
      radiusM: 18520,
      floor: { m: 0, ref: 'sfc' },
      ceiling: { m: 6096, ref: 'msl' },
      inCommand: axeman.pid,
      jtacs: [{ pid: axeman.pid, callsign: 'Axeman 11', presence: 'online' }],
    });
    expect(created?.body.joinCode).toMatch(/^[0-9A-Z]{3}-[0-9A-Z]{3}$/);
    expect(created?.body.aoId).toMatch(/^a_/);
    // The pilot sees the AO, its JTAC and frequencies – never the join code.
    expect(vis.last('ao.created')?.body).toMatchObject({
      aoId: created?.body.aoId,
      joinCode: null,
      jtacs: [{ freqs: [{ mhz: 251, label: 'AXEMAN 11 PRI' }] }],
    });
  });

  it('takes the AO the JTAC asks for, and his typed centre without a DCS position', () => {
    const host = new FakeHost(relay);
    host.hello();
    host.join('Axeman', { role: 'jtac', aircraft: { type: 'forward_observer' } });
    onStation(host, 'Axeman 11');
    expect(host.last('error')?.body.code).toBe('badMessage');
    onStation(host, 'Axeman 11', {
      ao: { name: 'AO ANVIL', center: { lat: 42.1, lon: 41.6 }, radiusM: 9260 },
    });
    expect(host.last('ao.created')?.body).toMatchObject({
      name: 'AO ANVIL',
      center: { lat: 42.1, lon: 41.6 },
      radiusM: 9260,
    });
  });

  it('refuses a pilot, a second on-station call and a wrong join code', () => {
    const vis = pilot('Vis7');
    onStation(vis, 'Vis 1');
    expect(vis.last('error')?.body.code).toBe('forbidden');
    const axeman = jtac('Axeman');
    onStation(axeman, 'Axeman 11');
    onStation(axeman, 'Axeman 11');
    expect(axeman.last('error')?.body.code).toBe('alreadyOnStation');
    const pontiac = jtac('Pontiac');
    onStation(pontiac, 'Pontiac 21', { joinCode: 'ZZZ-ZZZ' });
    expect(pontiac.last('error')?.body.code).toBe('badCode');
  });

  it('lets a second JTAC join by join code; both are listed in order', () => {
    const { axeman, pontiac, vis } = twoJtacs();
    for (const host of [axeman, pontiac, vis]) {
      expect(aoOf(host)?.jtacs.map((j) => j.pid)).toEqual([axeman.pid, pontiac.pid]);
      expect(aoOf(host)?.inCommand).toBe(axeman.pid);
    }
    expect(aoOf(pontiac)?.joinCode).not.toBeNull();
    expect(aoOf(vis)?.joinCode).toBeNull();
  });

  it('a red JTAC can’t join a blue AO', () => {
    const { joinCode } = twoJtacs();
    const red = new FakeHost(relay);
    red.hello();
    red.join('Red', { code: CODES.red, role: 'jtac', aircraft: { type: 'forward_observer' } });
    onStation(red, 'Red 1', { joinCode });
    expect(red.last('error')?.body.code).toBe('badCode');
    expect(red.of('ao.updated')).toEqual([]);
  });
});

describe('command of an AO (§8.3)', () => {
  it('moves to the next JTAC while the creator is lost and comes back with him', () => {
    const { axeman, pontiac } = twoJtacs();
    axeman.drop();
    expect(aoOf(pontiac)).toMatchObject({
      inCommand: pontiac.pid,
      jtacs: [{ pid: axeman.pid, presence: 'lost' }, { presence: 'online' }],
    });
    axeman.reconnect();
    axeman.hello();
    axeman.join('Axeman', { role: 'jtac', aircraft: { type: 'forward_observer', unit: 'Axeman' } });
    expect(aoOf(pontiac)?.inCommand).toBe(axeman.pid);
    // His snapshot has the AO with him in command again.
    expect(axeman.last('session.state')?.body.aos[0]).toMatchObject({ inCommand: axeman.pid });
  });

  it('a lost JTAC keeps the AO alive', () => {
    const axeman = jtac('Axeman');
    const vis = pilot('Vis7');
    onStation(axeman, 'Axeman 11');
    axeman.drop();
    expect(aoOf(vis)).toMatchObject({ inCommand: null, jtacs: [{ presence: 'lost' }] });
    expect(vis.of('ao.closed')).toEqual([]);
  });

  it('off-station hands command on for good', () => {
    const { axeman, pontiac, aoId, joinCode } = twoJtacs();
    const id = axeman.send('jtac.offStation', { aoId });
    expect(aoOf(axeman)).toMatchObject({ inCommand: pontiac.pid, jtacs: [{ pid: pontiac.pid }] });
    expect(axeman.last('ao.updated')?.re).toBe(id);
    onStation(axeman, 'Axeman 11', { joinCode });
    expect(aoOf(pontiac)).toMatchObject({
      inCommand: pontiac.pid,
      jtacs: [{ pid: pontiac.pid }, { pid: axeman.pid }],
    });
  });

  it('the last JTAC off-station closes the AO with its entries', () => {
    const { axeman, pontiac, vis, aoId } = twoJtacs();
    axeman.send('cm.create', keyhole(aoId, 'coalition'));
    axeman.send('jtac.offStation', { aoId });
    pontiac.send('jtac.offStation', { aoId });
    expect(vis.last('ao.closed')?.body).toEqual({ aoId });
    const late = pilot('Late');
    expect(late.last('session.state')?.body).toMatchObject({ aos: [], mapEntries: [] });
  });

  it('only the JTAC in command changes the AO; Recenter uses his position', () => {
    const { axeman, pontiac, vis, aoId } = twoJtacs();
    pontiac.send('ao.update', { aoId, changes: { radiusM: 5000 } });
    expect(pontiac.last('error')?.body.code).toBe('forbidden');
    axeman.status(42.25, 41.75);
    axeman.send('ao.update', {
      aoId,
      changes: { center: null, radiusM: 9260, ceiling: { m: 7620, ref: 'msl' } },
    });
    expect(aoOf(vis)).toMatchObject({
      center: { lat: 42.25, lon: 41.75 },
      radiusM: 9260,
      ceiling: { m: 7620, ref: 'msl' },
    });
    axeman.send('ao.update', { aoId, changes: { floor: { m: 9000, ref: 'msl' } } });
    expect(axeman.last('error')?.body.code).toBe('badMessage');
  });

  it('turns a circle into a square with its own fields', () => {
    const { axeman, vis, aoId } = twoJtacs();
    axeman.send('ao.update', {
      aoId,
      changes: { type: 'square', lengthM: 20000, widthM: 10000, headingDeg: 45 },
    });
    expect(aoOf(vis)).toMatchObject({ type: 'square', radiusM: null, lengthM: 20000 });
  });
});

describe('off-station without jtac.offStation (§8.2)', () => {
  it.each([
    ['leaving the session', (h: FakeHost) => h.send('session.leave', {})],
    ['switching coalition', (h: FakeHost) => h.send('session.switch', { code: CODES.red })],
    [
      'taking an aircraft slot',
      (h: FakeHost) =>
        h.send('session.update', {
          nick: 'Axeman',
          role: 'pilot',
          aircraft: { type: 'A-10C_2', unit: 'Hawg 1-1' },
        }),
    ],
  ])('%s takes the JTAC off-station', (_why, act) => {
    const { axeman, pontiac } = twoJtacs();
    act(axeman);
    expect(aoOf(pontiac)).toMatchObject({ inCommand: pontiac.pid, jtacs: [{ pid: pontiac.pid }] });
  });

  it('expiry after 4 h does too, and closes an AO with no JTAC left', () => {
    const axeman = jtac('Axeman');
    const vis = pilot('Vis7');
    onStation(axeman, 'Axeman 11');
    axeman.drop();
    clock.advance(SESSION_TIMING.tokenExpiryHours * 3_600_000 + 1000);
    vis.alive();
    relay.tick();
    expect(vis.last('ao.closed')).toBeDefined();
  });

  it('a pilot taking a JTAC slot gets the join codes', () => {
    const { vis } = twoJtacs();
    vis.send('session.update', {
      nick: 'Vis7',
      role: 'jtac',
      aircraft: { type: 'forward_observer' },
    });
    expect(aoOf(vis)?.joinCode).not.toBeNull();
  });
});

describe('map entries (§8.4)', () => {
  it('a coalition threat reaches everyone, nobody in red', () => {
    const { axeman, pontiac, vis } = twoJtacs();
    const red = new FakeHost(relay);
    red.hello();
    red.join('Red', { code: CODES.red });
    const id = vis.send('cm.create', threat());
    expect(vis.last('cm.created')?.re).toBe(id);
    for (const host of [axeman, pontiac]) {
      expect(host.last('cm.created')?.body).toMatchObject({ kind: 'threat', author: vis.pid });
    }
    expect(red.of('cm.created')).toEqual([]);
  });

  it('an AO-only entry reaches only the AO’s JTACs', () => {
    const { axeman, pontiac, vis, aoId } = twoJtacs();
    axeman.send('cm.create', keyhole(aoId));
    expect(pontiac.last('cm.created')?.body).toMatchObject({ kind: 'keyhole', label: 'HAMMER' });
    expect(vis.of('cm.created')).toEqual([]);
    expect(pilot('Late').last('session.state')?.body.mapEntries).toEqual([]);
  });

  it('what pilots may draw (§8.4)', () => {
    const { vis, aoId } = twoJtacs();
    vis.send('cm.create', threat({ kind: 'ip', label: 'IP SIERRA', ringM: null, aoId }));
    expect(vis.last('error')?.body.code).toBe('forbidden');
    vis.send('cm.create', threat({ visibility: 'ao', aoId }));
    expect(vis.last('error')?.body.code).toBe('forbidden');
    vis.send(
      'cm.create',
      threat({
        kind: 'enemy',
        label: 'BMP-2',
        ringM: null,
        count: 2,
        moving: false,
      }),
    );
    expect(vis.last('cm.created')?.body.kind).toBe('enemy');
  });

  it('a JTAC draws only into his own AO', () => {
    const { aoId } = twoJtacs();
    const other = jtac('Other');
    other.send('cm.create', keyhole(aoId));
    expect(other.last('error')?.body.code).toBe('forbidden');
    other.send('cm.create', threat({ visibility: 'ao' }));
    expect(other.last('error')?.body.code).toBe('badMessage');
  });

  it('only the author or the JTAC in command of its AO changes or deletes it', () => {
    const { axeman, pontiac, vis, aoId } = twoJtacs();
    pontiac.send('cm.create', keyhole(aoId, 'coalition'));
    const cmId = pontiac.last('cm.created')?.body.cmId ?? '';
    vis.send('cm.delete', { cmId });
    expect(vis.last('error')?.body.code).toBe('forbidden');
    // Axeman is in command of the AO: he may change Pontiac's keyhole.
    axeman.send('cm.update', {
      cmId,
      entry: { ...keyhole(aoId, 'coalition'), geom: { lat: 42.3, lon: 41.8 } } as Draft,
    });
    expect(vis.last('cm.updated')?.body).toMatchObject({ cmId, author: pontiac.pid });
    // A vis marker: only Vis7 or nobody.
    vis.send('cm.create', threat());
    const own = vis.last('cm.created')?.body.cmId ?? '';
    axeman.send('cm.delete', { cmId: own });
    expect(axeman.last('error')?.body.code).toBe('forbidden');
    const id = vis.send('cm.delete', { cmId: own });
    expect(axeman.last('cm.deleted')).toMatchObject({ body: { cmId: own, hidden: false } });
    expect(vis.last('cm.deleted')?.re).toBe(id);
  });

  it('keeps kind and AO on an update', () => {
    const { axeman, aoId } = twoJtacs();
    axeman.send('cm.create', keyhole(aoId));
    const cmId = axeman.last('cm.created')?.body.cmId ?? '';
    axeman.send('cm.update', {
      cmId,
      entry: { ...keyhole(aoId), kind: 'ip', label: 'IP' },
    });
    expect(axeman.last('error')?.body.code).toBe('badMessage');
  });

  it('a change to AO-only hides it from the others; back to coalition shows it again', () => {
    const { axeman, pontiac, vis, aoId } = twoJtacs();
    axeman.send('cm.create', keyhole(aoId, 'coalition'));
    const cmId = axeman.last('cm.created')?.body.cmId ?? '';
    axeman.send('cm.update', { cmId, entry: keyhole(aoId, 'ao') });
    expect(vis.last('cm.deleted')?.body).toEqual({ cmId, hidden: true });
    expect(pontiac.last('cm.updated')?.body.visibility).toBe('ao');
    axeman.send('cm.update', { cmId, entry: keyhole(aoId, 'coalition') });
    expect(vis.last('cm.created')?.body).toMatchObject({ cmId, visibility: 'coalition' });
  });

  it('a JTAC joining the AO gets its AO-only entries; going off-station hides them', () => {
    const axeman = jtac('Axeman');
    onStation(axeman, 'Axeman 11');
    const ao = aoOf(axeman);
    axeman.send('cm.create', keyhole(ao?.aoId ?? ''));
    const pontiac = jtac('Pontiac');
    expect(pontiac.of('cm.created')).toEqual([]);
    onStation(pontiac, 'Pontiac 21', { joinCode: ao?.joinCode ?? '' });
    const cmId = pontiac.last('cm.created')?.body.cmId;
    expect(cmId).toBeDefined();
    pontiac.send('jtac.offStation', { aoId: ao?.aoId ?? '' });
    expect(pontiac.last('cm.deleted')?.body).toEqual({ cmId, hidden: true });
  });

  it('a rejoining JTAC gets his AO and its entries in the snapshot', () => {
    const { axeman, aoId } = twoJtacs();
    axeman.send('cm.create', keyhole(aoId));
    axeman.reconnect();
    axeman.hello();
    axeman.join('Axeman', { role: 'jtac', aircraft: { type: 'forward_observer', unit: 'Axeman' } });
    expect(axeman.last('session.state')?.body).toMatchObject({
      aos: [{ aoId, joinCode: expect.any(String) as string }],
      mapEntries: [{ kind: 'keyhole', aoId }],
    });
  });
});

describe('mission time on the relay (§1.4)', () => {
  it('runs on from the newest mt a host sent', () => {
    const vis = pilot('Vis7');
    expect(relay.missionTime('blue')).toBeNull();
    vis.send(
      'status.update',
      {
        pos: null,
        hdg: null,
        hdgMag: null,
        gs: null,
        ias: null,
        fuel: null,
        armament: null,
        avail: { pos: false, fuel: false, payload: false },
        reason: 'heartbeat',
      },
      { mt: 51000 },
    );
    clock.advance(30_000);
    expect(relay.missionTime('blue')).toBe(51030);
    expect(relay.missionTime('red')).toBeNull();
  });
});
