// SPDX-License-Identifier: GPL-3.0-or-later
// Host ↔ UI messages (protocol.md §14): between slate-host and its screens.
// This layer never reaches the relay.

import { z } from 'zod';

import { Coalition, Nick, RoleId } from './common.js';
import { MessageId } from './envelope.js';
import { FlightCreate, FlightJoin, FlightMove } from './flights.js';
import { SessionCode } from './session.js';
import { SLICE_SCHEMAS, SpeedSelection, TimeDisplay, UiScale } from './slices.js';
import { Fuel, Position, WeaponStation } from './status.js';

// ---------------------------------------------------------------------------
// Rules (§14.5)

export const UI_TIMING = {
  /** The host remembers command IDs this long; a repeat isn't applied again. */
  commandMemoryMin: 10,
  /** The screen shows "no answer" after this long without `cmd.result`. */
  pendingTimeoutSec: 5,
  /** The host gives up on the relay after this long (`relayTimeout`). */
  relayTimeoutSec: 10,
  /** Reconnect backoff: first delay … */
  reconnectFirstMs: 500,
  /** … doubling up to this. */
  reconnectMaxMs: 5000,
} as const;

/** Path of the WebSocket on the host's UI port (§14.1). */
export const UI_WEBSOCKET_PATH = '/ws';

// ---------------------------------------------------------------------------
// State slices (§14.3)

/** Names of the host's state slices. */
export const SLICE_NAMES = [
  'host',
  'session',
  'flight',
  'ownship',
  'traffic',
  'mission',
  'dcs',
  'settings',
] as const;
export const SliceName = z.enum(SLICE_NAMES);
export type SliceName = z.infer<typeof SliceName>;

/** All slices with their contents (slices.ts) – a snapshot must contain every one. */
export const Slices = z.object(SLICE_SCHEMAS);
export type Slices = z.infer<typeof Slices>;

/** Some slices – an update replaces at least one. */
export const SliceChanges = Slices.partial().refine((changes) => Object.keys(changes).length > 0, {
  message: 'An update must change at least one slice',
});

// ---------------------------------------------------------------------------
// Command arguments (§14.7). Relay-bound commands reuse the relay body schemas.

/** Relay address as typed for a manual join: host name or IPv4, optional port. */
export const RelayAddress = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9.-]+(:\d{1,5})?$/, 'Expected an address like slate.example.org:7790')
  .refine((address) => {
    const port = address.split(':')[1];
    return port === undefined || (Number(port) >= 1 && Number(port) <= 65535);
  }, 'Port must be 1–65535');

const command = <const C extends string, A extends z.ZodType>(cmd: C, args: A) =>
  z.object({ cmd: z.literal(cmd), args });

const Empty = z.object({});

/** Every command a screen can send in P1. */
export const Command = z.discriminatedUnion('cmd', [
  // Session (§4, §5) – manual join only; discovery joins are started by the host.
  command(
    'session.join',
    z.object({
      address: RelayAddress,
      code: SessionCode,
      /** Required with the group code; the relay checks. */
      coalition: Coalition.nullable(),
      nick: Nick,
      role: RoleId,
    }),
  ),
  command('session.leave', Empty),
  // Flights (§7) – forwarded to the relay unchanged.
  command('flight.create', FlightCreate.shape.body),
  command('flight.join', FlightJoin.shape.body),
  command('flight.leave', Empty),
  command('flight.move', FlightMove.shape.body),
  command('flight.moveUp', Empty),
  // Manual own-ship values – host only; `null` = back to the export/server value.
  command('ownship.setPosition', Position.pick({ lat: true, lon: true, altMsl: true }).nullable()),
  command('ownship.setFuel', Fuel.omit({ source: true }).nullable()),
  command('ownship.setStation', WeaponStation.omit({ source: true })),
  command('ownship.clearStation', WeaponStation.pick({ st: true })),
  command('ownship.setGun', z.object({ rounds: z.int().nonnegative() }).nullable()),
  // DCS user folders (P1.3) – host only. `folder` is a folder name from the
  // `dcs` slice, never a path.
  command('dcs.rescan', Empty),
  command('dcs.install', z.object({ folder: z.string().min(1) })),
  command('dcs.repair', z.object({ folder: z.string().min(1) })),
  command('dcs.remove', z.object({ folder: z.string().min(1) })),
  // Settings – host only.
  command(
    'settings.set',
    z
      .object({
        timeDisplay: TimeDisplay.optional(),
        uiScale: UiScale.optional(),
        speeds: SpeedSelection.optional(),
      })
      .refine((settings) => Object.keys(settings).length > 0, {
        message: 'Set at least one setting',
      }),
  ),
]);
export type Command = z.infer<typeof Command>;
export type CommandName = Command['cmd'];

const COMMAND_NAMES: ReadonlySet<string> = new Set(
  Command.options.map((option) => option.shape.cmd.value),
);

/** Commands the host forwards to the relay; their `cmd.result` waits for its answer (§14.5). */
export const RELAY_COMMANDS: ReadonlySet<CommandName> = new Set([
  'session.join',
  'session.leave',
  'flight.create',
  'flight.join',
  'flight.leave',
  'flight.move',
  'flight.moveUp',
]);

// ---------------------------------------------------------------------------
// Messages (§14.2)

/** Host state sequence number (§14.4). */
const UiSeq = z.int().nonnegative();

/** `state.snapshot` (host → screen): the full state, on connect and after `state.resync`. */
export const StateSnapshot = z.object({
  t: z.literal('state.snapshot'),
  seq: UiSeq,
  body: z.object({
    /** Host build version, e.g. `0.1.0+3f2c1ab` (§14.6). */
    build: z.string().min(1),
    slices: Slices,
  }),
});
export type StateSnapshot = z.infer<typeof StateSnapshot>;

/** `state.update` (host → all screens): replaces one or more slices completely. */
export const StateUpdate = z.object({
  t: z.literal('state.update'),
  seq: UiSeq.min(1),
  body: z.object({ slices: SliceChanges }),
});
export type StateUpdate = z.infer<typeof StateUpdate>;

/** `state.resync` (screen → host): asks for a fresh snapshot after a gap. */
export const StateResync = z.object({ t: z.literal('state.resync'), body: Empty });
export type StateResync = z.infer<typeof StateResync>;

/** `cmd` (screen → host). `id` is a ULID made by the screen (§14.5). */
export const CommandMessage = z.object({ t: z.literal('cmd'), id: MessageId, body: Command });
export type CommandMessage = z.infer<typeof CommandMessage>;

/** Error codes of `cmd.result` (§14.5). */
export const UI_ERROR_CODES = [
  'badCommand',
  'unknownCommand',
  'forbidden',
  'notPossible',
  'relayError',
  'relayTimeout',
  'notConnected',
] as const;
export const UiErrorCode = z.enum(UI_ERROR_CODES);
export type UiErrorCode = z.infer<typeof UiErrorCode>;

/** `cmd.result` (host → the sending screen only). */
export const CommandResult = z.object({
  t: z.literal('cmd.result'),
  id: MessageId,
  body: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), error: z.object({ code: UiErrorCode, text: z.string() }) }),
  ]),
});
export type CommandResult = z.infer<typeof CommandResult>;

/** Messages the host sends to screens. */
export const HostToScreen = z.discriminatedUnion('t', [StateSnapshot, StateUpdate, CommandResult]);
export type HostToScreen = z.infer<typeof HostToScreen>;

/** Messages screens send to the host. */
export const ScreenToHost = z.discriminatedUnion('t', [StateResync, CommandMessage]);
export type ScreenToHost = z.infer<typeof ScreenToHost>;

// ---------------------------------------------------------------------------
// Parsing

export type ScreenParseResult =
  | { ok: true; message: ScreenToHost }
  /** Answer with `cmd.result` (badCommand / unknownCommand) to this `id`. */
  | { ok: false; reply: { id: string; code: 'badCommand' | 'unknownCommand'; text: string } }
  /** No readable command ID: log and drop (§14.5). */
  | { ok: false; reply: null; detail: string };

/** Host side: validates a frame from a screen (already decoded from JSON, or as text). */
export function parseScreenMessage(input: unknown): ScreenParseResult {
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      return { ok: false, reply: null, detail: 'Not valid JSON' };
    }
  }
  const parsed = ScreenToHost.safeParse(input);
  if (parsed.success) return { ok: true, message: parsed.data };

  const id = readCommandId(input);
  if (id === null) return { ok: false, reply: null, detail: z.prettifyError(parsed.error) };

  const name = readCommandName(input);
  if (name !== null && !COMMAND_NAMES.has(name)) {
    return {
      ok: false,
      reply: { id, code: 'unknownCommand', text: `Unknown command "${name}"` },
    };
  }
  return { ok: false, reply: { id, code: 'badCommand', text: z.prettifyError(parsed.error) } };
}

export type HostParseResult = { ok: true; message: HostToScreen } | { ok: false; detail: string };

/** Screen side: validates a frame from the host (already decoded from JSON, or as text). */
export function parseHostMessage(input: unknown): HostParseResult {
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      return { ok: false, detail: 'Not valid JSON' };
    }
  }
  const parsed = HostToScreen.safeParse(input);
  return parsed.success
    ? { ok: true, message: parsed.data }
    : { ok: false, detail: z.prettifyError(parsed.error) };
}

/** Reads the command ID of a `cmd` frame that failed validation, if usable. */
function readCommandId(input: unknown): string | null {
  if (!isRecord(input) || input['t'] !== 'cmd') return null;
  const id = MessageId.safeParse(input['id']);
  return id.success ? id.data : null;
}

/** Reads `body.cmd` of a frame that failed validation, if it is a string. */
function readCommandName(input: unknown): string | null {
  if (!isRecord(input) || !isRecord(input['body'])) return null;
  const name = input['body']['cmd'];
  return typeof name === 'string' ? name : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Screen-side helpers (§14.4, §14.5)

/**
 * What a screen does with a `state.update` (§14.4): apply it if its `seq` is
 * last + 1, ignore it if old or repeated, resync on a gap.
 */
export function updateAction(lastSeq: number, updateSeq: number): 'apply' | 'ignore' | 'resync' {
  if (updateSeq === lastSeq + 1) return 'apply';
  return updateSeq <= lastSeq ? 'ignore' : 'resync';
}

/** Reconnect delay for the n-th attempt (0-based): 0.5 s, doubling, max 5 s (§14.5). */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(UI_TIMING.reconnectFirstMs * 2 ** Math.max(0, attempt), UI_TIMING.reconnectMaxMs);
}
