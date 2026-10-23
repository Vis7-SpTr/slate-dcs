// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { probeSlate, rotateLog } from './desktop.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slate-desktop-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('log file (P1.9)', () => {
  it('keeps the last five runs', async () => {
    for (let run = 1; run <= 7; run += 1) {
      const file = await rotateLog(dir);
      await writeFile(file, `run ${String(run)}\n`);
    }
    const logs = join(dir, 'logs');
    expect((await readdir(logs)).sort()).toEqual([
      'slate.1.log',
      'slate.2.log',
      'slate.3.log',
      'slate.4.log',
      'slate.log',
    ]);
    expect(await readFile(join(logs, 'slate.log'), 'utf8')).toBe('run 7\n');
    expect(await readFile(join(logs, 'slate.4.log'), 'utf8')).toBe('run 3\n');
  });
});

describe('a second start (P1.9)', () => {
  it('finds no SLATE on a free port', async () => {
    expect(await probeSlate(1)).toBe(false);
  });
});
