// SPDX-License-Identifier: GPL-3.0-or-later
// Windows Firewall for LAN access (architecture.md §1.1): a port rule for the
// UI port on the *Private* profile only, added on demand with one UAC prompt
// (the installer stays admin-free). A network set to *Public* gets a hint
// instead – the rule doesn't apply there. Elsewhere than Windows: `unknown`.

import { execFile, spawn } from 'node:child_process';

export type FirewallState = 'ok' | 'missing' | 'publicNetwork' | 'unknown';

/** Runs a program, resolves with exit code and output (never rejects). */
export type Exec = (
  file: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

const execNode: Exec = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 120_000 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, stdout, stderr });
    });
  });

/** Starts a program on its own and doesn't wait for it. */
export type Launch = (file: string, args: string[]) => void;

const launchNode: Launch = (file, args) => {
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => undefined);
  child.unref();
};

export const ruleName = (port: number) => `SLATE LAN (TCP ${String(port)})`;

/** PowerShell script as `-EncodedCommand` (UTF-16LE base64) – no quoting trouble. */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** The elevated command: netsh adds the rule; Start-Process -Verb RunAs shows the UAC prompt. */
export function addRuleScript(port: number): string {
  const args = [
    'advfirewall firewall add rule',
    `name="${ruleName(port)}"`,
    'dir=in action=allow protocol=TCP',
    `localport=${String(port)}`,
    'profile=private',
  ].join(' ');
  return [
    "$ErrorActionPreference = 'Stop'",
    `$p = Start-Process -FilePath netsh -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '${args.replace(/'/g, "''")}'`,
    'exit $p.ExitCode',
  ].join('; ');
}

/** The elevated command that removes the rule again (uninstall, P1.9). */
export function removeRuleScript(port: number): string {
  const args = `advfirewall firewall delete rule name="${ruleName(port)}"`;
  return `Start-Process -FilePath netsh -Verb RunAs -WindowStyle Hidden -ArgumentList '${args.replace(/'/g, "''")}'`;
}

/** NetworkCategory of the interfaces that carry `ips` – `Public`, `Private`, `DomainAuthenticated`. */
export function categoriesScript(ips: readonly string[]): string {
  const list = ips.map((ip) => `'${ip}'`).join(',');
  return `foreach ($ip in @(${list})) { try { $i = (Get-NetIPAddress -IPAddress $ip -ErrorAction Stop).InterfaceIndex; (Get-NetConnectionProfile -InterfaceIndex $i -ErrorAction Stop).NetworkCategory } catch {} }`;
}

export class Firewall {
  readonly #exec: Exec;
  readonly #launch: Launch;
  readonly #windows: boolean;

  constructor(options: { exec?: Exec; launch?: Launch; windows?: boolean } = {}) {
    this.#exec = options.exec ?? execNode;
    this.#launch = options.launch ?? launchNode;
    this.#windows = options.windows ?? process.platform === 'win32';
  }

  /** The rule and the network category of the LAN addresses (`ips` without port). */
  async check(port: number, ips: readonly string[]): Promise<FirewallState> {
    if (!this.#windows) return 'unknown';
    const rule = await this.#exec('netsh', [
      'advfirewall',
      'firewall',
      'show',
      'rule',
      `name=${ruleName(port)}`,
    ]);
    if (ips.length > 0) {
      const categories = await this.#exec('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        encodePowerShell(categoriesScript(ips)),
      ]);
      if (/\bPublic\b/.test(categories.stdout)) return 'publicNetwork';
    }
    return rule.code === 0 && /Private/i.test(rule.stdout) ? 'ok' : 'missing';
  }

  /** `true` if the rule exists (no admin rights needed to look). */
  async hasRule(port: number): Promise<boolean> {
    if (!this.#windows) return false;
    const rule = await this.#exec('netsh', [
      'advfirewall',
      'firewall',
      'show',
      'rule',
      `name=${ruleName(port)}`,
    ]);
    return rule.code === 0;
  }

  /**
   * Removes the rule with a UAC prompt, without waiting for the answer: the
   * uninstaller gives SLATE 30 s, a prompt may take longer (P1.9). The
   * prompt runs on in its own process.
   */
  removeRuleDetached(port: number): void {
    if (!this.#windows) return;
    this.#launch('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-EncodedCommand',
      encodePowerShell(removeRuleScript(port)),
    ]);
  }

  /** Adds the rule (UAC prompt). Resolves with an error text, or `null` when done. */
  async addRule(port: number): Promise<string | null> {
    if (!this.#windows) return 'Firewall rules are only added on Windows';
    const result = await this.#exec('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      encodePowerShell(addRuleScript(port)),
    ]);
    if (result.code === 0) return null;
    return /cancel/i.test(result.stderr)
      ? 'Cancelled at the Windows prompt'
      : `Windows refused the rule (exit ${String(result.code)})`;
  }
}
