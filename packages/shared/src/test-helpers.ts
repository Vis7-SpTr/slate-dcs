// SPDX-License-Identifier: GPL-3.0-or-later
// Helpers for tests only – not exported from the package.

/** Valid ULIDs for tests. */
export const ID_1 = '01JABCXYZ8M3Q4R5S6T7V8W9X0';
export const ID_2 = '01JABCXYZ8M3Q4R5S6T7V8W9X1';

/** A valid envelope of protocol version 1, without `type` and `body`. */
export function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    id: ID_1,
    from: 'p_7f3a9c',
    session: 'blue',
    to: { scope: 'relay' },
    ts: 1792156980123,
    ack: false,
    re: null,
    ...overrides,
  };
}
