// SPDX-License-Identifier: GPL-3.0-or-later
// Standalone `slate-relay` (architecture.md §1.3): the relay core on its own,
// without UI or Lua bridge – the default for real sessions, on the PC that
// runs the group's DCS server.
//
// Usage (repo root): pnpm relay [--data <folder>] [--port <port>]
// Files: <data>/relay.json (port, codes, public address), cert.pem, key.pem –
// created on the first start. Default folder: %APPDATA%\SLATE\relay.

import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { BUILD } from './build-info.js';
import { loadRelayFiles, lanAddresses } from './cas-relay/config.js';
import { Relay } from './cas-relay/relay.js';
import type { RelayLog } from './cas-relay/relay.js';
import { startRelayServer } from './cas-relay/server.js';
import { defaultDataDir } from './data-dir.js';

const { values } = parseArgs({
  options: { data: { type: 'string' }, port: { type: 'string' }, verbose: { type: 'boolean' } },
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

const files = await loadRelayFiles(values.data ?? join(defaultDataDir(), 'relay'));
const port = values.port === undefined ? files.port : Number(values.port);
const name = `slate-relay ${BUILD}`;
const relay = new Relay({ codes: files.codes, name, log });
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
log.info(`LAN:         ${lanAddresses(server.port).join(', ') || '–'}`);
log.info(`Public:      ${files.publicAddress ?? '– (set publicAddress in relay.json)'}`);
log.info(`Fingerprint: ${files.fingerprint}`);
log.info(
  `Codes:       blue ${files.codes.blue} · red ${files.codes.red} · group ${files.codes.group}`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log.info(`${signal} received – closing all sessions`);
    void server.close().then(() => process.exit(0));
  });
}
