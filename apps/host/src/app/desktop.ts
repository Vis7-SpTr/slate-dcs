// SPDX-License-Identifier: GPL-3.0-or-later
// The installed SLATE runs without a window (decided 23 Oct 2026): at start
// it opens its page in the default browser, a second start opens the page of
// the one already running, and errors that would end it show a message box.
// Also starts the Windows uninstaller (More → Settings → Uninstall).

import { execFile, spawn } from 'node:child_process';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { encodePowerShell } from '../lan/firewall.js';

const detached = (file: string, args: string[]): void => {
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => undefined);
  child.unref();
};

/** Opens `url` in the default browser. */
export function openBrowser(url: string): void {
  if (process.platform === 'win32') detached('rundll32', ['url.dll,FileProtocolHandler', url]);
  else if (process.platform === 'darwin') detached('open', [url]);
  else detached('xdg-open', [url]);
}

/** A Windows message box, for errors no window could show otherwise. */
export function messageBox(text: string): void {
  if (process.platform !== 'win32') {
    process.stderr.write(`${text}\n`);
    return;
  }
  const quoted = text.replace(/'/g, "''");
  detached('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle',
    'Hidden',
    '-EncodedCommand',
    encodePowerShell(
      `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${quoted}', 'SLATE') | Out-Null`,
    ),
  ]);
}

/** Is a SLATE host answering on this port? */
export async function probeSlate(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    const body = (await response.json()) as { app?: unknown };
    return body.app === 'slate-host';
  } catch {
    return false;
  }
}

/** Velopack's uninstall command, from the registry entry it writes. */
function uninstallCommand(appId: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      [
        'query',
        `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${appId}`,
        '/v',
        'UninstallString',
      ],
      { windowsHide: true, timeout: 10_000 },
      (error, stdout) => {
        const match = /UninstallString\s+REG_\w+\s+(.+)/i.exec(stdout);
        resolve(error || !match?.[1] ? null : match[1].trim());
      },
    );
  });
}

/**
 * Starts the Windows uninstaller (detached, so it outlives SLATE). Velopack's
 * own entry first; else `Update.exe --uninstall` next to the version folder.
 * Resolves with an error text, or `null` when it was started.
 */
export async function startUninstaller(appId: string): Promise<string | null> {
  if (process.platform !== 'win32') return 'Uninstalling is only possible on Windows';
  const command = await uninstallCommand(appId);
  // `"C:\…\Update.exe" --uninstall` → program and arguments.
  const parts = command
    ? (/^"([^"]+)"\s*(.*)$/.exec(command) ?? /^(\S+)\s*(.*)$/.exec(command))
    : null;
  if (parts?.[1]) {
    detached(parts[1], (parts[2] ?? '').split(/\s+/).filter(Boolean));
    return null;
  }
  const updateExe = join(dirname(dirname(process.execPath)), 'Update.exe');
  try {
    await access(updateExe);
  } catch {
    return 'The SLATE uninstaller was not found – uninstall SLATE in Windows Settings → Apps';
  }
  detached(updateExe, ['--uninstall']);
  return null;
}

/**
 * Log file of the installed SLATE: `<data>\logs\slate.log`; the last 5 runs
 * are kept as slate.1.log … slate.4.log.
 */
export async function rotateLog(dataDir: string): Promise<string> {
  const dir = join(dataDir, 'logs');
  await mkdir(dir, { recursive: true });
  const file = (n: number) => join(dir, n === 0 ? 'slate.log' : `slate.${String(n)}.log`);
  await rm(file(4), { force: true });
  for (let n = 3; n >= 0; n -= 1) await rename(file(n), file(n + 1)).catch(() => undefined);
  return file(0);
}
