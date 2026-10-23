// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { setGuiSubsystem, SUBSYSTEM_CONSOLE, SUBSYSTEM_GUI, subsystemOffset } from './pe.mjs';

/** The smallest header layout the helper reads: MZ stub, PE signature, COFF and optional header. */
function fakePe(magic = 0x20b) {
  const data = Buffer.alloc(0x200);
  data.write('MZ', 0, 'latin1');
  const pe = 0x80;
  data.writeUInt32LE(pe, 0x3c);
  data.write('PE\0\0', pe, 'latin1');
  data.writeUInt16LE(magic, pe + 24);
  data.writeUInt16LE(SUBSYSTEM_CONSOLE, pe + 24 + 68);
  return data;
}

describe('PE subsystem (P1.9 – no console window)', () => {
  it('switches a console program to a GUI program', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slate-pe-'));
    try {
      const file = join(dir, 'SLATE.exe');
      await writeFile(file, fakePe());
      expect(setGuiSubsystem(file)).toBe(SUBSYSTEM_CONSOLE);
      const data = await readFile(file);
      expect(data.readUInt16LE(subsystemOffset(data))).toBe(SUBSYSTEM_GUI);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses what is not a PE file', () => {
    expect(() => subsystemOffset(Buffer.alloc(0x200))).toThrow(/Not a PE file/);
    expect(() => subsystemOffset(fakePe(0x1234))).toThrow(/optional header/);
  });
});
