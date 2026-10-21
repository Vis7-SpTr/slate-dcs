// SPDX-License-Identifier: GPL-3.0-or-later
// SLATE's own data folder: Export.lua backups (P1.3), the relay's files in
// host mode (P1.6c), the saved relay tokens and fingerprints.

import { homedir } from 'node:os';
import { join } from 'node:path';

/** SLATE's own data folder: `%APPDATA%\SLATE` on Windows, `SLATE_DATA_DIR` to override. */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['SLATE_DATA_DIR'];
  if (override !== undefined && override !== '') return override;
  if (process.platform === 'win32' && env['APPDATA']) return join(env['APPDATA'], 'SLATE');
  return join(homedir(), '.local', 'share', 'slate');
}
