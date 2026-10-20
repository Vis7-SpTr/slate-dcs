// SPDX-License-Identifier: GPL-3.0-or-later
// Control messages: confirmations, errors and the version handshake
// (protocol.md §1.2, §1.3, §3.3, §3.4).

import { z } from 'zod';

import { defineMessage } from './envelope.js';

// ---------------------------------------------------------------------------
// Confirmations (protocol.md §1.2). Level 3 (a person reacted) is always a
// domain message, never one of these.

/** Level 1: the relay accepted a message and gave it a `seq`. `re` = the original ID. */
export const RelayReceipt = defineMessage(
  'relay.receipt',
  z.object({ seq: z.int().nonnegative() }),
);
export type RelayReceipt = z.infer<typeof RelayReceipt>;

/** Level 2: the recipient's app got the message. `re` = the original ID. */
export const MsgReceived = defineMessage('msg.received', z.object({}));
export type MsgReceived = z.infer<typeof MsgReceived>;

// ---------------------------------------------------------------------------
// Errors (protocol.md §1.3, plus the codes defined in later sections).

/** Error codes defined in protocol.md. Senders use these; receivers accept any code. */
export const ERROR_CODES = [
  'badCode',
  'badCoalition',
  'versionMismatch',
  'notJoined',
  'forbidden',
  'badMessage',
  'unsupported',
  'rateLimited',
  'alreadyInFlight',
  'flightFull',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** `error` – `re` = the message that failed. */
export const ErrorMessage = defineMessage(
  'error',
  z.object({
    /** Any non-empty code is accepted, so codes added by a newer relay still parse. */
    code: z.string().min(1),
    text: z.string(),
  }),
);
export type ErrorMessage = z.infer<typeof ErrorMessage>;

// ---------------------------------------------------------------------------
// Version handshake (protocol.md §3.3, §3.4): hello → welcome or reject.

/** List of protocol major versions; at least one, each a positive integer. */
const ProtocolList = z.array(z.int().positive()).min(1);

/** Optional abilities, e.g. `plugin` (P6). */
const Features = z.array(z.string().min(1));

/** `hello` (host → relay): which protocol majors the host speaks. */
export const Hello = defineMessage(
  'hello',
  z.object({
    protocols: ProtocolList,
    /** App name and version, e.g. `slate-host 0.1.0`. */
    app: z.string().min(1),
    features: Features,
  }),
);
export type Hello = z.infer<typeof Hello>;

/** `welcome` (relay → host): the chosen protocol and the relay's settings. */
export const Welcome = defineMessage(
  'welcome',
  z.object({
    protocol: z.int().positive(),
    /** Relay name and version, e.g. `slate-relay 0.1.0`. */
    relay: z.string().min(1),
    features: Features,
    /** Relay clock (epoch ms); the host shows its own clock offset from it. */
    time: z.int().nonnegative(),
    /** WebSocket ping/pong interval in seconds (protocol.md §5). */
    heartbeatSec: z.int().positive(),
  }),
);
export type Welcome = z.infer<typeof Welcome>;

/** `reject` (relay → host): no common protocol major, or another reason. */
export const Reject = defineMessage(
  'reject',
  z.object({
    reason: z.string().min(1),
    /** Protocol majors the relay supports. */
    supported: ProtocolList,
  }),
);
export type Reject = z.infer<typeof Reject>;

/**
 * Picks the protocol major for a connection: the highest version both sides
 * support, or `null` if there is none (→ `reject` with `versionMismatch`).
 */
export function negotiateProtocol(
  offered: readonly number[],
  supported: readonly number[],
): number | null {
  const common = offered.filter((version) => supported.includes(version));
  return common.length > 0 ? Math.max(...common) : null;
}
