// SPDX-License-Identifier: GPL-3.0-or-later
// ULID generator (protocol.md §0): 48-bit milliseconds + 80 random bits,
// Crockford base32, 26 characters, sortable by time.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * The Web Crypto function used here. This package has neither DOM nor Node
 * types, but both environments provide `crypto.getRandomValues`.
 */
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

/**
 * Makes a new ULID. Uses the Web Crypto API, available in browsers and Node.
 * IDs from the same millisecond are unique but not ordered among each other,
 * which is all SLATE needs (ordering always uses the relay's/host's `seq`).
 */
export function ulid(now: number = Date.now()): string {
  let time = Math.floor(now);
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = (ALPHABET[time % 32] ?? '0') + timePart;
    time = Math.floor(time / 32);
  }
  // 16 random bytes; 5 bits of each make one character.
  const random = crypto.getRandomValues(new Uint8Array(16));
  let randomPart = '';
  for (const byte of random) randomPart += ALPHABET[byte % 32] ?? '0';
  return timePart + randomPart;
}
