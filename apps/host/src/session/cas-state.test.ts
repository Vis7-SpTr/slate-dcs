// SPDX-License-Identifier: GPL-3.0-or-later
// The host's CAS picture rule by rule (P2.5): what each relay message does to
// the slices, the snapshot, the brief draft and the CAS log copy.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultSlices } from '@slate-dcs/shared';
import type { CasSlice, FireMission, LogEntry, Message } from '@slate-dcs/shared';
import { describe, expect, it } from 'vitest';

import { StateStore } from '../state/store.js';
import { BriefDraft, ordnanceTotals } from './brief.js';
import { CasLogCopy } from './cas-log-copy.js';
import { CasState } from './cas-state.js';

const ME = { pid: 'p_000001', role: 'pilot' };
const JTAC = { pid: 'p_000009', role: 'jtac' };
const AO = 'a_000001';
const FLIGHT = 'f_000001';
const ID1 = '01JABD2K7Q0M3N4P5R6S7T8V9W';
const ID2 = '01JABD2K7Q0M3N4P5R6S7T8V9X';

function setup() {
  const store = new StateStore(defaultSlices('test'));
  return { store, cas: new CasState(store, () => 1000) };
}

let n = 0;
function msg<T extends Message['type']>(
  type: T,
  body: Extract<Message, { type: T }>['body'],
  extra: Partial<Message> = {},
): Message {
  n += 1;
  return {
    v: 1,
    id: `01JABD2K7Q0M3N4P5R6S7T${String(n).padStart(4, '0')}`,
    type,
    from: 'relay',
    session: 'blue',
    to: { scope: 'ao', id: AO },
    ts: 1,
    ack: false,
    re: null,
    body,
    ...extra,
  } as Message;
}

const ao = {
  aoId: AO,
  joinCode: null,
  name: 'AO AXEMAN',
  type: 'circle' as const,
  center: { lat: 42, lon: 41 },
  radiusM: 18_520,
  lengthM: null,
  widthM: null,
  headingDeg: null,
  points: null,
  floor: { m: 0, ref: 'sfc' as const },
  ceiling: { m: 6096, ref: 'msl' as const },
  jtacs: [
    { pid: JTAC.pid, callsign: 'Axeman 11', since: 1, presence: 'online' as const, freqs: [] },
  ],
  inCommand: JTAC.pid,
};

const entry = (cmId: string, visibility: 'ao' | 'coalition') => ({
  cmId,
  author: JTAC.pid,
  kind: 'threat' as const,
  shape: 'point' as const,
  geom: { lat: 42.2203, lon: 41.7431 },
  label: 'SA-8',
  text: null,
  ringM: 9000,
  count: null,
  moving: null,
  observedMtime: 51000,
  block: null,
  aoId: AO,
  visibility,
});

const hold = {
  holdId: 'h_1',
  aoId: AO,
  flightId: FLIGHT,
  point: { lat: 42, lon: 41 },
  floor: { m: 4572, ref: 'msl' as const },
  ceiling: { m: 5182, ref: 'msl' as const },
  turns: 'left' as const,
  shape: 'orbit' as const,
  radiusM: 5556,
  legM: null,
  inboundDeg: null,
  from: null,
  until: null,
  visibility: 'ao' as const,
  conflicts: [],
};

function mission(state: FireMission['state'], missionId = 'm_1'): FireMission {
  return {
    missionId,
    aoId: AO,
    owner: JTAC.pid,
    inCommand: JTAC.pid,
    commandOffer: null,
    revision: 1,
    state,
    assignee: { flightId: FLIGHT, pids: null },
    gamePlan: null,
    nineLine: null,
    remarks: {
      ltl: null,
      finalAttackHeading: null,
      dangerClose: false,
      tot: null,
      restrictions: [],
      hazards: '',
      text: '',
    },
    changes: [],
    lanes: [],
    window: null,
    voiceOnly: false,
  };
}

/** Puts the AO, an AO-only and a coalition entry and a hold into the picture. */
function picture(cas: CasState, me = ME): void {
  const name = () => 'X';
  cas.apply(msg('ao.created', ao), me, name);
  cas.apply(msg('cm.created', entry('c_ao', 'ao')), me, name);
  cas.apply(msg('cm.created', entry('c_co', 'coalition')), me, name);
  cas.apply(msg('cas.hold.updated', hold), me, name);
}

describe('relay messages', () => {
  it('an AO closing takes everything tied to it', () => {
    const { store, cas } = setup();
    picture(cas);
    cas.apply(msg('fm.updated', mission('assigned')), ME, () => 'X');
    cas.apply(msg('ao.closed', { aoId: AO }), ME, () => 'X');
    const slice: CasSlice = store.get('cas');
    expect([slice.aos, slice.mapEntries, slice.holds, store.get('missions').missions]).toEqual([
      [],
      [],
      [],
      [],
    ]);
  });

  it('checked out: a pilot loses the AO-only entries and holds, its JTAC keeps them (§8.4)', () => {
    const checkedOut = msg('cas.checkedOut', {
      checkInId: 'ci_1',
      flightId: FLIGHT,
      aoId: AO,
      by: 'flight',
    });
    const pilot = setup();
    picture(pilot.cas);
    pilot.cas.apply(checkedOut, ME, () => 'X');
    expect(pilot.store.get('cas').mapEntries.map((e) => e.cmId)).toEqual(['c_co']);
    expect(pilot.store.get('cas').holds).toEqual([]);
    const jtac = setup();
    picture(jtac.cas, JTAC);
    jtac.cas.apply(checkedOut, JTAC, () => 'X');
    expect(jtac.store.get('cas').mapEntries).toHaveLength(2);
    expect(jtac.store.get('cas').holds).toHaveLength(1);
  });

  it('ticks: sent, the relay’s receipt, each recipient once', () => {
    const { store, cas } = setup();
    cas.sent(ID1);
    cas.receipt(ID1);
    cas.received(ID1, 'p_2');
    cas.received(ID1, 'p_2');
    cas.received(ID2, 'p_2');
    expect(store.get('cas').deliveries).toEqual([
      { id: ID1, type: '', ref: null, pid: null, at: 1000, relay: true, receivedBy: ['p_2'] },
    ]);
  });

  it('own fuel calls are not "received"', () => {
    const { store, cas } = setup();
    cas.apply(
      msg('fuel.call', { call: 'joker', internalKg: 1000 }, { from: ME.pid }),
      ME,
      () => 'X',
    );
    cas.apply(
      msg('fuel.call', { call: 'joker', internalKg: 1000 }, { from: 'p_2' }),
      ME,
      () => 'Enfield 1-2',
    );
    expect(store.get('fuelCalls').received.map((c) => c.callsign)).toEqual(['Enfield 1-2']);
  });
});

describe('the snapshot (§4.5)', () => {
  it('is the truth for open missions; closed ones this host saw stay while their AO does', () => {
    const { store, cas } = setup();
    picture(cas);
    cas.apply(msg('fm.updated', mission('complete', 'm_done')), ME, () => 'X');
    cas.apply(msg('fm.updated', mission('assigned', 'm_gone')), ME, () => 'X');
    const body = {
      asOfSeq: 10,
      participants: [],
      flights: [],
      aos: [ao],
      mapEntries: [],
      holds: [],
      checkIns: [],
      you: {
        flight: null,
        checkIn: {
          checkInId: 'ci_1',
          flightId: FLIGHT,
          aoId: AO,
          primary: null,
          brief: {
            callsign: 'Enfield 1',
            aircraft: [{ pid: ME.pid, type: 'FA-18C_hornet' }],
            position: null,
            ordnance: [],
            playtimeMin: null,
            capabilities: [],
            abortCode: null,
            missionNumber: null,
            laserCodes: { flight: null, perAircraft: {} },
            remarks: '',
          },
          since: 1,
        },
        openMissions: [mission('briefed', 'm_open')],
      },
    };
    cas.snapshot(body);
    expect(store.get('missions').missions.map((m) => m.missionId)).toEqual(['m_open', 'm_done']);
    expect(store.get('cas').checkIns.map((c) => c.checkInId)).toEqual(['ci_1']);
    expect(store.get('cas').mapEntries).toEqual([]);
    cas.snapshot({ ...body, aos: [] });
    expect(store.get('missions').missions.map((m) => m.missionId)).toEqual(['m_open']);
  });
});

describe('the brief draft (§9.1)', () => {
  function inFlight(file: string | null = null) {
    const { store } = setup();
    store.update({
      session: { ...store.get('session'), pid: ME.pid },
      flight: {
        own: {
          flightId: FLIGHT,
          name: 'Enfield',
          number: 1,
          display: 'Enfield 1',
          open: true,
          privateCode: null,
          members: [
            { pid: ME.pid, pos: 1, presence: 'online', aircraft: { type: 'FA-18C_hornet' } },
          ],
          inCommand: ME.pid,
          actingLead: null,
          moveUp: null,
        } as never,
        open: [],
        status: [],
      },
    });
    return { store, draft: new BriefDraft(store, file) };
  }

  it('keeps the entered fields across a host restart, never the live ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slate-brief-'));
    try {
      const file = join(dir, 'brief.json');
      const first = inFlight(file);
      first.draft.refresh();
      expect(
        first.draft.set(
          {
            callsign: 'ENFIELD ONE',
            playtimeMin: 40,
            abortCode: 'A1',
            laserCodes: { flight: 1688, perAircraft: {} },
          },
          [],
        ),
      ).toEqual({ ok: true });
      await first.draft.saved();
      const kept = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
      expect(kept).toMatchObject({ playtimeMin: 40, abortCode: 'A1' });
      expect(kept).not.toHaveProperty('callsign');

      // A new host run: the draft starts from what was kept, live fields fresh.
      const second = inFlight(file);
      second.draft.refresh();
      expect(second.store.get('cas').briefDraft?.brief).toMatchObject({
        callsign: 'Enfield 1',
        playtimeMin: 40,
        abortCode: 'A1',
        laserCodes: { flight: 1688 },
      });

      // A broken file counts as nothing entered.
      await writeFile(file, '{ not json');
      const third = inFlight(file);
      third.draft.refresh();
      expect(third.store.get('cas').briefDraft?.brief.playtimeMin).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('live fields follow the flight until typed over; reset gives them back', () => {
    const { store, draft } = inFlight();
    draft.refresh();
    expect(store.get('cas').briefDraft?.brief.callsign).toBe('Enfield 1');
    expect(draft.set({ callsign: 'ENFIELD ONE', playtimeMin: 30 }, [])).toEqual({ ok: true });
    expect(store.get('cas').briefDraft?.edited).toEqual(['callsign']);
    draft.refresh();
    expect(store.get('cas').briefDraft?.brief).toMatchObject({
      callsign: 'ENFIELD ONE',
      playtimeMin: 30,
    });
    expect(draft.set({}, ['callsign'])).toEqual({ ok: true });
    expect(store.get('cas').briefDraft).toMatchObject({
      brief: { callsign: 'Enfield 1', playtimeMin: 30 },
      edited: [],
    });
  });

  it('refuses a change that makes no valid brief, and needs a flight first', () => {
    const { draft } = inFlight();
    draft.refresh();
    expect(draft.set({ callsign: '' }, [])).toMatchObject({ ok: false });
    const outside = new BriefDraft(setup().store);
    expect(outside.set({ playtimeMin: 10 }, [])).toEqual({
      ok: false,
      text: 'Join a flight first',
    });
  });

  it('ordnance totals: A/G first, then A/A, the gun last', () => {
    const station = (name: string, role: 'ag' | 'aa', count: number) => ({
      st: 1,
      name,
      kind: 'missile' as const,
      role,
      count,
      source: 'export' as const,
    });
    expect(
      ordnanceTotals([
        {
          stations: [station('AIM-9X', 'aa', 2), station('GBU-12', 'ag', 2)],
          gun: { rounds: 500, source: 'export' },
          stores: [],
        },
        {
          stations: [station('GBU-12', 'ag', 1), station('AGM-65F', 'ag', 0)],
          gun: null,
          stores: [],
        },
        null,
      ]),
    ).toEqual([
      { name: 'GBU-12', count: 3 },
      { name: 'AIM-9X', count: 2 },
      { name: 'Gun (rounds)', count: 500 },
    ]);
  });
});

describe('the CAS log copy (§12.1)', () => {
  const entry = (seq: number): LogEntry => ({
    seq,
    rts: 1000 + seq,
    mtime: null,
    area: 'mission',
    kind: 'fm.clear',
    actor: 'relay',
    actorName: 'Relay',
    summary: `entry ${String(seq)}`,
    aoId: AO,
    flightId: FLIGHT,
    missionId: 'm_1',
    pid: null,
  });

  it('pages through log.entries, keeps each entry once, asks again from the newest', async () => {
    const { store } = setup();
    const asked: (number | null)[] = [];
    const pages: Record<string, { entries: LogEntry[]; next: number | null }> = {
      null: { entries: [entry(1), entry(2)], next: 3 },
      3: { entries: [entry(3)], next: null },
      4: { entries: [entry(3), entry(4)], next: null },
    };
    const copy = new CasLogCopy(store, (body) => {
      asked.push(body.from);
      return Promise.resolve(pages[String(body.from)] ?? { entries: [], next: null });
    });
    await copy.sync({ scope: 'ao', id: AO });
    expect(store.get('casLog').entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    // The newest seq is asked again (an entry may join it later); duplicates are dropped.
    pages['3'] = { entries: [entry(3), entry(4)], next: null };
    await copy.sync({ scope: 'ao', id: AO });
    expect(asked).toEqual([null, 3, 3]);
    expect(store.get('casLog').entries.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it('a refusal changes nothing and is passed on', async () => {
    const { store } = setup();
    const copy = new CasLogCopy(store, () =>
      Promise.resolve('A JTAC exports his AO, a pilot his flight'),
    );
    expect(await copy.fetch({ scope: 'ao', id: AO, from: null, to: null })).toBe(
      'A JTAC exports his AO, a pilot his flight',
    );
    expect(store.get('casLog').entries).toEqual([]);
  });
});
