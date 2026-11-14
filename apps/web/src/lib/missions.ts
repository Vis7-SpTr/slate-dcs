// SPDX-License-Identifier: GPL-3.0-or-later
// Fire-mission helpers for the screens (P2.6b): what a user may do on a
// mission and on each lane, which buttons sit in which slot, the laser a lane
// uses and the conflicts clearing it would cause, the SPI against line 6.
// Pure functions over the host's slices, tested without a browser. The relay
// decides (protocol.md §10); these only choose what to offer.

import {
  distanceM,
  formatElevationFt,
  gridConvergenceDeg,
  normalizeDegrees,
  shortBearingDeg,
} from '@slate-dcs/shared';
import type {
  CoordStyle,
  FireMission,
  GamePlan,
  Lane,
  LatLon,
  LinkedText,
  MapEntry,
  Mark,
  MissionContent,
  PointRef,
  Slices,
} from '@slate-dcs/shared';

import { callsignOf, mtimeText, pointText, positionText } from './cas.js';
import { en } from './i18n/en.js';
import type { MessageKey } from './i18n/index.js';

/** Closed missions: no step but the owner's delete (§10.8). */
export const CLOSED_STATES: ReadonlySet<FireMission['state']> = new Set(['complete', 'cancelled']);

export interface MissionRights {
  /** A JTAC working the mission's AO – he may abort any lane (§10.2). */
  jtac: boolean;
  /** The JTAC in command: every step except deleting. */
  inCommand: boolean;
  /** The creator: deletes, offers command and reclaims it. */
  owner: boolean;
  /** Command was offered to him and waits for his accept. */
  offered: boolean;
  open: boolean;
}

/** What this user may do on a mission (§10.2). */
export function missionRights(slices: Slices, m: FireMission): MissionRights {
  const pid = slices.session.pid;
  const ao = slices.cas.aos.find((a) => a.aoId === m.aoId);
  const jtac =
    slices.session.role === 'jtac' &&
    pid !== null &&
    (ao?.jtacs.some((j) => j.pid === pid) ?? false);
  const open = !CLOSED_STATES.has(m.state);
  return {
    jtac,
    inCommand: jtac && open && m.inCommand === pid,
    owner: jtac && m.owner === pid,
    offered: jtac && open && m.commandOffer === pid,
    open,
  };
}

/** The mission's action row, left to right in fixed slots (ui-design.md §6). */
export interface MissionSlots {
  edit: boolean;
  /** The next step of the shared part, or `null` when there is none. */
  next: 'assign' | 'brief' | 'readbackCorrect' | 'complete' | null;
  /** The step back: unassign before the readback, replan after it. */
  back: 'unassign' | 'replan' | null;
  cancel: boolean;
}

/** Mission actions for the JTAC in command, by state (§10.3). Nothing for anyone else. */
export function missionSlots(m: FireMission, rights: MissionRights): MissionSlots {
  if (!rights.inCommand) return { edit: false, next: null, back: null, cancel: false };
  const next = (
    {
      draft: 'assign',
      assigned: 'brief',
      briefed: 'readbackCorrect',
      readbackCorrect: 'complete',
      complete: null,
      cancelled: null,
    } as const
  )[m.state];
  const back =
    m.state === 'assigned' || m.state === 'briefed'
      ? 'unassign'
      : m.state === 'readbackCorrect'
        ? 'replan'
        : null;
  return { edit: true, next, back, cancel: true };
}

/** Whether a step can be taken now – e.g. briefing needs a 9-line (§10.10). */
export function stepReady(m: FireMission, step: MissionSlots['next']): boolean {
  if (step === 'assign') return m.gamePlan !== null;
  if (step === 'brief') return m.nineLine !== null;
  return step !== null;
}

export type LaneButton = 'correlated' | 'hot' | 'dry' | 'waitingBda' | 'bda' | 'reattack';

/**
 * A lane's buttons in four fixed slots. Every button has its own slot and
 * never moves, so a second tap can't land on another action: next step ·
 * CONTINUE DRY or BDA · RE-ATTACK · ABORT far right.
 */
export interface LaneSlots {
  /** CORRELATED, CLEARED HOT or WAITING BDA. */
  first: 'correlated' | 'hot' | 'waitingBda' | null;
  /** CONTINUE DRY, or BDA (also straight from a cleared lane). */
  second: 'dry' | 'bda' | null;
  third: 'reattack' | null;
  /** ABORT offered: a cleared lane, to any JTAC of the AO (§10.6). */
  abort: boolean;
}

/**
 * The buttons of one lane by its state (§10.3, §10.6–§10.8). A Type 3 lane is
 * cleared by the mission's window, so it has no CLEARED HOT / CONTINUE DRY.
 */
export function laneSlots(m: FireMission, lane: Lane, rights: MissionRights): LaneSlots {
  const none: LaneSlots = { first: null, second: null, third: null, abort: false };
  if (!rights.open || m.state !== 'readbackCorrect') return none;
  const abort = rights.jtac && lane.state === 'cleared';
  if (!rights.inCommand) return { ...none, abort };
  const type3 = m.gamePlan?.control === 3;
  switch (lane.state) {
    case 'open':
      return { ...none, first: 'correlated' };
    case 'correlated':
      return type3 ? none : { ...none, first: 'hot', second: 'dry' };
    case 'cleared':
      // BDA straight from a cleared lane ends the attack and passes the BDA in one go.
      return { ...none, first: 'waitingBda', second: 'bda', abort };
    case 'waitingBda':
      return { ...none, second: 'bda', third: 'reattack' };
    case 'bda':
      return { ...none, third: 'reattack' };
  }
}

// ---------------------------------------------------------------------------
// Lasers (§9.5, §10.6) – the same rules as the relay's, so the JTAC sees a
// conflict before he clears, not only after.

/** The aircraft's weapon code from its flight's check-in: its own, else the flight's. */
export function weaponCode(slices: Slices, m: FireMission, pid: string): number | null {
  const checkIn = slices.cas.checkIns.find((c) => c.flightId === m.assignee?.flightId);
  const codes = checkIn?.brief.laserCodes;
  return codes?.perAircraft[pid] ?? codes?.flight ?? null;
}

export interface LaneLaser {
  code: number;
  /** Who lases: the aircraft itself (ownship), or line 7's JTAC or aircraft. */
  source: string;
}

/** The laser a lane's attack uses (line 7), or `null` without a laser mark. */
export function laneLaser(slices: Slices, m: FireMission, pid: string): LaneLaser | null {
  const mark = m.nineLine?.mark;
  if (mark?.type !== 'laser' || !mark.source) return null;
  if (mark.source.kind === 'ownship') {
    const code = weaponCode(slices, m, pid);
    return code === null ? null : { code, source: pid };
  }
  return mark.code === null ? null : { code: mark.code, source: mark.source.pid };
}

/** A cleared lane whose laser would clash with another one. */
export interface LaserClash {
  missionId: string;
  pid: string;
}

/**
 * Cleared lanes whose active laser would clash with this lane's if it were
 * cleared now: the same code from a different source, in the same AO.
 * Flagged, never blocked (§10.6).
 */
export function clearConflicts(slices: Slices, m: FireMission, pid: string): LaserClash[] {
  const mine = laneLaser(slices, m, pid);
  if (!mine) return [];
  const clash: LaserClash[] = [];
  for (const other of slices.missions.missions) {
    if (other.aoId !== m.aoId || CLOSED_STATES.has(other.state)) continue;
    for (const lane of other.lanes) {
      if (lane.state !== 'cleared') continue;
      if (other.missionId === m.missionId && lane.pid === pid) continue;
      const theirs = laneLaser(slices, other, lane.pid);
      if (theirs?.code === mine.code && theirs.source !== mine.source) {
        clash.push({ missionId: other.missionId, pid: lane.pid });
      }
    }
  }
  return clash;
}

// ---------------------------------------------------------------------------
// Correlation (§10.7)

export interface SpiOffset {
  distanceM: number;
  /** Bearing from line 6 to the SPI, from DCS's grid north (§0); geographic on an unknown map. */
  bearingDeg: number;
}

/** Where a lane's SPI lies from line 6. */
export function spiOffset(slices: Slices, m: FireMission, lane: Lane): SpiOffset | null {
  const target = m.nineLine?.location;
  if (!lane.spi || !target) return null;
  const trueBearing = shortBearingDeg(target.lat, target.lon, lane.spi.lat, lane.spi.lon);
  const gamma = gridConvergenceDeg(slices.mission.theatre, target) ?? 0;
  return {
    distanceM: distanceM(target, lane.spi),
    bearingDeg: Math.round(normalizeDegrees(trueBearing - gamma)) % 360,
  };
}

// ---------------------------------------------------------------------------
// Content

/** A new mission's content: Type 2 BOT, line 7 none, nothing else filled. */
export function emptyContent(): MissionContent {
  return {
    gamePlan: { control: 2, method: 'BOT', effects: '', ordnance: '', interval: '' },
    nineLine: {
      ipBp: null,
      headingDeg: null,
      offset: null,
      distanceM: null,
      elevationM: null,
      description: '',
      location: null,
      locationText: '',
      mark: { type: 'none', code: null, source: null, at: null, text: '' },
      friendlies: { text: '', cmIds: [] },
      egress: '',
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
  };
}

/** The aircraft a lane can belong to that haven't acknowledged a change yet (§10.5). */
export function pendingAcks(m: FireMission, rev: number): string[] {
  const change = m.changes.find((c) => c.rev === rev);
  if (!change) return [];
  return m.lanes.map((l) => l.pid).filter((pid) => !change.ackedBy.includes(pid));
}

/** The lane steps whose ticks a lane shows: the newest of them. */
export const LANE_STEP_TYPES = [
  'fm.correlated',
  'fm.clear',
  'fm.waitingBda',
  'fm.abort',
  'fm.bda',
  'fm.reattack',
] as const;

/** The mission steps whose ticks the action row shows. */
export const MISSION_STEP_TYPES = [
  'fm.create',
  'fm.update',
  'fm.assign',
  'fm.unassign',
  'fm.brief',
  'fm.readbackCorrect',
  'fm.window',
  'fm.windowRevoke',
  'fm.voiceOnly',
  'fm.complete',
  'fm.cancel',
] as const;

// ---------------------------------------------------------------------------
// Text of one field (§10.4), for the 9-line card and for the old value of a
// change (§10.5) – both go through here, so they read the same.

const NM = 1852;
const deg = (d: number) => `${String(Math.round(d)).padStart(3, '0')}°`;

/** A point reference as `IP HAMMER · 37T GG 26400 77879`. */
export function pointLine(slices: Slices, point: PointRef, style: CoordStyle): string {
  const p = pointText(slices, point);
  const at = p.at ? (positionText(p.at, style)[0] ?? '') : '';
  return [p.name, at].filter((x) => x).join(' · ') || '—';
}

/** Line 7: `LASER 1688 – Axeman 11`, `LASER – OWNSHIP`, `SMOKE at KEYHOLE ROCK – ALPHA 2`. */
export function markText(slices: Slices, mark: Mark, style: CoordStyle): string {
  if (mark.type === 'none') return mark.text || 'NO MARK';
  const parts = [mark.type.toUpperCase()];
  if (mark.code !== null) parts.push(String(mark.code));
  let text = parts.join(' ');
  if (mark.source) {
    text += ` – ${mark.source.kind === 'ownship' ? 'OWNSHIP' : callsignOf(slices, mark.source.pid)}`;
  }
  if (mark.at) text += ` at ${pointLine(slices, mark.at, style)}`;
  if (mark.text) text += ` (${mark.text})`;
  return text;
}

/** The text of a mission field by its change path (`nineLine.location`, `remarks.tot`, …). */
export function fieldText(slices: Slices, path: string, value: unknown, style: CoordStyle): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (path) {
    case 'gamePlan': {
      const g = value as GamePlan;
      return [`Type ${String(g.control)}`, g.method, g.effects, g.ordnance, g.interval]
        .filter((x) => x)
        .join(' · ');
    }
    case 'nineLine.ipBp':
      return pointLine(slices, value as PointRef, style);
    case 'nineLine.headingDeg':
    case 'remarks.ltl':
      return deg(value as number);
    case 'nineLine.offset':
      return `offset ${value as string}`;
    case 'nineLine.distanceM':
      return `${((value as number) / NM).toFixed(1)} NM`;
    case 'nineLine.elevationM':
      return `${formatElevationFt(value as number)} MSL`;
    case 'nineLine.location':
      return positionText(value as LatLon, style).join(' · ');
    case 'nineLine.mark':
      return markText(slices, value as Mark, style);
    case 'nineLine.friendlies':
      return (value as LinkedText).text || '—';
    case 'remarks.finalAttackHeading': {
      const f = value as { fromDeg: number; toDeg: number };
      return `${deg(f.fromDeg)}–${deg(f.toDeg)}`;
    }
    case 'remarks.dangerClose':
      return value === true ? 'DANGER CLOSE' : 'no';
    case 'remarks.tot':
      return mtimeText(slices, value as number);
    case 'remarks.restrictions':
      return (value as string[]).length === 0 ? '—' : (value as string[]).join(' · ');
    default:
      return typeof value === 'string' ? value : JSON.stringify(value);
  }
}

/** Fields changed and not yet acknowledged by every lane, with their old values (§10.5). */
export function unackedChanges(m: FireMission, pid: string | null = null): Record<string, unknown> {
  const old: Record<string, unknown> = {};
  for (const change of m.changes) {
    const waiting =
      pid === null ? pendingAcks(m, change.rev).length > 0 : !change.ackedBy.includes(pid);
    if (!waiting) continue;
    for (const path of change.fields) {
      // The oldest value not yet acknowledged is what the pilot last read back.
      if (!(path in old)) old[path] = change.old[path];
    }
  }
  return old;
}

/** The text key naming a changed field (`line 6`, `TOT`); unknown paths fall back to line 5's name. */
export function fieldKey(path: string): MessageKey {
  const key = `field.${path}`;
  return key in en ? (key as MessageKey) : 'field.nineLine.description';
}

// ---------------------------------------------------------------------------
// The pilot's side (P2.7): his own lane only (§10.1).

/** What the pilot's clearance slot says (ui-design.md §7). Only `hot`, `dry`, `window` are cleared. */
export type PilotClearance =
  | 'notAssigned'
  | 'briefed'
  | 'open'
  | 'correlated'
  | 'hot'
  | 'dry'
  | 'window'
  | 'waitingBda'
  | 'bda'
  | 'closed';

/** The pilot's own lane, or `null` (an aircraft assignment without him). */
export function ownLane(m: FireMission, pid: string | null): Lane | null {
  return m.lanes.find((l) => l.pid === pid) ?? null;
}

/** The pilot's clearance state for one mission (dual clearance: the app's half, §10.6). */
export function pilotClearance(m: FireMission, pid: string | null): PilotClearance {
  if (CLOSED_STATES.has(m.state)) return 'closed';
  const lane = ownLane(m, pid);
  if (!lane) return 'notAssigned';
  if (m.state !== 'readbackCorrect') return m.state === 'briefed' ? 'briefed' : 'notAssigned';
  if (lane.state === 'cleared') return lane.runs.at(-1)?.clearance.kind ?? 'hot';
  return lane.state;
}

export interface AbortNotice {
  /** Stays the same for one abort, so a screen can remember it was dismissed. */
  key: string;
  /** `LINE 6 CHANGED`, `REPLAN`, or the reason given. */
  reason: string;
  channel: 'app' | 'voice';
  /** Who aborted: a pid, or `relay` for a change or a replan. */
  by: string;
}

const READBACK_NAMES: Record<string, string> = {
  'nineLine.elevationM': 'LINE 4',
  'nineLine.location': 'LINE 6',
  'nineLine.locationText': 'LINE 6',
  'remarks.restrictions': 'RESTRICTIONS',
};

/**
 * The abort on the pilot's own lane, while it stands: the lane's last run was
 * aborted and it hasn't been cleared again. A read-back change reads
 * "LINE 6 CHANGED" (§10.5).
 */
export function abortNotice(m: FireMission, pid: string | null): AbortNotice | null {
  if (CLOSED_STATES.has(m.state)) return null;
  const lane = ownLane(m, pid);
  const run = lane?.runs.at(-1);
  if (!lane || !run?.abort || lane.state === 'cleared') return null;
  const { abort } = run;
  let reason = abort.reason;
  if (reason === 'rbChange') {
    const fields = [...m.changes]
      .reverse()
      .find((c) => c.fields.some((f) => f in READBACK_NAMES))?.fields;
    const names = [...new Set((fields ?? []).map((f) => READBACK_NAMES[f]).filter((x) => x))];
    reason = `${names.length > 0 ? names.join(' + ') : 'READ-BACK ITEM'} CHANGED`;
  } else if (reason === 'replan') {
    reason = 'REPLAN';
  }
  return {
    key: `${m.missionId}:${String(run.run)}:${String(abort.ts)}`,
    reason,
    channel: abort.channel,
    by: abort.by,
  };
}

/** Changes the pilot hasn't acknowledged yet, oldest first (§10.5). */
export function pendingRevs(m: FireMission, pid: string | null): number[] {
  if (pid === null || !ownLane(m, pid)) return [];
  return m.changes.filter((c) => !c.ackedBy.includes(pid)).map((c) => c.rev);
}

// ---------------------------------------------------------------------------
// Fewer presses (workflow compression): steps that always go together.

/** Game plan and a line 6: enough to assign and brief in one press. */
export function canSendBrief(m: Pick<FireMission, 'gamePlan' | 'nineLine'>): boolean {
  return m.gamePlan !== null && m.nineLine?.location != null;
}

/** Lanes CORRELATED – ALL would mark: every open lane after the readback. */
export function correlatable(m: FireMission): string[] {
  if (m.state !== 'readbackCorrect') return [];
  return m.lanes.filter((l) => l.state === 'open').map((l) => l.pid);
}

/** Lanes CLEARED HOT – FLIGHT would clear: every correlated lane of a Type 1/2 mission. */
export function clearable(m: FireMission): string[] {
  if (m.state !== 'readbackCorrect' || m.gamePlan?.control === 3) return [];
  return m.lanes.filter((l) => l.state === 'correlated').map((l) => l.pid);
}

/**
 * Laser conflicts clearing several lanes at once would cause: with lanes
 * already cleared in the AO, and among the lanes themselves (the same code
 * from different sources). Flagged, never blocked (§10.6).
 */
export function groupClearConflicts(slices: Slices, m: FireMission, pids: string[]): LaserClash[] {
  const clash = pids.flatMap((pid) => clearConflicts(slices, m, pid));
  const lasers = pids.map((pid) => ({ pid, laser: laneLaser(slices, m, pid) }));
  for (const a of lasers) {
    const other = lasers.find(
      (b) =>
        b.pid !== a.pid &&
        a.laser !== null &&
        b.laser?.code === a.laser.code &&
        b.laser.source !== a.laser.source,
    );
    if (other) clash.push({ missionId: m.missionId, pid: a.pid });
  }
  const seen = new Set<string>();
  return clash.filter((c) => {
    const key = `${c.missionId}:${c.pid}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every lane has its BDA: COMPLETE is offered (the JTAC still presses it). */
export function readyToComplete(m: FireMission): boolean {
  return (
    m.state === 'readbackCorrect' && m.lanes.length > 0 && m.lanes.every((l) => l.state === 'bda')
  );
}

/** Lines 5 and 6 from an enemy or threat marker (a point, or a circle's centre). */
export function targetFromEntry(entry: MapEntry): { description: string; location: LatLon } | null {
  if (entry.kind !== 'enemy' && entry.kind !== 'threat') return null;
  const geom = entry.geom as LatLon | { center: LatLon } | LatLon[];
  const location = Array.isArray(geom) ? null : 'center' in geom ? geom.center : geom;
  if (!location) return null;
  const count = entry.count !== null && entry.count > 1 ? `${String(entry.count)}x ` : '';
  const moving = entry.moving === true ? ', moving' : '';
  const description = `${count}${entry.label ?? entry.text ?? ''}${moving}`.trim();
  return { description, location: { lat: location.lat, lon: location.lon } };
}

// ---------------------------------------------------------------------------
// What a pilot still has to answer – shown on the alert bar on every page.

export type PilotTodo =
  | { kind: 'wilco'; key: string; holdId: string; point: PointRef }
  | { kind: 'copy'; key: string; noteId: string; from: string; whole: boolean }
  | { kind: 'ack'; key: string; missionId: string; revs: number[]; fields: string[] }
  | { kind: 'ackBda'; key: string; missionId: string; effect: string; target: string };

/**
 * Open answers, most urgent first: changes to ACK, a hold to WILCO, a
 * situation update to COPY, a BDA to ACK. WILCO and COPY are the flight's
 * answer, so only the member in command is asked; changes and BDA are per
 * aircraft (§10.5).
 */
export function pilotTodos(slices: Slices): PilotTodo[] {
  const pid = slices.session.pid;
  const own = slices.flight.own;
  if (slices.session.role === 'jtac' || pid === null || !own) return [];
  const todos: PilotTodo[] = [];
  for (const m of slices.missions.missions) {
    if (CLOSED_STATES.has(m.state)) continue;
    const revs = pendingRevs(m, pid);
    if (revs.length > 0) {
      const fields = m.changes.filter((c) => revs.includes(c.rev)).flatMap((c) => c.fields);
      todos.push({
        kind: 'ack',
        key: `ack:${m.missionId}:${revs.join(',')}`,
        missionId: m.missionId,
        revs,
        fields: [...new Set(fields)],
      });
    }
  }
  if (own.inCommand === pid) {
    for (const h of slices.cas.holds) {
      if (h.flightId !== own.flightId) continue;
      if (slices.cas.holdWilcos.some((w) => w.holdId === h.holdId && w.pid === pid)) continue;
      todos.push({ kind: 'wilco', key: `wilco:${h.holdId}`, holdId: h.holdId, point: h.point });
    }
    for (const n of slices.cas.sitUpdates) {
      if (n.copied || n.from === pid) continue;
      if (n.flightId !== null && n.flightId !== own.flightId) continue;
      todos.push({
        kind: 'copy',
        key: `copy:${n.id}`,
        noteId: n.id,
        from: n.from,
        whole: n.flightId === null,
      });
    }
  }
  for (const m of slices.missions.missions) {
    if (CLOSED_STATES.has(m.state)) continue;
    const bda = ownLane(m, pid)?.bda;
    if (bda && !bda.acked) {
      todos.push({
        kind: 'ackBda',
        key: `bda:${m.missionId}:${String(bda.mtime ?? 0)}`,
        missionId: m.missionId,
        effect: bda.effect,
        target: bda.target,
      });
    }
  }
  return todos;
}
