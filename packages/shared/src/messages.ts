// SPDX-License-Identifier: GPL-3.0-or-later
// All known message types, and parsing of inbound messages.

import { z } from 'zod';

import { AoClosed, AoCreated, AoUpdate, AoUpdated, JtacOffStation, JtacOnStation } from './aos.js';
import { LogEntries, LogRequest } from './cas-log.js';
import {
  CasCheckedIn,
  CasCheckedOut,
  CasCheckIn,
  CasCheckOut,
  CasHoldAssign,
  CasHoldCancel,
  CasHoldCancelled,
  CasHoldUpdate,
  CasHoldUpdated,
  CasHoldWilco,
  CasRelease,
  CasSitCopy,
  CasSitUpdate,
} from './checkins.js';
import { ErrorMessage, Hello, MsgReceived, Reject, RelayReceipt, Welcome } from './control.js';
import { EnvelopeBase } from './envelope.js';
import {
  FlightClosed,
  FlightCreate,
  FlightCreated,
  FlightJoin,
  FlightLeave,
  FlightListed,
  FlightMove,
  FlightMoveUp,
  FlightUpdated,
} from './flights.js';
import { CmCreate, CmCreated, CmDelete, CmDeleted, CmUpdate, CmUpdated } from './map-entries.js';
import {
  FmAbort,
  FmAcceptCommand,
  FmAckBda,
  FmAckChange,
  FmAssign,
  FmBda,
  FmBrief,
  FmCancel,
  FmClear,
  FmComplete,
  FmCorrelated,
  FmCreate,
  FmDelete,
  FmDeleted,
  FmOfferCommand,
  FmReadbackCorrect,
  FmReattack,
  FmReclaim,
  FmReturnCommand,
  FmSpi,
  FmUnassign,
  FmUpdate,
  FmUpdated,
  FmVoiceOnly,
  FmWaitingBda,
  FmWindow,
  FmWindowRevoke,
} from './missions.js';
import { PROTOCOL_VERSION } from './protocol.js';
import {
  SessionClosed,
  SessionJoin,
  SessionJoined,
  SessionLeave,
  SessionPresence,
  SessionState,
  SessionSwitch,
  SessionUpdate,
  SessionUpdated,
} from './session.js';
import { FuelCall, StatusPosition, StatusUpdate } from './status.js';

/**
 * Every message type this version knows. New message types are added here –
 * the compiler then flags every `switch (message.type)` that misses one.
 */
export const Message = z.discriminatedUnion('type', [
  // Confirmations and errors (§1.2, §1.3)
  RelayReceipt,
  MsgReceived,
  ErrorMessage,
  // Version handshake (§3)
  Hello,
  Welcome,
  Reject,
  // Session (§4, §5)
  SessionJoin,
  SessionJoined,
  SessionState,
  SessionPresence,
  SessionSwitch,
  SessionUpdate,
  SessionUpdated,
  SessionLeave,
  SessionClosed,
  // Status packages and fuel calls (§6)
  StatusUpdate,
  StatusPosition,
  FuelCall,
  // Flights (§7)
  FlightCreate,
  FlightCreated,
  FlightJoin,
  FlightLeave,
  FlightMove,
  FlightMoveUp,
  FlightUpdated,
  FlightListed,
  FlightClosed,
  // JTAC on-station and AOs (§8.1–§8.3)
  JtacOnStation,
  JtacOffStation,
  AoCreated,
  AoUpdate,
  AoUpdated,
  AoClosed,
  // Map entries (§8.4, §8.5)
  CmCreate,
  CmCreated,
  CmUpdate,
  CmUpdated,
  CmDelete,
  CmDeleted,
  // Check-in, situation update, holds (§9)
  CasCheckIn,
  CasCheckedIn,
  CasCheckOut,
  CasRelease,
  CasCheckedOut,
  CasSitUpdate,
  CasSitCopy,
  CasHoldAssign,
  CasHoldUpdate,
  CasHoldCancel,
  CasHoldUpdated,
  CasHoldCancelled,
  CasHoldWilco,
  // Fire missions (§10)
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
  FmUpdated,
  FmDeleted,
  // CAS log (§12)
  LogRequest,
  LogEntries,
]);
export type Message = z.infer<typeof Message>;
export type MessageTypeName = Message['type'];

const KNOWN_TYPES: ReadonlySet<string> = new Set(
  Message.options.map((option) => option.shape.type.value),
);

/** Why an inbound message was refused. Matches the error codes the receiver sends back. */
export type ParseFailureCode = 'badMessage' | 'versionMismatch' | 'unsupported';

export type ParseResult =
  | { ok: true; message: Message }
  | {
      ok: false;
      code: ParseFailureCode;
      /** Readable reason, for logs and the `error` message's `text`. */
      detail: string;
      /** The message ID, if it could be read – becomes `re` of the `error` reply. */
      id: string | null;
    };

/**
 * Validates an inbound message (already decoded from JSON).
 *
 * - Envelope broken → `badMessage`
 * - Other protocol major → `versionMismatch`
 * - Unknown `type` → `unsupported` (protocol.md §3.4)
 * - Known type, body broken → `badMessage`
 *
 * Unknown fields are stripped, never an error.
 */
export function parseMessage(input: unknown): ParseResult {
  const envelope = EnvelopeBase.safeParse(input);
  if (!envelope.success) {
    return fail('badMessage', z.prettifyError(envelope.error), readId(input));
  }
  const { v, type, id } = envelope.data;

  if (v !== PROTOCOL_VERSION) {
    return fail(
      'versionMismatch',
      `Protocol version ${v} is not supported (expected ${PROTOCOL_VERSION})`,
      id,
    );
  }
  if (!KNOWN_TYPES.has(type)) {
    return fail('unsupported', `Unknown message type "${type}"`, id);
  }

  const message = Message.safeParse(input);
  if (!message.success) {
    return fail('badMessage', z.prettifyError(message.error), id);
  }
  return { ok: true, message: message.data };
}

/** Like `parseMessage`, for one WebSocket text frame or UDP datagram. */
export function parseMessageText(text: string): ParseResult {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return fail('badMessage', 'Not valid JSON', null);
  }
  return parseMessage(input);
}

function fail(code: ParseFailureCode, detail: string, id: string | null): ParseResult {
  return { ok: false, code, detail, id };
}

/** Reads `id` from a message that failed validation, if it's a usable ID. */
function readId(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || !('id' in input)) return null;
  const parsed = EnvelopeBase.shape.id.safeParse(input.id);
  return parsed.success ? parsed.data : null;
}
