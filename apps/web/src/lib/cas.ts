// SPDX-License-Identifier: GPL-3.0-or-later
// CAS helpers for the screens (P2.6): who this user is in the CAS picture,
// names, coordinates in his format, point references, times and delivery
// ticks. Pure functions over the host's slices, so they are tested without a
// browser. The screens show only what the relay sent (protocol.md §14.8).

import {
  coordStyle,
  formatLogMtime,
  formatPosition,
  keyholePoint,
  keyholePointName,
  mapUtcOffsetHours,
} from '@slate-dcs/shared';
import type {
  Ao,
  CheckIn,
  CoordStyle,
  Delivery,
  FireMission,
  LatLon,
  MapEntry,
  PointRef,
  Slices,
} from '@slate-dcs/shared';

export interface CasWho {
  pid: string | null;
  jtac: boolean;
  /** The AO he works as a JTAC, if on-station. */
  ao: Ao | null;
  /** He is the AO's JTAC in command (§8.3). */
  aoCommand: boolean;
  style: CoordStyle;
}

/** Who this user is in the CAS picture. */
export function casWho(slices: Slices): CasWho {
  const pid = slices.session.pid;
  const jtac = slices.session.role === 'jtac';
  const ao = pid ? (slices.cas.aos.find((a) => a.jtacs.some((j) => j.pid === pid)) ?? null) : null;
  return {
    pid,
    jtac,
    ao,
    aoCommand: ao !== null && ao.inCommand === pid,
    style: coordStyle(slices.ownship.aircraft?.type, jtac ? 'jtac' : 'pilot'),
  };
}

/**
 * A callsign for a pid: a JTAC's AO callsign, `Enfield 1-2` from the own
 * flight or a check-in's aircraft list (by position), else the nick.
 */
export function callsignOf(slices: Slices, pid: string): string {
  for (const ao of slices.cas.aos) {
    const jtac = ao.jtacs.find((j) => j.pid === pid);
    if (jtac) return jtac.callsign;
  }
  const own = slices.flight.own;
  const member = own?.members.find((m) => m.pid === pid);
  if (own && member) return `${own.display}-${String(member.pos)}`;
  for (const checkIn of slices.cas.checkIns) {
    const index = checkIn.brief.aircraft.findIndex((a) => a.pid === pid);
    if (index >= 0) return `${checkIn.brief.callsign}-${String(index + 1)}`;
  }
  return slices.session.participants.find((p) => p.pid === pid)?.nick ?? pid;
}

/** The check-in of a flight, if it is checked in. */
export function checkInOf(slices: Slices, flightId: string | null | undefined): CheckIn | null {
  return slices.cas.checkIns.find((c) => c.flightId === flightId) ?? null;
}

/** Callsign of a flight from its check-in or the own flight. */
export function flightName(slices: Slices, flightId: string | null | undefined): string {
  const checkIn = checkInOf(slices, flightId);
  if (checkIn) return checkIn.brief.callsign;
  const own = slices.flight.own;
  if (own && own.flightId === flightId) return own.display;
  return flightId ?? '—';
}

// ---------------------------------------------------------------------------
// Positions

/** A position in the user's format, main one first (scope §4.1). */
export function positionText(p: LatLon, style: CoordStyle): string[] {
  return formatPosition(p, style);
}

export interface PointText {
  /** `IP HAMMER`, `KEYHOLE ROCK – ALPHA 8`, or `null` for own coordinates. */
  name: string | null;
  /** Where it is, `null` if its map entry is unknown here. */
  at: LatLon | null;
}

const KIND_NAMES: Record<string, string> = {
  ip: 'IP',
  cp: 'CP',
  keyhole: 'KEYHOLE',
};

/** A point reference (§8.5) as a name and a position; keyhole points resolved in the map grid. */
export function pointText(slices: Slices, point: PointRef): PointText {
  if ('lat' in point) return { name: null, at: { lat: point.lat, lon: point.lon } };
  const entry = slices.cas.mapEntries.find((e) => e.cmId === point.cmId);
  const label = entry?.label ?? point.cmId;
  const kind = entry ? (KIND_NAMES[entry.kind] ?? entry.kind.toUpperCase()) : '';
  const echo = entry?.shape === 'point' ? entry.geom : null;
  if ('axis' in point && point.axis !== undefined) {
    const axis = keyholePointName(point.axis, point.distanceNm);
    return {
      name: `KEYHOLE ${label} – ${axis}`,
      at: echo ? keyholePoint(echo, point.axis, point.distanceNm, slices.mission.theatre) : null,
    };
  }
  return { name: `${kind} ${label}`.trim(), at: echo };
}

/** The position of a map entry for lists: a point, or a circle's centre. */
export function entryPosition(entry: MapEntry): LatLon | null {
  if (entry.shape === 'point') return entry.geom;
  if (entry.shape === 'circle') return (entry.geom as { center: LatLon }).center;
  return null;
}

// ---------------------------------------------------------------------------
// Times

/** Mission time as the user set it: `14:23:05 Z` or `L` (§0). */
export function mtimeText(slices: Slices, mtime: number | null): string {
  return formatLogMtime(mtime, {
    display: slices.settings.timeDisplay,
    utcOffsetHours: mapUtcOffsetHours(slices.mission.theatre),
  });
}

/** The mission time now, from the host's clock sample (§14.3); `null` without a mission. */
export function missionTimeNow(slices: Slices, now: number): number | null {
  const clock = slices.mission.clock;
  if (!slices.mission.running || clock === null) return null;
  return clock.mtimeSec + (clock.paused ? 0 : Math.max(0, now - clock.sampledAt) / 1000);
}

// ---------------------------------------------------------------------------
// Delivery ticks (ui-design.md §7)

export type TickLevel = 'none' | 'sent' | 'relay' | 'delivered' | 'acknowledged';

/** The newest delivery of `type` about `ref` (and `pid`), if this host sent one. */
export function deliveryOf(
  slices: Slices,
  type: string | readonly string[],
  ref: string | null,
  pid: string | null = null,
): Delivery | null {
  const types = typeof type === 'string' ? [type] : type;
  const list = slices.cas.deliveries.filter(
    (d) => types.includes(d.type) && d.ref === ref && (pid === null || d.pid === pid),
  );
  return list.at(-1) ?? null;
}

/**
 * Messenger ticks: one = the relay took it, two = delivered to `to` (or to
 * anyone, without `to`), filled = a person acknowledged it (level 3, §1.2).
 */
export function tickLevel(
  delivery: Delivery | null,
  to: readonly string[] | null,
  acknowledged: boolean,
): TickLevel {
  if (acknowledged) return 'acknowledged';
  if (!delivery) return 'none';
  const delivered =
    to === null ? delivery.receivedBy.length > 0 : to.some((p) => delivery.receivedBy.includes(p));
  if (delivered) return 'delivered';
  return delivery.relay ? 'relay' : 'sent';
}

// ---------------------------------------------------------------------------
// Missions and lasers

/** Missions sorted for the list (ui-design.md §7): needing action first, closed last. */
export function sortedMissions(missions: readonly FireMission[]): FireMission[] {
  const rank: Record<FireMission['state'], number> = {
    readbackCorrect: 0,
    briefed: 1,
    assigned: 2,
    draft: 3,
    complete: 4,
    cancelled: 5,
  };
  return [...missions].sort((a, b) => rank[a.state] - rank[b.state]);
}

export interface LaserUse {
  code: number;
  /** Who it belongs to: an aircraft's own code, a flight's, line 7's source. */
  owner: string;
  /** A flight's own code, an aircraft's, or line 7 of a mission. */
  kind: 'flight' | 'aircraft' | 'mark';
  /** Active = a lane with this laser is cleared now. */
  active: boolean;
}

/** Every laser code in the AO (Other → Lasers): the flights' codes and line 7 marks. */
export function laserUses(slices: Slices): LaserUse[] {
  const uses: LaserUse[] = [];
  const cleared = new Set(
    slices.missions.missions.flatMap((m) =>
      m.lanes.filter((l) => l.state === 'cleared').map((l) => l.pid),
    ),
  );
  for (const checkIn of slices.cas.checkIns) {
    const codes = checkIn.brief.laserCodes;
    const crew = checkIn.brief.aircraft.map((a) => a.pid);
    if (codes.flight !== null) {
      uses.push({
        code: codes.flight,
        owner: checkIn.brief.callsign,
        kind: 'flight',
        active: crew.some((p) => cleared.has(p) && codes.perAircraft[p] === undefined),
      });
    }
    for (const [pid, code] of Object.entries(codes.perAircraft)) {
      uses.push({
        code,
        owner: callsignOf(slices, pid),
        kind: 'aircraft',
        active: cleared.has(pid),
      });
    }
  }
  for (const m of slices.missions.missions) {
    const mark = m.nineLine?.mark;
    if (
      mark?.type !== 'laser' ||
      mark.code === null ||
      !mark.source ||
      mark.source.kind === 'ownship'
    ) {
      continue;
    }
    uses.push({
      code: mark.code,
      owner: `${callsignOf(slices, mark.source.pid)} (${m.missionId})`,
      kind: 'mark',
      active: m.lanes.some((l) => l.state === 'cleared'),
    });
  }
  return uses.sort((a, b) => a.code - b.code);
}

/** Codes used more than once in the AO – a hint, never blocked (§9.5). */
export function sharedCodes(uses: readonly LaserUse[]): Set<number> {
  const counts = new Map<number, number>();
  for (const use of uses) counts.set(use.code, (counts.get(use.code) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([code]) => code));
}

/**
 * A typed time of day – `1415`, `14:15`, `14:15:30` – in the user's display
 * (Zulu or local) as mission time (§0), on the mission day that lies closest
 * to now. `null` if it can't be read or there is no mission clock.
 */
export function parseMissionTime(slices: Slices, text: string, now: number): number | null {
  const match = /^\s*(\d{1,2}):?(\d{2})(?::?(\d{2}))?\s*[zZlL]?\s*$/.exec(text);
  const mtNow = missionTimeNow(slices, now);
  if (!match || mtNow === null) return null;
  const [h, m, s] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  if (h > 23 || m > 59 || s > 59) return null;
  const offset = mapUtcOffsetHours(slices.mission.theatre);
  const zulu = slices.settings.timeDisplay === 'zulu' && offset !== null;
  const ofDay = h * 3600 + m * 60 + s + (zulu ? offset * 3600 : 0);
  const day = Math.floor(mtNow / 86_400) * 86_400;
  // The day that brings it within 12 h of now: a time "just after midnight" is tomorrow.
  const candidates = [day - 86_400, day, day + 86_400].map((d) => d + ofDay).filter((t) => t >= 0);
  return candidates.reduce((best, t) => (Math.abs(t - mtNow) < Math.abs(best - mtNow) ? t : best));
}

const NM = 1852;

/** `circle 10 NM`, `SFC – 20000 ft MSL`. */
export function areaText(ao: Ao): string {
  const nm = (m: number | null) => `${String(Math.round(((m ?? 0) / NM) * 10) / 10)} NM`;
  if (ao.type === 'circle') return `circle ${nm(ao.radiusM)}`;
  if (ao.type === 'square') return `square ${nm(ao.lengthM)} × ${nm(ao.widthM)}`;
  return `polygon, ${String(ao.points?.length ?? 0)} points`;
}

/** `SFC`, `15000 ft MSL`, `500 ft AGL`. */
export function altText(a: { m: number; ref: 'sfc' | 'agl' | 'msl' }): string {
  if (a.ref === 'sfc') return 'SFC';
  return `${String(Math.round(a.m / 0.3048 / 100) * 100)} ft ${a.ref.toUpperCase()}`;
}
