// SPDX-License-Identifier: GPL-3.0-or-later
// Lua bridge → host datagrams (protocol.md §6.1): local UDP on 127.0.0.1, one
// JSON object per datagram. Never forwarded as-is. The Lua side sends raw DCS
// values; every conversion (true heading, fuel weight, weapon kind) happens in
// the host, where it can be tested.

import { z } from 'zod';

/**
 * Bridge version (`bv`, architecture.md §1.1 rule 6). Bump it whenever a
 * datagram changes; the Lua files in `dcs/export` carry the same number.
 */
export const BRIDGE_VERSION = 4;

/** Timing of the bridge as seen by the host. */
export const BRIDGE_TIMING = {
  /** The export script sends `own` this often (real time, 4 Hz). */
  ownIntervalSec: 0.25,
  /** The hook repeats `session` this often while a mission runs. */
  sessionBeatSec: 5,
  /** No datagram for this long → the bridge is `stale`. */
  staleAfterSec: 10,
} as const;

/**
 * Lua can't store `nil` in a table, so a missing value is simply absent from
 * the JSON. The schemas read an absent field as `null`.
 */
function maybe<T extends z.ZodType>(schema: T) {
  return schema.nullable().default(null);
}

const Bv = z.int().positive();
const Latitude = z.number().min(-90).max(90);
const Longitude = z.number().min(-180).max(180);
const Count = z.int().nonnegative();

// ---------------------------------------------------------------------------
// hello – both Lua environments, at start and every 30 s

export const BridgeHello = z.object({
  t: z.literal('hello'),
  bv: Bv,
  /** Which Lua environment sent it: the export script or the GUI hook. */
  env: z.enum(['export', 'hook']),
  /** DCS version, e.g. `2.9.30.28738`, if readable. */
  dcs: maybe(z.string().min(1)),
});
export type BridgeHello = z.infer<typeof BridgeHello>;

// ---------------------------------------------------------------------------
// own – export script, 4 Hz

/** DCS weapon type code `level1–4` (spike 3.3). */
export const WeaponTypeCode = z.tuple([z.int(), z.int(), z.int(), z.int()]);
export type WeaponTypeCode = z.infer<typeof WeaponTypeCode>;

/** One station from `LoGetPayloadInfo()`. Empty stations (type 0,0,0,0) are not sent. */
export const BridgeStation = z.object({
  /** Station number = index in DCS's station list. */
  st: z.int().positive(),
  /** Weapon type code. */
  w: WeaponTypeCode,
  /** `LoGetNameByType()` – e.g. `AIM-9X`, `aaq-28LEFT litening`. */
  name: maybe(z.string()),
  /** Weapons left on the station; 0 after the last release. */
  count: Count,
  /** Loadout CLSID, e.g. `{FPU_8A_FUEL_TANK}`. */
  clsid: maybe(z.string()),
});
export type BridgeStation = z.infer<typeof BridgeStation>;

export const BridgeOwn = z.object({
  t: z.literal('own'),
  bv: Bv,
  /** DCS model time, s. On an MP client this is the server's mission model time. */
  mt: z.number().nonnegative(),
  /** Mission start time, s after 00:00 local (`LoGetMissionStartTime`). */
  start: maybe(z.number().nonnegative()),
  /** Unit type, e.g. `FA-18C_hornet`, `M1043 HMMWV Armament`; `null` without own-ship data. */
  type: maybe(z.string().min(1)),
  /** Unit name, e.g. `Enfield 1-1`. */
  unit: maybe(z.string().min(1)),
  lat: maybe(Latitude),
  lon: maybe(Longitude),
  /** Altitude MSL, m. */
  altMsl: maybe(z.number()),
  /** Altitude AGL, m. */
  altAgl: maybe(z.number()),
  /**
   * `LoGetSelfData().Heading`: heading from the **map grid's north** in radians,
   * not normalised (spike 3.2). This is what DCS's avionics and the F10 ruler
   * call "true" – SLATE uses it as true heading (protocol.md §0).
   */
  gridHdg: maybe(z.number()),
  /**
   * `LoGetMagneticYaw()`: magnetic heading in radians as the cockpit shows it
   * (bridge version 2). Missing in ground vehicles.
   */
  magHdg: maybe(z.number()),
  /**
   * Lat/lon of the point 1 km grid-north of the aircraft, from DCS's own map
   * projection (`LoLoCoordinatesToGeoCoordinates`). Not used for the heading:
   * it gives the angle between grid north and geographic north, which bearings
   * worked out from lat/lon need to match the cockpit (moving map, P3).
   */
  north: maybe(z.tuple([Latitude, Longitude])),
  /** Velocity in map axes, m/s: x north (grid), y up, z east (grid). */
  vel: maybe(z.tuple([z.number(), z.number(), z.number()])),
  /** Indicated airspeed, m/s (`LoGetIndicatedAirSpeed`); `null` in ground vehicles. */
  ias: maybe(z.number()),
  /** True airspeed, m/s (`LoGetTrueAirSpeed`, bridge version 3). */
  tas: maybe(z.number()),
  /** Mach number (`LoGetMachNumber`, bridge version 3); `null` in ground vehicles. */
  mach: maybe(z.number()),
  /** Vertical speed, m/s, + up (`LoGetVerticalVelocity`, bridge version 3). */
  vs: maybe(z.number()),
  /**
   * `LoGetEngineInfo().fuel_internal`: fraction of **internal** capacity that
   * **includes external tanks** (above 1.0 with tanks, spike 3.2).
   */
  fuelInt: maybe(z.number().nonnegative()),
  /** `fuel_external` – 0 on every airframe tested so far. */
  fuelExt: maybe(z.number().nonnegative()),
  /** Stations; `null` when `LoGetPayloadInfo()` returns nothing (vehicles, no slot). */
  payload: maybe(z.array(BridgeStation)),
  /** Gun rounds left; `null` without a gun. */
  gun: maybe(Count),
  /** Chaff and flares left (`LoGetSnares`). */
  cm: maybe(z.object({ chaff: Count, flare: Count })),
});
export type BridgeOwn = z.infer<typeof BridgeOwn>;

// ---------------------------------------------------------------------------
// session – GUI hook, on every event and every 5 s while a mission runs

/** What made the hook send. */
export const SessionEvent = z.enum(['load', 'start', 'stop', 'slot', 'beat']);
export type SessionEvent = z.infer<typeof SessionEvent>;

export const BridgeSession = z.object({
  t: z.literal('session'),
  bv: Bv,
  ev: SessionEvent,
  /** `true` while a mission is loaded and the simulation runs. */
  running: z.boolean(),
  /** DCS model time, s (`DCS.getModelTime`). */
  mt: maybe(z.number().nonnegative()),
  /** From `DCS.getCurrentMission()` – read once per mission load. */
  mission: maybe(
    z.object({
      name: maybe(z.string().min(1)),
      /** DCS map, e.g. `Caucasus`. */
      theatre: maybe(z.string().min(1)),
      /** Start date `YYYY-MM-DD`. */
      date: maybe(z.iso.date()),
      /** Start time, s after 00:00 local. */
      start: maybe(z.number().nonnegative()),
    }),
  ),
  /** `DCS.isMultiplayer()`. */
  mp: maybe(z.boolean()),
  /** `DCS.isServer()` – `true` in single player too. */
  server: maybe(z.boolean()),
  /** Own player only – no UCID, no IP. */
  player: maybe(
    z.object({
      name: maybe(z.string().min(1)),
      /** `net.get_player_info().side`: 0 spectators, 1 red, 2 blue. */
      side: maybe(z.int().min(0).max(2)),
      /** Slot ID, e.g. `1000043`, `forward_observer_blue_4`. */
      slot: maybe(z.string().min(1)),
      /** `DCS.getPlayerUnitType()`, e.g. `FA-18C_hornet`, `forward_observer`. */
      unitType: maybe(z.string().min(1)),
    }),
  ),
});
export type BridgeSession = z.infer<typeof BridgeSession>;

// ---------------------------------------------------------------------------
// missionCheck – GUI hook, once per mission load (P1.2 check)

/** Counts per category of what `DCS.getCurrentMission()` holds for one coalition. */
export const MissionCounts = z.object({
  groups: Count,
  units: Count,
  /** Groups with at least one route point. */
  routed: Count,
  /** Groups with a radio frequency set. */
  withFrequency: Count,
});
export type MissionCounts = z.infer<typeof MissionCounts>;

/**
 * Answers the P1.2 question "are the contents of `DCS.getCurrentMission()`
 * complete on an MP client, or filtered?" (architecture.md §1.1): the hook
 * counts groups, units, routes and frequencies per coalition; the host logs them.
 */
export const BridgeMissionCheck = z.object({
  t: z.literal('missionCheck'),
  bv: Bv,
  coalitions: z.record(z.string().min(1), MissionCounts),
});
export type BridgeMissionCheck = z.infer<typeof BridgeMissionCheck>;

// ---------------------------------------------------------------------------
// chat – GUI hook, on event (P1.7): a chat line starting with `[SLATE]`
// (discovery, protocol.md §2). Other chat lines are never passed on.

export const BridgeChat = z.object({
  t: z.literal('chat'),
  bv: Bv,
  text: z.string().min(1).max(1000),
  /**
   * `true` if the line came from the server (`from` = `net.get_server_id()`).
   * The host only follows those – a player could type a `[SLATE]` line too.
   */
  server: z.boolean(),
  /** Raw sender and server player IDs, for the log (spike 3.5: what DCS really passes). */
  from: maybe(z.number()),
  serverId: maybe(z.number()),
});
export type BridgeChat = z.infer<typeof BridgeChat>;

// ---------------------------------------------------------------------------
// Parsing

export const BridgeDatagram = z.discriminatedUnion('t', [
  BridgeHello,
  BridgeOwn,
  BridgeSession,
  BridgeMissionCheck,
  BridgeChat,
]);
export type BridgeDatagram = z.infer<typeof BridgeDatagram>;

export type BridgeParseResult =
  | { ok: true; datagram: BridgeDatagram }
  | { ok: false; reason: 'badJson' | 'badDatagram' | 'unknownType'; text: string }
  | { ok: false; reason: 'versionMismatch'; bv: number };

const KNOWN_TYPES = new Set(['hello', 'own', 'session', 'missionCheck', 'chat']);

/**
 * Reads one datagram. The version is checked first: a datagram from Lua files
 * of another version is reported as `versionMismatch` and never read further,
 * since its fields may mean something else. Unknown types (from newer Lua
 * files) are reported, not treated as errors.
 */
export function parseBridgeDatagram(text: string): BridgeParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'badJson', text: 'Not JSON' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'badDatagram', text: 'Not a JSON object' };
  }
  const { t, bv } = raw as { t?: unknown; bv?: unknown };
  if (typeof bv !== 'number' || !Number.isInteger(bv) || bv < 1) {
    return { ok: false, reason: 'badDatagram', text: 'Missing bridge version "bv"' };
  }
  if (bv !== BRIDGE_VERSION) return { ok: false, reason: 'versionMismatch', bv };
  if (typeof t !== 'string' || !KNOWN_TYPES.has(t)) {
    return { ok: false, reason: 'unknownType', text: `Unknown datagram type ${JSON.stringify(t)}` };
  }
  const result = BridgeDatagram.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join('.') ?? '';
    return {
      ok: false,
      reason: 'badDatagram',
      text: `${t}: ${where} ${issue?.message ?? ''}`.trim(),
    };
  }
  return { ok: true, datagram: result.data };
}
