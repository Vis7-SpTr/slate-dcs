// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deviceName, DeviceStore, PAIRING_MS, UNUSED_MS } from './devices.js';

const IPAD =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

let dir: string;
let now: number;
let store: DeviceStore;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slate-lan-'));
  now = 1_792_700_000_000;
  store = new DeviceStore(join(dir, 'lan.json'), () => now);
  await store.load();
});
afterEach(async () => {
  // verify() saves lastSeen in the background; on Windows a write still in
  // flight makes the folder "not empty" – wait for it, and retry the delete.
  await store.idle();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('deviceName', () => {
  it.each([
    [IPAD, 'iPad · Safari'],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Mobile/15E148 Safari/604.1',
      'iPhone · Safari',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130',
      'Windows · Edge',
    ],
    [
      'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36',
      'Android · Chrome',
    ],
    [undefined, 'Device'],
  ])('names %s', (ua, name) => {
    expect(deviceName(ua)).toBe(name);
  });
});

describe('DeviceStore', () => {
  it('pairs once with a fresh secret and remembers the device and the switch', async () => {
    await store.setEnabled(true);
    const { secret } = store.startPairing();
    const paired = await store.pair(secret, IPAD);
    expect(paired?.device.name).toBe('iPad · Safari');
    expect(await store.pair(secret, IPAD)).toBeNull(); // single use
    expect(store.verify(paired?.token)?.id).toBe(paired?.device.id);
    expect(store.verify('wrong')).toBeNull();
    // Only the hash is on disk.
    const file = await readFile(join(dir, 'lan.json'), 'utf8');
    expect(file).not.toContain(paired?.token ?? '-');
    const again = new DeviceStore(join(dir, 'lan.json'), () => now);
    await again.load();
    expect(again.enabled).toBe(true);
    expect(again.verify(paired?.token)?.name).toBe('iPad · Safari');
    await again.idle();
  });

  it('refuses an expired secret, and locks out after 10 wrong tries in a minute', async () => {
    const { secret } = store.startPairing();
    now += PAIRING_MS;
    expect(await store.pair(secret, IPAD)).toBeNull();
    const fresh = store.startPairing().secret;
    for (let i = 0; i < 10; i += 1) await store.pair(`guess${String(i)}`, IPAD);
    expect(await store.pair(fresh, IPAD)).toBeNull();
    now += 61_000;
    expect(await store.pair(fresh, IPAD)).not.toBeNull();
  });

  it('a new pairing replaces the open one', async () => {
    const first = store.startPairing().secret;
    const second = store.startPairing().secret;
    expect(await store.pair(first, IPAD)).toBeNull();
    expect(await store.pair(second, IPAD)).not.toBeNull();
  });

  it('drops devices unused for 90 days and removes on request', async () => {
    const a = await store.pair(store.startPairing().secret, IPAD);
    const b = await store.pair(store.startPairing().secret, IPAD);
    now += UNUSED_MS - 1000;
    store.verify(b?.token);
    now += 2000;
    expect(await store.prune()).toEqual([a?.device.id]);
    expect(await store.remove(b?.device.id ?? '')).toBe(true);
    expect(store.devices).toEqual([]);
  });
});
