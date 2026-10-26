// SPDX-License-Identifier: GPL-3.0-or-later

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultSlices } from '@slate-dcs/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyDemoState, startDemoTicker } from './demo.js';
import { StateStore } from './state/store.js';

/** A real clock time: the demo's CAS times lie up to 40 minutes before it. */
const NOW = 1_792_600_000_000;

afterEach(() => {
  vi.useRealTimers();
});

describe('demo data', () => {
  it('fills in a running mission and own-ship status that pass the slice schemas', () => {
    const store = new StateStore(defaultSlices('test'));
    applyDemoState(store, NOW);
    expect(store.get('mission')).toMatchObject({ running: true, theatre: 'Caucasus' });
    expect(store.get('ownship').status?.armament?.stations).toHaveLength(6);
    expect(store.get('host').bridge.state).toBe('receiving');
  });

  it('refreshes the data age until stopped', () => {
    vi.useFakeTimers();
    const store = new StateStore(defaultSlices('test'));
    applyDemoState(store);
    const stop = startDemoTicker(store, 2000);
    // The P1 data, the CAS picture, then three refreshes.
    vi.advanceTimersByTime(6000);
    expect(store.seq).toBe(5);
    stop();
    vi.advanceTimersByTime(6000);
    expect(store.seq).toBe(5);
  });
});

describe('CAS demo (P2.5, D9)', () => {
  it('a pilot: joined, in Enfield 1, checked in, cleared hot – only his own lane', () => {
    const store = new StateStore(defaultSlices('test'));
    applyDemoState(store, NOW);
    const pid = store.get('session').pid;
    expect(store.get('session')).toMatchObject({ state: 'joined', role: 'pilot' });
    expect(store.get('flight').own?.display).toBe('Enfield 1');
    const cas = store.get('cas');
    expect(cas.aos[0]?.joinCode).toBeNull();
    expect(cas.checkIns).toHaveLength(1);
    expect(cas.briefDraft?.brief.callsign).toBe('Enfield 1');
    const [mission] = store.get('missions').missions;
    expect(mission?.lanes.map((l) => [l.pid, l.state])).toEqual([[pid, 'cleared']]);
    expect(mission?.lanes.every((l) => l.warnings.length === 0)).toBe(true);
    expect(store.get('casLog').entries.every((e) => e.pid === null || e.pid === pid)).toBe(true);
    expect(store.get('fuelCalls').bingoKg).not.toBeNull();
  });

  it('a JTAC (--demo=jtac): his AO with the join code, two flights, the warnings', () => {
    const store = new StateStore(defaultSlices('test'));
    applyDemoState(store, NOW, 'jtac');
    expect(store.get('session')).toMatchObject({ state: 'joined', role: 'jtac' });
    expect(store.get('ownship').aircraft?.type).toBe('forward_observer');
    const cas = store.get('cas');
    expect(cas.aos[0]?.joinCode).toBe('Q4T-8MZ');
    expect(cas.checkIns.map((c) => c.brief.callsign)).toEqual(['Enfield 1', 'Colt 1']);
    const missions = store.get('missions').missions;
    expect(missions.map((m) => m.state)).toEqual(['readbackCorrect', 'draft']);
    expect(missions[0]?.lanes).toHaveLength(2);
    expect(missions[0]?.lanes[1]?.warnings).toEqual([
      { kind: 'codeMismatch', code: 1688, weaponCode: 1687 },
    ]);
    expect(store.get('flight').own).toBeNull();
  });
});

describe('the host under plain Node', () => {
  // Vitest loads packages' ES builds; `pnpm start` runs Node, which loads the
  // CommonJS build of `mgrs` (P2.5) – this caught a broken import once.
  it('formats MGRS from the shared package', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '-e',
        "import('@slate-dcs/shared').then((m) => process.stdout.write(m.formatMgrs({ lat: 42.2203, lon: 41.7431 })))",
      ],
      { cwd: join(here, '..'), encoding: 'utf8', timeout: 20_000 },
    );
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe('37T GG 26400 77879');
  });
});
