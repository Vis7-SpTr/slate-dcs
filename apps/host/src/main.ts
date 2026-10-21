// SPDX-License-Identifier: GPL-3.0-or-later
// Starts slate-host: state store, command dispatcher, the UI server on
// 127.0.0.1:7792 and the Lua bridge receiver on UDP 127.0.0.1:7791.
// Usage (repo root): pnpm start, or pnpm dev while developing. `--demo` fills
// in demo data for layout tests instead of listening to DCS (see demo.ts).

import { fileURLToPath } from 'node:url';

import { DEFAULT_PORTS, defaultSlices } from '@slate-dcs/shared';

import { BUILD } from './build-info.js';
import { CommandDispatcher } from './commands/dispatcher.js';
import { createHandlers } from './commands/handlers.js';
import { startBridgeReceiver } from './dcs-bridge/receiver.js';
import { DcsBridge } from './dcs-bridge/service.js';
import { applyDemoState, startDemoTicker } from './demo.js';
import { createHostServer } from './server/server.js';
import { StateStore } from './state/store.js';

const port = Number(process.env['SLATE_PORT'] ?? DEFAULT_PORTS.hostUi);
const bridgePort = Number(process.env['SLATE_BRIDGE_PORT'] ?? DEFAULT_PORTS.bridge);
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

// The Lua bridge. Without it the UI still works, so a busy port is reported, not fatal.
let stopBridge = (): Promise<void> => Promise.resolve();
if (!demo) {
  const bridgeLog = app.log.child({ module: 'dcs' });
  const bridge = new DcsBridge({ store, log: bridgeLog });
  const stopTicks = bridge.start();
  try {
    const receiver = await startBridgeReceiver({
      port: bridgePort,
      onText: (text) => {
        bridge.handleText(text);
      },
      onError: (error) => {
        bridgeLog.warn(`Lua bridge socket: ${error.message}`);
      },
    });
    bridgeLog.info(`Listening for the Lua bridge on UDP 127.0.0.1:${receiver.port}`);
    stopBridge = async () => {
      stopTicks();
      await receiver.close();
    };
  } catch (error) {
    stopTicks();
    bridgeLog.error(
      `Can't listen on UDP 127.0.0.1:${bridgePort} for DCS data (${error instanceof Error ? error.message : String(error)}) – is another SLATE host running?`,
    );
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received – shutting down`);
    stopDemo();
    void stopBridge()
      .then(() => app.close())
      .then(() => process.exit(0));
  });
}
