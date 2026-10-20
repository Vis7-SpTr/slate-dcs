// SPDX-License-Identifier: GPL-3.0-or-later
// Protocol constants (protocol.md §0, §4, §5).

/** Protocol major version. Host and relay must agree on it (`hello` / `welcome`). */
export const PROTOCOL_VERSION = 1;

/** Default ports. All of them are configurable. */
export const DEFAULT_PORTS = {
  /** Relay, TCP – the one port forwarded on the server PC's router. */
  relay: 7790,
  /** Lua bridge → host, UDP, 127.0.0.1 only. */
  bridge: 7791,
  /** Host web UI, TCP, 127.0.0.1 (LAN only when switched on). */
  hostUi: 7792,
} as const;

export type PortName = keyof typeof DEFAULT_PORTS;

/** Timing rules of the session layer. */
export const SESSION_TIMING = {
  /** WebSocket ping/pong interval; the relay sends it as `welcome.heartbeatSec` (§5). */
  heartbeatSec: 15,
  /** A participant is `lost` after this long without a pong; his state is kept (§5). */
  lostAfterSec: 45,
  /** Relay entries (token, flight position, …) expire this long after last seen (§4.3). */
  tokenExpiryHours: 4,
} as const;
