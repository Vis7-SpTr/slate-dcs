// SPDX-License-Identifier: GPL-3.0-or-later
// Fire-mission log entries (protocol.md §12.2), worked out from what changed
// between two versions of a mission – so the relay's own steps (a Type 3
// window opening or ending, command moving on a drop-out, a lane going with a
// pilot who left) are logged the same way as a JTAC's command. Entries about
// one aircraft carry its pid: a pilot's export shows only his own (§12.3).

import type { FireMission, Lane, MissionContent, Run } from '@slate-dcs/shared';

import { mtText } from './cas-log.js';

export interface MissionLogLine {
  kind: string;
  summary: string;
  pid: string | null;
  jtacOnly?: boolean;
}

export interface MissionLogNames {
  nameOf(pid: string): string;
  flightName(flightId: string | null | undefined): string;
}

/** Readable names of content fields (§10.4). */
const FIELD_NAMES: [prefix: string, name: string][] = [
  ['gamePlan', 'game plan'],
  ['nineLine.ipBp', 'line 1'],
  ['nineLine.headingDeg', 'line 2'],
  ['nineLine.offset', 'line 2'],
  ['nineLine.distanceM', 'line 3'],
  ['nineLine.elevationM', 'line 4'],
  ['nineLine.description', 'line 5'],
  ['nineLine.location', 'line 6'],
  ['nineLine.locationText', 'line 6'],
  ['nineLine.mark', 'line 7'],
  ['nineLine.friendlies', 'line 8'],
  ['nineLine.egress', 'line 9'],
  ['remarks.restrictions', 'restrictions'],
  ['remarks.tot', 'TOT'],
  ['remarks.ltl', 'LTL'],
  ['remarks.finalAttackHeading', 'final attack heading'],
  ['remarks.dangerClose', 'danger close'],
  ['remarks.hazards', 'hazards'],
  ['remarks.text', 'remarks'],
];

/** Why the relay aborted a lane (missions.ts), in words. */
const ABORT_REASONS: Record<string, string> = {
  rbChange: 'read-back item changed',
  replan: 'replan',
  leftFlight: 'left the flight',
};

const BDA_EFFECTS: Record<string, string> = {
  destroyed: 'destroyed',
  damaged: 'damaged',
  neutralised: 'neutralised',
  noEffect: 'no effect',
  unknown: 'unknown',
};

const COMMAND_KINDS = new Set(['fm.acceptCommand', 'fm.returnCommand', 'fm.reclaim']);

function value(content: MissionContent, path: string): string {
  const [group, key] = path.split('.') as [keyof MissionContent, string | undefined];
  const part = content[group] as Record<string, unknown> | null;
  return JSON.stringify(key === undefined ? part : (part?.[key] ?? null));
}

/** The changed fields as `line 6, restrictions`. */
function changedFields(before: MissionContent, after: MissionContent): string {
  const names = FIELD_NAMES.filter(([path]) => value(before, path) !== value(after, path)).map(
    ([, name]) => name,
  );
  return [...new Set(names)].join(', ') || 'content';
}

function runText(run: Run): string {
  return `run ${String(run.run)}`;
}

/** Every entry for the step from `before` (`null` = just created) to `after`. */
export function missionLogLines(
  before: FireMission | null,
  after: FireMission,
  names: MissionLogNames,
  handled: { pid: string; type: string } | null,
): MissionLogLine[] {
  const command = handled?.type ?? null;
  const lines: MissionLogLine[] = [];
  const add = (kind: string, summary: string, pid: string | null = null, jtacOnly = false) => {
    lines.push({ kind, summary, pid, jtacOnly });
  };
  const who = (pid: string) => names.nameOf(pid);

  if (before === null) {
    const plan = after.gamePlan;
    const type = plan ? `Type ${String(plan.control)} ${plan.method}` : 'no game plan yet';
    const target = after.nineLine?.description ? ` – ${after.nineLine.description}` : '';
    add('fm.create', `mission created (${type})${target}`);
    return lines;
  }

  // Content and state of the mission as a whole.
  if (after.revision > before.revision) {
    add('fm.update', `revision ${String(after.revision)}: ${changedFields(before, after)} changed`);
  }
  if (after.state !== before.state) stateLine(before, after, names, add);

  // Command (§10.2).
  if (after.inCommand !== before.inCommand) {
    const kind = command !== null && COMMAND_KINDS.has(command) ? command : 'fm.commandMoved';
    add(kind, `command → ${who(after.inCommand)}`);
  }
  if (after.commandOffer !== null && after.commandOffer !== before.commandOffer) {
    add('fm.offerCommand', `command offered to ${who(after.commandOffer)}`);
  }
  if (after.voiceOnly !== before.voiceOnly) {
    add('fm.voiceOnly', after.voiceOnly ? 'voice only – app clearances off' : 'voice only off');
  }

  // Change acknowledgements (§10.5), per aircraft.
  for (const change of after.changes) {
    const old = before.changes.find((c) => c.rev === change.rev);
    for (const pid of change.ackedBy) {
      if (!old?.ackedBy.includes(pid)) {
        add('fm.ackChange', `${who(pid)} acknowledged revision ${String(change.rev)}`, pid);
      }
    }
  }

  // Type 3 window (§10.6): set, revoked or over – per covered aircraft.
  const prev = before.window;
  const windowSet =
    after.window !== null &&
    (prev?.from !== after.window.from ||
      prev.until !== after.window.until ||
      prev.by !== after.window.by);
  if (after.window !== null && windowSet) {
    const { from, until, by } = after.window;
    for (const pid of after.window.pids) {
      add(
        'fm.window',
        `Type 3 window ${mtText(from)} – ${mtText(until)} for ${who(pid)} (set by ${who(by)})`,
        pid,
      );
    }
  }
  const windowEnded =
    before.window !== null && after.window === null && after.state === before.state;
  if (before.window !== null && windowEnded) {
    // Revoked by the JTAC, or over on the relay's clock (no command behind it).
    const kind =
      command === 'fm.windowRevoke'
        ? 'fm.windowRevoke'
        : command === null
          ? 'fm.windowExpired'
          : null;
    if (kind !== null) {
      for (const pid of before.window.pids) {
        const text = kind === 'fm.windowRevoke' ? 'revoked' : 'over';
        add(kind, `Type 3 window ${text} for ${who(pid)}`, pid);
      }
    }
  }

  // Lanes, one aircraft each (§10.3).
  const assigning = before.state === 'draft' && after.state !== 'draft';
  const unassigning = after.state === 'draft';
  for (const lane of after.lanes) {
    const old = before.lanes.find((l) => l.pid === lane.pid);
    if (!old) {
      if (!assigning) add('fm.laneAdded', `${who(lane.pid)} joined the mission`, lane.pid);
      continue;
    }
    laneLines(old, lane, after.missionId, names, handled?.pid ?? null, add);
  }
  if (!unassigning) {
    for (const old of before.lanes) {
      if (!after.lanes.some((l) => l.pid === old.pid)) {
        // A cleared lane goes with an abort (§7.2) – the lane itself is gone, so say it here.
        const run = old.runs.at(-1);
        if (old.state === 'cleared' && run) {
          add('fm.abort', `ABORT ${who(old.pid)} (${runText(run)}): left the flight`, old.pid);
        }
        add('fm.laneRemoved', `${who(old.pid)} left the mission`, old.pid);
      }
    }
  }
  return lines;
}

type Add = (kind: string, summary: string, pid?: string | null, jtacOnly?: boolean) => void;

function stateLine(
  before: FireMission,
  after: FireMission,
  names: MissionLogNames,
  add: Add,
): void {
  const from = before.state;
  switch (after.state) {
    case 'assigned': {
      if (from === 'readbackCorrect') {
        add('fm.reattack', 'replan – back to assigned, new brief and readback');
        return;
      }
      const flight = names.flightName(after.assignee?.flightId);
      const aircraft = after.lanes.map((lane) => names.nameOf(lane.pid)).join(', ');
      add('fm.assign', `assigned to ${flight} (${aircraft})`);
      return;
    }
    case 'draft':
      add(
        'fm.unassign',
        `back to draft – unassigned from ${names.flightName(before.assignee?.flightId)}`,
      );
      return;
    case 'briefed':
      if (from === 'readbackCorrect')
        add('fm.update', 'read-back item changed – brief and readback again');
      else add('fm.brief', 'briefed');
      return;
    case 'readbackCorrect':
      add('fm.readbackCorrect', 'READBACK CORRECT');
      return;
    case 'complete':
      add('fm.complete', 'mission complete');
      return;
    case 'cancelled':
      add('fm.cancel', 'mission cancelled');
      return;
  }
}

function laneLines(
  old: Lane,
  lane: Lane,
  missionId: string,
  names: MissionLogNames,
  actor: string | null,
  add: Add,
): void {
  const pid = lane.pid;
  const who = names.nameOf(pid);
  // New runs: one clearance each (§10.3).
  for (const run of lane.runs.slice(old.runs.length)) {
    const kind = run.clearance.kind;
    if (kind === 'window')
      add('fm.windowOpened', `CLEARED TO ENGAGE ${who} – Type 3 window (${runText(run)})`, pid);
    else add('fm.clear', `CLEARED ${kind === 'hot' ? 'HOT' : 'DRY'} ${who} (${runText(run)})`, pid);
  }
  // Aborts: on a run that had none (§10.7).
  for (const run of lane.runs) {
    const before = old.runs.find((r) => r.run === run.run);
    const abort = run.abort;
    if (!abort || before?.abort) continue;
    const reason = ABORT_REASONS[abort.reason] ?? abort.reason;
    // The relay's own aborts (read-back change, replan, left the flight) have no channel.
    const how =
      abort.by === 'relay'
        ? ''
        : `${abort.by === actor ? '' : ` by ${names.nameOf(abort.by)}`} on ${abort.channel}`;
    add('fm.abort', `ABORT ${who} (${runText(run)})${how}: ${reason}`, pid);
  }
  if (lane.state !== old.state) {
    if (lane.state === 'correlated' && old.state === 'open')
      add('fm.correlated', `${who} correlated`, pid);
    if (lane.state === 'correlated' && (old.state === 'waitingBda' || old.state === 'bda')) {
      add('fm.reattack', `${who} re-attack`, pid);
    }
    if (lane.state === 'waitingBda')
      add('fm.waitingBda', `${who} off target – waiting for BDA`, pid);
    if (lane.state === 'bda' && lane.bda) {
      const target = lane.bda.target ? ` – ${lane.bda.target}` : '';
      add('fm.bda', `BDA ${who}: ${BDA_EFFECTS[lane.bda.effect] ?? lane.bda.effect}${target}`, pid);
    }
  }
  if (lane.bda?.acked && !old.bda?.acked) add('fm.ackBda', `${who} acknowledged the BDA`, pid);
  if (lane.spi !== null && JSON.stringify(lane.spi) !== JSON.stringify(old.spi)) {
    add('fm.spi', `${who} sent his SPI`, pid);
  }
  // Laser warnings (§10.4, §10.6): JTACs only; logged when they appear.
  for (const warning of lane.warnings) {
    if (old.warnings.some((w) => JSON.stringify(w) === JSON.stringify(warning))) continue;
    const text =
      warning.kind === 'laserConflict'
        ? `laser conflict for ${who}: code ${String(warning.code)} also lased ${warning.with === missionId ? 'by another aircraft of this mission' : `on mission ${warning.with}`}`
        : `code mismatch for ${who}: line 7 code ${String(warning.code)}, weapon code ${warning.weaponCode === null ? 'not set' : String(warning.weaponCode)}`;
    add('fm.warning', text, pid, true);
  }
}
