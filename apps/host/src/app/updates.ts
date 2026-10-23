// SPDX-License-Identifier: GPL-3.0-or-later
// Updates (P1.9, architecture.md §1.2): SLATE looks for a newer release at
// start and twice a day and shows it in More → Settings; it installs only
// when the user says so, and never while a mission is running. Installing
// downloads the release, hands it to Velopack's updater, ends SLATE, and the
// updater starts the new version.
//
// Feed: the GitHub Releases of the repo (decided 23 Oct 2026 – the repo goes
// public with P1, so the feed is unreachable until then and the card says so).
// `SLATE_UPDATE_SOURCE` points elsewhere for tests: a folder or an http(s) URL
// with Velopack's release files.

import type { AppState } from '@slate-dcs/shared';

import { failed } from '../commands/dispatcher.js';
import type { CommandOutcome } from '../commands/dispatcher.js';
import type { StateStore } from '../state/store.js';
import type { Velopack } from './velopack.js';

export const RELEASE_REPO = 'https://github.com/Vis7-SpTr/slate-dcs';
const RECHECK_MS = 12 * 3600_000;
const FIRST_CHECK_MS = 10_000;

type UpdateManager = InstanceType<Velopack['UpdateManager']>;
type UpdateInfo = NonNullable<Awaited<ReturnType<UpdateManager['checkForUpdatesAsync']>>>;

export interface UpdaterOptions {
  store: StateStore;
  /** `null`: not installed with Velopack – updates are `unsupported`. */
  velopack: Velopack | null;
  log: { info(message: string): void; warn(message: string): void };
  /** Ends SLATE after the update was handed to the updater. */
  exit: () => void;
  source?: string | undefined;
  now?: () => number;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The update source: a URL, a folder, or the GitHub releases. */
export function updateSource(vp: Velopack, source: string | undefined): unknown {
  if (source === undefined || source === '') return new vp.GithubSource(RELEASE_REPO);
  if (/^https?:\/\//i.test(source)) return new vp.HttpSource(source);
  return new vp.FileSource(source);
}

export class Updater {
  readonly #o: UpdaterOptions;
  readonly #now: () => number;
  readonly #manager: UpdateManager | null = null;
  #found: UpdateInfo | null = null;
  #busy = false;
  #timers: ReturnType<typeof setTimeout>[] = [];

  constructor(options: UpdaterOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
    const vp = options.velopack;
    if (vp) {
      try {
        this.#manager = new vp.UpdateManager(updateSource(vp, options.source) as never);
      } catch (error) {
        // Running from a build folder instead of an installation.
        options.log.info(`Updates off: ${message(error)}`);
      }
    }
    this.#set({
      installed: this.#manager !== null,
      update: {
        state: this.#manager ? 'idle' : 'unsupported',
        version: null,
        progress: null,
        checkedAt: null,
        error: null,
      },
    });
  }

  /** Current version as Velopack knows it, or `null` when not installed. */
  get currentVersion(): string | null {
    return this.#manager?.getCurrentVersion() ?? null;
  }

  /** First check after a few seconds, then every 12 h. */
  start(): void {
    if (!this.#manager) return;
    const first = setTimeout(() => {
      void this.check();
      const again = setInterval(() => void this.check(), RECHECK_MS);
      this.#timers.push(again);
    }, FIRST_CHECK_MS);
    this.#timers.push(first);
  }

  stop(): void {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers = [];
  }

  async check(): Promise<CommandOutcome> {
    const manager = this.#manager;
    if (!manager) return failed('notPossible', 'Updates need the installed SLATE');
    if (this.#busy) return { ok: true };
    this.#busy = true;
    this.#update({ state: 'checking', error: null });
    try {
      const found = await manager.checkForUpdatesAsync();
      this.#found = found;
      const version = found?.TargetFullRelease.Version ?? null;
      this.#update({
        state: found ? 'available' : 'upToDate',
        version,
        progress: null,
        checkedAt: this.#now(),
      });
      if (version) this.#o.log.info(`Update available: ${version}`);
      return { ok: true };
    } catch (error) {
      const text = `Can't reach the release feed: ${message(error)}`;
      this.#o.log.warn(text);
      this.#update({ state: 'failed', error: text, checkedAt: this.#now() });
      return failed('notPossible', text);
    } finally {
      this.#busy = false;
    }
  }

  /** Downloads and installs the found update; SLATE ends and comes back as the new version. */
  async install(): Promise<CommandOutcome> {
    const manager = this.#manager;
    const found = this.#found;
    if (!manager || !found) return failed('notPossible', 'No update to install – check first');
    if (this.#o.store.get('mission').running) {
      return failed('notPossible', 'Finish the mission first – SLATE never updates during one');
    }
    if (this.#busy) return failed('notPossible', 'Busy – try again in a moment');
    this.#busy = true;
    this.#update({ state: 'downloading', progress: 0, error: null });
    try {
      await manager.downloadUpdateAsync(found, (progress: number) => {
        this.#update({ progress: Math.max(0, Math.min(100, Math.round(progress))) });
      });
      if (this.#o.store.get('mission').running) {
        this.#update({ state: 'available', progress: null });
        return failed('notPossible', 'A mission started – the update installs after it');
      }
      this.#o.log.info(`Installing ${found.TargetFullRelease.Version} – SLATE restarts`);
      manager.waitExitThenApplyUpdate(found, false, true);
      this.#o.exit();
      return { ok: true };
    } catch (error) {
      const text = `Update failed: ${message(error)}`;
      this.#o.log.warn(text);
      this.#update({ state: 'failed', progress: null, error: text });
      return failed('notPossible', text);
    } finally {
      this.#busy = false;
    }
  }

  #update(change: Partial<AppState['update']>): void {
    const app = this.#o.store.get('host').app;
    this.#set({ ...app, update: { ...app.update, ...change } });
  }

  #set(app: AppState): void {
    this.#o.store.update({ host: { ...this.#o.store.get('host'), app } });
  }
}
