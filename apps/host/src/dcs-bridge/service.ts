// SPDX-License-Identifier: GPL-3.0-or-later
// The DCS bridge in the host: reads the Lua datagrams (protocol.md §6.1) and
// keeps the `host.bridge`, `mission` and `ownship` slices up to date.
//
// - Own-ship data arrives at 4 Hz; the `ownship` slice is published at most
//   every 500 ms (latest wins), events (slot change, weapon released, mission
//   start/stop) at once.
// - The mission clock is published only when it drifts more than 0.5 s from
//   what the screens work out themselves, or pauses/resumes.
// - Every slice is rebuilt at publish time from the current store, so manual
//   overrides set by commands in between are never lost.

import {
  BRIDGE_TIMING,
  BRIDGE_VERSION,
  formatTimeOfDay,
  parseBridgeDatagram,
  unitDisplayName,
  weaponsCount,
} from '@slate-dcs/shared';
import type {
  AircraftInfo,
  BridgeHello,
  BridgeMissionCheck,
  BridgeOwn,
  BridgeSession,
  MissionSlice,
  OwnshipOverrides,
  Slices,
} from '@slate-dcs/shared';

import type { StateStore } from '../state/store.js';
import { exportValues } from './convert.js';
import type { ExportValues } from './convert.js';
import { OwnshipBuilder } from './ownship.js';

/** The logging the bridge needs; Fastify's (pino) logger fits. */
export interface BridgeLog {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

export interface DcsBridgeOptions {
  store: StateStore;
  log: BridgeLog;
  /** Host clock, ms. */
  now?: () => number;
  /** Routine own-ship updates are published at most this often. */
  publishIntervalMs?: number;
  /** No datagram for this long → `stale`. */
  staleAfterMs?: number;
  /** An own-ship summary goes to the log this often. */
  summaryIntervalMs?: number;
}

type BridgeState = Slices['host']['bridge']['state'];
type DirtySlice = 'host' | 'mission' | 'ownship';
type Clock = NonNullable<MissionSlice['clock']>;

/** Model time standing still this long while data keeps coming = paused. */
const PAUSE_AFTER_MS = 1500;
/** Clock drift that's worth an update. */
const CLOCK_TOLERANCE_SEC = 0.5;
/** Own-ship data this old no longer counts for the clock. */
const OWN_FRESH_MS = 2000;
/** Own datagrams right after a mission stop are left over from it. */
const IGNORE_OWN_AFTER_STOP_MS = 2000;
/** Bad datagrams logged as warnings before switching to debug. */
const BAD_WARNINGS = 5;

const NO_OVERRIDES: OwnshipOverrides = { position: null, fuel: null, stations: [], gun: null };

export class DcsBridge {
  readonly #store: StateStore;
  readonly #log: BridgeLog;
  readonly #now: () => number;
  readonly #publishIntervalMs: number;
  readonly #staleAfterMs: number;
  readonly #summaryIntervalMs: number;

  #state: BridgeState = 'waiting';
  #version: number | null = null;
  #dcsVersion: string | null = null;
  #lastDatagramAt: number | null = null;
  #badCount = 0;
  readonly #warned = new Set<string>();

  #running = false;
  #session: BridgeSession | null = null;
  #own: ExportValues | null = null;
  #ownAt: number | null = null;
  #ignoreOwnUntil = 0;

  #aircraft: AircraftInfo | null = null;
  #aircraftKey: string | null = null;
  #clearOverrides = false;
  #overridesAt: number | null = null;
  #lastOverridesJson = JSON.stringify(NO_OVERRIDES);
  #payloadKey: string | null = null;
  #weapons: number | null = null;
  readonly #builder = new OwnshipBuilder();

  #clock: Clock | null = null;
  #lastMt: number | null = null;
  #mtChangedAt = 0;
  #paused = false;

  readonly #dirty = new Set<DirtySlice>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #lastPublish = -Infinity;
  #publishing = false;
  #lastSummary = -Infinity;
  readonly #unsubscribe: () => void;

  constructor(options: DcsBridgeOptions) {
    this.#store = options.store;
    this.#log = options.log;
    this.#now = options.now ?? Date.now;
    this.#publishIntervalMs = options.publishIntervalMs ?? 500;
    this.#staleAfterMs = options.staleAfterMs ?? BRIDGE_TIMING.staleAfterSec * 1000;
    this.#summaryIntervalMs = options.summaryIntervalMs ?? 10_000;
    this.#lastOverridesJson = JSON.stringify(this.#store.get('ownship').overrides);

    // Manual overrides set by a command: rebuild the status right after the
    // command's own update (not inside it, so screens see the changes in order).
    this.#unsubscribe = this.#store.subscribe((change) => {
      const ownship = change.slices.ownship;
      if (this.#publishing || ownship === undefined) return;
      const json = JSON.stringify(ownship.overrides);
      if (json === this.#lastOverridesJson) return;
      this.#lastOverridesJson = json;
      this.#overridesAt = this.#now();
      queueMicrotask(() => {
        this.#markDirty('ownship');
        this.#flush();
      });
    });
  }

  /** Current bridge state (for tests and the log). */
  get state(): BridgeState {
    return this.#state;
  }

  /** Calls `tick` every second until the returned function is called. */
  start(): () => void {
    const interval = setInterval(() => {
      this.tick();
    }, 1000);
    return () => {
      clearInterval(interval);
      this.dispose();
    };
  }

  dispose(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#unsubscribe();
  }

  /** One datagram as received. */
  handleText(text: string): void {
    const now = this.#now();
    const result = parseBridgeDatagram(text);
    if (!result.ok) {
      if (result.reason === 'versionMismatch') {
        this.#versionMismatch(result.bv);
      } else if (result.reason === 'unknownType') {
        this.#warnOnce(`type:${result.text}`, `Lua bridge: ${result.text} – ignored`);
      } else {
        this.#bad(result.text);
      }
      return;
    }

    this.#lastDatagramAt = now;
    if (this.#version !== BRIDGE_VERSION) {
      this.#version = BRIDGE_VERSION;
      this.#markDirty('host');
    }
    const datagram = result.datagram;
    switch (datagram.t) {
      case 'hello':
        this.#hello(datagram);
        break;
      case 'own':
        this.#ownDatagram(datagram, now);
        break;
      case 'session':
        this.#sessionDatagram(datagram, now);
        break;
      case 'missionCheck':
        this.#missionCheck(datagram);
        break;
    }
    this.#flushIfDirtyNow();
  }

  /** Stale check and the periodic log line; called every second. */
  tick(): void {
    const now = this.#now();
    if (
      this.#state === 'receiving' &&
      this.#lastDatagramAt !== null &&
      now - this.#lastDatagramAt > this.#staleAfterMs
    ) {
      this.#log.warn(
        `DCS data stopped – nothing from the Lua bridge for ${String(Math.round(this.#staleAfterMs / 1000))} s`,
      );
      this.#setState('stale');
      this.#running = false;
      this.#markDirty('mission', 'ownship');
      this.#immediate = true;
    }
    if (
      this.#state === 'receiving' &&
      this.#own !== null &&
      now - this.#lastSummary >= this.#summaryIntervalMs
    ) {
      this.#lastSummary = now;
      this.#log.info(this.#summary(this.#own));
    }
    this.#flushIfDirtyNow();
  }

  // -------------------------------------------------------------------------
  // Datagrams

  #hello(hello: BridgeHello): void {
    if (hello.dcs !== null && hello.dcs !== this.#dcsVersion) {
      this.#dcsVersion = hello.dcs;
      this.#markDirty('host');
    }
    this.#log.info(
      `Lua bridge: ${hello.env === 'export' ? 'export script' : 'GUI hook'} v${String(hello.bv)}` +
        (hello.dcs === null ? '' : `, DCS ${hello.dcs}`),
    );
  }

  #ownDatagram(own: BridgeOwn, now: number): void {
    if (now < this.#ignoreOwnUntil) return;
    this.#setState('receiving');
    const values = exportValues(own);
    const first = this.#own === null;
    this.#own = values;
    this.#ownAt = now;
    if (!this.#running) {
      this.#running = true;
      this.#markDirty('mission');
      this.#immediate = true;
    }

    // Pause (single player): data keeps coming, model time stands still.
    if (this.#lastMt === null || values.mt !== this.#lastMt) {
      this.#lastMt = values.mt;
      this.#mtChangedAt = now;
      this.#paused = false;
    } else if (now - this.#mtChangedAt > PAUSE_AFTER_MS) {
      this.#paused = true;
    }
    const start = values.start ?? this.#session?.mission?.start ?? null;
    this.#updateClock(start === null ? null : { mtimeSec: start + values.mt, sampledAt: now });

    if (this.#updateAircraft()) this.#immediate = true;
    if (this.#updatePayload(values)) this.#immediate = true;

    if (values.avail.fuel && values.fuel === null && values.type !== null) {
      this.#warnOnce(
        `fuel:${values.type}`,
        `No fuel capacity known for ${values.type} – fuel stays empty (add it to packages/shared/src/airframes.ts)`,
      );
    }
    this.#markDirty('ownship');
    if (first) this.#immediate = true;
  }

  #sessionDatagram(session: BridgeSession, now: number): void {
    if (session.ev === 'stop') {
      this.#stop(now);
      return;
    }
    // A loaded mission that hasn't started (briefing) doesn't count as live yet:
    // the hook only repeats `session` once the simulation runs.
    if (session.running) this.#setState('receiving');
    const before = this.#session;
    this.#session = session;
    if (missionKey(before) !== missionKey(session) && session.mission !== null) {
      const m = session.mission;
      this.#log.info(
        `Mission: ${m.name ?? '(no name)'} – ${m.theatre ?? 'unknown map'}, ${m.date ?? 'no date'}, ` +
          `start ${m.start === null ? '?' : hms(m.start)} local, ` +
          (session.mp === true ? 'multiplayer' : 'single player'),
      );
    }
    const ownFresh = this.#ownAt !== null && now - this.#ownAt < OWN_FRESH_MS;
    this.#running = session.running || ownFresh;

    // Without fresh own-ship data (JTAC on the map, menus), the hook's model time keeps the clock.
    const start = session.mission?.start ?? null;
    if (!ownFresh && session.mt !== null && start !== null) {
      this.#updateClock({ mtimeSec: start + session.mt, sampledAt: now });
    }
    this.#updateAircraft();
    this.#markDirty('mission', 'ownship');
    this.#immediate = true;
  }

  #missionCheck(check: BridgeMissionCheck): void {
    const parts = Object.entries(check.coalitions).map(
      ([side, c]) =>
        `${side} ${String(c.groups)} groups/${String(c.units)} units ` +
        `(${String(c.routed)} with route, ${String(c.withFrequency)} with frequency)`,
    );
    this.#log.info(
      `Mission data seen by DCS.getCurrentMission(): ${parts.join('; ') || 'nothing'}`,
    );
  }

  #stop(now: number): void {
    this.#log.info('Mission ended');
    this.#running = false;
    this.#session = null;
    this.#own = null;
    this.#ownAt = null;
    this.#clock = null;
    this.#lastMt = null;
    this.#paused = false;
    this.#payloadKey = null;
    this.#weapons = null;
    this.#ignoreOwnUntil = now + IGNORE_OWN_AFTER_STOP_MS;
    this.#updateAircraft();
    this.#setState('waiting');
    this.#markDirty('mission', 'ownship');
    this.#immediate = true;
  }

  #versionMismatch(bv: number): void {
    if (this.#version !== bv) {
      this.#version = bv;
      this.#markDirty('host');
      this.#immediate = true;
    }
    this.#warnOnce(
      `bv:${String(bv)}`,
      `Lua bridge files are version ${String(bv)}, this SLATE needs version ${String(BRIDGE_VERSION)} – ` +
        'install the Lua files from this build. Their data is ignored until then.',
    );
    this.#flushIfDirtyNow();
  }

  #bad(text: string): void {
    this.#badCount += 1;
    const message = `Lua bridge: bad datagram (${String(this.#badCount)}): ${text}`;
    if (this.#badCount <= BAD_WARNINGS) this.#log.warn(message);
    else this.#log.debug(message);
  }

  // -------------------------------------------------------------------------
  // Derived state

  #updateClock(sample: { mtimeSec: number; sampledAt: number } | null): void {
    const before = this.#clock;
    if (sample === null) {
      if (before !== null) {
        this.#clock = null;
        this.#markDirty('mission');
      }
      return;
    }
    const predicted =
      before === null
        ? null
        : before.mtimeSec + (before.paused ? 0 : (sample.sampledAt - before.sampledAt) / 1000);
    if (
      before === null ||
      predicted === null ||
      before.paused !== this.#paused ||
      Math.abs(predicted - sample.mtimeSec) > CLOCK_TOLERANCE_SEC
    ) {
      this.#clock = { ...sample, paused: this.#paused };
      this.#markDirty('mission');
      if (before === null) this.#log.info(`Mission clock: ${hms(sample.mtimeSec)} local`);
      if (before !== null && before.paused !== this.#paused) {
        this.#log.info(this.#paused ? 'Mission paused' : 'Mission resumed');
      }
    }
  }

  /** Works out the own aircraft; returns `true` if it changed (overrides are cleared then). */
  #updateAircraft(): boolean {
    const player = this.#session?.player ?? null;
    const own = this.#own;
    const type = player?.unitType ?? own?.type ?? null;
    let aircraft: AircraftInfo | null = null;
    if (type !== null) {
      aircraft = { type };
      if (own?.unit) aircraft.unit = own.unit;
      if (player?.slot) aircraft.slot = player.slot;
    }
    const key =
      aircraft === null ? null : `${aircraft.type}|${aircraft.unit ?? ''}|${aircraft.slot ?? ''}`;
    if (key === this.#aircraftKey) return false;

    this.#aircraftKey = key;
    this.#aircraft = aircraft;
    this.#clearOverrides = true;
    this.#builder.reset();
    this.#markDirty('ownship');
    if (aircraft === null) {
      this.#log.info('Slot: none');
    } else {
      const vehicle = own?.type && own.type !== aircraft.type ? ` in ${own.type}` : '';
      this.#log.info(
        `Slot: ${unitDisplayName(aircraft.type)}${vehicle}` +
          (aircraft.unit ? ` "${aircraft.unit}"` : '') +
          (aircraft.slot ? ` (slot ${aircraft.slot})` : ''),
      );
    }
    return true;
  }

  /** Logs payload changes; returns `true` if the weapons count changed (an event, §6.3). */
  #updatePayload(values: ExportValues): boolean {
    const armament = values.armament;
    const key =
      armament === null
        ? 'none'
        : [
            ...armament.stations.map((s) => `${String(s.st)} ${s.name} ×${String(s.count)}`),
            ...armament.stores.map((s) => `${String(s.st)} ${s.name}`),
          ].join(' · ');
    if (key !== this.#payloadKey) {
      this.#payloadKey = key;
      this.#log.info(`Payload: ${key === '' ? 'empty' : key}`);
    }
    const weapons = weaponsCount(armament);
    const changed = weapons !== this.#weapons;
    this.#weapons = weapons;
    return changed;
  }

  #setState(state: BridgeState): void {
    if (state === this.#state) return;
    if (state === 'receiving') this.#log.info('DCS data: receiving');
    this.#state = state;
    this.#markDirty('host');
    this.#immediate = true;
  }

  #missionSlice(): MissionSlice {
    const session = this.#session;
    const mission = session?.mission ?? null;
    const player = session?.player ?? null;
    return {
      running: this.#running,
      name: mission?.name ?? null,
      theatre: mission?.theatre ?? null,
      startDate: mission?.date ?? null,
      multiplayer: session?.mp ?? null,
      coalition: player?.side === 1 ? 'red' : player?.side === 2 ? 'blue' : null,
      playerName: player?.name ?? null,
      clock: this.#running ? this.#clock : null,
    };
  }

  #summary(own: ExportValues): string {
    const parts = [`Own: ${own.type === null ? 'no own-ship data' : unitDisplayName(own.type)}`];
    if (own.pos) {
      parts.push(
        `${own.pos.lat.toFixed(4)} ${own.pos.lon.toFixed(4)}`,
        `${String(Math.round(own.pos.altMsl / 0.3048))} ft`,
      );
    }
    const deg = (value: number) => String(Math.round(value) % 360).padStart(3, '0');
    if (own.hdgMag !== null) parts.push(`${deg(own.hdgMag)}°M`);
    if (own.hdg !== null) parts.push(`${deg(own.hdg)}°T`);
    if (own.gs !== null) parts.push(`GS ${String(Math.round((own.gs * 3600) / 1852))} kt`);
    if (own.ias !== null) parts.push(`IAS ${String(Math.round((own.ias * 3600) / 1852))} kt`);
    if (own.fuel) {
      parts.push(
        `fuel ${String(Math.round(own.fuel.internalKg))}+${String(Math.round(own.fuel.externalKg))} kg`,
      );
    }
    if (own.armament) {
      parts.push(`${String(weaponsCount(own.armament))} weapons`);
      if (own.armament.gun) parts.push(`gun ${String(own.armament.gun.rounds)}`);
    }
    const clock = this.#clock;
    if (clock) {
      const elapsed = clock.paused ? 0 : (this.#now() - clock.sampledAt) / 1000;
      parts.push(`clock ${hms(clock.mtimeSec + elapsed)}L${clock.paused ? ' paused' : ''}`);
    }
    return parts.join(', ');
  }

  // -------------------------------------------------------------------------
  // Publishing

  /** Set by a change that screens should see at once instead of within 500 ms. */
  #immediate = false;

  #markDirty(...slices: DirtySlice[]): void {
    for (const slice of slices) this.#dirty.add(slice);
  }

  #flushIfDirtyNow(): void {
    if (this.#dirty.size === 0) return;
    const now = this.#now();
    if (this.#immediate || now - this.#lastPublish >= this.#publishIntervalMs) {
      this.#flush();
      return;
    }
    this.#timer ??= setTimeout(
      () => {
        this.#timer = null;
        this.#flush();
      },
      this.#lastPublish + this.#publishIntervalMs - now,
    );
  }

  #flush(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#immediate = false;
    if (this.#dirty.size === 0) return;
    const now = this.#now();
    const changes: Partial<Slices> = {};

    if (this.#dirty.has('host')) {
      changes.host = {
        ...this.#store.get('host'),
        bridge: { state: this.#state, version: this.#version, dcsVersion: this.#dcsVersion },
      };
    }
    if (this.#dirty.has('mission')) changes.mission = this.#missionSlice();
    if (this.#dirty.has('ownship')) {
      let overrides = this.#store.get('ownship').overrides;
      if (this.#clearOverrides) {
        this.#clearOverrides = false;
        overrides = structuredClone(NO_OVERRIDES);
      }
      const built = this.#builder.build(this.#own, overrides);
      changes.ownship = {
        aircraft: this.#aircraft,
        status: built.status,
        statusAt:
          built.status === null
            ? null
            : this.#own !== null
              ? this.#ownAt
              : (this.#overridesAt ?? now),
        countermeasures: this.#own?.countermeasures ?? null,
        airData: this.#own?.airData ?? { tas: null, mach: null, vs: null },
        overrides: built.overrides,
      };
      this.#lastOverridesJson = JSON.stringify(built.overrides);
    }
    this.#dirty.clear();
    this.#lastPublish = now;

    this.#publishing = true;
    try {
      this.#store.update(changes);
    } finally {
      this.#publishing = false;
    }
  }

  #warnOnce(key: string, message: string): void {
    if (this.#warned.has(key)) return;
    this.#warned.add(key);
    this.#log.warn(message);
  }
}

function missionKey(session: BridgeSession | null): string {
  const m = session?.mission;
  return m ? `${m.name ?? ''}|${m.theatre ?? ''}|${m.date ?? ''}|${String(m.start)}` : '';
}

/** mtime or start time in seconds → `HH:MM:SS` local time of day. */
const hms = formatTimeOfDay;
