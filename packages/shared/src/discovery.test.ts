// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  ANNOUNCE_JOIN_MS,
  Announcement,
  announcedCoalition,
  AnnouncementReader,
  formatAnnouncement,
  parseAnnouncementLine,
} from './discovery.js';

const FP = 'NZ5N-SEHR-0N1A-CA2G-QN0B-WFQE-30';
const blue = Announcement.parse({
  protocol: 1,
  relay: 'slate-grp.dyndns.org:7790',
  lan: '192.168.1.20:7790',
  code: 'BLUE-7K3Q9XPM',
  fingerprint: FP,
});

describe('formatAnnouncement (§2)', () => {
  it('writes the readable line', () => {
    expect(formatAnnouncement(blue)).toEqual([
      `[SLATE] v1 relay slate-grp.dyndns.org:7790 lan 192.168.1.20:7790 code BLUE-7K3Q9XPM fp ${FP}`,
    ]);
  });

  it('splits into lines with the same prefix when asked to', () => {
    const lines = formatAnnouncement(blue, 80);
    expect(lines.length).toBe(2);
    expect(lines.every((l) => l.startsWith('[SLATE] v1 ') && l.length <= 80)).toBe(true);
  });

  it('leaves out a missing public address', () => {
    const lanOnly = { ...blue, relay: null };
    expect(formatAnnouncement(lanOnly)[0]).toBe(
      `[SLATE] v1 lan 192.168.1.20:7790 code BLUE-7K3Q9XPM fp ${FP}`,
    );
  });
});

describe('AnnouncementReader', () => {
  it('reads one line and the coalition from the code', () => {
    const reader = new AnnouncementReader();
    const a = reader.feed(formatAnnouncement(blue)[0] ?? '', 0);
    expect(a).toEqual(blue);
    expect(a && announcedCoalition(a)).toBe('blue');
  });

  it('puts split lines together, but not across 10 s', () => {
    const [one = '', two = ''] = formatAnnouncement(blue, 80);
    const reader = new AnnouncementReader();
    expect(reader.feed(one, 0)).toBeNull();
    expect(reader.feed(two, 1000)).toEqual(blue);
    expect(reader.feed(one, 2000)).toBeNull();
    expect(reader.feed(two, 2000 + ANNOUNCE_JOIN_MS + 1)).toBeNull();
  });

  it.each([
    ['another chat line', 'hello there'],
    ['a group code (manual join only)', `[SLATE] v1 lan 1.2.3.4:7790 code SLATE-7K3Q9XPM fp ${FP}`],
    ['no address', `[SLATE] v1 code BLUE-7K3Q9XPM fp ${FP}`],
    ['a broken fingerprint', '[SLATE] v1 lan 1.2.3.4:7790 code BLUE-7K3Q9XPM fp XYZ'],
    ['a bad port', `[SLATE] v1 lan 1.2.3.4:99999 code BLUE-7K3Q9XPM fp ${FP}`],
  ])('ignores %s', (_why, line) => {
    expect(new AnnouncementReader().feed(line, 0)).toBeNull();
  });

  it('reads the protocol version of a newer relay', () => {
    expect(
      parseAnnouncementLine(`[SLATE] v2 lan 1.2.3.4:7790 code RED-7K3Q9XPM fp ${FP}`)?.protocol,
    ).toBe(2);
    expect(parseAnnouncementLine('[SLATE] x')).toBeNull();
  });
});
