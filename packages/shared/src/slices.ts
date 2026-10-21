// SPDX-License-Identifier: GPL-3.0-or-later
// Contents of the host's state slices (protocol.md §14.3). The host owns them;
// screens get them in `state.snapshot` and `state.update`. Slices grow with
// their packages: session/flight/traffic with the relay (P1.6), ownship status
// and mission with the Lua bridge (P1.2).

import { z } from 'zod';

import { AircraftInfo, Coalition, EpochMs, Pid } from './common.js';
import { Flight, FlightSummary } from './flights.js';
import { Participant } from './session.js';
import { Fuel, Position, StatusPosition, StatusUpdate, WeaponStation } from './status.js';

/** Speeds that can be shown on Ownship → Aircraft (More → Settings). */
export const SpeedKind = z.enum(['ias', 'tas', 'gs', 'mach', 'vs']);
export type SpeedKind = z.infer<typeof SpeedKind>;

/** The speeds shown, in the fixed order of `SpeedKind`, each at most once. */
export const SpeedSelection = z
  .array(SpeedKind)
  .refine((kinds) => new Set(kinds).size === kinds.length, { message: 'Each speed only once' });

/** Time display in the status strip and everywhere else (scope §4.6, mission clock). */
export const TimeDisplay = z.enum(['zulu', 'local']);
export type TimeDisplay = z.infer<typeof TimeDisplay>;

/**
 * UI scale factor (ui-design.md §2). The range is a starting point; the default
 * and minimum window size are set after the first OKB tests (ui-design.md §10).
 */
export const UiScale = z.number().min(0.5).max(3);

/** `host`: the host process itself. */
export const HostSlice = z.object({
  /** Build version, e.g. `0.1.0+3f2c1ab` (§14.6). */
  build: z.string().min(1),
  /** Lua bridge (protocol.md §6.1). */
  bridge: z.object({
    /**
     * `waiting` = nothing received yet, or the mission ended normally;
     * `receiving`; `stale` = data stopped without the mission ending (DCS
     * closed or crashed).
     */
    state: z.enum(['waiting', 'receiving', 'stale']),
    /** Bridge version (`bv`) of the installed Lua files, once heard from. */
    version: z.int().positive().nullable(),
    /** DCS version, e.g. `2.9.30.28738`, if the Lua side could read it. */
    dcsVersion: z.string().min(1).nullable(),
  }),
  /** Relay connection. */
  relay: z.object({ state: z.enum(['notConnected', 'connecting', 'connected']) }),
  /** LAN access switch (P1.8). */
  lan: z.object({ enabled: z.boolean() }),
});
export type HostSlice = z.infer<typeof HostSlice>;

/** `session`: the coalition session on the relay. */
export const SessionSlice = z.object({
  joined: z.boolean(),
  /** Own participant ID while joined. */
  pid: Pid.nullable(),
  coalition: Coalition.nullable(),
  participants: z.array(Participant),
});
export type SessionSlice = z.infer<typeof SessionSlice>;

/** `flight`: the own flight and the list of open flights. */
export const FlightSlice = z.object({
  own: Flight.nullable(),
  open: z.array(FlightSummary),
});
export type FlightSlice = z.infer<typeof FlightSlice>;

/** Manual own-ship values; each wins over export/server values (§6.2, §14.7). */
export const OwnshipOverrides = z.object({
  position: Position.pick({ lat: true, lon: true, altMsl: true }).nullable(),
  fuel: Fuel.omit({ source: true }).nullable(),
  stations: z.array(WeaponStation.omit({ source: true })),
  gun: z.object({ rounds: z.int().nonnegative() }).nullable(),
});
export type OwnshipOverrides = z.infer<typeof OwnshipOverrides>;

/** Chaff and flares left. Host-local for now: not part of `status.update`. */
export const Countermeasures = z.object({
  chaff: z.int().nonnegative(),
  flare: z.int().nonnegative(),
});
export type Countermeasures = z.infer<typeof Countermeasures>;

/**
 * Air data beyond `status.update`'s ground speed and IAS – host-local, shown on
 * the user's own screens only. `null` where DCS has no value (e.g. Mach in a
 * ground vehicle).
 */
export const AirData = z.object({
  /** True airspeed, m/s. */
  tas: z.number().nonnegative().nullable(),
  mach: z.number().nonnegative().nullable(),
  /** Vertical speed, m/s, + up. */
  vs: z.number().nullable(),
});
export type AirData = z.infer<typeof AirData>;

/** `ownship`: own status as sent in `status.update`, plus the manual overrides. */
export const OwnshipSlice = z.object({
  /**
   * Own aircraft or slot: DCS unit type (from the hook, else the export), unit
   * name and slot ID. `null` without a slot.
   */
  aircraft: AircraftInfo.nullable(),
  /**
   * Built by the host from bridge data and overrides (P1.2); `null` while
   * neither has anything.
   */
  status: StatusUpdate.shape.body.nullable(),
  /** Host clock when `status`'s data arrived; screens show the data age from it. */
  statusAt: EpochMs.nullable(),
  countermeasures: Countermeasures.nullable(),
  airData: AirData,
  /**
   * Manual values. They belong to the aircraft they were entered for and are
   * cleared when the own aircraft changes (slot change, mission end).
   */
  overrides: OwnshipOverrides,
});
export type OwnshipSlice = z.infer<typeof OwnshipSlice>;

/** `traffic`: other aircraft of the coalition from `status.position` (§6.4). */
export const TrafficSlice = z.object({
  aircraft: z.array(
    StatusPosition.shape.body.extend({
      /** Host clock when the position arrived; screens show the age from it. */
      receivedAt: EpochMs,
    }),
  ),
});
export type TrafficSlice = z.infer<typeof TrafficSlice>;

/** `mission`: the running DCS mission, from the client hook (P1.2). */
export const MissionSlice = z.object({
  /** `true` while a mission is loaded and running. */
  running: z.boolean(),
  /** Mission name, e.g. `VWA_CAU_2.2.11`. */
  name: z.string().min(1).nullable(),
  /** DCS map, e.g. `Caucasus`. */
  theatre: z.string().min(1).nullable(),
  /** Mission start date, `YYYY-MM-DD`. */
  startDate: z.iso.date().nullable(),
  /** `true` on a multiplayer server, `false` in single player. */
  multiplayer: z.boolean().nullable(),
  /** Coalition of the own slot; `null` as a spectator or without hook data. */
  coalition: Coalition.nullable(),
  /** Own player name in DCS (local only, a default for the nick in P1.6). */
  playerName: z.string().min(1).nullable(),
  /**
   * Mission clock: `mtime` in seconds (start time + model time, protocol.md §0)
   * as sampled at `sampledAt` (host clock). Model time runs at real time, so
   * screens advance it themselves between updates – except while `paused`
   * (single player pause: model time stands still).
   */
  clock: z
    .object({ mtimeSec: z.number().nonnegative(), sampledAt: EpochMs, paused: z.boolean() })
    .nullable(),
});
export type MissionSlice = z.infer<typeof MissionSlice>;

/** `settings`: user settings, shared by all of his screens. */
export const SettingsSlice = z.object({
  timeDisplay: TimeDisplay,
  uiScale: UiScale,
  /** Speeds shown on Ownship → Aircraft. */
  speeds: SpeedSelection,
});
export type SettingsSlice = z.infer<typeof SettingsSlice>;

/** Schema of every slice, by name. */
export const SLICE_SCHEMAS = {
  host: HostSlice,
  session: SessionSlice,
  flight: FlightSlice,
  ownship: OwnshipSlice,
  traffic: TrafficSlice,
  mission: MissionSlice,
  settings: SettingsSlice,
} as const;

/** State of a host that just started. */
export function defaultSlices(build: string): {
  host: HostSlice;
  session: SessionSlice;
  flight: FlightSlice;
  ownship: OwnshipSlice;
  traffic: TrafficSlice;
  mission: MissionSlice;
  settings: SettingsSlice;
} {
  return {
    host: {
      build,
      bridge: { state: 'waiting', version: null, dcsVersion: null },
      relay: { state: 'notConnected' },
      lan: { enabled: false },
    },
    session: { joined: false, pid: null, coalition: null, participants: [] },
    flight: { own: null, open: [] },
    ownship: {
      aircraft: null,
      status: null,
      statusAt: null,
      countermeasures: null,
      airData: { tas: null, mach: null, vs: null },
      overrides: { position: null, fuel: null, stations: [], gun: null },
    },
    traffic: { aircraft: [] },
    mission: {
      running: false,
      name: null,
      theatre: null,
      startDate: null,
      multiplayer: null,
      coalition: null,
      playerName: null,
      clock: null,
    },
    settings: { timeDisplay: 'zulu', uiScale: 1, speeds: ['ias', 'gs'] },
  };
}
