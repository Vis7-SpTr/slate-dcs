// SPDX-License-Identifier: GPL-3.0-or-later
// P2.5 done-when (roadmap): hosts and a relay go through check-in → mission →
// clearance → BDA, and the host slices match the relay. A JTAC host and a
// two-ship (lead + wing) on one in-process relay; then the relay drops every
// link, the hosts rejoin with their tokens and the snapshot must leave their
// slices as they were.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultSlices, KG_PER_LB } from '@slate-dcs/shared';
import type { Command, FireMission, StatusBody } from '@slate-dcs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CODES } from '../cas-relay/relay-harness.js';
import { Relay } from '../cas-relay/relay.js';
import { StateStore } from '../state/store.js';
import { RelayClient } from './client.js';
import type { CasCommand } from './client.js';
import { TokenStore } from './tokens.js';

const quiet = { info: () => undefined, warn: () => undefined, debug: () => undefined };

let dir: string;
let relay: Relay;
const clients: RelayClient[] = [];

interface Host {
  name: string;
  store: StateStore;
  client: RelayClient;
  run(command: CasCommand): ReturnType<RelayClient['cas']>;
}

function host(name: string): Host {
  const store = new StateStore(defaultSlices('test'));
  const client = new RelayClient({
    store,
    tokens: new TokenStore(join(dir, `${name}-relays.json`)),
    log: quiet,
    app: `slate-host ${name}`,
  });
  clients.push(client);
  return { name, store, client, run: (command) => client.cas(command) };
}

type JoinArgs = Extract<Command, { cmd: 'session.join' }>['args'];
const join_ = (nick: string, role: 'pilot' | 'jtac'): JoinArgs => ({
  address: 'localhost:7790',
  code: CODES.blue,
  coalition: null,
  nick,
  role,
});

async function until(check: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  expect(check()).toBe(true);
}

/** A second of host life: each sends its status, receipts and brief refresh. */
async function pump(hosts: Host[], rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    for (const h of hosts) h.client.tick();
    await new Promise((r) => setTimeout(r, 15));
  }
}

function hornet(lat: number, rounds: number): StatusBody {
  return {
    pos: { lat, lon: 41.68, altMsl: 4500, altAgl: 4300 },
    hdg: 90,
    hdgMag: 84,
    gs: 180,
    ias: 160,
    fuel: { internalKg: 2900, externalKg: 0, source: 'export' },
    armament: {
      stations: [
        { st: 2, name: 'GBU-12', kind: 'bomb', role: 'ag', count: 2, source: 'export' },
        { st: 1, name: 'AIM-9X', kind: 'missile', role: 'aa', count: 1, source: 'export' },
      ],
      gun: { rounds, source: 'export' },
      stores: [],
    },
    avail: { pos: true, fuel: true, payload: true },
    reason: 'heartbeat',
  };
}

function inSlot(
  h: Host,
  type: string,
  unit: string,
  status: StatusBody | null,
  mtime: number,
): void {
  const now = Date.now();
  h.store.update({
    ownship: {
      ...h.store.get('ownship'),
      aircraft: { type, unit, slot: '1' },
      status,
      statusAt: now,
    },
    mission: {
      running: true,
      name: 'test',
      theatre: 'Caucasus',
      startDate: '2026-06-21',
      multiplayer: true,
      coalition: 'blue',
      playerName: unit,
      clock: { mtimeSec: mtime, sampledAt: now, paused: false },
    },
  });
}

const content = () => ({
  gamePlan: {
    control: 2 as const,
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
    locationText: '37T GG 26400 77879',
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

const ok = async (h: Host, command: CasCommand) => {
  const outcome = await h.run(command);
  if (!outcome.ok)
    throw new Error(`${h.name} ${command.cmd}: ${outcome.error.code} ${outcome.error.text}`);
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slate-cas-client-'));
  relay = new Relay({ codes: CODES, name: 'slate-relay test', log: quiet });
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  relay.shutdown();
  await rm(dir, { recursive: true, force: true });
});

/** The JTAC on-station; the lead and wing in Enfield 1, in their Hornets. */
async function scene() {
  const jtac = host('jtac');
  const lead = host('lead');
  const wing = host('wing');
  inSlot(lead, 'FA-18C_hornet', 'Enfield 1-1', hornet(42.17, 578), 51_000);
  inSlot(wing, 'FA-18C_hornet', 'Enfield 1-2', hornet(42.18, 400), 51_000);
  for (const [h, role] of [
    [jtac, 'jtac'],
    [lead, 'pilot'],
    [wing, 'pilot'],
  ] as const) {
    const joined = await h.client.join(join_(h.name, role), relay);
    if (!joined.ok) throw new Error(joined.error.text);
  }
  await ok(jtac, {
    cmd: 'jtac.onStation',
    args: {
      callsign: 'Axeman 11',
      freqs: [{ mhz: 251, label: 'PRI' }],
      ao: { center: { lat: 42.2, lon: 41.7 } },
    },
  });
  const aoId = jtac.store.get('cas').aos[0]?.aoId ?? '';
  const created = await lead.client.flight({
    cmd: 'flight.create',
    args: { name: 'Enfield', open: true },
  });
  if (!created.ok) throw new Error(created.error.text);
  const flightId = lead.store.get('flight').own?.flightId ?? '';
  await wing.client.flight({ cmd: 'flight.join', args: { flightId } });
  await until(() => lead.store.get('flight').own?.members.length === 2);
  await pump([jtac, lead, wing]);
  return { jtac, lead, wing, aoId, flightId, pid: (h: Host) => h.store.get('session').pid ?? '' };
}

/** What a host shows, without what only it keeps (ticks, its own draft, arrival times). */
function picture(h: Host) {
  const cas = h.store.get('cas');
  return {
    aos: cas.aos,
    mapEntries: cas.mapEntries,
    holds: cas.holds,
    checkIns: cas.checkIns,
    missions: h.store.get('missions').missions,
  };
}

describe('CAS through the host (P2.5)', () => {
  it('check-in → mission → clearance → BDA; the host slices match the relay', async () => {
    const { jtac, lead, wing, aoId, flightId, pid } = await scene();
    const hosts = [jtac, lead, wing];

    // --- The brief draft: live fields from the flight, entered fields kept ---
    await until(() => (lead.store.get('cas').briefDraft?.brief.ordnance.length ?? 0) > 0);
    await until(
      () =>
        lead.store.get('cas').briefDraft?.brief.ordnance.find((o) => o.name === 'GBU-12')?.count ===
        4,
    );
    await ok(lead, {
      cmd: 'cas.setBrief',
      args: {
        changes: {
          playtimeMin: 40,
          capabilities: ['tgp', 'laser'],
          abortCode: 'LOBSTER',
          laserCodes: { flight: 1688, perAircraft: {} },
        },
        reset: [],
      },
    });
    const draft = lead.store.get('cas').briefDraft;
    expect(draft?.brief).toMatchObject({
      callsign: 'Enfield 1',
      aircraft: [
        { pid: pid(lead), type: 'FA-18C_hornet' },
        { pid: pid(wing), type: 'FA-18C_hornet' },
      ],
      ordnance: [
        { name: 'GBU-12', count: 4 },
        { name: 'AIM-9X', count: 2 },
        { name: 'Gun (rounds)', count: 978 },
      ],
      playtimeMin: 40,
    });
    expect(draft?.edited).toEqual([]);
    // Live fields refreshed at sending; a typed-over one stays.
    await ok(lead, {
      cmd: 'cas.setBrief',
      args: { changes: { callsign: 'ENFIELD ONE' }, reset: [] },
    });
    inSlot(lead, 'FA-18C_hornet', 'Enfield 1-1', hornet(42.25, 578), 51_100);

    // --- Check-in to the JTAC (§9.2) ------------------------------------------
    await ok(lead, { cmd: 'cas.checkIn', args: { target: { scope: 'pid', id: pid(jtac) } } });
    await until(() => jtac.store.get('cas').checkIns.length === 1);
    const checkIn = jtac.store.get('cas').checkIns[0];
    expect(checkIn).toMatchObject({ flightId, aoId, primary: pid(jtac) });
    expect(checkIn?.brief.callsign).toBe('ENFIELD ONE');
    expect(checkIn?.brief.position?.lat).toBe(42.25);
    await until(() => wing.store.get('cas').checkIns.length === 1);

    // --- A Type 2 mission, assigned to the flight -----------------------------
    await ok(jtac, { cmd: 'fm.create', args: { ...content(), aoId } });
    const missionId = jtac.store.get('missions').missions[0]?.missionId ?? '';
    await ok(jtac, { cmd: 'fm.assign', args: { missionId, assignee: { flightId, pids: null } } });
    await ok(jtac, { cmd: 'fm.brief', args: { missionId } });
    await ok(jtac, { cmd: 'fm.readbackCorrect', args: { missionId } });
    await ok(jtac, { cmd: 'fm.correlated', args: { missionId, pid: pid(lead) } });
    await ok(jtac, { cmd: 'fm.clear', args: { missionId, pid: pid(lead), kind: 'hot' } });
    const mission = (h: Host): FireMission | undefined =>
      h.store.get('missions').missions.find((m) => m.missionId === missionId);
    await until(() => mission(lead)?.lanes[0]?.state === 'cleared');
    expect(mission(jtac)?.lanes.map((l) => [l.pid, l.state])).toEqual([
      [pid(lead), 'cleared'],
      [pid(wing), 'open'],
    ]);
    // Each pilot only his own lane, no warnings.
    expect(mission(lead)?.lanes.map((l) => l.pid)).toEqual([pid(lead)]);
    expect(mission(wing)?.lanes.map((l) => [l.pid, l.state])).toEqual([[pid(wing), 'open']]);

    // --- Ticks (§1.2): the clearance reached the lead's app ---------------------
    await pump(hosts);
    // The clearance's ticks name its mission and lane, so the lane can show them.
    const clear = jtac.store.get('cas').deliveries.at(-1);
    expect(clear).toMatchObject({ type: 'fm.clear', ref: missionId, pid: pid(lead) });
    const clearId = clear?.id ?? '';
    await until(() => {
      const d = jtac.store.get('cas').deliveries.find((x) => x.id === clearId);
      return d?.relay === true && d.receivedBy.includes(pid(lead));
    });
    // Mission time (§1.4): the JTAC runs no DCS, so the clearance's comes from the pilots' clock.
    expect(mission(lead)?.lanes[0]?.runs[0]?.clearance.mtime).not.toBeNull();

    // --- Off target, BDA, the pilot acknowledges, complete --------------------
    await ok(jtac, { cmd: 'fm.waitingBda', args: { missionId, pid: pid(lead) } });
    await ok(jtac, {
      cmd: 'fm.bda',
      args: {
        missionId,
        pid: pid(lead),
        target: '2x BMP-2',
        effect: 'destroyed',
        location: null,
        mtime: null,
        remarks: '',
      },
    });
    await until(() => mission(lead)?.lanes[0]?.state === 'bda');
    await ok(lead, { cmd: 'fm.ackBda', args: { missionId } });
    await until(() => mission(jtac)?.lanes[0]?.bda?.acked === true);

    // --- Situation update and COPY, a hold and WILCO, a fuel call ------------
    await ok(jtac, {
      cmd: 'cas.sitUpdate',
      args: {
        aoId,
        flightId,
        update: {
          threats: { text: 'SA-8 north', cmIds: [] },
          targets: { text: '', cmIds: [] },
          friendlies: { text: '', cmIds: [] },
          fires: '',
          clearanceAuthority: 'Axeman 11',
          restrictions: '',
          hazards: '',
        },
      },
    });
    await until(() => wing.store.get('cas').sitUpdates.length === 1);
    const noteId = wing.store.get('cas').sitUpdates[0]?.id ?? '';
    expect(jtac.store.get('cas').sitUpdates.map((n) => n.id)).toEqual([noteId]);
    await ok(wing, { cmd: 'cas.sitCopy', args: { id: noteId } });
    await until(() => jtac.store.get('cas').sitUpdates[0]?.copied === true);
    expect(wing.store.get('cas').sitUpdates[0]?.copied).toBe(true);

    await ok(jtac, {
      cmd: 'cas.hold.assign',
      args: {
        flightId,
        point: { lat: 42.4, lon: 41.6 },
        floor: { m: 4572, ref: 'msl' },
        ceiling: { m: 5182, ref: 'msl' },
        turns: 'left',
        shape: 'orbit',
        radiusM: 5556,
        legM: null,
        inboundDeg: null,
        from: null,
        until: null,
        visibility: 'ao',
      },
    });
    await until(() => lead.store.get('cas').holds.length === 1);
    const holdId = lead.store.get('cas').holds[0]?.holdId ?? '';
    await ok(lead, { cmd: 'cas.hold.wilco', args: { holdId } });
    await until(() =>
      jtac.store.get('cas').holdWilcos.some((w) => w.holdId === holdId && w.pid === pid(lead)),
    );

    await ok(wing, { cmd: 'fuel.call', args: { call: 'bingo' } });
    for (const h of [lead, jtac]) {
      await until(() => h.store.get('fuelCalls').received.some((c) => c.pid === pid(wing)));
    }
    expect(lead.store.get('fuelCalls').received[0]).toMatchObject({
      callsign: 'Enfield 1-2',
      call: 'bingo',
      internalKg: 2900,
    });
    expect(wing.store.get('fuelCalls').sent.map((s) => s.call)).toEqual(['bingo']);

    await ok(jtac, { cmd: 'fm.complete', args: { missionId } });
    await until(() => mission(wing)?.state === 'complete');

    // --- The CAS log copy (§12.1): each host what it may export --------------
    await until(() => jtac.store.get('casLog').entries.some((e) => e.kind === 'fm.complete'));
    await until(() => lead.store.get('casLog').entries.some((e) => e.kind === 'fm.complete'));
    await until(() => wing.store.get('casLog').entries.some((e) => e.kind === 'fm.complete'));
    expect(jtac.store.get('casLog').entries).toEqual(
      relay.casLog('blue').filter((e) => e.aoId === aoId),
    );
    for (const p of [lead, wing]) {
      const entries = p.store.get('casLog').entries;
      expect(
        entries.every((e) => e.flightId === flightId && (e.pid === null || e.pid === pid(p))),
      ).toBe(true);
    }
    expect(lead.store.get('casLog').entries.some((e) => e.kind === 'fm.clear')).toBe(true);
    expect(wing.store.get('casLog').entries.some((e) => e.kind === 'fm.clear')).toBe(false);

    // --- The host slices match the relay: drop every link, rejoin, compare ---
    await pump(hosts);
    const before = hosts.map(picture);
    relay.shutdown();
    for (const h of hosts) await until(() => h.store.get('session').state === 'reconnecting');
    for (const h of hosts) await until(() => h.store.get('session').state === 'joined', 6000);
    await pump(hosts);
    expect(hosts.map(picture)).toEqual(before);
  }, 20_000);

  it('the slot decides the role while there is one (§5)', async () => {
    const h = host('jtac-in-a-jet');
    inSlot(h, 'FA-18C_hornet', 'Enfield 1-1', null, 51_000);
    await h.client.join(join_('X', 'jtac'), relay);
    expect(h.store.get('session').role).toBe('pilot');
    inSlot(h, 'forward_observer', 'JTAC', null, 51_000);
    h.client.tick();
    expect(h.store.get('session').role).toBe('jtac');
    h.store.update({ ownship: { ...h.store.get('ownship'), aircraft: null } });
    h.client.tick();
    expect(h.store.get('session').role).toBe('jtac');
  });

  it('every message carries the mission time while a mission runs (§1.4)', async () => {
    const { lead, aoId } = await scene();
    await ok(lead, { cmd: 'cas.checkIn', args: { target: { scope: 'ao', id: aoId } } });
    // The relay's clock anchor follows the lead's DCS clock.
    expect(relay.missionTime('blue')).toBeGreaterThanOrEqual(51_000);
    expect(relay.missionTime('blue')).toBeLessThan(51_010);
  });

  it('JOKER/BINGO: the default bingo, the prompt on the own dash, never sent by itself', async () => {
    const h = host('fuel');
    inSlot(h, 'FA-18C_hornet', 'Enfield 1-1', hornet(42.2, 0), 51_000);
    h.client.tick();
    expect(h.store.get('fuelCalls')).toMatchObject({ jokerKg: null, prompt: null });
    expect((h.store.get('fuelCalls').bingoKg ?? 0) / KG_PER_LB).toBeCloseTo(2000, 6);
    await ok(h, { cmd: 'fuel.setLevels', args: { jokerKg: 3000, bingoKg: 2000 } });
    expect(h.store.get('fuelCalls').prompt).toBe('joker');
    await ok(h, { cmd: 'fuel.dismiss', args: {} });
    h.client.tick();
    expect(h.store.get('fuelCalls').prompt).toBeNull();
    const low = hornet(42.2, 0);
    if (low.fuel) low.fuel.internalKg = 1900;
    inSlot(h, 'FA-18C_hornet', 'Enfield 1-1', low, 51_000);
    h.client.tick();
    expect(h.store.get('fuelCalls').prompt).toBe('bingo');
    expect(h.store.get('fuelCalls').sent).toEqual([]);
    // Another aircraft = a new sortie: back to the defaults.
    inSlot(h, 'AH-64D_BLK_II', 'Boar 1-1', low, 51_000);
    h.client.tick();
    expect((h.store.get('fuelCalls').bingoKg ?? 0) / KG_PER_LB).toBeCloseTo(750, 6);
    expect(h.store.get('fuelCalls').jokerKg).toBeNull();
  });

  it('CAS commands need a session; host-only ones don’t', async () => {
    const h = host('alone');
    const outcome = await h.run({ cmd: 'fm.brief', args: { missionId: 'm_1' } });
    expect(outcome).toMatchObject({ ok: false, error: { code: 'notConnected' } });
    expect((await h.run({ cmd: 'fuel.dismiss', args: {} })).ok).toBe(true);
    const relayError = await (async () => {
      const { lead } = await scene();
      return lead.run({ cmd: 'fm.brief', args: { missionId: 'm_99' } });
    })();
    expect(relayError).toMatchObject({ ok: false, error: { code: 'relayError' } });
  });
});
