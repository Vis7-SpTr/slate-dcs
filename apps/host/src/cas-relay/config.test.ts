// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { codesValid } from './codes.js';
import { loadRelayFiles } from './config.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slate-relay-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('loadRelayFiles', () => {
  it('creates config, codes and certificate once, then keeps them', async () => {
    const first = await loadRelayFiles(dir);
    expect(first.created).toEqual(['relay.json', 'cert.pem', 'key.pem']);
    expect(first.port).toBe(7790);
    expect(codesValid(first.codes)).toBe(true);
    expect(first.codes.group).toMatch(/^SLATE-/);
    const again = await loadRelayFiles(dir);
    expect(again.created).toEqual([]);
    expect(again.codes).toEqual(first.codes);
    expect(again.fingerprint).toBe(first.fingerprint);
  });

  it('takes changed codes and port from relay.json', async () => {
    await loadRelayFiles(dir);
    const path = join(dir, 'relay.json');
    const config = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const codes = { blue: 'BLUE-11111111', red: 'RED-22222222', group: 'SLATE-33333333' };
    await writeFile(path, JSON.stringify({ ...config, port: 7800, codes }));
    const files = await loadRelayFiles(dir);
    expect([files.port, files.codes]).toEqual([7800, codes]);
  });

  it('reads a relay.json from before P1.7: discovery off', async () => {
    const first = await loadRelayFiles(dir);
    const path = join(dir, 'relay.json');
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      dcsServerFolder: null,
      lanAddress: null,
      announceMaxLength: null,
    });
    await writeFile(
      path,
      JSON.stringify({ port: 7790, codes: first.codes, publicAddress: 'x.dyndns.org' }),
    );
    expect(await loadRelayFiles(dir)).toMatchObject({
      publicAddress: 'x.dyndns.org',
      dcsServerFolder: null,
      lanAddress: null,
      announceMaxLength: null,
      autoStartWithDcs: true,
    });
  });

  it('refuses bad codes with a readable message', async () => {
    await writeFile(
      join(dir, 'relay.json'),
      JSON.stringify({
        port: 7790,
        codes: { blue: 'BLUE-1', red: 'RED-22222222', group: 'SLATE-33333333' },
        publicAddress: null,
      }),
    );
    await expect(loadRelayFiles(dir)).rejects.toThrow(/three codes must be different/);
  });
});
