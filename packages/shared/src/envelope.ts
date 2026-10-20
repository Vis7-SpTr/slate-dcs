// SPDX-License-Identifier: GPL-3.0-or-later
// Message envelope and addressing (protocol.md §0, §1, §1.1).

import { z } from 'zod';

import { PROTOCOL_VERSION } from './protocol.js';

/**
 * Message ID: a ULID – 26 characters, Crockford base32 (no I, L, O, U).
 * Unique and sortable by time (protocol.md §0).
 */
export const MessageId = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Expected a ULID (26 characters, Crockford base32)');
export type MessageId = z.infer<typeof MessageId>;

/**
 * Message type, `area.action` – e.g. `session.join`, `cas.hold.assign`.
 * A few control messages have one part only: `hello`, `welcome`, `reject`, `error`.
 */
export const MessageType = z
  .string()
  .regex(/^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z]*)*$/, 'Expected a message type like "session.join"');

/** Epoch milliseconds, UTC (protocol.md §0). */
export const EpochMs = z.int().nonnegative();

/** Addressing: who a message goes to (protocol.md §1.1). The relay enforces visibility. */
export const Address = z.discriminatedUnion('scope', [
  /** The relay itself (control messages: join, leave, …). */
  z.object({ scope: z.literal('relay') }),
  /** Everyone in the coalition session. */
  z.object({ scope: z.literal('session') }),
  /** All members of one flight. */
  z.object({ scope: z.literal('flight'), id: z.string().min(1) }),
  /** Everyone working or checked in to one AO. */
  z.object({ scope: z.literal('ao'), id: z.string().min(1) }),
  /** One participant. */
  z.object({ scope: z.literal('pid'), id: z.string().min(1) }),
]);
export type Address = z.infer<typeof Address>;

/**
 * Fields every message has, independent of its type (protocol.md §1).
 * `v` accepts any major version here, so a mismatch can be reported as
 * `versionMismatch` instead of a generic `badMessage` (see `parseMessage`).
 * Unknown fields are stripped – that's what lets minor versions work together.
 */
export const EnvelopeBase = z.object({
  /** Protocol major version. */
  v: z.int().positive(),
  /** Message ID (ULID). */
  id: MessageId,
  /** Message type, `area.action`. */
  type: MessageType,
  /** Sender's participant ID – never the token. Empty before `session.joined`. */
  from: z.string(),
  /** Coalition session the message belongs to. Empty before joining. */
  session: z.string(),
  /** Addressing. */
  to: Address,
  /** Sender's clock. */
  ts: EpochMs,
  /** `true` = the sender wants confirmations (protocol.md §1.2). */
  ack: z.boolean(),
  /** ID of the message this one answers, or `null`. */
  re: MessageId.nullable(),
  /** Type-specific content. */
  body: z.unknown(),
  /** Set by the relay: running number per session, for order and resync. */
  seq: z.int().nonnegative().optional(),
  /** Set by the relay: its clock when it received the message. */
  rts: EpochMs.optional(),
});

/** Envelope of this protocol version (`v` = PROTOCOL_VERSION). */
export const Envelope = EnvelopeBase.extend({ v: z.literal(PROTOCOL_VERSION) });
export type Envelope = z.infer<typeof Envelope>;

/**
 * Builds the schema of one message type: the envelope with a fixed `type`
 * and a typed `body`.
 */
export function defineMessage<const T extends string, B extends z.ZodType>(type: T, body: B) {
  return Envelope.extend({ type: z.literal(type), body });
}
