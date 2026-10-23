// SPDX-License-Identifier: GPL-3.0-or-later
// Where SLATE's own files are (P1.9): the repo while developing, the folder of
// the executable when packaged. A packaged build is a Node single executable
// (`tools/release/build.mjs`) with its files next to it:
//
//   SLATE.exe / slate-relay        the executable (host or relay)
//   web\                           the built web UI          (apps/web/dist)
//   lua\                           Lua files for Saved Games (dcs/export/Scripts)
//   server-hook\SLATE-server-hook.lua                        (relay only)
//   node_modules\velopack\         Velopack's native module  (host on Windows only)

import { dirname, join } from 'node:path';
import { isSea } from 'node:sea';
import { fileURLToPath } from 'node:url';

/** `true` when running as the packaged executable. */
export const PACKAGED: boolean = isSea();

/** Folder of the executable (packaged) or the repo root (development). */
export const APP_ROOT: string = PACKAGED
  ? dirname(process.execPath)
  : fileURLToPath(new URL('../../../', import.meta.url));

const LAYOUT = {
  ui: { packaged: ['web'], repo: ['apps', 'web', 'dist'] },
  lua: { packaged: ['lua'], repo: ['dcs', 'export', 'Scripts'] },
  serverHook: {
    packaged: ['server-hook', 'SLATE-server-hook.lua'],
    repo: ['dcs', 'server-hook', 'Scripts', 'Hooks', 'SLATE-server-hook.lua'],
  },
} as const;

/** Path of one of SLATE's own files or folders. */
export function resourcePath(name: keyof typeof LAYOUT): string {
  return join(APP_ROOT, ...(PACKAGED ? LAYOUT[name].packaged : LAYOUT[name].repo));
}
