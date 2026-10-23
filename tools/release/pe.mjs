// SPDX-License-Identifier: GPL-3.0-or-later
// Windows executables (P1.9): the PE header's subsystem decides whether
// Windows opens a console window for a program.

import { readFileSync, writeFileSync } from 'node:fs';

export const SUBSYSTEM_GUI = 2;
export const SUBSYSTEM_CONSOLE = 3;

/** Offset of the subsystem field in a PE file (optional header + 68, the same for PE32 and PE32+). */
export function subsystemOffset(data) {
  const pe = data.readUInt32LE(0x3c);
  if (data.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('Not a PE file');
  const optional = pe + 24;
  const magic = data.readUInt16LE(optional);
  if (magic !== 0x20b && magic !== 0x10b) throw new Error('Unknown PE optional header');
  return optional + 68;
}

/**
 * Makes `file` a GUI program (no console window). Node gives such a program
 * dummy stdout/stderr. Returns the subsystem it had before.
 */
export function setGuiSubsystem(file) {
  const data = readFileSync(file);
  const offset = subsystemOffset(data);
  const before = data.readUInt16LE(offset);
  data.writeUInt16LE(SUBSYSTEM_GUI, offset);
  writeFileSync(file, data);
  return before;
}
