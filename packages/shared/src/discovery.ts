// SPDX-License-Identifier: GPL-3.0-or-later
// The discovery chat line (protocol.md §2): the server hook sends it to a
// player with his coalition's session code; the client hook passes it to the
// host, which joins by itself. Readable, so a player without SLATE can type
// it in by hand.
//
//   [SLATE] v1 relay slate-grp.dyndns.org:7790 lan 192.168.1.20:7790 code BLUE-7K3Q9XPM fp 4D2A-…
//
// If DCS cuts long chat lines, the relay splits it into lines with the same
// prefix; the reader puts them together again.

import { z } from 'zod';

import type { Coalition } from './common.js';
import { RelayFingerprint, SessionCode } from './session.js';

export const ANNOUNCE_PREFIX = '[SLATE]';
/** Parts of a split announcement arriving further apart than this don't belong together. */
export const ANNOUNCE_JOIN_MS = 10_000;

/** `host:port` as it appears in the line. */
const HostPort = z
  .string()
  .regex(/^[A-Za-z0-9.-]+:\d{1,5}$/, 'Expected host:port')
  .refine((value) => {
    const port = Number(value.split(':')[1]);
    return port >= 1 && port <= 65535;
  });

export const Announcement = z
  .object({
    /** Protocol major the relay speaks. */
    protocol: z.int().positive(),
    /** Public address (DynDNS hostname); `null` if the relay has none set. */
    relay: HostPort.nullable(),
    /** The server PC's LAN address – tried first. */
    lan: HostPort.nullable(),
    /** Coalition code – it decides the session (§4.1). */
    code: SessionCode.refine((code) => /^(BLUE|RED)-/.test(code), 'Expected a coalition code'),
    fingerprint: RelayFingerprint,
  })
  .refine((a) => a.relay !== null || a.lan !== null, 'No relay address');
export type Announcement = z.infer<typeof Announcement>;

/** The coalition an announcement's code is for. */
export function announcedCoalition(a: Announcement): Coalition {
  return a.code.startsWith('BLUE-') ? 'blue' : 'red';
}

/**
 * The chat line(s) for one announcement. With `maxLength`, parts move to
 * further lines with the same prefix so no line is longer (protocol.md §2).
 */
export function formatAnnouncement(a: Announcement, maxLength: number | null = null): string[] {
  const head = `${ANNOUNCE_PREFIX} v${String(a.protocol)}`;
  const parts = [
    ...(a.relay ? [`relay ${a.relay}`] : []),
    ...(a.lan ? [`lan ${a.lan}`] : []),
    `code ${a.code}`,
    `fp ${a.fingerprint}`,
  ];
  if (maxLength === null) return [`${head} ${parts.join(' ')}`];
  const lines: string[] = [];
  let line = head;
  for (const part of parts) {
    if (line !== head && line.length + 1 + part.length > maxLength) {
      lines.push(line);
      line = head;
    }
    line += ` ${part}`;
  }
  lines.push(line);
  return lines;
}

const KEYS = { relay: 'relay', lan: 'lan', code: 'code', fp: 'fingerprint' } as const;

/** One chat line's parts, or `null` if it isn't a SLATE line. Unknown parts are ignored. */
export function parseAnnouncementLine(text: string): {
  protocol: number;
  parts: Partial<Record<'relay' | 'lan' | 'code' | 'fingerprint', string>>;
} | null {
  const words = text.trim().split(/\s+/);
  if (words[0] !== ANNOUNCE_PREFIX) return null;
  const version = /^v(\d+)$/.exec(words[1] ?? '');
  if (!version) return null;
  const parts: Partial<Record<'relay' | 'lan' | 'code' | 'fingerprint', string>> = {};
  for (let i = 2; i + 1 < words.length; i += 2) {
    const key = KEYS[words[i] as keyof typeof KEYS] as (typeof KEYS)[keyof typeof KEYS] | undefined;
    const value = words[i + 1];
    if (key && value !== undefined) parts[key] = value;
  }
  return { protocol: Number(version[1]), parts };
}

/**
 * Puts (possibly split) announcement lines together. `feed` returns the
 * announcement once code, fingerprint and an address are there, else `null`.
 */
export class AnnouncementReader {
  #parts: Partial<Record<'relay' | 'lan' | 'code' | 'fingerprint', string>> = {};
  #protocol = 0;
  #since = 0;

  feed(text: string, now: number): Announcement | null {
    const line = parseAnnouncementLine(text);
    if (!line) return null;
    if (line.protocol !== this.#protocol || now - this.#since > ANNOUNCE_JOIN_MS) {
      this.#parts = {};
      this.#protocol = line.protocol;
      this.#since = now;
    }
    this.#parts = { ...this.#parts, ...line.parts };
    const parsed = Announcement.safeParse({
      protocol: this.#protocol,
      relay: this.#parts.relay ?? null,
      lan: this.#parts.lan ?? null,
      code: this.#parts.code,
      fingerprint: this.#parts.fingerprint,
    });
    if (!parsed.success) return null;
    this.#parts = {};
    this.#since = 0;
    return parsed.data;
  }
}
