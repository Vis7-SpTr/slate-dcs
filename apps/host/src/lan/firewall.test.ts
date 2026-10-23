// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { addRuleScript, categoriesScript, Firewall, removeRuleScript } from './firewall.js';
import type { Exec } from './firewall.js';

function fake(results: Record<string, { code: number; stdout?: string; stderr?: string }>) {
  const calls: string[][] = [];
  const exec: Exec = (file, args) => {
    calls.push([file, ...args]);
    const r = results[file] ?? { code: 0 };
    return Promise.resolve({ code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' });
  };
  return { exec, calls };
}

const decode = (call: string[] | undefined) =>
  Buffer.from(call?.at(-1) ?? '', 'base64').toString('utf16le');

describe('Firewall', () => {
  it('is unknown off Windows', async () => {
    expect(await new Firewall({ windows: false }).check(7792, ['192.168.1.20'])).toBe('unknown');
  });

  it('finds the rule on the Private profile', async () => {
    const { exec, calls } = fake({
      netsh: { code: 0, stdout: 'Rule Name: SLATE LAN (TCP 7792)\nProfiles: Private\n' },
      powershell: { code: 0, stdout: 'Private\n' },
    });
    expect(await new Firewall({ exec, windows: true }).check(7792, ['192.168.1.20'])).toBe('ok');
    expect(calls[0]).toEqual([
      'netsh',
      'advfirewall',
      'firewall',
      'show',
      'rule',
      'name=SLATE LAN (TCP 7792)',
    ]);
    expect(decode(calls[1])).toContain("'192.168.1.20'");
  });

  it('reports a missing rule and a Public network', async () => {
    const missing = fake({
      netsh: { code: 1, stdout: 'No rules match' },
      powershell: { code: 0, stdout: 'Private' },
    });
    expect(
      await new Firewall({ exec: missing.exec, windows: true }).check(7792, ['10.0.0.5']),
    ).toBe('missing');
    const pub = fake({
      netsh: { code: 0, stdout: 'Private' },
      powershell: { code: 0, stdout: 'Public\r\n' },
    });
    expect(await new Firewall({ exec: pub.exec, windows: true }).check(7792, ['10.0.0.5'])).toBe(
      'publicNetwork',
    );
  });

  it('adds the rule elevated, for the Private profile only', async () => {
    const ok = fake({ powershell: { code: 0 } });
    expect(await new Firewall({ exec: ok.exec, windows: true }).addRule(7792)).toBeNull();
    const script = decode(ok.calls[0]);
    expect(script).toContain('-Verb RunAs');
    expect(script).toContain('localport=7792');
    expect(script).toContain('profile=private');
    expect(script).toBe(addRuleScript(7792));
    const cancelled = fake({
      powershell: { code: 1, stderr: 'The operation was canceled by the user.' },
    });
    expect(await new Firewall({ exec: cancelled.exec, windows: true }).addRule(7792)).toBe(
      'Cancelled at the Windows prompt',
    );
  });

  it('builds the category lookup per address', () => {
    expect(categoriesScript(['192.168.1.20', '10.0.0.5'])).toContain(
      "@('192.168.1.20','10.0.0.5')",
    );
  });

  it('removes the rule at uninstall without waiting for the prompt (P1.9)', async () => {
    const launched: string[][] = [];
    const found = fake({ netsh: { code: 0 } });
    const firewall = new Firewall({
      exec: found.exec,
      windows: true,
      launch: (file, args) => launched.push([file, ...args]),
    });
    expect(await firewall.hasRule(7792)).toBe(true);
    firewall.removeRuleDetached(7792);
    expect(decode(launched[0])).toBe(removeRuleScript(7792));
    expect(removeRuleScript(7792)).toContain('delete rule name="SLATE LAN (TCP 7792)"');
    expect(removeRuleScript(7792)).not.toContain('-Wait');
    const gone = fake({ netsh: { code: 1 } });
    expect(await new Firewall({ exec: gone.exec, windows: true }).hasRule(7792)).toBe(false);
    expect(await new Firewall({ windows: false }).hasRule(7792)).toBe(false);
  });
});
