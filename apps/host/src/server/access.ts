// SPDX-License-Identifier: GPL-3.0-or-later
// Host and Origin checks (architecture.md §1.1, "Pairing and access control").
// They stop a website open in the user's browser from driving the host
// (cross-site WebSocket, DNS rebinding). Requests on the LAN listeners (P1.8)
// are checked in server.ts against lan/lan.ts instead.

/** Names the host answers to on localhost. */
const LOCAL_NAMES = ['127.0.0.1', 'localhost', '[::1]'];

/** `Host` header values accepted on `port`. */
export function allowedHosts(port: number): Set<string> {
  return new Set(LOCAL_NAMES.map((name) => `${name}:${port}`));
}

/** `Origin` header values accepted on `port` – only SLATE's own pages. */
export function allowedOrigins(port: number): Set<string> {
  return new Set(LOCAL_NAMES.map((name) => `http://${name}:${port}`));
}

/** `true` if the request was addressed to the host by one of its own names. */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  return host !== undefined && allowedHosts(port).has(host.toLowerCase());
}

/**
 * `true` if the request comes from SLATE's own page. Browsers always send
 * `Origin` on WebSocket upgrades; a request without it comes from a local
 * program, not from a website, and localhost is trusted.
 */
export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  return origin === undefined || allowedOrigins(port).has(origin.toLowerCase());
}
