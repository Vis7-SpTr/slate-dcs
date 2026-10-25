// SPDX-License-Identifier: GPL-3.0-or-later
// A relay hosted somewhere else (P1.7 follow-up, decided 25 Oct 2026): the DCS
// server PC opens no port, the relay runs e.g. on a Raspberry Pi or a VPS.
// slate-relay on the server PC then only installs the server hook and writes
// the announcement for that relay – address, coalition codes and fingerprint
// copied once from it (`slate-relay --print-remote` there) into `remoteRelay`
// in relay.json – checks it once and exits. Nothing listens on the server PC.

import { DEFAULT_PORTS, parseMessageText, PROTOCOL_VERSION, ulid } from '@slate-dcs/shared';

import { dialWss, FingerprintError } from '../session/link.js';
import { installServerHook, announcementLines, withPort } from './announce.js';
import type { RelayFiles } from './config.js';

/** `remoteRelay` in relay.json: the relay the DCS server announces instead of this one. */
export interface RemoteRelay {
  /** Public address (DynDNS name or fixed IP, with or without port). */
  address: string;
  codes: { blue: string; red: string };
  fingerprint: string;
}

/**
 * The block to paste into the server PC's relay.json – printed on the remote
 * relay with `--print-remote`. Needs its `publicAddress`.
 */
export function remoteRelayBlock(files: RelayFiles): string {
  if (files.publicAddress === null) {
    throw new Error(
      `Set publicAddress in ${files.dir}/relay.json first (the DynDNS name or fixed IP players reach this relay on)`,
    );
  }
  const block: RemoteRelay = {
    address: withPort(files.publicAddress, files.port),
    codes: { blue: files.codes.blue, red: files.codes.red },
    fingerprint: files.fingerprint,
  };
  return `"remoteRelay": ${JSON.stringify(block, null, 2)}`;
}

export type RemoteCheck =
  | { ok: true; relay: string }
  | { ok: false; reachable: boolean; fingerprint: string | null; error: string };

/**
 * Connects once to the remote relay: its certificate must show the
 * configured fingerprint and it must answer `hello` with `welcome`.
 */
export async function checkRemoteRelay(
  remote: RemoteRelay,
  app: string,
  timeoutMs = 10_000,
): Promise<RemoteCheck> {
  let answer: (text: string) => void = () => undefined;
  const reply = new Promise<string | null>((resolve) => {
    answer = resolve;
    setTimeout(() => {
      resolve(null);
    }, timeoutMs).unref();
  });
  let link;
  try {
    link = await dialWss(
      remote.address,
      (seen) => seen === remote.fingerprint,
      {
        onText: (text) => {
          answer(text);
        },
        onClose: () => {
          answer('');
        },
      },
      timeoutMs,
    );
  } catch (error) {
    if (error instanceof FingerprintError) {
      return {
        ok: false,
        reachable: true,
        fingerprint: error.fingerprint,
        error: `${remote.address} shows the fingerprint ${error.fingerprint}, not ${remote.fingerprint}`,
      };
    }
    return {
      ok: false,
      reachable: false,
      fingerprint: null,
      error: `Can't reach ${remote.address}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  link.send(
    JSON.stringify({
      v: PROTOCOL_VERSION,
      id: ulid(Date.now()),
      type: 'hello',
      from: '',
      session: '',
      to: { scope: 'relay' },
      ts: Date.now(),
      ack: false,
      re: null,
      body: { protocols: [PROTOCOL_VERSION], app, features: [] },
    }),
  );
  const text = await reply;
  link.close();
  const parsed = text ? parseMessageText(text) : null;
  const message = parsed?.ok ? parsed.message : null;
  if (message?.type === 'welcome') return { ok: true, relay: message.body.relay };
  return {
    ok: false,
    reachable: true,
    fingerprint: remote.fingerprint,
    error:
      message?.type === 'reject'
        ? `${remote.address} speaks protocol ${message.body.supported.join(', ')}, this slate-relay ${String(PROTOCOL_VERSION)} – update one of them`
        : `${remote.address} didn't answer like a SLATE relay`,
  };
}

export interface AnnounceRemoteOptions {
  files: RelayFiles;
  remote: RemoteRelay;
  /** The bundled `SLATE-server-hook.lua`. */
  hookFile: string;
  /** App name for the check, e.g. `slate-relay 0.1.0`. */
  app: string;
  log: { info(message: string): void; warn(message: string): void };
  check?: typeof checkRemoteRelay;
}

/**
 * Announce-only: installs the hook and writes the remote relay's lines into
 * `dcsServerFolder`, removes any autostart file. A relay that shows another
 * fingerprint is not announced (every player would be refused); one that
 * can't be reached right now is announced anyway (it may just be off).
 * Returns `true` when the announcement was written.
 */
export async function announceRemote(o: AnnounceRemoteOptions): Promise<boolean> {
  const folder = o.files.dcsServerFolder;
  if (folder === null) {
    o.log.warn(
      `Remote relay: set dcsServerFolder in ${o.files.dir}/relay.json (the DCS server's Saved Games folder) – nothing to announce into`,
    );
    return false;
  }
  if (o.remote.codes.blue === o.remote.codes.red) {
    o.log.warn('Remote relay: the blue and red codes must be different');
    return false;
  }
  const address = withPort(o.remote.address, DEFAULT_PORTS.relay);
  o.log.info(`Remote relay: checking ${address} …`);
  const result = await (o.check ?? checkRemoteRelay)({ ...o.remote, address }, o.app);
  if (result.ok) {
    o.log.info(`Remote relay: ${address} answers (${result.relay}), fingerprint matches`);
  } else if (result.reachable && result.fingerprint !== o.remote.fingerprint) {
    o.log.warn(
      `Remote relay: ${result.error} – not announced. Copy the block from slate-relay --print-remote on that relay again.`,
    );
    return false;
  } else {
    o.log.warn(`Remote relay: ${result.error} – announcing it anyway`);
  }

  const lanAddress =
    o.files.lanAddress === null ? null : withPort(o.files.lanAddress, DEFAULT_PORTS.relay);
  const lines = announcementLines({
    codes: o.remote.codes,
    fingerprint: o.remote.fingerprint,
    publicAddress: address,
    lanAddress,
    maxLength: o.files.announceMaxLength,
  });
  const installed = await installServerHook(folder, o.hookFile, lines, null);
  o.log.info(
    installed.hookUpdated
      ? `Remote relay: installed ${installed.hook} – restart the DCS server once so it loads the hook`
      : `Remote relay: server hook up to date in ${installed.hook}`,
  );
  o.log.info(
    `Remote relay: the DCS server now announces ${lines.blue.join(' / ')} (blue), ${lines.red.join(' / ')} (red)`,
  );
  o.log.info(
    'Remote relay: nothing listens on this PC. Run this again after changing remoteRelay in relay.json.',
  );
  return true;
}
