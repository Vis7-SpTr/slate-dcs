// SPDX-License-Identifier: GPL-3.0-or-later
// JTAC on-station and AOs (protocol.md §8.1–§8.3). AOs are relay state: only
// the relay changes them, and it tells the session with `ao.updated`.

import { z } from 'zod';

import {
  Altitude,
  AoId,
  AoJoinCode,
  blockInverted,
  Callsign,
  Frequency,
  LatLon,
  MAX_FREQUENCIES,
} from './cas-common.js';
import { EpochMs, Pid, Presence } from './common.js';
import { defineMessage } from './envelope.js';

// ---------------------------------------------------------------------------
// Rules

const NM = 1852;

export const AO_RULES = {
  /** Default radius of a new AO: 10 NM (scope §4.2). */
  defaultRadiusM: 10 * NM,
  /** Largest AO radius or side, 200 NM. */
  maxSizeM: 200 * NM,
  /** At most this many corners of a polygon AO. */
  maxPoints: 64,
  /** Default floor: the surface (scope §4.2). */
  defaultFloor: { m: 0, ref: 'sfc' },
  /** Default ceiling until the JTAC sets one: FL200 (20 000 ft MSL). */
  defaultCeiling: { m: 6096, ref: 'msl' },
} as const;

// ---------------------------------------------------------------------------
// Building blocks

/** AO shapes (§8.1). The P2 UI creates circles only; square and polygon come with the P3 map (D3). */
export const AoType = z.enum(['circle', 'square', 'polygon']);
export type AoType = z.infer<typeof AoType>;

/** AO name, e.g. `AO HAMMER`. */
export const AoName = z.string().trim().min(1).max(32);

const Size = z.number().positive().max(AO_RULES.maxSizeM);

/** One JTAC working an AO, in the order they joined. */
export const AoJtac = z.object({
  pid: Pid,
  callsign: Callsign,
  /** When he joined the AO (relay time) – the order of command (§8.3). */
  since: EpochMs,
  /** A lost JTAC keeps the AO alive and is shown as "JTAC lost". */
  presence: Presence.exclude(['left']),
  /** His radio frequencies, from `jtac.onStation` (D10). */
  freqs: z.array(Frequency).max(MAX_FREQUENCIES),
});
export type AoJtac = z.infer<typeof AoJtac>;

/** The fields that describe an AO's area (all present, `null` where the type doesn't use them). */
const areaFields = {
  type: AoType,
  /** Circle and square: fixed at the creator's position; moved only by Recenter (§8.1). */
  center: LatLon.nullable(),
  /** Circle. */
  radiusM: Size.nullable(),
  /** Square: length (along `headingDeg`) and width. */
  lengthM: Size.nullable(),
  widthM: Size.nullable(),
  /** Square: rotation, 0 = north-up. */
  headingDeg: z.number().min(0).lt(360).nullable(),
  /** Polygon corners. */
  points: z.array(LatLon).min(3).max(AO_RULES.maxPoints).nullable(),
  floor: Altitude,
  ceiling: Altitude,
};

/** Area rules per type, and floor below ceiling. */
function checkArea(
  area: {
    type: AoType;
    center: unknown;
    radiusM: unknown;
    lengthM: unknown;
    widthM: unknown;
    headingDeg: unknown;
    points: unknown;
    floor: Altitude;
    ceiling: Altitude;
  },
  ctx: z.RefinementCtx,
): void {
  const need = (field: keyof typeof area, ok: boolean) => {
    if (!ok) ctx.addIssue({ code: 'custom', path: [field], message: `Needed for a ${area.type}` });
  };
  const unused = (field: keyof typeof area) => {
    if (area[field] !== null) {
      ctx.addIssue({ code: 'custom', path: [field], message: `Not used for a ${area.type}` });
    }
  };
  if (area.type === 'circle') {
    need('center', area.center !== null);
    need('radiusM', area.radiusM !== null);
    unused('lengthM');
    unused('widthM');
    unused('headingDeg');
    unused('points');
  } else if (area.type === 'square') {
    need('center', area.center !== null);
    need('lengthM', area.lengthM !== null);
    need('widthM', area.widthM !== null);
    need('headingDeg', area.headingDeg !== null);
    unused('radiusM');
    unused('points');
  } else {
    need('points', area.points !== null);
    unused('center');
    unused('radiusM');
    unused('lengthM');
    unused('widthM');
    unused('headingDeg');
  }
  if (blockInverted(area.floor, area.ceiling)) {
    ctx.addIssue({ code: 'custom', path: ['floor'], message: 'Floor is above the ceiling' });
  }
}

/** The AO object (§8.1). */
export const Ao = z
  .object({
    aoId: AoId,
    /** Only for participants with the JTAC role; `null` for pilots. */
    joinCode: AoJoinCode.nullable(),
    name: AoName,
    ...areaFields,
    jtacs: z.array(AoJtac),
    /** Worked out by the relay (§8.3); `null` while every JTAC is lost. */
    inCommand: Pid.nullable(),
  })
  .superRefine((ao, ctx) => {
    checkArea(ao, ctx);
    const pids = ao.jtacs.map((jtac) => jtac.pid);
    if (new Set(pids).size !== pids.length) {
      ctx.addIssue({ code: 'custom', path: ['jtacs'], message: 'A JTAC is listed twice' });
    }
    if (ao.inCommand !== null) {
      const commander = ao.jtacs.find((jtac) => jtac.pid === ao.inCommand);
      if (!commander) {
        ctx.addIssue({ code: 'custom', path: ['inCommand'], message: 'Not a JTAC of this AO' });
      } else if (commander.presence !== 'online') {
        ctx.addIssue({ code: 'custom', path: ['inCommand'], message: 'JTAC is not online' });
      }
    }
  });
export type Ao = z.infer<typeof Ao>;

/**
 * A new AO as the JTAC asks for it in `jtac.onStation`. Everything may be left
 * out: the relay makes a circle of 10 NM around his position, floor SFC,
 * ceiling as given. `center: null` = his current position (§8.2).
 */
export const AoSpec = z
  .object({
    name: AoName,
    type: AoType,
    center: LatLon.nullable(),
    radiusM: Size.nullable(),
    lengthM: Size.nullable(),
    widthM: Size.nullable(),
    headingDeg: z.number().min(0).lt(360).nullable(),
    points: z.array(LatLon).min(3).max(AO_RULES.maxPoints).nullable(),
    floor: Altitude,
    ceiling: Altitude.nullable(),
  })
  .partial();
export type AoSpec = z.infer<typeof AoSpec>;

// ---------------------------------------------------------------------------
// Messages (§8.2)

const OnStationBase = z.object({
  callsign: Callsign,
  freqs: z.array(Frequency).max(MAX_FREQUENCIES),
});

/**
 * `jtac.onStation` (host → relay): with `joinCode`, he joins that AO; otherwise
 * a new AO is made from `ao` (or the defaults). JTAC role only; a JTAC already
 * on-station gets `alreadyOnStation`.
 */
export const JtacOnStation = defineMessage(
  'jtac.onStation',
  z.union([
    OnStationBase.extend({ joinCode: AoJoinCode }),
    // `joinCode` must be absent here, so a mistyped code is refused instead of making a new AO.
    OnStationBase.extend({ ao: AoSpec.nullable().optional(), joinCode: z.never().optional() }),
  ]),
);
export type JtacOnStation = z.infer<typeof JtacOnStation>;

/** `ao.created` (relay → session): the new AO. */
export const AoCreated = defineMessage('ao.created', Ao);
export type AoCreated = z.infer<typeof AoCreated>;

/**
 * `ao.update` (host → relay), from the JTAC in command only: shape, size,
 * height, name. Recenter = `center` set to his current position.
 */
export const AoUpdate = defineMessage(
  'ao.update',
  z.object({
    aoId: AoId,
    changes: AoSpec.omit({ ceiling: true }).extend({ ceiling: Altitude.optional() }),
  }),
);
export type AoUpdate = z.infer<typeof AoUpdate>;

/** `ao.updated` (relay → session): the full AO after every change, incl. JTACs joining, leaving, lost. */
export const AoUpdated = defineMessage('ao.updated', Ao);
export type AoUpdated = z.infer<typeof AoUpdated>;

/** `jtac.offStation` (host → relay): he leaves the AO. */
export const JtacOffStation = defineMessage('jtac.offStation', z.object({ aoId: AoId }));
export type JtacOffStation = z.infer<typeof JtacOffStation>;

/** `ao.closed` (relay → session): the last JTAC went off-station; its map entries go with it. */
export const AoClosed = defineMessage('ao.closed', z.object({ aoId: AoId }));
export type AoClosed = z.infer<typeof AoClosed>;
