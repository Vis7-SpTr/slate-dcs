// SPDX-License-Identifier: GPL-3.0-or-later
// CAS demo data (P2.5, D9) for the P2 screens before a real session: a
// pilot's picture with `--demo` (Enfield 1-1, checked in, cleared hot) and a
// JTAC's with `--demo=jtac` (Axeman 11 working the AO with two flights). The
// same AO and mission seen from both sides; a pilot's mission has only his
// own lane, as the relay would send it. Never used in a real session.

import { defaultBingoKg } from '@slate-dcs/shared';
import type {
  Ao,
  CasLogSlice,
  CasSlice,
  CheckIn,
  CheckInBrief,
  FireMission,
  FlightSlice,
  FuelCallsSlice,
  Hold,
  LogEntry,
  MapEntry,
  MissionContent,
  SessionSlice,
} from '@slate-dcs/shared';

import type { StateStore } from './state/store.js';

export type DemoKind = 'pilot' | 'jtac';

const JTAC = 'p_9c11aa';
const JTAC_2 = 'p_4d2e10';
const LEAD = 'p_7f3a9c';
const WING = 'p_2b81de';
const COLT_1 = 'p_5e7d20';
const COLT_2 = 'p_6f1a33';
const ENFIELD = 'f_3k9q2m';
const COLT = 'f_8h2w4n';
const AO_ID = 'a_4m2k9q';
const IP = 'c_ip_01';
const KEYHOLE = 'c_kh_01';
const THREAT = 'c_51e0b2';
const FRIENDLY = 'c_fr_02';

/** Mission time of the demo: about 08:30 local (demo.ts). */
const MT = 8 * 3600 + 30 * 60;

function ao(jtac: boolean, now: number): Ao {
  return {
    aoId: AO_ID,
    joinCode: jtac ? 'Q4T-8MZ' : null,
    name: 'AO HAMMER',
    type: 'circle',
    center: { lat: 42.205, lon: 41.71 },
    radiusM: 18_520,
    lengthM: null,
    widthM: null,
    headingDeg: null,
    points: null,
    floor: { m: 0, ref: 'sfc' },
    ceiling: { m: 6096, ref: 'msl' },
    jtacs: [
      {
        pid: JTAC,
        callsign: 'Axeman 11',
        since: now - 40 * 60_000,
        presence: 'online',
        freqs: [
          { mhz: 251, label: 'AXEMAN PRI' },
          { mhz: 30.5, label: 'FM' },
        ],
      },
      {
        pid: JTAC_2,
        callsign: 'Pontiac 21',
        since: now - 15 * 60_000,
        presence: 'online',
        freqs: [{ mhz: 255.5, label: 'PONTIAC' }],
      },
    ],
    inCommand: JTAC,
  };
}

function entry(
  cmId: string,
  kind: MapEntry['kind'],
  label: string,
  geom: { lat: number; lon: number },
  extra: Partial<MapEntry> = {},
): MapEntry {
  return {
    cmId,
    author: JTAC,
    kind,
    shape: 'point',
    geom,
    label,
    text: null,
    ringM: null,
    count: null,
    moving: null,
    observedMtime: null,
    block: null,
    aoId: AO_ID,
    visibility: 'ao',
    ...extra,
  } as MapEntry;
}

const MAP_ENTRIES: MapEntry[] = [
  entry(IP, 'ip', 'HAMMER', { lat: 42.29, lon: 41.6 }),
  entry(KEYHOLE, 'keyhole', 'ROCK', { lat: 42.22, lon: 41.74 }),
  entry(
    THREAT,
    'threat',
    'SA-8',
    { lat: 42.28, lon: 41.79 },
    {
      ringM: 9000,
      observedMtime: MT - 600,
      aoId: null,
      visibility: 'coalition',
    },
  ),
  entry(
    FRIENDLY,
    'friendly',
    'PLT 2',
    { lat: 42.213, lon: 41.742 },
    { text: 'Dismounted, south of the treeline' },
  ),
];

function brief(
  callsign: string,
  lead: string,
  wing: string,
  code: number,
  type = 'FA-18C_hornet',
): CheckInBrief {
  return {
    callsign,
    aircraft: [
      { pid: lead, type },
      { pid: wing, type },
    ],
    position: { lat: 41.6123, lon: 41.6391, altMsl: 4572 },
    ordnance: [
      { name: 'GBU-12', count: 8 },
      { name: 'AGM-65F Maverick', count: 4 },
      { name: 'AIM-9X', count: 4 },
      { name: 'Gun (rounds)', count: 1156 },
    ],
    playtimeMin: 40,
    capabilities: ['tgp', 'laser', 'datalink'],
    abortCode: 'LOBSTER',
    missionNumber: '4021',
    laserCodes: { flight: code, perAircraft: code === 1688 ? { [wing]: 1687 } : {} },
    remarks: '',
  };
}

function checkIn(
  flightId: string,
  b: CheckInBrief,
  since: number,
  primary: string | null,
): CheckIn {
  return { checkInId: `ci_${flightId.slice(2)}`, flightId, aoId: AO_ID, primary, brief: b, since };
}

const HOLD: Hold = {
  holdId: 'h_77a1c0',
  aoId: AO_ID,
  flightId: ENFIELD,
  point: { cmId: KEYHOLE, axis: 'A', distanceNm: 8 },
  floor: { m: 4572, ref: 'msl' },
  ceiling: { m: 5181, ref: 'msl' },
  turns: 'left',
  shape: 'racetrack',
  radiusM: null,
  legM: 9260,
  inboundDeg: 270,
  from: MT - 900,
  until: null,
  visibility: 'ao',
  conflicts: [],
};

function content(control: 1 | 2 | 3, code: number | null): MissionContent {
  return {
    gamePlan: {
      control,
      method: 'BOT',
      effects: 'Destroy',
      ordnance: 'GBU-12 x2',
      interval: '1 min',
    },
    nineLine: {
      ipBp: { cmId: IP },
      headingDeg: 95,
      offset: 'left',
      distanceM: 11_100,
      elevationM: 412,
      description: '2x BMP-2 in treeline',
      location: { lat: 42.2203, lon: 41.7431 },
      locationText: '37T GG 26400 77879',
      mark:
        code === null
          ? { type: 'none', code: null, source: null, at: null, text: '' }
          : { type: 'laser', code, source: { kind: 'jtac', pid: JTAC }, at: null, text: '' },
      friendlies: { text: 'PLT 2, south 800 m', cmIds: [FRIENDLY] },
      egress: 'North, climb to block',
    },
    remarks: {
      ltl: 210,
      finalAttackHeading: { fromDeg: 60, toDeg: 120 },
      dangerClose: false,
      tot: null,
      restrictions: ['No release east of MSR'],
      hazards: 'SA-8 north of the river',
      text: '',
    },
  };
}

/** Enfield's Type 2: the lead cleared hot, the wing correlated – as the JTAC sees it. */
function mission(now: number): FireMission {
  return {
    ...content(2, 1688),
    missionId: 'm_8d21f0',
    aoId: AO_ID,
    owner: JTAC,
    inCommand: JTAC,
    commandOffer: null,
    revision: 3,
    state: 'readbackCorrect',
    assignee: { flightId: ENFIELD, pids: null },
    changes: [
      { rev: 3, fields: ['nineLine.egress'], old: { 'nineLine.egress': 'North' }, ackedBy: [LEAD] },
    ],
    lanes: [
      {
        pid: LEAD,
        state: 'cleared',
        spi: { lat: 42.2201, lon: 41.7427, elevM: 410 },
        runs: [
          {
            run: 1,
            clearance: { kind: 'hot', ts: now - 40_000, mtime: MT - 40, by: JTAC },
            abort: null,
          },
        ],
        bda: null,
        warnings: [],
      },
      {
        pid: WING,
        state: 'correlated',
        spi: { lat: 42.2204, lon: 41.743, elevM: 412 },
        runs: [],
        bda: null,
        // The wing's own code is 1687, line 7 says 1688: the JTAC sees it, the pilot doesn't.
        warnings: [{ kind: 'codeMismatch', code: 1688, weaponCode: 1687 }],
      },
    ],
    window: null,
    voiceOnly: false,
  };
}

/** Colt's Type 3, still a draft. */
const COLT_MISSION: FireMission = {
  ...content(3, null),
  missionId: 'm_3c0b77',
  aoId: AO_ID,
  owner: JTAC_2,
  inCommand: JTAC_2,
  commandOffer: null,
  revision: 1,
  state: 'draft',
  assignee: null,
  changes: [],
  lanes: [],
  window: null,
  voiceOnly: false,
};

/** A pilot's view (§10.1): only his own lane, no warnings, only his own acks. */
function pilotView(m: FireMission, pid: string): FireMission {
  return {
    ...m,
    lanes: m.lanes.filter((l) => l.pid === pid).map((l) => ({ ...l, warnings: [] })),
    changes: m.changes.map((c) => ({ ...c, ackedBy: c.ackedBy.filter((p) => p === pid) })),
  };
}

function log(now: number, jtac: boolean): LogEntry[] {
  const at = (
    seq: number,
    minutesAgo: number,
    e: Omit<LogEntry, 'seq' | 'rts' | 'mtime'>,
  ): LogEntry => ({
    ...e,
    seq,
    rts: now - minutesAgo * 60_000,
    mtime: MT - minutesAgo * 60,
  });
  const base = { aoId: AO_ID, flightId: ENFIELD, missionId: null, pid: null };
  const mission = { ...base, area: 'mission' as const, missionId: 'm_8d21f0' };
  const entries: (LogEntry & { jtacOnly?: boolean })[] = [
    at(12, 40, {
      ...base,
      flightId: null,
      area: 'ao',
      kind: 'jtac.onStation',
      actor: JTAC,
      actorName: 'Axeman 11',
      summary: 'Axeman 11: on-station – new AO HAMMER (circle 10 NM, SFC – 20000 ft MSL)',
    }),
    at(20, 22, {
      ...base,
      area: 'checkIn',
      kind: 'cas.checkIn',
      actor: LEAD,
      actorName: 'Enfield 1-1',
      summary:
        'Enfield 1-1: Enfield 1 checked in to AO HAMMER, primary Axeman 11 – 2× F/A-18C · 8× GBU-12, 4× AGM-65F Maverick, 4× AIM-9X · 40 min · codes 1688 · abort LOBSTER · mission 4021',
    }),
    at(23, 20, {
      ...base,
      area: 'situation',
      kind: 'cas.hold.assign',
      actor: JTAC,
      actorName: 'Axeman 11',
      summary:
        'Axeman 11: hold assigned: Enfield 1 at ROCK ALPHA 8, 15000 ft MSL – 17000 ft MSL, racetrack 5 NM inbound 270° left turns, 08:15:00 L – open',
    }),
    at(31, 9, {
      ...mission,
      kind: 'fm.create',
      actor: JTAC,
      actorName: 'Axeman 11',
      summary: 'Axeman 11: mission created (Type 2 BOT) – 2x BMP-2 in treeline',
    }),
    at(32, 8, {
      ...mission,
      kind: 'fm.assign',
      actor: JTAC,
      actorName: 'Axeman 11',
      summary: 'Axeman 11: assigned to Enfield 1 (Enfield 1-1, Enfield 1-2)',
    }),
    at(35, 4, {
      ...mission,
      kind: 'fm.readbackCorrect',
      actor: JTAC,
      actorName: 'Axeman 11',
      summary: 'Axeman 11: READBACK CORRECT',
    }),
    at(36, 2, {
      ...mission,
      kind: 'fm.correlated',
      actor: JTAC,
      actorName: 'Axeman 11',
      summary: 'Axeman 11: Enfield 1-1 correlated',
      pid: LEAD,
    }),
    at(38, 1, {
      ...mission,
      kind: 'fm.clear',
      actor: JTAC,
      actorName: 'Axeman 11',
      summary: 'Axeman 11: CLEARED HOT Enfield 1-1 (run 1)',
      pid: LEAD,
    }),
    at(39, 1, {
      ...mission,
      kind: 'fm.correlated',
      actor: JTAC,
      actorName: 'Axeman 11',
      summary: 'Axeman 11: Enfield 1-2 correlated',
      pid: WING,
    }),
  ];
  // A pilot keeps what he may export (§12.3): his flight's missions and check-ins, his own lane.
  return jtac
    ? entries
    : entries.filter(
        (e) =>
          e.flightId === ENFIELD &&
          (e.area === 'mission' || e.area === 'checkIn') &&
          (e.pid === null || e.pid === LEAD),
      );
}

/** The CAS slices, the session and the flight of the demo. */
export function demoCas(kind: DemoKind, now: number) {
  const jtac = kind === 'jtac';
  const enfield = brief('Enfield 1', LEAD, WING, 1688);
  const colt = brief('Colt 1', COLT_1, COLT_2, 1511, 'F-16C_50');
  const participants: SessionSlice['participants'] = [
    {
      pid: JTAC,
      nick: 'Axeman',
      role: 'jtac',
      aircraft: { type: 'forward_observer' },
      presence: 'online',
    },
    { pid: JTAC_2, nick: 'Pontiac', role: 'jtac', aircraft: null, presence: 'online' },
    {
      pid: LEAD,
      nick: 'Demo Pilot',
      role: 'pilot',
      aircraft: { type: 'FA-18C_hornet' },
      presence: 'online',
    },
    {
      pid: WING,
      nick: 'Wing',
      role: 'pilot',
      aircraft: { type: 'FA-18C_hornet' },
      presence: 'online',
    },
    {
      pid: COLT_1,
      nick: 'Colt',
      role: 'pilot',
      aircraft: { type: 'F-16C_50' },
      presence: 'online',
    },
  ];
  const session: SessionSlice = {
    state: 'joined',
    relay: { address: 'demo.relay:7790', name: 'slate-relay demo', own: false },
    pid: jtac ? JTAC : LEAD,
    coalition: 'blue',
    nick: jtac ? 'Axeman' : 'Demo Pilot',
    role: jtac ? 'jtac' : 'pilot',
    participants,
    fingerprintCheck: null,
    error: null,
    announced: null,
  };
  // A JTAC gets the full status of checked-in aircraft (§6.4): fuel and age on the cards.
  const status = (pid: string, lat: number, internalKg: number, ageS: number) => ({
    pid,
    status: {
      pos: { lat, lon: 41.62, altMsl: 4900, altAgl: 4700 },
      hdg: 270,
      hdgMag: 264,
      gs: 190,
      ias: 160,
      fuel: { internalKg, externalKg: 0, source: 'export' as const },
      armament: null,
      avail: { pos: true, fuel: true, payload: false },
      reason: 'heartbeat' as const,
    },
    receivedAt: now - ageS * 1000,
  });
  const flight: FlightSlice = jtac
    ? {
        own: null,
        open: [],
        status: [
          status(LEAD, 42.3, 2900, 4),
          status(WING, 42.31, 1814, 7),
          status(COLT_1, 42.36, 2100, 3),
          status(COLT_2, 42.37, 2050, 12),
        ],
      }
    : {
        own: {
          flightId: ENFIELD,
          name: 'Enfield',
          number: 1,
          display: 'Enfield 1',
          open: true,
          members: [
            { pid: LEAD, pos: 1, presence: 'online', aircraft: { type: 'FA-18C_hornet' } },
            { pid: WING, pos: 2, presence: 'online', aircraft: { type: 'FA-18C_hornet' } },
          ],
          inCommand: LEAD,
          moveUp: null,
          privateCode: null,
        },
        open: [],
        status: [],
      };
  const note = {
    id: '01JABD2K7Q0M3N4P5R6S7T8V9W',
    aoId: AO_ID,
    flightId: ENFIELD,
    from: JTAC,
    update: {
      threats: { text: 'SA-8 north of the river', cmIds: [THREAT] },
      targets: { text: '2x BMP-2 in treeline', cmIds: [] },
      friendlies: { text: 'PLT 2, south 800 m', cmIds: [FRIENDLY] },
      fires: 'None',
      clearanceAuthority: 'Axeman 11',
      restrictions: 'No release east of MSR',
      hazards: '',
    },
    receivedAt: now - 18 * 60_000,
    copied: !jtac,
  };
  const cas: CasSlice = {
    aos: [ao(jtac, now)],
    mapEntries: MAP_ENTRIES,
    holds: [HOLD],
    checkIns: jtac
      ? [
          checkIn(ENFIELD, enfield, now - 22 * 60_000, JTAC),
          checkIn(COLT, colt, now - 6 * 60_000, JTAC_2),
        ]
      : [checkIn(ENFIELD, enfield, now - 22 * 60_000, JTAC)],
    sitUpdates: [{ ...note, copied: true }],
    briefDraft: jtac ? null : { brief: enfield, edited: [] },
    deliveries: jtac
      ? [
          {
            id: '01JABD2K7Q0M3N4P5R6S7T8V9X',
            type: 'fm.clear',
            ref: 'm_8d21f0',
            pid: LEAD,
            at: now - 40_000,
            relay: true,
            receivedBy: [LEAD],
          },
        ]
      : [],
    holdWilcos: [{ holdId: HOLD.holdId, pid: LEAD, at: now - 19 * 60_000 }],
  };
  const missions = jtac ? [mission(now), COLT_MISSION] : [pilotView(mission(now), LEAD)];
  const casLog: CasLogSlice = { entries: log(now, jtac) };
  const fuelCalls: FuelCallsSlice = jtac
    ? {
        jokerKg: null,
        bingoKg: null,
        prompt: null,
        sent: [],
        received: [
          {
            pid: WING,
            callsign: 'Enfield 1-2',
            call: 'joker',
            internalKg: 1814,
            receivedAt: now - 3 * 60_000,
          },
        ],
      }
    : {
        jokerKg: 1814,
        bingoKg: defaultBingoKg('FA-18C_hornet'),
        prompt: null,
        sent: [],
        received: [
          {
            pid: WING,
            callsign: 'Enfield 1-2',
            call: 'joker',
            internalKg: 1814,
            receivedAt: now - 3 * 60_000,
          },
        ],
      };
  return { session, flight, cas, missions: { missions }, casLog, fuelCalls };
}

/** Fills the CAS demo into the store (after the P1 demo data). */
export function applyDemoCas(store: StateStore, kind: DemoKind, now: number): void {
  store.update(demoCas(kind, now));
  if (kind === 'jtac') {
    store.update({
      ownship: {
        ...store.get('ownship'),
        aircraft: { type: 'forward_observer', unit: 'Axeman 11', slot: '1000101' },
        status: {
          ...(store.get('ownship').status ?? ({} as never)),
          pos: { lat: 42.1985, lon: 41.735, altMsl: 112, altAgl: 0 },
          hdg: 0,
          hdgMag: null,
          gs: 0,
          ias: null,
          fuel: null,
          armament: null,
          avail: { pos: true, fuel: false, payload: false },
          reason: 'heartbeat',
        },
      },
    });
  }
}
