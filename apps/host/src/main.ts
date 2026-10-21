// SPDX-License-Identifier: GPL-3.0-or-later
// Starts slate-host: state store, command dispatcher and the UI server on
// 127.0.0.1:7792. Usage (repo root): pnpm start, or pnpm dev while developing.
// `--demo` fills in demo data for layout tests (see demo.ts).

import { fileURLToPath } from 'node:url';

import { DEFAULT_PORTS, defaultSlices } from '@slate-dcs/shared';

import { BUILD } from './build-info.js';
import { CommandDispatcher } from './commands/dispatcher.js';
import { createHandlers } from './commands/handlers.js';
import { applyDemoState, startDemoTicker } from './demo.js';
import { createHostServer } from './server/server.js';
import { StateStore } from './state/store.js';

const port = Number(process.env['SLATE_PORT'] ?? DEFAULT_PORTS.hostUi);
const uiDir =
  process.env['SLATE_UI_DIR'] ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
const demo = process.argv.includes('--demo');

const store = new StateStore(defaultSlices(BUILD));
let stopDemo = (): void => undefined;
if (demo) {
  applyDemoState(store);
  stopDemo = startDemoTicker(store);
}
const dispatcher = new CommandDispatcher(createHandlers(store));
const app = await createHostServer({
  store,
  dispatcher,
  build: BUILD,
  uiDir,
  logger: { level: 'info' },
});

await app.listen({ host: '127.0.0.1', port });
app.log.info(`SLATE host ${BUILD}${demo ? ' (demo data)' : ''} – open http://127.0.0.1:${port}/`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received – shutting down`);
    stopDemo();
    void app.close().then(() => process.exit(0));
  });
}
