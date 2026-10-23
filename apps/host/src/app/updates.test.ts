// SPDX-License-Identifier: GPL-3.0-or-later

import { defaultSlices } from '@slate-dcs/shared';
import { describe, expect, it } from 'vitest';

import { StateStore } from '../state/store.js';
import { Updater, updateSource } from './updates.js';
import type { Velopack } from './velopack.js';

const quiet = { info: () => undefined, warn: () => undefined };

interface Fake {
  velopack: Velopack;
  calls: string[];
  set: (next: { found?: unknown; fail?: string }) => void;
}

/** A stand-in for Velopack's SDK with the parts the updater uses. */
function fakeVelopack(): Fake {
  const calls: string[] = [];
  let found: unknown = null;
  let fail: string | undefined;
  class UpdateManager {
    constructor(source: unknown) {
      calls.push(`new ${(source as { kind: string }).kind}`);
    }
    getCurrentVersion() {
      return '0.1.0';
    }
    checkForUpdatesAsync() {
      calls.push('check');
      return fail ? Promise.reject(new Error(fail)) : Promise.resolve(found);
    }
    downloadUpdateAsync(_update: unknown, progress: (p: number) => void) {
      calls.push('download');
      progress(50);
      progress(100);
      return Promise.resolve();
    }
    waitExitThenApplyUpdate(_update: unknown, silent: boolean, restart: boolean) {
      calls.push(`apply silent=${String(silent)} restart=${String(restart)}`);
    }
  }
  const source = (kind: string) =>
    class {
      kind = kind;
    };
  const velopack = {
    UpdateManager,
    GithubSource: source('github'),
    HttpSource: source('http'),
    FileSource: source('file'),
  } as unknown as Velopack;
  return {
    velopack,
    calls,
    set: (next) => {
      found = next.found ?? null;
      fail = next.fail;
    },
  };
}

const update = { TargetFullRelease: { Version: '0.2.0' }, DeltasToTarget: [], IsDowngrade: false };

function setup(velopack: Velopack | null) {
  const store = new StateStore(defaultSlices('test'));
  const exits: string[] = [];
  const updater = new Updater({
    store,
    velopack,
    log: quiet,
    exit: () => exits.push('exit'),
    now: () => 1000,
  });
  return { store, updater, exits };
}

describe('updates (P1.9)', () => {
  it('is unsupported without the installed app', async () => {
    const { store, updater } = setup(null);
    expect(store.get('host').app).toMatchObject({
      installed: false,
      update: { state: 'unsupported' },
    });
    expect(await updater.check()).toMatchObject({ ok: false, error: { code: 'notPossible' } });
  });

  it('finds an update, installs it on request and ends SLATE', async () => {
    const fake = fakeVelopack();
    const { store, updater, exits } = setup(fake.velopack);
    expect(store.get('host').app).toMatchObject({ installed: true, update: { state: 'idle' } });
    expect(updater.currentVersion).toBe('0.1.0');

    expect(await updater.check()).toEqual({ ok: true });
    expect(store.get('host').app.update).toMatchObject({ state: 'upToDate', checkedAt: 1000 });

    fake.set({ found: update });
    await updater.check();
    expect(store.get('host').app.update).toMatchObject({ state: 'available', version: '0.2.0' });

    expect(await updater.install()).toEqual({ ok: true });
    expect(store.get('host').app.update.progress).toBe(100);
    expect(fake.calls).toEqual([
      'new github',
      'check',
      'check',
      'download',
      'apply silent=false restart=true',
    ]);
    expect(exits).toEqual(['exit']);
  });

  it('never installs while a mission is running', async () => {
    const fake = fakeVelopack();
    fake.set({ found: update });
    const { store, updater, exits } = setup(fake.velopack);
    await updater.check();
    store.update({ mission: { ...store.get('mission'), running: true } });
    expect(await updater.install()).toMatchObject({
      ok: false,
      error: { text: expect.stringMatching(/Finish the mission/) as unknown },
    });
    expect(fake.calls).not.toContain('download');
    expect(exits).toEqual([]);
  });

  it('reports an unreachable feed (the repo is private until P1 is done)', async () => {
    const fake = fakeVelopack();
    fake.set({ fail: '404 Not Found' });
    const { store, updater } = setup(fake.velopack);
    expect(await updater.check()).toMatchObject({ ok: false });
    expect(store.get('host').app.update).toMatchObject({
      state: 'failed',
      error: "Can't reach the release feed: 404 Not Found",
    });
    expect(await updater.install()).toMatchObject({ ok: false });
  });

  it('takes a test feed from SLATE_UPDATE_SOURCE', () => {
    const { velopack } = fakeVelopack();
    const kind = (s: string | undefined) => (updateSource(velopack, s) as { kind: string }).kind;
    expect(kind(undefined)).toBe('github');
    expect(kind('https://example.org/slate/')).toBe('http');
    expect(kind('C:\\SLATE\\releases')).toBe('file');
  });
});
