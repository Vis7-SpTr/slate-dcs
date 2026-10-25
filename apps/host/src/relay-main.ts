// SPDX-License-Identifier: GPL-3.0-or-later
// Standalone `slate-relay` (architecture.md §1.3): the relay core on its own,
// without UI or Lua bridge – the default for real sessions, on the PC that
// runs the group's DCS server.
//
// Usage (repo root): pnpm relay [--data <folder>] [--port <port>] [--print-remote]
//                                [--export-log [--csv-semicolon]]
// Files: <data>/relay.json (port, codes, public address, discovery), cert.pem,
// key.pem – created on the first start. Default folder: %APPDATA%\SLATE\relay.
// The CAS log goes to <data>/cas-log/, one JSONL file per session and run,
// kept `logRetentionDays` (default 30); `--export-log` writes a Markdown and a
// CSV file next to each (protocol.md §12.1, D7) and exits.
// With `dcsServerFolder` set, the relay installs the server hook there and
// writes the discovery announcement (P1.7, dcs/server-hook/README.md); the
// packaged relay also tells the hook how to start it, so it then starts with
// the DCS server (`autoStartWithDcs`, default on).
//
// Relay hosted somewhere else (Raspberry Pi, VPS – decided 25 Oct 2026): on
// that relay, `--print-remote` prints the `remoteRelay` block; pasted into
// relay.json on the DCS server PC, slate-relay there only installs the hook
// and announces the remote relay, then exits (cas-relay/remote.ts).

import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { BUILD } from './build-info.js';
import { startDiscovery } from './cas-relay/announce.js';
import {
  CAS_LOG_FOLDER,
  CasLogFiles,
  exportCasLogs,
  pruneCasLogs,
} from './cas-relay/cas-log-file.js';
import { loadRelayFiles, lanAddresses } from './cas-relay/config.js';
import { Relay } from './cas-relay/relay.js';
import { announceRemote, remoteRelayBlock } from './cas-relay/remote.js';
import type { RelayLog } from './cas-relay/relay.js';
import { startRelayServer } from './cas-relay/server.js';
import { defaultDataDir } from './data-dir.js';
import { PACKAGED, resourcePath } from './paths.js';

const { values } = parseArgs({
  options: {
    data: { type: 'string' },
    port: { type: 'string' },
    verbose: { type: 'boolean' },
    'print-remote': { type: 'boolean' },
    'export-log': { type: 'boolean' },
    'csv-semicolon': { type: 'boolean' },
  },
});

const line = (level: string, message: string) => {
  process.stdout.write(`${new Date().toISOString()} ${level} ${message}\n`);
};
const log: RelayLog = {
  info: (m) => {
    line('INFO ', m);
  },
  warn: (m) => {
    line('WARN ', m);
  },
  debug: (m) => {
    if (values.verbose) line('DEBUG', m);
  },
};

async function main(): Promise<void> {
  const files = await loadRelayFiles(resolve(values.data ?? join(defaultDataDir(), 'relay')));
  const port = values.port === undefined ? files.port : Number(values.port);
  const name = `slate-relay ${BUILD}`;
  const hookFile = process.env['SLATE_SERVER_HOOK'] ?? resourcePath('serverHook');

  if (values['print-remote']) {
    // For the DCS server PC's relay.json – codes are secret, like the codes in the log.
    process.stdout.write(
      `Paste this into relay.json on the DCS server PC (replacing "remoteRelay": null):\n\n${remoteRelayBlock({ ...files, port })}\n`,
    );
    return;
  }

  const logDir = join(files.dir, CAS_LOG_FOLDER);
  if (values['export-log']) {
    const done = await exportCasLogs(logDir, {
      delimiter: values['csv-semicolon'] ? ';' : ',',
    });
    if (done.length === 0) process.stdout.write(`No CAS log files in ${logDir}\n`);
    for (const file of done) {
      const lines = file.bad === 1 ? 'line' : 'lines';
      const bad = file.bad > 0 ? ` (${String(file.bad)} unreadable ${lines} skipped)` : '';
      process.stdout.write(
        `${file.source}: ${String(file.entries)} entries${bad}\n  ${file.markdown}\n  ${file.csv}\n`,
      );
    }
    return;
  }

  if (files.remoteRelay !== null) {
    log.info(
      `${name} – announce only: the DCS server announces the relay at ${files.remoteRelay.address}`,
    );
    log.info(`Config: ${join(files.dir, 'relay.json')}`);
    const done = await announceRemote({
      files,
      remote: files.remoteRelay,
      hookFile,
      app: name,
      log,
    });
    process.exitCode = done ? 0 : 1;
    return;
  }
  const prune = () =>
    pruneCasLogs(logDir, files.logRetentionDays)
      .then((removed) => {
        if (removed.length > 0) log.info(`CAS log: removed ${removed.join(', ')}`);
      })
      .catch((error: unknown) => {
        log.warn(`CAS log: can't remove old files: ${String(error)}`);
      });
  await prune();
  // A relay on a Pi may run for weeks: old files go once a day too.
  setInterval(() => void prune(), 86_400_000).unref();
  const casLog = await CasLogFiles.open(logDir, Date.now(), log);
  const relay = new Relay({ codes: files.codes, name, log, casLog });
  const server = await startRelayServer({
    relay,
    port,
    certPem: files.certPem,
    keyPem: files.keyPem,
    log,
  });

  log.info(`${name} listening on TCP ${String(server.port)}`);
  if (files.created.length > 0) log.info(`Created ${files.created.join(', ')} in ${files.dir}`);
  log.info(`Config: ${join(files.dir, 'relay.json')}`);
  log.info(`CAS log: ${logDir} (kept ${String(files.logRetentionDays)} days)`);
  log.info(`LAN:         ${lanAddresses(server.port).join(', ') || '–'}`);
  log.info(`Public:      ${files.publicAddress ?? '– (set publicAddress in relay.json)'}`);
  log.info(`Fingerprint: ${files.fingerprint}`);
  log.info(
    `Codes:       blue ${files.codes.blue} · red ${files.codes.red} · group ${files.codes.group}`,
  );

  const stopDiscovery = await startDiscovery({
    files,
    port: server.port,
    lan: lanAddresses(server.port),
    hookFile,
    // How the DCS server starts this relay again (autostart): same data folder and port.
    launch: PACKAGED
      ? {
          exe: process.execPath,
          args: [
            '--data',
            files.dir,
            ...(values.port === undefined ? [] : ['--port', String(port)]),
          ],
        }
      : null,
    log,
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      log.info(`${signal} received – closing all sessions`);
      void (stopDiscovery?.() ?? Promise.resolve())
        .catch((error: unknown) => {
          log.warn(`Discovery: can't empty the announcement: ${String(error)}`);
        })
        .then(() => server.close())
        .then(() => casLog.close())
        .then(() => process.exit(0));
    });
  }
}

// No top-level await: the release build bundles this file as CommonJS (P1.9).
main().catch((error: unknown) => {
  log.warn(`slate-relay stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
