// SPDX-License-Identifier: GPL-3.0-or-later

import { defaultSlices } from '@slate-dcs/shared';
import { describe, expect, it, vi } from 'vitest';

import { StateStore } from './store.js';
import type { StateChange } from './store.js';

const localSettings = { timeDisplay: 'local' as const, uiScale: 1 };

describe('StateStore', () => {
  it('starts at seq 0 with the initial slices', () => {
    const store = new StateStore(defaultSlices('test'));
    expect(store.snapshot()).toEqual({ seq: 0, slices: defaultSlices('test') });
  });

  it('counts every change by exactly 1', () => {
    const store = new StateStore(defaultSlices('test'));
    expect(store.update({ settings: localSettings })).toBe(1);
    expect(store.update({ settings: { ...localSettings, uiScale: 2 } })).toBe(2);
    expect(store.seq).toBe(2);
  });

  it('replaces whole slices and leaves the others alone', () => {
    const store = new StateStore(defaultSlices('test'));
    store.update({ settings: localSettings });
    expect(store.get('settings')).toEqual(localSettings);
    expect(store.get('host')).toEqual(defaultSlices('test').host);
  });

  it('tells listeners about each change, with the changed slices only', () => {
    const store = new StateStore(defaultSlices('test'));
    const listener = vi.fn();
    store.subscribe(listener);
    store.update({ settings: localSettings });
    expect(listener).toHaveBeenCalledWith({ seq: 1, slices: { settings: localSettings } });
  });

  it('sends one change for several slices changed together', () => {
    const store = new StateStore(defaultSlices('test'));
    const changes: StateChange[] = [];
    store.subscribe((change) => changes.push(change));
    const { flight, session } = defaultSlices('test');
    store.update({ flight, session });
    expect(changes).toHaveLength(1);
    expect(Object.keys(changes[0]?.slices ?? {}).sort()).toEqual(['flight', 'session']);
  });

  it('stops calling a listener after unsubscribe', () => {
    const store = new StateStore(defaultSlices('test'));
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.update({ settings: localSettings });
    expect(listener).not.toHaveBeenCalled();
  });

  it('refuses broken slice contents and keeps its state', () => {
    const store = new StateStore(defaultSlices('test'));
    // @ts-expect-error – deliberately broken content
    expect(() => store.update({ settings: { timeDisplay: 'pc', uiScale: 1 } })).toThrow();
    expect(store.seq).toBe(0);
    expect(store.get('settings')).toEqual(defaultSlices('test').settings);
  });

  it('refuses an update that changes nothing', () => {
    const store = new StateStore(defaultSlices('test'));
    expect(() => store.update({})).toThrow();
    expect(store.seq).toBe(0);
  });

  it('hands out copies, so callers cannot change the state behind its back', () => {
    const store = new StateStore(defaultSlices('test'));
    store.get('settings').uiScale = 2;
    store.snapshot().slices.settings.uiScale = 2;
    expect(store.get('settings').uiScale).toBe(1);
  });
});
