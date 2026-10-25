// SPDX-License-Identifier: GPL-3.0-or-later
// The relay's files in its data folder (architecture.md §1.2: "one config file
// for port, TLS and session secrets"): relay.json, cert.pem, key.pem. Missing
// files are created – random codes, a new certificate – and then kept, so the
// codes and the fingerprint stay the same across restarts.

import { mkdir, readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_PORTS, RelayAddress, RelayFingerprint, SessionCode } from '@slate-dcs/shared';
import { z } from 'zod';

import { writeFileAtomic } from '../fs-safe.js';
import { codesValid, generateCodes } from './codes.js';
import type { RelayCodes } from './codes.js';
import type { RemoteRelay } from './remote.js';
import { certificateDer, createCertificate, fingerprint } from './tls.js';

const ConfigFile = z.object({
  /** TCP port of the relay – the one port forwarded on the router (protocol.md §0). */
  port: z.int().min(1).max(65535),
  /** Session codes (protocol.md §4.1); change them here to lock out old ones. */
  codes: z.object({ blue: z.string(), red: z.string(), group: z.string() }),
  /** Public address for the discovery line (DynDNS hostname with port), if any (P1.7). */
  publicAddress: z.string().min(1).nullable(),
  /**
   * The DCS server's Saved Games folder (e.g. `…\Saved Games\DCS.server`):
   * the relay installs the server hook and the announcement there (P1.7).
   * `null`: no discovery, players join by hand.
   */
  dcsServerFolder: z.string().min(1).nullable().default(null),
  /**
   * LAN address for the discovery line (`ip:port`); `null` = this PC's only
   * LAN address. With `remoteRelay`: the remote relay's LAN address if it is
   * in the DCS server's LAN, else leave it `null`.
   */
  lanAddress: z.string().min(1).nullable().default(null),
  /** Split the discovery line so no chat line is longer; `null` = one line (spike 3.5). */
  announceMaxLength: z.int().min(40).nullable().default(null),
  /** With `dcsServerFolder`: the DCS server starts this relay when it loads a mission. */
  autoStartWithDcs: z.boolean().default(true),
  /**
   * A relay hosted somewhere else (Raspberry Pi, VPS): the DCS server
   * announces that one, and this slate-relay only installs the hook and the
   * announcement, then exits – it listens on nothing. Copied from
   * `slate-relay --print-remote` on that relay. `null` = announce this relay.
   */
  remoteRelay: z
    .object({
      address: RelayAddress,
      codes: z.object({ blue: SessionCode, red: SessionCode }),
      fingerprint: RelayFingerprint,
    })
    .nullable()
    .default(null),
});

export interface RelayFiles {
  dir: string;
  port: number;
  codes: RelayCodes;
  publicAddress: string | null;
  dcsServerFolder: string | null;
  lanAddress: string | null;
  announceMaxLength: number | null;
  autoStartWithDcs: boolean;
  remoteRelay: RemoteRelay | null;
  certPem: string;
  keyPem: string;
  fingerprint: string;
  /** Files created on this start, for the log. */
  created: string[];
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function writeNew(path: string, text: string): Promise<void> {
  return writeFileAtomic(path, text, { mode: 0o600 });
}

/** Reads the relay's files from `dir`, creating what's missing. */
export async function loadRelayFiles(dir: string): Promise<RelayFiles> {
  await mkdir(dir, { recursive: true });
  const created: string[] = [];

  const configPath = join(dir, 'relay.json');
  const configText = await readText(configPath);
  let config: z.infer<typeof ConfigFile>;
  if (configText === null) {
    config = {
      port: DEFAULT_PORTS.relay,
      codes: generateCodes(),
      publicAddress: null,
      dcsServerFolder: null,
      lanAddress: null,
      announceMaxLength: null,
      autoStartWithDcs: true,
      remoteRelay: null,
    };
    await writeNew(configPath, `${JSON.stringify(config, null, 2)}\n`);
    created.push('relay.json');
  } else {
    const parsed = ConfigFile.safeParse(JSON.parse(configText));
    if (!parsed.success) throw new Error(`${configPath}: ${z.prettifyError(parsed.error)}`);
    config = parsed.data;
  }
  if (!codesValid(config.codes)) {
    throw new Error(
      `${configPath}: the three codes must be different and look like BLUE-7K3Q9XPM (8 characters, no I, L, O, U)`,
    );
  }

  const certPath = join(dir, 'cert.pem');
  const keyPath = join(dir, 'key.pem');
  let certPem = await readText(certPath);
  let keyPem = await readText(keyPath);
  if (certPem === null || keyPem === null) {
    ({ certPem, keyPem } = await createCertificate());
    await writeNew(keyPath, keyPem);
    await writeNew(certPath, certPem);
    created.push('cert.pem', 'key.pem');
  }

  return {
    dir,
    port: config.port,
    codes: config.codes,
    publicAddress: config.publicAddress,
    dcsServerFolder: config.dcsServerFolder,
    lanAddress: config.lanAddress,
    announceMaxLength: config.announceMaxLength,
    autoStartWithDcs: config.autoStartWithDcs,
    remoteRelay: config.remoteRelay,
    certPem,
    keyPem,
    fingerprint: fingerprint(certificateDer(certPem)),
    created,
  };
}

/** This PC's LAN IPv4 addresses with the port, e.g. `192.168.1.20:7790`. */
export function lanAddresses(port: number): string[] {
  return Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => `${a.address}:${String(port)}`);
}
