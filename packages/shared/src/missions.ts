// SPDX-License-Identifier: GPL-3.0-or-later
// Fire missions (protocol.md §10): one shared part (game plan, 9-line,
// readback) and one lane per assigned aircraft. Relay state – the JTAC in
// command moves every step; SLATE never moves a lane on by itself, except an
// expired or revoked Type 3 window.

import { z } from 'zod';

import {
  AoId,
  CmId,
  LaserCode,
  LatLon,
  LinkedText,
  MissionId,
  Mtime,
  PointRef,
} from './cas-common.js';
import { EpochMs, Pid } from './common.js';
import { defineMessage } from './envelope.js';
import { FlightId } from './flights.js';

// ---------------------------------------------------------------------------
// States (§10.3)

export const MissionState = z.enum([
  'draft',
  'assigned',
  'briefed',
  'readbackCorrect',
  'complete',
  'cancelled',
]);
export type MissionState = z.infer<typeof MissionState>;

export const LaneState = z.enum(['open', 'correlated', 'cleared', 'waitingBda', 'bda']);
export type LaneState = z.infer<typeof LaneState>;

/**
 * Mission states in which lanes may have moved past `open`. Lanes are made at
 * `assigned` (§10.3) and stay `open` until the readback is correct; a change
 * to a read-back item sends the mission back to `briefed` and every lane to
 * `open` (§10.5).
 */
export const LANE_STATES_OF_MISSION: ReadonlySet<MissionState> = new Set([
  'readbackCorrect',
  'complete',
  'cancelled',
]);

// ---------------------------------------------------------------------------
// Content (§10.4)

const Text = (max: number) => z.string().max(max);

/** Game plan: type of control, method, effects, ordnance, interval. */
export const GamePlan = z.object({
  control: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  method: z.enum(['BOT', 'BOC']),
  effects: Text(100),
  ordnance: Text(100),
  interval: Text(100),
});
export type GamePlan = z.infer<typeof GamePlan>;

/** Who marks with a laser or IR pointer (line 7). */
export const MarkSource = z.discriminatedUnion('kind', [
  /** Each attacking aircraft lases for itself, with its own code (§9.5). */
  z.object({ kind: z.literal('ownship') }),
  /** A JTAC. */
  z.object({ kind: z.literal('jtac'), pid: Pid }),
  /** Another aircraft – buddy lase by the wingman or another flight. */
  z.object({ kind: z.literal('aircraft'), pid: Pid }),
]);
export type MarkSource = z.infer<typeof MarkSource>;

/** Line 7: the mark. */
export const Mark = z
  .object({
    type: z.enum(['none', 'laser', 'ir', 'smoke', 'other']),
    /** Laser only: the code of that laser; `null` with `ownship` (each aircraft uses its own). */
    code: LaserCode.nullable(),
    /** Laser and IR: who marks. */
    source: MarkSource.nullable(),
    /** Where the mark is, e.g. smoke at a keyhole point (§8.5). */
    at: PointRef.nullable(),
    /** Free text, e.g. "red smoke" or what `other` means. */
    text: Text(64),
  })
  .superRefine((mark, ctx) => {
    const pointer = mark.type === 'laser' || mark.type === 'ir';
    if (pointer && mark.source === null) {
      ctx.addIssue({ code: 'custom', path: ['source'], message: 'Say who marks' });
    }
    if (!pointer && mark.source !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'Only laser and IR have a source',
      });
    }
    if (mark.type !== 'laser' && mark.code !== null) {
      ctx.addIssue({ code: 'custom', path: ['code'], message: 'Only a laser has a code' });
    }
    if (mark.type === 'laser' && mark.source !== null) {
      const own = mark.source.kind === 'ownship';
      if (own && mark.code !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['code'],
          message: 'Ownship lasing uses each aircraft’s own code',
        });
      }
      if (!own && mark.code === null) {
        ctx.addIssue({ code: 'custom', path: ['code'], message: 'Give the laser’s code' });
      }
    }
  });
export type Mark = z.infer<typeof Mark>;

/** The 9-line (JP 3-09.3). Line 6 is stored as coordinates plus the text as passed. */
export const NineLine = z.object({
  /** Line 1: IP/BP – an IP/CP, a keyhole point or coordinates. */
  ipBp: PointRef.nullable(),
  /** Line 2: heading (degrees magnetic, as passed) and offset. */
  headingDeg: z.number().min(0).max(360).nullable(),
  offset: z.enum(['left', 'right']).nullable(),
  /** Line 3: distance in metres. */
  distanceM: z.number().nonnegative().max(200_000).nullable(),
  /** Line 4: target elevation, metres MSL. Read back. */
  elevationM: z.number().min(-500).max(9000).nullable(),
  /** Line 5. */
  description: Text(200),
  /** Line 6: target location. Read back. Each pilot sees it in his airframe's format. */
  location: LatLon.nullable(),
  /** Line 6 exactly as the JTAC passed it, e.g. `38T KM 12345 67890`. */
  locationText: Text(64),
  /** Line 7. */
  mark: Mark,
  /** Line 8. */
  friendlies: LinkedText,
  /** Line 9. */
  egress: Text(200),
});
export type NineLine = z.infer<typeof NineLine>;

/** Remarks and restrictions. Restrictions are read back (§10.5). */
export const Remarks = z.object({
  /** Laser-to-target line, degrees. */
  ltl: z.number().min(0).lt(360).nullable(),
  finalAttackHeading: z
    .object({ fromDeg: z.number().min(0).lt(360), toDeg: z.number().min(0).lt(360) })
    .nullable(),
  dangerClose: z.boolean(),
  /** Time on target, mission time. */
  tot: Mtime.nullable(),
  restrictions: z.array(Text(200)).max(10),
  hazards: Text(500),
  text: Text(1000),
});
export type Remarks = z.infer<typeof Remarks>;

/** The content a JTAC writes: game plan, 9-line, remarks. */
export const MissionContent = z.object({
  gamePlan: GamePlan.nullable(),
  nineLine: NineLine.nullable(),
  remarks: Remarks,
});
export type MissionContent = z.infer<typeof MissionContent>;

/** Fields whose change resets the readback: line 4, line 6, the restrictions (§10.5). */
export const READBACK_FIELDS = [
  'nineLine.elevationM',
  'nineLine.location',
  'nineLine.locationText',
  'remarks.restrictions',
] as const;

// ---------------------------------------------------------------------------
// Lanes (§10.3, §10.6–§10.8)

/** An electronic clearance. `window` = covered by a Type 3 window. */
export const Clearance = z.object({
  kind: z.enum(['hot', 'dry', 'window']),
  ts: EpochMs,
  mtime: Mtime.nullable(),
  by: Pid,
});
export type Clearance = z.infer<typeof Clearance>;

/** Why a lane was aborted besides a person's call: a read-back item changed, the pilot left the flight. */
export const AbortReason = z.string().min(1).max(100);

/** An abort of one lane. */
export const Abort = z.object({
  ts: EpochMs,
  mtime: Mtime.nullable(),
  /** The JTAC or the lane's pilot; `relay` for `rbChange` / `leftFlight`. */
  by: z.union([Pid, z.literal('relay')]),
  channel: z.enum(['app', 'voice']),
  /** Free text, or `rbChange`, `leftFlight`. */
  reason: AbortReason,
});
export type Abort = z.infer<typeof Abort>;

/** One attack run: its clearance and, if it happened, its abort. */
export const Run = z.object({
  run: z.int().positive(),
  clearance: Clearance,
  abort: Abort.nullable(),
});
export type Run = z.infer<typeof Run>;

/** A pilot's sensor point for correlation. */
export const Spi = LatLon.extend({ elevM: z.number().nullable() });
export type Spi = z.infer<typeof Spi>;

/** BDA effect (§10.8). */
export const BdaEffect = z.enum(['destroyed', 'damaged', 'neutralised', 'noEffect', 'unknown']);

/** BDA for one lane. The pilot acknowledges it (level 3). */
export const Bda = z.object({
  target: Text(200),
  effect: BdaEffect,
  location: LatLon.nullable(),
  mtime: Mtime.nullable(),
  remarks: Text(500),
  acked: z.boolean(),
});
export type Bda = z.infer<typeof Bda>;

/** Warnings on a lane – JTAC only, flagged, never blocked (§10.4, §10.6). */
export const LaneWarning = z.discriminatedUnion('kind', [
  /** Another laser source with the same code would be active in the AO at once. */
  z.object({ kind: z.literal('laserConflict'), code: LaserCode, with: MissionId }),
  /** Line 7's laser code isn't this aircraft's weapon code – the weapons wouldn't guide on it. */
  z.object({ kind: z.literal('codeMismatch'), code: LaserCode, weaponCode: LaserCode.nullable() }),
]);
export type LaneWarning = z.infer<typeof LaneWarning>;

/** One assigned aircraft's lane. A pilot only ever receives his own. */
export const Lane = z.object({
  pid: Pid,
  state: LaneState,
  spi: Spi.nullable(),
  runs: z.array(Run),
  bda: Bda.nullable(),
  /** JTACs only; empty in a pilot's view. */
  warnings: z.array(LaneWarning),
});
export type Lane = z.infer<typeof Lane>;

// ---------------------------------------------------------------------------
// Type 3 window (§10.6)

/** Where a Type 3 window applies: the whole AO, an existing map entry, or a circle. */
export const WindowArea = z.union([
  z.object({ cmId: CmId }),
  z.object({ center: PointRef, radiusM: z.number().positive().max(100_000) }),
]);
export type WindowArea = z.infer<typeof WindowArea>;

/** What a JTAC sends for a Type 3 window. Times are mission time; `pids: null` = every correlated lane. */
export const WindowDraft = z
  .object({
    pids: z.array(Pid).min(1).nullable(),
    from: Mtime,
    until: Mtime,
    /** `null` = the whole AO. */
    area: WindowArea.nullable(),
    targets: LinkedText,
    restrictions: z.array(Text(200)).max(10),
  })
  .superRefine((window, ctx) => {
    if (window.until <= window.from) {
      ctx.addIssue({ code: 'custom', path: ['until'], message: 'Ends before it starts' });
    }
  });
export type WindowDraft = z.infer<typeof WindowDraft>;

/** The window as the relay keeps it: which lanes it covers, who set it, revoked or not. */
export const Window = WindowDraft.safeExtend({
  pids: z.array(Pid).min(1),
  by: Pid,
  revoked: z.boolean(),
});
export type Window = z.infer<typeof Window>;

// ---------------------------------------------------------------------------
// The mission object (§10.4)

/** A change after the brief that needs every assigned aircraft's acknowledgement (§10.5). */
export const MissionChange = z.object({
  rev: z.int().positive(),
  /** Changed fields as paths, e.g. `nineLine.description`. */
  fields: z.array(z.string().min(1)).min(1),
  /** The values before the change, by path. */
  old: z.record(z.string(), z.json()),
  /** Who has acknowledged. A pilot's view lists only himself, if he has. */
  ackedBy: z.array(Pid),
});
export type MissionChange = z.infer<typeof MissionChange>;

/** Whole flight (`pids: null`) or some of its aircraft. */
export const Assignee = z.object({
  flightId: FlightId,
  pids: z.array(Pid).min(1).max(4).nullable(),
});
export type Assignee = z.infer<typeof Assignee>;

export const FireMission = MissionContent.extend({
  missionId: MissionId,
  aoId: AoId,
  /** The creator; never changes. Only he deletes and hands command over (§10.2). */
  owner: Pid,
  inCommand: Pid,
  /** Command offered to this JTAC, waiting for his accept. */
  commandOffer: Pid.nullable(),
  revision: z.int().positive(),
  state: MissionState,
  assignee: Assignee.nullable(),
  changes: z.array(MissionChange),
  /** One per assigned aircraft from `assigned` on, `open` until the readback; a pilot gets only his own. */
  lanes: z.array(Lane),
  window: Window.nullable(),
  voiceOnly: z.boolean(),
}).superRefine((mission, ctx) => {
  if (mission.state === 'draft' && mission.assignee !== null) {
    ctx.addIssue({ code: 'custom', path: ['assignee'], message: 'A draft is not assigned' });
  }
  if (mission.state !== 'draft' && mission.assignee === null && mission.state !== 'cancelled') {
    ctx.addIssue({ code: 'custom', path: ['assignee'], message: 'Needs an assignee' });
  }
  if (mission.state === 'draft' && mission.lanes.length > 0) {
    ctx.addIssue({ code: 'custom', path: ['lanes'], message: 'A draft has no lanes' });
  }
  if (
    !LANE_STATES_OF_MISSION.has(mission.state) &&
    mission.lanes.some((lane) => lane.state !== 'open')
  ) {
    ctx.addIssue({ code: 'custom', path: ['lanes'], message: 'Lanes stay open until readback' });
  }
  const pids = mission.lanes.map((lane) => lane.pid);
  if (new Set(pids).size !== pids.length) {
    ctx.addIssue({ code: 'custom', path: ['lanes'], message: 'An aircraft has two lanes' });
  }
  if (mission.commandOffer !== null && mission.commandOffer === mission.inCommand) {
    ctx.addIssue({ code: 'custom', path: ['commandOffer'], message: 'Already in command' });
  }
});
export type FireMission = z.infer<typeof FireMission>;

// ---------------------------------------------------------------------------
// Messages (§10.9). All of them `ack: true`; the relay answers with `fm.updated`.

const ById = z.object({ missionId: MissionId });
const ByLane = ById.extend({ pid: Pid });

/** `fm.create` (any JTAC in the AO, who becomes owner and in command). The mission starts as `draft`. */
export const FmCreate = defineMessage('fm.create', MissionContent.extend({ aoId: AoId }));
/** `fm.update`: the new content, in full. The relay works out what changed (§10.5). */
export const FmUpdate = defineMessage('fm.update', MissionContent.extend({ missionId: MissionId }));
/** `fm.assign`: to a checked-in flight or some of its aircraft; the game plan counts as passed. */
export const FmAssign = defineMessage('fm.assign', ById.extend({ assignee: Assignee }));
/** `fm.unassign`: back to `draft`, content kept, lanes removed. */
export const FmUnassign = defineMessage('fm.unassign', ById);
/** `fm.brief`: 9-line and remarks passed; readback pending on voice. */
export const FmBrief = defineMessage('fm.brief', ById);
/** `fm.readbackCorrect`: the JTAC confirms the readback; the lanes start. */
export const FmReadbackCorrect = defineMessage('fm.readbackCorrect', ById);
/** `fm.ackChange` (pilot): acknowledges change `rev` for his own aircraft. */
export const FmAckChange = defineMessage('fm.ackChange', ById.extend({ rev: z.int().positive() }));
/** `fm.spi` (pilot, own lane): his sensor point. */
export const FmSpi = defineMessage('fm.spi', ById.extend({ spi: Spi }));
/** `fm.correlated`: correlation for one lane done. */
export const FmCorrelated = defineMessage('fm.correlated', ByLane);
/** `fm.clear`: cleared hot / continue dry for one aircraft (Type 1/2). */
export const FmClear = defineMessage('fm.clear', ByLane.extend({ kind: z.enum(['hot', 'dry']) }));
/** `fm.window`: Type 3 "cleared to engage". Expires by the relay's clock (§1.4). */
export const FmWindow = defineMessage('fm.window', ById.extend({ window: WindowDraft }));
/** `fm.windowRevoke`: ends the window at once; its lanes go back to `correlated`. */
export const FmWindowRevoke = defineMessage('fm.windowRevoke', ById);
/** `fm.waitingBda`: the attack is over (OFF on voice); the clearance ends. */
export const FmWaitingBda = defineMessage('fm.waitingBda', ByLane);
/** `fm.abort`: any JTAC in the AO, or the pilot for his own lane. A voice abort is clicked in afterwards. */
export const FmAbort = defineMessage(
  'fm.abort',
  ByLane.extend({ channel: z.enum(['app', 'voice']), reason: Text(100) }),
);
/** `fm.voiceOnly`: the SLATE link was lost mid-mission – shown on both sides and logged. */
export const FmVoiceOnly = defineMessage('fm.voiceOnly', ById.extend({ on: z.boolean() }));
/** `fm.bda`: BDA for one lane. */
export const FmBda = defineMessage('fm.bda', ByLane.extend(Bda.omit({ acked: true }).shape));
/** `fm.ackBda` (pilot): acknowledges the BDA of his own lane. */
export const FmAckBda = defineMessage('fm.ackBda', ById);
/** `fm.reattack`: one lane back to `correlated`, or the whole mission back to `assigned` (replan). */
export const FmReattack = defineMessage(
  'fm.reattack',
  z.discriminatedUnion('to', [
    ByLane.extend({ to: z.literal('attack') }),
    ById.extend({ to: z.literal('replan') }),
  ]),
);
/** `fm.complete`: closes the mission with all lanes. */
export const FmComplete = defineMessage('fm.complete', ById);
/** `fm.cancel`: from any open state. */
export const FmCancel = defineMessage('fm.cancel', ById);
/** `fm.delete`: owner only; it stays in the CAS log. */
export const FmDelete = defineMessage('fm.delete', ById);
/** `fm.offerCommand`: owner only, to another JTAC of the AO. */
export const FmOfferCommand = defineMessage('fm.offerCommand', ByLane);
/** `fm.acceptCommand`: the offered JTAC takes command. */
export const FmAcceptCommand = defineMessage('fm.acceptCommand', ById);
/** `fm.returnCommand`: a JTAC given command hands it back to the owner – the only handover he can make. */
export const FmReturnCommand = defineMessage('fm.returnCommand', ById);
/** `fm.reclaim`: the owner takes command back at any time. */
export const FmReclaim = defineMessage('fm.reclaim', ById);

/** `fm.updated` (relay → the AO's JTACs + the assigned flight): the full mission; a pilot gets only his lane. */
export const FmUpdated = defineMessage('fm.updated', FireMission);
export type FmUpdated = z.infer<typeof FmUpdated>;

/** `fm.deleted` (relay): deleted – or, with `hidden: true`, no longer visible to this viewer (unassigned). */
export const FmDeleted = defineMessage(
  'fm.deleted',
  z.object({ missionId: MissionId, hidden: z.boolean() }),
);
export type FmDeleted = z.infer<typeof FmDeleted>;

/** Every host → relay mission message, for the relay's dispatch. */
export const FM_COMMANDS = [
  FmCreate,
  FmUpdate,
  FmAssign,
  FmUnassign,
  FmBrief,
  FmReadbackCorrect,
  FmAckChange,
  FmSpi,
  FmCorrelated,
  FmClear,
  FmWindow,
  FmWindowRevoke,
  FmWaitingBda,
  FmAbort,
  FmVoiceOnly,
  FmBda,
  FmAckBda,
  FmReattack,
  FmComplete,
  FmCancel,
  FmDelete,
  FmOfferCommand,
  FmAcceptCommand,
  FmReturnCommand,
  FmReclaim,
] as const;
