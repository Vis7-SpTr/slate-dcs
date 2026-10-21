// SPDX-License-Identifier: GPL-3.0-or-later

import { defaultSlices } from '@slate-dcs/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyDemoState, startDemoTicker } from './demo.js';
import { StateStore } from './state/store.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('demo data', () => {
  it('fills in a running mission and own-ship status that pass the slice schemas', () => {
    const store = new StateStore(defaultSlices('test'));
    applyDemoState(store, 1_000_000);
    expect(store.get('mission')).toMatchObject({ running: true, theatre: 'Caucasus' });
    expect(store.get('ownship').status?.armament?.stations).toHaveLength(6);
    expect(store.get('host').bridge.state).toBe('receiving');
  });

  it('refreshes the data age until stopped', () => {
    vi.useFakeTimers();
    const store = new StateStore(defaultSlices('test'));
    applyDemoState(store);
    const stop = startDemoTicker(store, 2000);
    vi.advanceTimersByTime(6000);
    expect(store.seq).toBe(4);
    stop();
    vi.advanceTimersByTime(6000);
    expect(store.seq).toBe(4);
  });
});
