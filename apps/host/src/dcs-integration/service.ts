// SPDX-License-Identifier: GPL-3.0-or-later
// The `dcs` slice and the `dcs.*` commands (protocol.md §14.7): finds the DCS
// user folders, checks SLATE's files in each and installs, repairs or removes
// them on request. Changes run one at a time; each is followed by a rescan.

import { join } from 'node:path';

import type { DcsFolder, DcsSlice } from '@slate-dcs/shared';

import { failed } from '../commands/dispatcher.js';
import type { CommandOutcome } from '../commands/dispatcher.js';
import type { StateStore } from '../state/store.js';
import type { Installer } from './installer.js';
import { findSavedGames, listDcsFolders } from './saved-games.js';

export interface IntegrationLog {
  info(message: string): void;
  warn(message: string): void;
}

export interface DcsIntegrationOptions {
  store: StateStore;
  installer: Installer;
  log: IntegrationLog;
  /** Defaults to the registry lookup in saved-games.ts. */
  findSavedGames?: () => Promise<string | null>;
  now?: () => number;
}

export type DcsAction = 'install' | 'repair' | 'remove';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class DcsIntegration {
  readonly #store: StateStore;
  readonly #installer: Installer;
  readonly #log: IntegrationLog;
  readonly #findSavedGames: () => Promise<string | null>;
  readonly #now: () => number;
  /** The running scan or change; the next one waits for it. */
  #queue: Promise<unknown> = Promise.resolve();
  #lastLogged = '';

  constructor(options: DcsIntegrationOptions) {
    this.#store = options.store;
    this.#installer = options.installer;
    this.#log = options.log;
    this.#findSavedGames = options.findSavedGames ?? (() => findSavedGames());
    this.#now = options.now ?? Date.now;
  }

  /** Looks at every DCS folder again and publishes the `dcs` slice. */
  rescan(): Promise<DcsSlice> {
    return this.#serial(() => this.#scan());
  }

  /** Runs one `dcs.*` change on the folder named in the `dcs` slice. */
  run(action: DcsAction, name: string): Promise<CommandOutcome> {
    return this.#serial(async () => {
      const current = await this.#scan();
      const folder = current.folders.find((f) => f.name === name);
      if (current.savedGames === null || folder === undefined) {
        return failed('notPossible', `No DCS folder "${name}" in Saved Games`);
      }
      if (action === 'repair' && folder.state === 'notInstalled') {
        return failed('notPossible', `SLATE isn't installed in ${name} – use Install`);
      }
      if (action === 'remove' && folder.state === 'notInstalled') {
        return failed('notPossible', `SLATE isn't installed in ${name}`);
      }
      const path = join(current.savedGames, name);
      try {
        if (action === 'remove') await this.#installer.remove(path, name);
        else await this.#installer.install(path, name);
      } catch (error) {
        this.#log.warn(`DCS folder ${name}: ${action} failed – ${message(error)}`);
        await this.#scan();
        return failed('notPossible', `Couldn't ${action} in ${name}: ${message(error)}`);
      }
      const after = (await this.#scan()).folders.find((f) => f.name === name);
      this.#log.info(`DCS folder ${name}: ${action} done, now ${after?.state ?? 'gone'}`);
      return { ok: true };
    });
  }

  #serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(task, task);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #scan(): Promise<DcsSlice> {
    const slice: DcsSlice = { savedGames: null, folders: [], scannedAt: this.#now(), error: null };
    try {
      slice.savedGames = await this.#findSavedGames();
      if (slice.savedGames === null) {
        slice.error = 'Saved Games folder not found';
      } else {
        const savedGames = slice.savedGames;
        const names = await listDcsFolders(savedGames);
        slice.folders = await Promise.all(
          names.map(async (name): Promise<DcsFolder> => {
            const path = join(savedGames, name);
            return { name, path, ...(await this.#installer.inspect(path)) };
          }),
        );
      }
    } catch (error) {
      slice.error = message(error);
    }
    this.#store.update({ dcs: slice });
    this.#logChanges(slice);
    return slice;
  }

  /** One log line per scan result that differs from the last one. */
  #logChanges(slice: DcsSlice): void {
    const summary =
      slice.error ??
      (slice.folders.length === 0
        ? `no DCS folder in ${slice.savedGames ?? '?'}`
        : slice.folders
            .map(
              (f) =>
                `${f.name} ${f.state}${f.problems.length ? ` (${f.problems.join(', ')})` : ''}`,
            )
            .join('; '));
    if (summary === this.#lastLogged) return;
    this.#lastLogged = summary;
    if (slice.error === null) this.#log.info(`DCS folders: ${summary}`);
    else this.#log.warn(`DCS folders: ${summary}`);
  }
}
