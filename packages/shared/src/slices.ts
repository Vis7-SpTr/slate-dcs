// SPDX-License-Identifier: GPL-3.0-or-later
// Contents of the host's state slices (protocol.md §14.3). The host owns them;
// screens get them in `state.snapshot` and `state.update`. Slices grow with
// their packages: session/flight/traffic with the relay (P1.6), ownship status
// and mission with the Lua bridge (P1.2).

import { z } from 'zod';

import { Coalition, EpochMs, Pid } from './common.js';
import { Flight, FlightSummary } from './flights.js';
import { Participant } from './session.js';
import { Fuel, Position, StatusPosition, StatusUpdate, WeaponStation } from './status.js';

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
  /** Lua bridge: `waiting` = nothing received yet, `receiving`, `stale` = stopped. */
  bridge: z.object({ state: z.enum(['waiting', 'receiving', 'stale']) }),
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

/** `ownship`: own status as sent in `status.update`, plus the manual overrides. */
export const OwnshipSlice = z.object({
  /** Built by the host from bridge data and overrides (P1.2); `null` until then. */
  status: StatusUpdate.shape.body.nullable(),
  /** Host clock when `status` was last built; screens show the data age from it. */
  statusAt: EpochMs.nullable(),
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
  /** DCS map, e.g. `Caucasus`. */
  theatre: z.string().min(1).nullable(),
  /** Mission start date, `YYYY-MM-DD`. */
  startDate: z.iso.date().nullable(),
  /**
   * Mission clock: `mtime` in seconds (start time + model time, protocol.md §0)
   * as sampled at `sampledAt` (host clock). Model time runs at real time, so
   * screens advance it themselves between updates.
   */
  clock: z.object({ mtimeSec: z.number().nonnegative(), sampledAt: EpochMs }).nullable(),
});
export type MissionSlice = z.infer<typeof MissionSlice>;

/** `settings`: user settings, shared by all of his screens. */
export const SettingsSlice = z.object({
  timeDisplay: TimeDisplay,
  uiScale: UiScale,
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
      bridge: { state: 'waiting' },
      relay: { state: 'notConnected' },
      lan: { enabled: false },
    },
    session: { joined: false, pid: null, coalition: null, participants: [] },
    flight: { own: null, open: [] },
    ownship: {
      status: null,
      statusAt: null,
      overrides: { position: null, fuel: null, stations: [], gun: null },
    },
    traffic: { aircraft: [] },
    mission: { running: false, theatre: null, startDate: null, clock: null },
    settings: { timeDisplay: 'zulu', uiScale: 1 },
  };
}
