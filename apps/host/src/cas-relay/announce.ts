// SPDX-License-Identifier: GPL-3.0-or-later
// Discovery on the server PC (P1.7, protocol.md §2): slate-relay installs the
// server hook into the dedicated server's Saved Games folder and writes the
// announcement it sends – one set of lines per coalition – and how to start
// the relay, so the hook starts it with the DCS server (autostart, decided
// 23 Oct 2026). Only `<server folder>\Scripts\Hooks\SLATE-server-hook.lua`,
// `<server folder>\Scripts\SLATE\SLATE-announce.lua` and
// `<server folder>\Scripts\SLATE\SLATE-relay.lua` are ever written.

import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { formatAnnouncement, PROTOCOL_VERSION } from '@slate-dcs/shared';
import type { Announcement } from '@slate-dcs/shared';

import { writeFileAtomic } from '../fs-safe.js';
import type { RelayCodes } from './codes.js';

export const SERVER_HOOK = ['Hooks', 'SLATE-server-hook.lua'];
export const ANNOUNCE_FILE = ['SLATE', 'SLATE-announce.lua'];
export const AUTOSTART_FILE = ['SLATE', 'SLATE-relay.lua'];

/** How the server hook starts this relay: the executable, its arguments, the port to probe. */
export interface Autostart {
  exe: string;
  args: string[];
  port: number;
}

export interface AnnounceInput {
  codes: RelayCodes;
  fingerprint: string;
  publicAddress: string | null;
  lanAddress: string | null;
  maxLength: number | null;
}

/** The chat lines per coalition. */
export function announcementLines(input: AnnounceInput): { blue: string[]; red: string[] } {
  const base = {
    protocol: PROTOCOL_VERSION,
    relay: input.publicAddress,
    lan: input.lanAddress,
    fingerprint: input.fingerprint,
  };
  const lines = (code: string) =>
    formatAnnouncement({ ...base, code } satisfies Announcement, input.maxLength);
  return { blue: lines(input.codes.blue), red: lines(input.codes.red) };
}

/** A Lua string literal; the lines are plain ASCII (hostnames, codes). */
function luaString(text: string): string {
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error(`Not plain ASCII: ${text}`);
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * The autostart file: `return { exe = '…', args = { … }, port = 7790 }`.
 * Plain ASCII only – DCS hands the command to Windows in its ANSI code page,
 * so a path with other characters would not start (the relay says so).
 */
export function autostartFileText(autostart: Autostart): string {
  for (const part of [autostart.exe, ...autostart.args]) {
    if (part.includes('"')) throw new Error(`No quotes allowed: ${part}`);
  }
  return [
    '-- Written by slate-relay at every start (autostart, P1.7). Read by',
    '-- Scripts\\Hooks\\SLATE-server-hook.lua: when the DCS server loads a mission and',
    '-- nothing answers on the port, it starts the relay. Changes here are overwritten;',
    '-- turn autostart off with "autoStartWithDcs": false in relay.json.',
    'return {',
    `  exe = ${luaString(autostart.exe)},`,
    `  args = { ${autostart.args.map(luaString).join(', ')} },`,
    `  port = ${String(autostart.port)},`,
    '}',
    '',
  ].join('\n');
}

/** The announce file the server hook reads; `null` = announce nothing (relay stopped). */
export function announceFileText(lines: { blue: string[]; red: string[] } | null): string {
  const list = (items: string[]) =>
    items.length === 0 ? '{}' : `{\n    ${items.map(luaString).join(',\n    ')},\n  }`;
  return [
    '-- Written by slate-relay at every start, emptied when it stops (P1.7).',
    '-- Read by Scripts\\Hooks\\SLATE-server-hook.lua. Changes here are overwritten.',
    'return {',
    `  blue = ${list(lines?.blue ?? [])},`,
    `  red = ${list(lines?.red ?? [])},`,
    '}',
    '',
  ].join('\n');
}

function atomicWrite(path: string, data: Buffer | string): Promise<void> {
  return writeFileAtomic(path, data);
}

/**
 * Copies the server hook into `<folder>\Scripts\Hooks\` and writes the
 * announcement. The folder itself must exist – a typo in relay.json should
 * not create a stray Saved Games folder.
 */
export async function installServerHook(
  folder: string,
  hookFile: string,
  lines: { blue: string[]; red: string[] },
  autostart: Autostart | null = null,
): Promise<{ hook: string; announce: string; hookUpdated: boolean }> {
  const info = await stat(folder).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`DCS server folder not found: ${folder}`);
  const scripts = join(folder, 'Scripts');
  const hook = join(scripts, ...SERVER_HOOK);
  const announce = join(scripts, ...ANNOUNCE_FILE);
  const source = await readFile(hookFile);
  const installed = await readFile(hook).catch(() => null);
  const hookUpdated = !installed?.equals(source);
  if (hookUpdated) await atomicWrite(hook, source);
  await atomicWrite(announce, announceFileText(lines));
  const autostartPath = join(scripts, ...AUTOSTART_FILE);
  if (autostart) await atomicWrite(autostartPath, autostartFileText(autostart));
  else await rm(autostartPath, { force: true });
  return { hook, announce, hookUpdated };
}

/** Empties the announcement (relay stopping); the hook stays. */
export async function clearAnnouncement(folder: string): Promise<void> {
  await atomicWrite(join(folder, 'Scripts', ...ANNOUNCE_FILE), announceFileText(null));
}

/** `host` → `host:port`; an address that has a port stays as it is. */
export function withPort(address: string, port: number): string {
  return /:\d{1,5}$/.test(address) ? address : `${address}:${String(port)}`;
}

export interface DiscoveryOptions {
  /** relay.json's discovery settings and the relay's codes and fingerprint. */
  files: {
    codes: RelayCodes;
    fingerprint: string;
    publicAddress: string | null;
    dcsServerFolder: string | null;
    lanAddress: string | null;
    announceMaxLength: number | null;
    autoStartWithDcs: boolean;
  };
  /**
   * How to start this relay again (the packaged executable and its
   * arguments); `null` when it runs from the repo (`pnpm relay`) – then the
   * DCS server can't start it.
   */
  launch: { exe: string; args: string[] } | null;
  /** The port the relay listens on. */
  port: number;
  /** This PC's LAN addresses with the port (`lanAddresses`). */
  lan: string[];
  /** The bundled `SLATE-server-hook.lua`. */
  hookFile: string;
  log: { info(message: string): void; warn(message: string): void };
}

/**
 * Sets up discovery at relay start: installs the hook and writes the lines.
 * Returns the function that empties the lines when the relay stops, or
 * `null` if discovery is off or couldn't be set up (logged; the relay runs
 * on – players can still join by hand).
 */
export async function startDiscovery(o: DiscoveryOptions): Promise<(() => Promise<void>) | null> {
  const folder = o.files.dcsServerFolder;
  if (folder === null) {
    o.log.info('Discovery: off (set dcsServerFolder in relay.json to announce in DCS chat)');
    return null;
  }
  let lanAddress = o.files.lanAddress === null ? null : withPort(o.files.lanAddress, o.port);
  if (lanAddress === null) {
    lanAddress = o.lan[0] ?? null;
    if (o.lan.length > 1) {
      o.log.warn(
        `Discovery: this PC has several LAN addresses (${o.lan.join(', ')}) – announcing ${String(lanAddress)}; set lanAddress in relay.json to pick another`,
      );
    }
  }
  const publicAddress =
    o.files.publicAddress === null ? null : withPort(o.files.publicAddress, o.port);
  if (lanAddress === null && publicAddress === null) {
    o.log.warn(
      'Discovery: no LAN address and no publicAddress in relay.json – nothing to announce',
    );
    return null;
  }
  try {
    const lines = announcementLines({
      codes: o.files.codes,
      fingerprint: o.files.fingerprint,
      publicAddress,
      lanAddress,
      maxLength: o.files.announceMaxLength,
    });
    const autostart = autostartFor(o);
    const result = await installServerHook(folder, o.hookFile, lines, autostart);
    o.log.info(
      result.hookUpdated
        ? `Discovery: installed ${result.hook} – restart the DCS server once so it loads the hook`
        : `Discovery: server hook up to date in ${result.hook}`,
    );
    o.log.info(
      `Discovery: announcing ${lines.blue.join(' / ')} (blue), ${lines.red.join(' / ')} (red)`,
    );
    if (autostart) {
      o.log.info('Autostart: the DCS server starts this relay when it loads a mission');
    }
    return () => clearAnnouncement(folder);
  } catch (error) {
    o.log.warn(`Discovery: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** The autostart entry, or `null` (off, not packaged, or a path DCS can't pass on – logged). */
function autostartFor(o: DiscoveryOptions): Autostart | null {
  if (!o.files.autoStartWithDcs) {
    o.log.info('Autostart: off (autoStartWithDcs in relay.json)');
    return null;
  }
  if (o.launch === null) {
    o.log.info('Autostart: only for the packaged slate-relay, not for pnpm relay');
    return null;
  }
  const parts = [o.launch.exe, ...o.launch.args];
  if (parts.some((part) => !/^[\x20-\x7e]*$/.test(part) || part.includes('"'))) {
    o.log.warn(
      `Autostart: off – the relay's folder or data folder has characters DCS can't pass on (${parts.join(' ')}); move them to a plain path such as C:\\SLATE\\relay`,
    );
    return null;
  }
  return { exe: o.launch.exe, args: o.launch.args, port: o.port };
}
