// SPDX-License-Identifier: GPL-3.0-or-later
// Cleanup when SLATE is uninstalled (P1.9, architecture.md §1.2): removes the
// Export.lua block and SLATE's Lua files from every DCS folder, and the LAN
// firewall rule. SLATE's data folder (%APPDATA%\SLATE – Export.lua backups,
// saved relays, paired devices, host-mode relay files) stays for a reinstall,
// unless the user chose "Uninstall and wipe data" in the app (decided
// 23 Oct 2026), which leaves a marker file for this step.

import { access, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Installer } from '../dcs-integration/installer.js';
import { listDcsFolders } from '../dcs-integration/saved-games.js';
import type { Firewall } from '../lan/firewall.js';

/** Written by "Uninstall and wipe data"; read by the uninstall step. */
export const WIPE_MARKER = 'wipe-on-uninstall';

export interface CleanupOptions {
  dataDir: string;
  installer: Pick<Installer, 'inspect' | 'remove'>;
  findSavedGames: () => Promise<string | null>;
  firewall: Pick<Firewall, 'hasRule' | 'removeRuleDetached'>;
  /** UI ports whose LAN rule may exist (the default port, and SLATE_PORT if set). */
  ports: number[];
  log: (line: string) => void;
}

export interface CleanupResult {
  removedFrom: string[];
  failed: string[];
  firewallRule: boolean;
  wiped: boolean;
}

/** Marks the data folder to be deleted by the uninstall step. */
export async function markWipe(dataDir: string): Promise<void> {
  await writeFile(join(dataDir, WIPE_MARKER), 'Delete this folder when SLATE is uninstalled.\n');
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Everything the uninstaller has to undo. Never throws; each failure is logged. */
export async function cleanupForUninstall(o: CleanupOptions): Promise<CleanupResult> {
  const result: CleanupResult = { removedFrom: [], failed: [], firewallRule: false, wiped: false };
  const wipe = await exists(join(o.dataDir, WIPE_MARKER));

  try {
    const savedGames = await o.findSavedGames();
    if (savedGames === null) o.log('Saved Games folder not found – no Lua files to remove');
    for (const name of savedGames ? await listDcsFolders(savedGames) : []) {
      const folder = join(savedGames ?? '', name);
      try {
        if ((await o.installer.inspect(folder)).state === 'notInstalled') continue;
        await o.installer.remove(folder, name);
        result.removedFrom.push(name);
        o.log(`Removed SLATE's Lua files and Export.lua block from ${name}`);
      } catch (error) {
        result.failed.push(name);
        o.log(
          `Could not clean up ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    o.log(`Lua cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const port of new Set(o.ports)) {
    try {
      if (await o.firewall.hasRule(port)) {
        o.firewall.removeRuleDetached(port);
        result.firewallRule = true;
        o.log(`Asked Windows to remove the firewall rule for TCP ${String(port)}`);
      }
    } catch (error) {
      o.log(
        `Firewall rule check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (wipe) {
    try {
      await rm(o.dataDir, { recursive: true, force: true, maxRetries: 3 });
      result.wiped = true;
      o.log(`Deleted SLATE's data folder ${o.dataDir}`);
    } catch (error) {
      o.log(
        `Could not delete ${o.dataDir}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    o.log(`Kept SLATE's data folder ${o.dataDir}`);
  }
  return result;
}
