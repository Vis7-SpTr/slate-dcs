// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeFileAtomic } from './fs-safe.js';
import { DeviceStore } from './lan/devices.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slate-fs-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('writeFileAtomic', () => {
  it('writes the file and leaves no temporary file, also with parallel writers', async () => {
    const path = join(dir, 'sub', 'state.json');
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => writeFileAtomic(path, `{"n":${String(i)}}\n`)),
    );
    expect(await readFile(path, 'utf8')).toMatch(/^\{"n":\d+\}\n$/);
    expect(await readdir(join(dir, 'sub'))).toEqual(['state.json']);
  });

  it('cleans up its temporary file when the write fails', async () => {
    // The target is a folder: the rename can't replace it.
    const path = join(dir, 'taken');
    await writeFileAtomic(join(path, 'inside'), 'x');
    await expect(writeFileAtomic(path, 'y')).rejects.toThrow();
    expect((await readdir(dir)).sort()).toEqual(['taken']);
  });
});

describe('DeviceStore background save', () => {
  it("doesn't end SLATE when saving 'last seen' fails", async () => {
    let now = 1_792_700_000_000;
    const store = new DeviceStore(join(dir, 'lan.json'), () => now);
    await store.load();
    const { secret } = store.startPairing();
    const paired = await store.pair(secret, undefined);
    // Make the next write fail: lan.json becomes a folder.
    await rm(join(dir, 'lan.json'));
    await writeFileAtomic(join(dir, 'lan.json', 'blocker'), 'x');
    now += 86_400_000;
    // verify() starts a background save that fails – no unhandled rejection.
    expect(store.verify(paired?.token)?.id).toBe(paired?.device.id);
    await store.idle();
    expect(await readdir(dir)).toEqual(['lan.json']);
  });
});
