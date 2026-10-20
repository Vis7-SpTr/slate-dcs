// SPDX-License-Identifier: GPL-3.0-or-later
// Protocol constants. Message schemas follow in P1.1.

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
