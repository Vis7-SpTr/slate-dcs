// SPDX-License-Identifier: GPL-3.0-or-later
// Velopack's JS SDK (P1.9, architecture.md §1.2): installer hooks and updates.
// It is a native module, so it is loaded from disk at run time – next to
// SLATE.exe when packaged (the single executable can't hold it), from
// node_modules while developing. Only on Windows: SLATE is installed with
// Velopack there; everywhere else this returns `null`.

import { createRequire } from 'node:module';
import { join } from 'node:path';

import type * as VelopackModule from 'velopack';

import { APP_ROOT, PACKAGED } from '../paths.js';

export type Velopack = typeof VelopackModule;

let cached: Velopack | null | undefined;

export function loadVelopack(): Velopack | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (process.platform !== 'win32') return cached;
  try {
    const require = createRequire(PACKAGED ? join(APP_ROOT, 'slate.cjs') : import.meta.url);
    cached = require('velopack') as Velopack;
  } catch {
    cached = null;
  }
  return cached;
}
