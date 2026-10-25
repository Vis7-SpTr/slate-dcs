// SPDX-License-Identifier: GPL-3.0-or-later
// Session codes, participant IDs and tokens made by the relay (protocol.md §0,
// §4.1, §4.3). All random parts come from node:crypto.

import { randomBytes, randomInt } from 'node:crypto';

import { SessionCode } from '@slate-dcs/shared';
import type { Coalition } from '@slate-dcs/shared';

/** Crockford base32 – no I, L, O, U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The relay's three session codes (§4.1). Set in the relay config, changeable there. */
export interface RelayCodes {
  /** Coalition codes: the code decides the session (discovery chat line). */
  blue: string;
  red: string;
  /** Group code for manual join: the player picks the coalition. */
  group: string;
}

/** Prefix of the group code; coalition codes use `BLUE` / `RED`. */
export const GROUP_PREFIX = 'SLATE';

function randomCode(prefix: string): string {
  let code = '';
  for (let i = 0; i < 8; i += 1) code += ALPHABET.charAt(randomInt(ALPHABET.length));
  return SessionCode.parse(`${prefix}-${code}`);
}

/** Fresh random codes, for a new relay config or host mode. */
export function generateCodes(): RelayCodes {
  return { blue: randomCode('BLUE'), red: randomCode('RED'), group: randomCode(GROUP_PREFIX) };
}

/**
 * What a code joins: a fixed coalition, the group (player picks), or nothing.
 * Codes are compared as sent on the wire (normalised by the host).
 */
export function readCode(
  codes: RelayCodes,
  code: string,
): { kind: 'coalition'; coalition: Coalition } | { kind: 'group' } | null {
  if (code === codes.blue) return { kind: 'coalition', coalition: 'blue' };
  if (code === codes.red) return { kind: 'coalition', coalition: 'red' };
  if (code === codes.group) return { kind: 'group' };
  return null;
}

/** `true` if the three codes are valid and all different. */
export function codesValid(codes: RelayCodes): boolean {
  const list = [codes.blue, codes.red, codes.group];
  return list.every((c) => SessionCode.safeParse(c).success) && new Set(list).size === 3;
}

/** Participant ID, e.g. `p_7f3a9c` – shown to others, stable across reconnects. */
export function newPid(taken: (pid: string) => boolean): string {
  for (;;) {
    const pid = `p_${randomBytes(3).toString('hex')}`;
    if (!taken(pid)) return pid;
  }
}

/** Token: 256 random bits, base64url without padding (43 characters). Secret. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Flight ID, e.g. `f_3a9c1e`. */
export function newFlightId(taken: (id: string) => boolean): string {
  for (;;) {
    const id = `f_${randomBytes(3).toString('hex')}`;
    if (!taken(id)) return id;
  }
}

/** AO ID, e.g. `a_3a9c1e` (§8.1) – sent to everyone. */
export function newAoId(taken: (id: string) => boolean): string {
  for (;;) {
    const id = `a_${randomBytes(3).toString('hex')}`;
    if (!taken(id)) return id;
  }
}

/** Map entry ID, e.g. `c_3a9c1e4f` (§8.4). */
export function newCmId(taken: (id: string) => boolean): string {
  for (;;) {
    const id = `c_${randomBytes(4).toString('hex')}`;
    if (!taken(id)) return id;
  }
}

/**
 * Private flight code or AO join code, e.g. `K7Q-4XM` (§7.1, §8.1): 6
 * Crockford base32 characters.
 */
export function newPrivateCode(taken: (code: string) => boolean): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i += 1) code += ALPHABET.charAt(randomInt(ALPHABET.length));
    const result = `${code.slice(0, 3)}-${code.slice(3)}`;
    if (!taken(result)) return result;
  }
}
