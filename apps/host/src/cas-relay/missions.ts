// SPDX-License-Identifier: GPL-3.0-or-later
// Fire missions (protocol.md §10). Relay state: one shared part (game plan,
// 9-line, readback) and one lane per assigned aircraft. The JTAC in command
// moves every step; the relay never moves a lane on by itself, except a Type 3
// window opening, expiring or being revoked. Each pilot gets only his own lane.

import { READBACK_FIELDS } from '@slate-dcs/shared';
import type {
  ErrorCode,
  FireMission,
  Lane,
  LaneWarning,
  Message,
  MissionChange,
  MissionContent,
  PointRef,
} from '@slate-dcs/shared';

import { RELAY_FROM } from './core.js';
import type { AoRec, FlightRec, Member, RelayCore } from './core.js';
import type { Aos } from './aos.js';
import type { CheckIns } from './checkins.js';
import type { Flights } from './flights.js';
import type { MapEntries } from './map-entries.js';

type Fail = (code: ErrorCode, text: string) => void;
type FmMessage = Extract<Message, { type: `fm.${string}` }>;
type FmCommand = Exclude<FmMessage, { type: 'fm.updated' | 'fm.deleted' }>;
type Json = MissionChange['old'][string];

/** A mission as the relay keeps it. `mission` is the full view a JTAC of the AO gets. */
export interface MissionRec {
  mission: FireMission;
  ao: AoRec;
  /** Relay times of the Type 3 window, from its mission times (§1.4); `null` without one. */
  windowAt: { start: number; end: number; open: boolean } | null;
}

/** The JSON value of a field path like `nineLine.description`. */
function fieldValue(content: MissionContent, path: string): Json {
  const [group, key] = path.split('.') as [keyof MissionContent, string | undefined];
  const part = content[group] as Record<string, unknown> | null;
  const value = key === undefined ? part : (part?.[key] ?? null);
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

/** Every field path of the content, for working out what an update changed (§10.5). */
const FIELD_PATHS = [
  'gamePlan',
  ...[
    'ipBp',
    'headingDeg',
    'offset',
    'distanceM',
    'elevationM',
    'description',
    'location',
    'locationText',
    'mark',
    'friendlies',
    'egress',
  ].map((k) => `nineLine.${k}`),
  ...['ltl', 'finalAttackHeading', 'dangerClose', 'tot', 'restrictions', 'hazards', 'text'].map(
    (k) => `remarks.${k}`,
  ),
];

const CLOSED = new Set(['complete', 'cancelled']);

export class Missions {
  readonly #core: RelayCore;
  readonly #aos: Aos;
  readonly #flights: Flights;
  readonly #missions = new Map<string, MissionRec>();
  #nextId = 1;

  constructor(
    core: RelayCore,
    parts: { aos: Aos; flights: Flights; checkIns: CheckIns; entries: MapEntries },
  ) {
    this.#core = core;
    this.#aos = parts.aos;
    this.#flights = parts.flights;
    parts.aos.listen({
      // A JTAC joining the AO gets all its missions; leaving, they disappear for him.
      joined: (member, ao) => {
        for (const rec of this.#inAo(ao)) this.#send(rec, [member], null);
      },
      left: (member, ao, stays) => {
        this.#reassign(member, ao);
        if (stays) for (const rec of this.#inAo(ao)) this.#deleted(rec, [member], true, null);
      },
      presence: (member, ao) => {
        if (member.presence === 'lost') this.#reassign(member, ao);
      },
      // Hosts drop the AO's missions with `ao.closed`.
      closed: (ao) => {
        for (const rec of this.#inAo(ao)) this.#missions.delete(rec.mission.missionId);
      },
    });
    // A flight leaving the AO: its missions go back to draft, content kept (§9.2, §10.1).
    parts.checkIns.listen({
      checkedOut: (checkIn) => {
        for (const rec of this.#ofFlight(checkIn.flight.id)) this.#unassign(rec, null);
      },
    });
    parts.flights.listen({
      joined: (member, flight) => {
        this.#memberJoined(member, flight);
      },
      left: (member, flight) => {
        this.#memberLeft(member, flight);
      },
    });
    parts.entries.addInUseCheck((cmId) =>
      [...this.#missions.values()].some(
        (rec) => !CLOSED.has(rec.mission.state) && this.#refersTo(rec.mission, cmId),
      ),
    );
  }

  /** For `session.state` (§10.9): a JTAC every mission of his AO, a pilot his flight's. Closed ones not. */
  openFor(member: Member): FireMission[] {
    return [...this.#missions.values()]
      .filter((rec) => !CLOSED.has(rec.mission.state) && this.#viewers(rec).includes(member))
      .map((rec) => this.view(rec, member));
  }

  /** Lost detection's clock: opens and closes Type 3 windows (§10.6). */
  tick(): void {
    const now = this.#core.now();
    for (const rec of [...this.#missions.values()]) {
      const at = rec.windowAt;
      const window = rec.mission.window;
      if (!at || !window) continue;
      if (now >= at.end) {
        this.#closeWindow(rec);
        this.#changed(rec, null);
      } else if (!at.open && now >= at.start) {
        at.open = true;
        this.#openWindow(rec);
        this.#changed(rec, null);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Messages

  command(member: Member, message: FmCommand): void {
    const fail: Fail = (code, text) => {
      this.#core.error(member.conn, code, text, message.id);
    };
    if (message.type === 'fm.create') {
      this.#create(member, message, fail);
      return;
    }
    const rec = this.#missions.get(message.body.missionId);
    if (rec?.ao.session !== member.session || !this.#viewers(rec).includes(member)) {
      fail('badCode', 'No such mission');
      return;
    }
    const m = rec.mission;
    const jtac = member.role === 'jtac' && member.ao === rec.ao;
    const inCommand = jtac && m.inCommand === member.pid;
    const owner = jtac && m.owner === member.pid;
    const open = !CLOSED.has(m.state);
    const need = (ok: boolean, text: string): boolean => {
      if (!ok) fail('forbidden', text);
      return ok;
    };
    const commanding = () =>
      need(inCommand, 'Only the JTAC in command') && need(open, 'Mission closed');
    const re = message.id;
    const mt = message.mt ?? this.#core.missionTime(rec.ao.session);

    switch (message.type) {
      case 'fm.update': {
        if (!commanding()) return;
        this.#update(rec, message.body, re);
        return;
      }
      case 'fm.assign': {
        if (!commanding() || !need(m.state === 'draft', 'Unassign it first')) return;
        this.#assign(rec, message.body.assignee, re, fail);
        return;
      }
      case 'fm.unassign': {
        if (!commanding() || !need(m.state !== 'draft', 'Not assigned')) return;
        this.#unassign(rec, re);
        return;
      }
      case 'fm.brief': {
        if (!commanding() || !need(m.state === 'assigned', 'Assign it first')) return;
        if (m.nineLine === null) {
          fail('badMessage', 'Write the 9-line first');
          return;
        }
        m.state = 'briefed';
        this.#changed(rec, re);
        return;
      }
      case 'fm.readbackCorrect': {
        if (!commanding() || !need(m.state === 'briefed', 'Brief it first')) return;
        m.state = 'readbackCorrect';
        this.#changed(rec, re);
        return;
      }
      case 'fm.correlated': {
        if (!commanding()) return;
        const lane = this.#laneFor(rec, message.body.pid, ['open'], fail);
        if (!lane || !need(m.state === 'readbackCorrect', 'Readback first')) return;
        lane.state = 'correlated';
        this.#changed(rec, re);
        return;
      }
      case 'fm.clear': {
        if (!commanding()) return;
        if (m.gamePlan?.control === 3) {
          fail('badMessage', 'Type 3 clears with a window');
          return;
        }
        const lane = this.#laneFor(rec, message.body.pid, ['correlated'], fail);
        if (!lane || !need(m.state === 'readbackCorrect', 'Readback first')) return;
        lane.state = 'cleared';
        lane.runs.push({
          run: lane.runs.length + 1,
          clearance: { kind: message.body.kind, ts: this.#core.now(), mtime: mt, by: member.pid },
          abort: null,
        });
        this.#changed(rec, re);
        return;
      }
      case 'fm.window': {
        if (!commanding()) return;
        this.#window(rec, member, message.body.window, message.mt, re, fail);
        return;
      }
      case 'fm.windowRevoke': {
        if (!commanding() || !need(m.window !== null, 'No window')) return;
        this.#closeWindow(rec);
        this.#changed(rec, re);
        return;
      }
      case 'fm.waitingBda': {
        if (!commanding()) return;
        const lane = this.#laneFor(rec, message.body.pid, ['cleared'], fail);
        if (!lane) return;
        lane.state = 'waitingBda';
        this.#dropFromWindow(rec, lane.pid);
        this.#changed(rec, re);
        return;
      }
      case 'fm.abort': {
        // Any JTAC in the AO; the pilot for his own lane (§10.2).
        const own = message.body.pid === member.pid;
        if (!need(jtac || own, 'Only a JTAC of the AO, or the pilot for his own lane')) return;
        const lane = this.#laneFor(rec, message.body.pid, ['cleared'], fail);
        if (!lane) return;
        this.#abort(rec, lane, {
          by: member.pid,
          channel: message.body.channel,
          reason: message.body.reason,
          mtime: mt,
        });
        this.#changed(rec, re);
        return;
      }
      case 'fm.voiceOnly': {
        if (!commanding()) return;
        m.voiceOnly = message.body.on;
        this.#changed(rec, re);
        return;
      }
      case 'fm.bda': {
        if (!commanding()) return;
        const lane = this.#laneFor(rec, message.body.pid, ['waitingBda'], fail);
        if (!lane) return;
        const { target, effect, location, remarks } = message.body;
        lane.state = 'bda';
        lane.bda = {
          target,
          effect,
          location,
          mtime: message.body.mtime ?? mt,
          remarks,
          acked: false,
        };
        this.#changed(rec, re);
        return;
      }
      case 'fm.ackBda': {
        const lane = this.#laneFor(rec, member.pid, ['bda'], fail);
        if (!lane?.bda) return;
        lane.bda.acked = true;
        this.#changed(rec, re);
        return;
      }
      case 'fm.reattack': {
        if (!commanding()) return;
        if (message.body.to === 'attack') {
          const lane = this.#laneFor(rec, message.body.pid, ['waitingBda', 'bda'], fail);
          if (!lane) return;
          lane.state = 'correlated';
          lane.bda = null;
        } else {
          if (!need(m.state === 'readbackCorrect', 'Nothing to replan yet')) return;
          this.#closeWindow(rec);
          for (const lane of m.lanes) this.#reopen(rec, lane, 'replan', mt);
          m.state = 'assigned';
        }
        this.#changed(rec, re);
        return;
      }
      case 'fm.complete': {
        if (!commanding() || !need(m.state === 'readbackCorrect', 'Not under way')) return;
        this.#closeWindow(rec);
        m.state = 'complete';
        this.#changed(rec, re);
        return;
      }
      case 'fm.cancel': {
        if (!commanding()) return;
        this.#closeWindow(rec);
        m.state = 'cancelled';
        this.#changed(rec, re);
        return;
      }
      case 'fm.delete': {
        if (!need(owner, 'Only the owner deletes')) return;
        this.#missions.delete(m.missionId);
        this.#deleted(rec, this.#viewers(rec), false, re);
        this.#refresh(rec.ao, null);
        return;
      }
      case 'fm.offerCommand': {
        if (!need(owner && open, 'Only the owner hands command over')) return;
        const to = this.#core.members.get(message.body.pid);
        if (to?.ao !== rec.ao || to.pid === m.inCommand) {
          fail('badCode', 'Not another JTAC of this AO');
          return;
        }
        m.commandOffer = to.pid;
        this.#changed(rec, re);
        return;
      }
      case 'fm.acceptCommand': {
        if (!need(jtac && m.commandOffer === member.pid, 'No offer to you')) return;
        m.inCommand = member.pid;
        m.commandOffer = null;
        this.#changed(rec, re);
        return;
      }
      case 'fm.returnCommand': {
        if (!need(inCommand && !owner, 'Only a JTAC given command gives it back')) return;
        m.inCommand = m.owner;
        this.#changed(rec, re);
        return;
      }
      case 'fm.reclaim': {
        if (!need(owner && m.inCommand !== m.owner, 'Only the owner, and only when not in command'))
          return;
        m.inCommand = m.owner;
        m.commandOffer = null;
        this.#changed(rec, re);
        return;
      }
      case 'fm.spi': {
        const lane = this.#laneFor(rec, member.pid, ['open', 'correlated', 'cleared'], fail);
        if (!lane || !need(open, 'Mission closed')) return;
        lane.spi = message.body.spi;
        this.#changed(rec, re);
        return;
      }
      case 'fm.ackChange': {
        const change = m.changes.find((c) => c.rev === message.body.rev);
        if (!m.lanes.some((lane) => lane.pid === member.pid) || !change) {
          fail('badCode', 'No such change for your aircraft');
          return;
        }
        if (!change.ackedBy.includes(member.pid)) change.ackedBy.push(member.pid);
        this.#changed(rec, re);
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Steps

  #create(member: Member, message: Extract<Message, { type: 'fm.create' }>, fail: Fail): void {
    const ao = this.#aos.get(message.body.aoId);
    if (member.role !== 'jtac' || !ao || member.ao !== ao) {
      fail('forbidden', 'Only a JTAC of the AO creates missions');
      return;
    }
    const { gamePlan, nineLine, remarks } = message.body;
    const rec: MissionRec = {
      mission: {
        missionId: `m_${String(this.#nextId++)}`,
        aoId: ao.id,
        owner: member.pid,
        inCommand: member.pid,
        commandOffer: null,
        revision: 1,
        state: 'draft',
        assignee: null,
        gamePlan,
        nineLine,
        remarks,
        changes: [],
        lanes: [],
        window: null,
        voiceOnly: false,
      },
      ao,
      windowAt: null,
    };
    this.#missions.set(rec.mission.missionId, rec);
    this.#changed(rec, message.id);
  }

  /** A new revision (§10.5). From `briefed` on, changes are listed for acknowledgement. */
  #update(rec: MissionRec, content: MissionContent, re: string): void {
    const m = rec.mission;
    const before: MissionContent = {
      gamePlan: m.gamePlan,
      nineLine: m.nineLine,
      remarks: m.remarks,
    };
    const fields = FIELD_PATHS.filter(
      (path) =>
        JSON.stringify(fieldValue(before, path)) !== JSON.stringify(fieldValue(content, path)),
    );
    m.gamePlan = content.gamePlan;
    m.nineLine = content.nineLine;
    m.remarks = content.remarks;
    if (fields.length === 0) {
      this.#changed(rec, re);
      return;
    }
    m.revision += 1;
    if (m.state !== 'draft' && m.state !== 'assigned') {
      const old = Object.fromEntries(fields.map((path) => [path, fieldValue(before, path)]));
      m.changes.push({ rev: m.revision, fields, old, ackedBy: [] });
    }
    // A read-back item changed: new readback and correlation; a cleared lane sees an abort.
    const readback = fields.some((path) => (READBACK_FIELDS as readonly string[]).includes(path));
    if (readback && m.state === 'readbackCorrect') {
      this.#closeWindow(rec);
      for (const lane of m.lanes) this.#reopen(rec, lane, 'rbChange', null);
      m.state = 'briefed';
    }
    this.#changed(rec, re);
  }

  #assign(
    rec: MissionRec,
    assignee: FireMission['assignee'] & object,
    re: string,
    fail: Fail,
  ): void {
    const m = rec.mission;
    const flight = this.#flights.all().find((f) => f.id === assignee.flightId);
    if (flight?.checkIn?.ao !== rec.ao) {
      fail('badCode', 'That flight is not checked in to this AO');
      return;
    }
    const crew = [...flight.slots.values()].map((member) => member.pid);
    if (assignee.pids?.some((pid) => !crew.includes(pid))) {
      fail('badCode', 'Not all of them are in that flight');
      return;
    }
    if (m.gamePlan === null) {
      fail('badMessage', 'Write the game plan first');
      return;
    }
    m.assignee = { flightId: flight.id, pids: assignee.pids };
    m.state = 'assigned';
    m.lanes = (assignee.pids ?? crew).map((pid) => this.#newLane(pid));
    this.#changed(rec, re);
  }

  /** Back to draft (§10.1): content kept, readback and lanes gone; the flight no longer sees it. */
  #unassign(rec: MissionRec, re: string | null): void {
    const m = rec.mission;
    const flight = this.#flights.all().find((f) => f.id === m.assignee?.flightId);
    const crew = flight ? [...flight.slots.values()] : [];
    this.#closeWindow(rec);
    m.assignee = null;
    m.state = 'draft';
    m.lanes = [];
    m.changes = [];
    this.#deleted(rec, crew, true, null);
    this.#changed(rec, re);
  }

  /** Type 3 "cleared to engage" (§10.6): its times are turned into relay times (§1.4). */
  #window(
    rec: MissionRec,
    member: Member,
    draft: Extract<Message, { type: 'fm.window' }>['body']['window'],
    senderMt: number | null | undefined,
    re: string,
    fail: Fail,
  ): void {
    const m = rec.mission;
    if (m.gamePlan?.control !== 3 || m.state !== 'readbackCorrect') {
      fail('badMessage', 'A window is for a Type 3 mission after the readback');
      return;
    }
    const pids =
      draft.pids ?? m.lanes.filter((lane) => lane.state === 'correlated').map((lane) => lane.pid);
    const lanes = pids.map((pid) => m.lanes.find((lane) => lane.pid === pid));
    if (pids.length === 0 || lanes.some((lane) => lane?.state !== 'correlated')) {
      fail('forbidden', 'Every lane in the window must be correlated');
      return;
    }
    const mt = senderMt ?? this.#core.missionTime(rec.ao.session);
    if (mt === null) {
      fail('badMessage', 'No mission time yet – the window needs a DCS clock');
      return;
    }
    const now = this.#core.now();
    const start = now + (draft.from - mt) * 1000;
    const end = now + (draft.until - mt) * 1000;
    if (end <= now) {
      fail('badMessage', 'The window is already over');
      return;
    }
    this.#closeWindow(rec);
    m.window = { ...draft, pids, by: member.pid, revoked: false };
    rec.windowAt = { start, end, open: start <= now };
    if (rec.windowAt.open) this.#openWindow(rec);
    this.#changed(rec, re);
  }

  /** The window's lanes are cleared while it is open. */
  #openWindow(rec: MissionRec): void {
    const m = rec.mission;
    for (const pid of m.window?.pids ?? []) {
      const lane = m.lanes.find((l) => l.pid === pid);
      if (lane?.state !== 'correlated') continue;
      lane.state = 'cleared';
      lane.runs.push({
        run: lane.runs.length + 1,
        clearance: {
          kind: 'window',
          ts: this.#core.now(),
          mtime: this.#core.missionTime(rec.ao.session),
          by: m.window?.by ?? m.inCommand,
        },
        abort: null,
      });
    }
  }

  /** Window over or revoked = not cleared: its lanes go back to `correlated`. */
  #closeWindow(rec: MissionRec): void {
    const m = rec.mission;
    for (const pid of m.window?.pids ?? []) {
      const lane = m.lanes.find((l) => l.pid === pid);
      if (lane?.state === 'cleared' && lane.runs.at(-1)?.clearance.kind === 'window') {
        lane.state = 'correlated';
      }
    }
    m.window = null;
    rec.windowAt = null;
  }

  #dropFromWindow(rec: MissionRec, pid: string): void {
    const window = rec.mission.window;
    if (!window) return;
    window.pids = window.pids.filter((p) => p !== pid);
    if (window.pids.length === 0) {
      rec.mission.window = null;
      rec.windowAt = null;
    }
  }

  #abort(
    rec: MissionRec,
    lane: Lane,
    abort: { by: string; channel: 'app' | 'voice'; reason: string; mtime: number | null },
  ): void {
    const run = lane.runs.at(-1);
    if (run) run.abort = { ts: this.#core.now(), ...abort };
    lane.state = 'correlated';
    this.#dropFromWindow(rec, lane.pid);
  }

  /** A lane back to `open` (replan, read-back change); a cleared one is logged as aborted. */
  #reopen(rec: MissionRec, lane: Lane, reason: string, mtime: number | null): void {
    if (lane.state === 'cleared') {
      this.#abort(rec, lane, { by: 'relay', channel: 'app', reason, mtime });
    }
    lane.state = 'open';
    lane.bda = null;
  }

  #newLane(pid: string): Lane {
    return { pid, state: 'open', spi: null, runs: [], bda: null, warnings: [] };
  }

  /** Missions he was in command of go to the owner, else to the AO's JTAC in command (§10.2). */
  #reassign(member: Member, ao: AoRec): void {
    for (const rec of this.#inAo(ao)) {
      const m = rec.mission;
      let changed = false;
      if (m.commandOffer === member.pid) {
        m.commandOffer = null;
        changed = true;
      }
      if (m.inCommand === member.pid) {
        const owner = this.#core.members.get(m.owner);
        const ownerHere =
          owner && owner !== member && owner.presence === 'online' && owner.ao === ao;
        const next = ownerHere ? owner : this.#aos.inCommand(ao);
        if (next && next !== member) {
          m.inCommand = next.pid;
          if (m.commandOffer === next.pid) m.commandOffer = null;
          changed = true;
        }
      }
      if (changed) this.#changed(rec, null);
    }
  }

  /** A pilot joining a flight assigned as a whole gets a lane (§10.1). */
  #memberJoined(member: Member, flight: FlightRec): void {
    for (const rec of this.#ofFlight(flight.id)) {
      const m = rec.mission;
      if (m.assignee?.pids !== null || CLOSED.has(m.state)) continue;
      m.lanes.push(this.#newLane(member.pid));
      this.#changed(rec, null);
    }
  }

  /** A pilot leaving takes his lane along; nothing left = back to draft (§7.2). */
  #memberLeft(member: Member, flight: FlightRec): void {
    for (const rec of this.#ofFlight(flight.id)) {
      const m = rec.mission;
      const lane = m.lanes.find((l) => l.pid === member.pid);
      if (lane?.state === 'cleared') {
        this.#abort(rec, lane, { by: 'relay', channel: 'app', reason: 'leftFlight', mtime: null });
      }
      m.lanes = m.lanes.filter((l) => l.pid !== member.pid);
      if (m.assignee?.pids) m.assignee.pids = m.assignee.pids.filter((pid) => pid !== member.pid);
      this.#deleted(rec, [member], true, null);
      if (m.assignee?.pids?.length === 0 && !CLOSED.has(m.state)) this.#unassign(rec, null);
      else this.#changed(rec, null);
    }
  }

  // -------------------------------------------------------------------------
  // Views and sending

  /** The AO's JTACs and every member of the assigned flight (§10.1). */
  #viewers(rec: MissionRec): Member[] {
    const jtacs = rec.ao.jtacs.map((jtac) => jtac.member);
    const flight = this.#flights.all().find((f) => f.id === rec.mission.assignee?.flightId);
    const crew = flight ? [...flight.slots.values()] : [];
    return [...new Set([...jtacs, ...crew])].filter((m) => m.presence !== 'left');
  }

  /** As one participant sees it: a pilot only his own lane, no warnings, only his own acks. */
  view(rec: MissionRec, viewer: Member): FireMission {
    const m = rec.mission;
    if (viewer.ao === rec.ao) return m;
    const window = m.window?.pids.includes(viewer.pid) ? { ...m.window, pids: [viewer.pid] } : null;
    return {
      ...m,
      lanes: m.lanes
        .filter((lane) => lane.pid === viewer.pid)
        .map((lane) => ({ ...lane, warnings: [] })),
      changes: m.changes.map((change) => ({
        ...change,
        ackedBy: change.ackedBy.filter((pid) => pid === viewer.pid),
      })),
      window,
    };
  }

  /** After every change: warnings worked out again, then `fm.updated` to its viewers. */
  #changed(rec: MissionRec, re: string | null): void {
    this.#refresh(rec.ao, rec);
    this.#send(rec, this.#viewers(rec), re);
  }

  #send(rec: MissionRec, to: readonly Member[], re: string | null): void {
    if (to.length === 0) return;
    const core = this.#core;
    core.publish(
      core.sessions[rec.ao.session],
      (viewer) => ({
        type: 'fm.updated',
        from: RELAY_FROM,
        session: rec.ao.session,
        to: { scope: 'ao', id: rec.ao.id },
        body: this.view(rec, viewer),
        re,
      }),
      to,
      true,
    );
  }

  #deleted(rec: MissionRec, to: readonly Member[], hidden: boolean, re: string | null): void {
    const core = this.#core;
    const recipients = to.filter((m) => m.presence !== 'left');
    if (recipients.length === 0) return;
    core.publish(
      core.sessions[rec.ao.session],
      {
        type: 'fm.deleted',
        from: RELAY_FROM,
        session: rec.ao.session,
        to: { scope: 'ao', id: rec.ao.id },
        body: { missionId: rec.mission.missionId, hidden },
        re,
      },
      recipients,
      true,
    );
  }

  /**
   * Laser deconfliction (§10.4, §10.6), flagged never blocked: a lane's laser
   * is active while it is cleared. Two different sources on one code in the AO
   * at once → `laserConflict`; line 7's code not the aircraft's weapon code →
   * `codeMismatch`. Missions other than `except` whose warnings changed go to
   * the AO's JTACs.
   */
  #refresh(ao: AoRec, except: MissionRec | null): void {
    const recs = this.#inAo(ao).filter((rec) => !CLOSED.has(rec.mission.state));
    const active: { missionId: string; pid: string; source: string; code: number }[] = [];
    for (const rec of recs) {
      for (const lane of rec.mission.lanes) {
        if (lane.state !== 'cleared') continue;
        const laser = this.#laserOf(rec, lane.pid);
        if (laser) active.push({ missionId: rec.mission.missionId, pid: lane.pid, ...laser });
      }
    }
    const jtacs = ao.jtacs.map((jtac) => jtac.member).filter((m) => m.presence !== 'left');
    for (const rec of recs) {
      let changed = false;
      for (const lane of rec.mission.lanes) {
        const warnings: LaneWarning[] = [];
        const mark = rec.mission.nineLine?.mark;
        if (mark?.type === 'laser' && mark.source && mark.source.kind !== 'ownship' && mark.code) {
          const weaponCode = this.#weaponCode(rec, lane.pid);
          if (weaponCode !== mark.code) {
            warnings.push({ kind: 'codeMismatch', code: mark.code, weaponCode });
          }
        }
        const mine = lane.state === 'cleared' ? this.#laserOf(rec, lane.pid) : null;
        if (mine) {
          const others = new Set(
            active
              .filter((a) => a.code === mine.code && a.source !== mine.source)
              .map((a) => a.missionId),
          );
          for (const other of others) {
            warnings.push({ kind: 'laserConflict', code: mine.code, with: other });
          }
        }
        if (JSON.stringify(warnings) !== JSON.stringify(lane.warnings)) {
          lane.warnings = warnings;
          changed = true;
        }
      }
      if (changed && rec !== except) this.#send(rec, jtacs, null);
    }
  }

  /** The laser a lane's attack uses: its own (ownship, with its code) or line 7's source. */
  #laserOf(rec: MissionRec, pid: string): { source: string; code: number } | null {
    const mark = rec.mission.nineLine?.mark;
    if (mark?.type !== 'laser' || !mark.source) return null;
    if (mark.source.kind === 'ownship') {
      const code = this.#weaponCode(rec, pid);
      return code === null ? null : { source: pid, code };
    }
    return mark.code === null ? null : { source: mark.source.pid, code: mark.code };
  }

  /** The aircraft's weapon code from its flight's check-in (§9.5): its own, else the flight's. */
  #weaponCode(rec: MissionRec, pid: string): number | null {
    const flight = this.#flights.all().find((f) => f.id === rec.mission.assignee?.flightId);
    const codes = flight?.checkIn?.brief.laserCodes;
    return codes?.perAircraft[pid] ?? codes?.flight ?? null;
  }

  #laneFor(rec: MissionRec, pid: string, states: Lane['state'][], fail: Fail): Lane | null {
    const lane = rec.mission.lanes.find((l) => l.pid === pid);
    if (!lane) {
      fail('badCode', 'No lane for that aircraft');
      return null;
    }
    if (!states.includes(lane.state)) {
      fail('forbidden', `That lane is ${lane.state}`);
      return null;
    }
    return lane;
  }

  #inAo(ao: AoRec): MissionRec[] {
    return [...this.#missions.values()].filter((rec) => rec.ao === ao);
  }

  #ofFlight(flightId: string): MissionRec[] {
    return [...this.#missions.values()].filter(
      (rec) => rec.mission.assignee?.flightId === flightId,
    );
  }

  /** Line 1, the mark position or the window's area name this entry (§8.5 – `inUse`). */
  #refersTo(m: FireMission, cmId: string): boolean {
    const names = (point: PointRef | null | undefined) =>
      point !== null && point !== undefined && 'cmId' in point && point.cmId === cmId;
    const area = m.window?.area;
    return (
      names(m.nineLine?.ipBp) ||
      names(m.nineLine?.mark.at) ||
      (area !== null && area !== undefined && 'cmId' in area && area.cmId === cmId) ||
      (area !== null && area !== undefined && 'center' in area && names(area.center))
    );
  }
}
