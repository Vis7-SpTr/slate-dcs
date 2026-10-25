// SPDX-License-Identifier: GPL-3.0-or-later
// Every P2 message type (protocol.md §6.5, §8–§12): a valid example parses,
// a broken one is refused, and no P2 type is left without an example.

import { describe, expect, it } from 'vitest';

import {
  AO,
  ao,
  brief,
  content,
  FLIGHT,
  hold,
  holdDraft,
  JTAC_2,
  keyholeDraft,
  LEAD,
  logEntry,
  mapEntry,
  mission,
  sitUpdate,
  threatDraft,
  WING,
} from './cas-fixtures.js';
import { Message, parseMessage } from './messages.js';
import { envelope, ID_2 } from './test-helpers.js';

const M = 'm_8d21f0';

/** A valid body and a broken one for every P2 message type. */
const EXAMPLES: Record<string, { valid: unknown; broken: unknown }> = {
  'fuel.call': {
    valid: { call: 'bingo', internalKg: 907 },
    broken: { call: 'chicken', internalKg: 907 },
  },
  'msg.received': { valid: {}, broken: 'yes' },
  // §8
  'jtac.onStation': {
    valid: { callsign: 'Axeman 11', freqs: [{ mhz: 251, label: 'PRI' }], ao: null },
    broken: { callsign: 'Axeman 11', freqs: [], joinCode: 'Q4T8MZ' },
  },
  'jtac.offStation': { valid: { aoId: AO }, broken: { aoId: 'Q4T-8MZ' } },
  'ao.created': { valid: ao(), broken: { ...ao(), radiusM: null } },
  'ao.update': {
    valid: { aoId: AO, changes: { radiusM: 9260, ceiling: { m: 7620, ref: 'msl' } } },
    broken: { aoId: AO, changes: { radiusM: -1 } },
  },
  'ao.updated': { valid: ao(), broken: { ...ao(), inCommand: JTAC_2 } },
  'ao.closed': { valid: { aoId: AO }, broken: {} },
  'cm.create': { valid: threatDraft(), broken: { ...threatDraft(), shape: 'line' } },
  'cm.created': { valid: mapEntry(), broken: { ...mapEntry(), author: '' } },
  'cm.update': {
    valid: { cmId: 'c_kh_01', entry: keyholeDraft() },
    broken: { cmId: 'c_kh_01', entry: { ...keyholeDraft(), aoId: null } },
  },
  'cm.updated': { valid: mapEntry(keyholeDraft()), broken: { ...mapEntry(), kind: 'mine' } },
  'cm.delete': { valid: { cmId: 'c_51e0b2' }, broken: { cmId: '' } },
  'cm.deleted': { valid: { cmId: 'c_51e0b2', hidden: true }, broken: { cmId: 'c_51e0b2' } },
  // §9
  'cas.checkIn': { valid: { brief: brief() }, broken: { brief: { ...brief(), aircraft: [] } } },
  'cas.checkedIn': {
    valid: {
      checkInId: 'ci_1',
      flightId: FLIGHT,
      aoId: AO,
      primary: 'p_9c11aa',
      brief: brief(),
      since: 1792160000000,
      aoEntries: { entries: [mapEntry(keyholeDraft())], holds: [hold()] },
    },
    broken: { checkInId: 'ci_1', flightId: FLIGHT, aoId: AO, primary: null, brief: brief() },
  },
  'cas.checkOut': { valid: {}, broken: null },
  'cas.release': { valid: { flightId: FLIGHT }, broken: {} },
  'cas.checkedOut': {
    valid: { checkInId: 'ci_1', flightId: FLIGHT, aoId: AO, by: 'flightClosed' },
    broken: { checkInId: 'ci_1', flightId: FLIGHT, aoId: AO, by: 'bored' },
  },
  'cas.sitUpdate': {
    valid: { aoId: AO, update: sitUpdate() },
    broken: { aoId: AO, update: { ...sitUpdate(), threats: 'SA-8' } },
  },
  'cas.sitCopy': { valid: {}, broken: [] },
  'cas.hold.assign': { valid: holdDraft(), broken: { ...holdDraft(), legM: null } },
  'cas.hold.update': {
    valid: { holdId: 'h_77a1c0', hold: holdDraft() },
    broken: { holdId: 'h_77a1c0', hold: { ...holdDraft(), turns: 'up' } },
  },
  'cas.hold.cancel': { valid: { holdId: 'h_77a1c0' }, broken: {} },
  'cas.hold.updated': { valid: hold(), broken: { ...hold(), conflicts: null } },
  'cas.hold.cancelled': { valid: { holdId: 'h_77a1c0', hidden: false }, broken: { hidden: false } },
  'cas.hold.wilco': { valid: { holdId: 'h_77a1c0' }, broken: { holdId: 7 } },
  // §10
  'fm.create': { valid: { ...content(), aoId: AO }, broken: content() },
  'fm.update': {
    valid: { ...content(), missionId: M },
    broken: { ...content(), missionId: M, remarks: null },
  },
  'fm.assign': {
    valid: { missionId: M, assignee: { flightId: FLIGHT, pids: [WING] } },
    broken: { missionId: M, assignee: { flightId: FLIGHT, pids: [] } },
  },
  'fm.unassign': { valid: { missionId: M }, broken: {} },
  'fm.brief': { valid: { missionId: M }, broken: { missionId: '' } },
  'fm.readbackCorrect': { valid: { missionId: M }, broken: {} },
  'fm.ackChange': { valid: { missionId: M, rev: 4 }, broken: { missionId: M, rev: 0 } },
  'fm.spi': {
    valid: { missionId: M, spi: { lat: 42.2201, lon: 41.7427, elevM: null } },
    broken: { missionId: M, spi: { lat: 42.2201 } },
  },
  'fm.correlated': { valid: { missionId: M, pid: LEAD }, broken: { missionId: M } },
  'fm.clear': {
    valid: { missionId: M, pid: LEAD, kind: 'hot' },
    broken: { missionId: M, pid: LEAD, kind: 'window' },
  },
  'fm.window': {
    valid: {
      missionId: M,
      window: {
        pids: null,
        from: 51000,
        until: 51900,
        area: { center: { cmId: 'c_kh_01', axis: 'E' }, radiusM: 3704 },
        targets: { text: 'Armour in the treeline', cmIds: [] },
        restrictions: ['No release east of MSR'],
      },
    },
    broken: {
      missionId: M,
      window: {
        pids: null,
        from: 51900,
        until: 51000,
        area: null,
        targets: { text: '', cmIds: [] },
        restrictions: [],
      },
    },
  },
  'fm.windowRevoke': { valid: { missionId: M }, broken: {} },
  'fm.waitingBda': { valid: { missionId: M, pid: LEAD }, broken: { pid: LEAD } },
  'fm.abort': {
    valid: { missionId: M, pid: LEAD, channel: 'voice', reason: 'Friendlies too close' },
    broken: { missionId: M, pid: LEAD, channel: 'email', reason: '' },
  },
  'fm.voiceOnly': { valid: { missionId: M, on: true }, broken: { missionId: M } },
  'fm.bda': {
    valid: {
      missionId: M,
      pid: LEAD,
      target: '2x BMP-2',
      effect: 'destroyed',
      location: null,
      mtime: 51960,
      remarks: '',
    },
    broken: { missionId: M, pid: LEAD, target: '2x BMP-2', effect: 'vaporised' },
  },
  'fm.ackBda': { valid: { missionId: M }, broken: {} },
  'fm.reattack': {
    valid: { missionId: M, pid: LEAD, to: 'attack' },
    broken: { missionId: M, to: 'attack' },
  },
  'fm.complete': { valid: { missionId: M }, broken: {} },
  'fm.cancel': { valid: { missionId: M }, broken: {} },
  'fm.delete': { valid: { missionId: M }, broken: {} },
  'fm.offerCommand': { valid: { missionId: M, pid: JTAC_2 }, broken: { missionId: M } },
  'fm.acceptCommand': { valid: { missionId: M }, broken: {} },
  'fm.returnCommand': { valid: { missionId: M }, broken: {} },
  'fm.reclaim': { valid: { missionId: M }, broken: {} },
  'fm.updated': { valid: mission(), broken: { ...mission(), state: 'draft' } },
  'fm.deleted': { valid: { missionId: M, hidden: true }, broken: { missionId: M } },
  // §12
  'log.request': {
    valid: { scope: 'ao', id: AO, from: null, to: null },
    broken: { scope: 'ao', id: FLIGHT, from: null, to: null },
  },
  'log.entries': {
    valid: { entries: [logEntry()], next: null },
    broken: { entries: [{ ...logEntry(), area: 'gossip' }], next: null },
  },
};

const message = (type: string, body: unknown) => ({ ...envelope({ ack: true }), type, body });

describe('P2 message types', () => {
  const p2Types = Message.options
    .map((option) => option.shape.type.value)
    .filter((type) => /^(jtac|ao|cm|cas|fm|log)\./.test(type) || type === 'fuel.call');

  it('has an example for every P2 type', () => {
    expect(
      Object.keys(EXAMPLES)
        .filter((type) => type !== 'msg.received')
        .sort(),
    ).toEqual([...p2Types].sort());
  });

  it.each(Object.entries(EXAMPLES))('accepts a valid %s', (type, { valid }) => {
    const result = parseMessage(message(type, valid));
    expect(result.ok ? result.message.type : result).toBe(type);
  });

  it.each(Object.entries(EXAMPLES))('rejects a broken %s', (type, { broken }) => {
    expect(parseMessage(message(type, broken))).toMatchObject({ ok: false, code: 'badMessage' });
  });
});

describe('envelope mission time (§1.4)', () => {
  const update = (mt: unknown) => ({
    ...envelope({ re: ID_2, ...(mt === undefined ? {} : { mt }) }),
    type: 'fm.brief',
    body: { missionId: M },
  });

  it.each([
    ['present', 51830.4],
    ['null without a mission', null],
    ['absent from an older host', undefined],
  ])('accepts mt %s', (_why, mt) => {
    expect(parseMessage(update(mt)).ok).toBe(true);
  });

  it('rejects a negative mt', () => {
    expect(parseMessage(update(-1)).ok).toBe(false);
  });
});
