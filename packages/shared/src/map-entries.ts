// SPDX-License-Identifier: GPL-3.0-or-later
// Control measures and markers (protocol.md §8.4, §8.5): everything drawn on
// the map, incl. keyholes. Relay state – only the relay changes it.

import { z } from 'zod';

import { AoId, Altitude, blockInverted, CmId, LatLon, Mtime } from './cas-common.js';
import { Pid } from './common.js';
import { defineMessage } from './envelope.js';

// ---------------------------------------------------------------------------
// Building blocks

/** Kinds of map entries (§8.4). */
export const CmKind = z.enum([
  'friendly',
  'nfa',
  'rfa',
  'roz',
  'fscl',
  'cfl',
  'ip',
  'cp',
  'keyhole',
  'threat',
  'enemy',
]);
export type CmKind = z.infer<typeof CmKind>;

/** Who may see an entry: the AO's JTACs and checked-in aircraft, or the whole coalition. */
export const Visibility = z.enum(['ao', 'coalition']);
export type Visibility = z.infer<typeof Visibility>;

/** Kinds pilots may draw (§8.4); everything else is drawn by JTACs. */
export const PILOT_CM_KINDS: ReadonlySet<CmKind> = new Set(['friendly', 'threat', 'enemy']);

/** Shapes each kind may have (§8.4). */
export const CM_SHAPES: Readonly<Record<CmKind, readonly CmShape[]>> = {
  friendly: ['point', 'circle', 'polygon'],
  nfa: ['circle', 'polygon'],
  rfa: ['circle', 'polygon'],
  roz: ['circle', 'polygon'],
  fscl: ['line'],
  cfl: ['line'],
  ip: ['point'],
  cp: ['point'],
  keyhole: ['point'],
  threat: ['point'],
  enemy: ['point', 'circle', 'polygon'],
};

/** Kinds that are always tied to an AO (§8.4). */
export const AO_CM_KINDS: ReadonlySet<CmKind> = new Set([
  'nfa',
  'rfa',
  'roz',
  'fscl',
  'cfl',
  'ip',
  'cp',
  'keyhole',
]);

const Shapes = z.enum(['point', 'circle', 'polygon', 'line']);
export type CmShape = z.infer<typeof Shapes>;
export const CmShape = Shapes;

/** Geometry by shape: one point, a circle, an area (≥ 3 points) or a line (≥ 2 points). */
const geometries = [
  z.object({ shape: z.literal('point'), geom: LatLon }),
  z.object({
    shape: z.literal('circle'),
    geom: z.object({ center: LatLon, radiusM: z.number().positive().max(500_000) }),
  }),
  z.object({ shape: z.literal('polygon'), geom: z.array(LatLon).min(3).max(64) }),
  z.object({ shape: z.literal('line'), geom: z.array(LatLon).min(2).max(64) }),
] as const;

/**
 * Fields of a map entry besides its geometry. Kind-specific fields are always
 * present and `null` where they don't apply.
 */
const entryFields = {
  kind: CmKind,
  /** Name or short text: `IP SIERRA`, `HAMMER` (keyhole), `SA-8`. */
  label: z.string().trim().max(48).nullable(),
  /** Longer text: the restriction of an RFA, the description of an enemy marker. */
  text: z.string().max(500).nullable(),
  /** Threat ring radius in metres (`threat`). */
  ringM: z.number().positive().max(500_000).nullable(),
  /** Number of vehicles/people (`enemy`). */
  count: z.int().positive().max(999).nullable(),
  /** Moving or static (`enemy`). */
  moving: z.boolean().nullable(),
  /** When it was seen, in mission time (`threat`, `enemy`). */
  observedMtime: Mtime.nullable(),
  /** Altitude block (`roz`). */
  block: z.object({ floor: Altitude, ceiling: Altitude }).nullable(),
  /** The AO it belongs to, or `null`. */
  aoId: AoId.nullable(),
  visibility: Visibility,
};

/** Kind ↔ shape and field rules (§8.4). */
function checkEntry(
  entry: {
    kind: CmKind;
    shape: CmShape;
    aoId: string | null;
    ringM: number | null;
    count: number | null;
    moving: boolean | null;
    block: { floor: Altitude; ceiling: Altitude } | null;
    label: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (!CM_SHAPES[entry.kind].includes(entry.shape)) {
    ctx.addIssue({
      code: 'custom',
      path: ['shape'],
      message: `A ${entry.kind} can't be a ${entry.shape}`,
    });
  }
  if (AO_CM_KINDS.has(entry.kind) && entry.aoId === null) {
    ctx.addIssue({ code: 'custom', path: ['aoId'], message: `A ${entry.kind} belongs to an AO` });
  }
  if (entry.ringM !== null && entry.kind !== 'threat') {
    ctx.addIssue({ code: 'custom', path: ['ringM'], message: 'Only threats have a ring' });
  }
  if ((entry.count !== null || entry.moving !== null) && entry.kind !== 'enemy') {
    ctx.addIssue({ code: 'custom', path: ['count'], message: 'Only enemy markers have a count' });
  }
  if (entry.kind === 'roz' && entry.block === null) {
    ctx.addIssue({ code: 'custom', path: ['block'], message: 'A ROZ needs an altitude block' });
  }
  if (entry.block !== null && entry.kind !== 'roz') {
    ctx.addIssue({ code: 'custom', path: ['block'], message: 'Only a ROZ has an altitude block' });
  }
  if (entry.block !== null && blockInverted(entry.block.floor, entry.block.ceiling)) {
    ctx.addIssue({ code: 'custom', path: ['block'], message: 'Floor is above the ceiling' });
  }
  if ((entry.kind === 'ip' || entry.kind === 'cp' || entry.kind === 'keyhole') && !entry.label) {
    ctx.addIssue({ code: 'custom', path: ['label'], message: `A ${entry.kind} needs a name` });
  }
}

/**
 * A map entry as created or changed by a host – without `cmId` and `author`,
 * which the relay sets. A keyhole's point is ECHO; its axes follow (§8.5).
 */
export const MapEntryDraft = z
  .discriminatedUnion('shape', [
    geometries[0].extend(entryFields),
    geometries[1].extend(entryFields),
    geometries[2].extend(entryFields),
    geometries[3].extend(entryFields),
  ])
  .superRefine((entry, ctx) => {
    checkEntry(entry, ctx);
  });
export type MapEntryDraft = z.infer<typeof MapEntryDraft>;

/** The draft fields plus what the relay sets. */
const relayFields = { cmId: CmId, author: Pid };

/** A map entry as the relay keeps and sends it (§8.4). */
export const MapEntry = z
  .discriminatedUnion('shape', [
    geometries[0].extend(entryFields).extend(relayFields),
    geometries[1].extend(entryFields).extend(relayFields),
    geometries[2].extend(entryFields).extend(relayFields),
    geometries[3].extend(entryFields).extend(relayFields),
  ])
  .superRefine((entry, ctx) => {
    checkEntry(entry, ctx);
  });
export type MapEntry = z.infer<typeof MapEntry>;

// ---------------------------------------------------------------------------
// Messages (§8.4)

/** `cm.create` (host → relay): a new entry. JTACs draw every kind, pilots friendly/threat/enemy. */
export const CmCreate = defineMessage('cm.create', MapEntryDraft);
export type CmCreate = z.infer<typeof CmCreate>;

/** `cm.created` (relay → everyone who may see it). Also sent to new viewers after a visibility change. */
export const CmCreated = defineMessage('cm.created', MapEntry);
export type CmCreated = z.infer<typeof CmCreated>;

/**
 * `cm.update` (host → relay): the entry's new content, in full. The kind stays
 * the same. Moving a keyhole's ECHO moves every point that refers to it (§8.5).
 */
export const CmUpdate = defineMessage('cm.update', z.object({ cmId: CmId, entry: MapEntryDraft }));
export type CmUpdate = z.infer<typeof CmUpdate>;

/** `cm.updated` (relay → everyone who may see it): the full entry after a change. */
export const CmUpdated = defineMessage('cm.updated', MapEntry);
export type CmUpdated = z.infer<typeof CmUpdated>;

/** `cm.delete` (host → relay). Refused with `inUse` while an open mission or hold refers to it. */
export const CmDelete = defineMessage('cm.delete', z.object({ cmId: CmId }));
export type CmDelete = z.infer<typeof CmDelete>;

/**
 * `cm.deleted` (relay → viewers): the entry is gone – or, with `hidden: true`,
 * this viewer can no longer see it (visibility changed to `ao`, §8.4).
 */
export const CmDeleted = defineMessage('cm.deleted', z.object({ cmId: CmId, hidden: z.boolean() }));
export type CmDeleted = z.infer<typeof CmDeleted>;
