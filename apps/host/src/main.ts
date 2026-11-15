// SPDX-License-Identifier: GPL-3.0-or-later
// Starts slate-host: state store, command dispatcher, the UI server on
// 127.0.0.1:7792, the Lua bridge receiver on UDP 127.0.0.1:7791, the DCS
// folder check (P1.3), the relay client with host mode (P1.6c), discovery
// (P1.7), LAN access with QR pairing (P1.8), and – installed – Velopack's
// hooks, updates, quit and uninstall (P1.9).
// Usage (repo root): pnpm start, or pnpm dev while developing. `--demo` fills
// in demo data for layout tests instead of listening to DCS (see demo.ts);
// `--demo=jtac` shows the JTAC's CAS picture (pnpm start:demo:jtac).
//
// Installed (P1.9) SLATE runs without a window: it logs to
// %APPDATA%\SLATE\logs\slate.log and opens its page in the browser; a second
// start only opens the page of the running one.

import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { DEFAULT_PORTS, defaultSlices } from '@slate-dcs/shared';

import { cleanupForUninstall, markWipe } from './app/cleanup.js';
import { messageBox, openBrowser, probeSlate, rotateLog, startUninstaller } from './app/desktop.js';
import { Updater } from './app/updates.js';
import { loadVelopack } from './app/velopack.js';
import { BUILD } from './build-info.js';
import { CommandDispatcher, failed } from './commands/dispatcher.js';
import { createHandlers } from './commands/handlers.js';
import type { AppControl } from './commands/handlers.js';
import { startBridgeReceiver } from './dcs-bridge/receiver.js';
import { DcsBridge } from './dcs-bridge/service.js';
import { defaultDataDir, Installer } from './dcs-integration/installer.js';
import { findSavedGames } from './dcs-integration/saved-games.js';
import { DcsIntegration } from './dcs-integration/service.js';
import { DeviceStore } from './lan/devices.js';
import { Firewall } from './lan/firewall.js';
import { LanAccess } from './lan/lan.js';
import { PACKAGED, resourcePath } from './paths.js';
import { RelayClient } from './session/client.js';
import { Discovery } from './session/discovery.js';
import { HostMode } from './session/host-mode.js';
import { TokenStore } from './session/tokens.js';
import { applyDemoState, startDemoTicker } from './demo.js';
import { createHostServer } from './server/server.js';
import { StateStore } from './state/store.js';

/** Velopack's app ID, the same as `vpk pack --packId` (tools/release). */
const APP_ID = 'SLATE';
const CLEANUP_ARG = '--slate-cleanup';

const port = Number(process.env['SLATE_PORT'] ?? DEFAULT_PORTS.hostUi);
const bridgePort = Number(process.env['SLATE_BRIDGE_PORT'] ?? DEFAULT_PORTS.bridge);
const uiDir = resolve(process.env['SLATE_UI_DIR'] ?? resourcePath('ui'));
const luaDir = resolve(process.env['SLATE_LUA_DIR'] ?? resourcePath('lua'));
const demoArg = process.argv.find((arg) => arg === '--demo' || arg.startsWith('--demo='));
const demo = demoArg !== undefined;
const demoKind = demoArg === '--demo=jtac' ? 'jtac' : 'pilot';
const dataDir = defaultDataDir();
const pageUrl = `http://127.0.0.1:${String(port)}/`;

const newInstaller = () => new Installer({ luaDir, backupDir: join(dataDir, 'backups') });

/**
 * The uninstaller's step (P1.9): run in a child process from Velopack's
 * before-uninstall hook, which can only wait for synchronous code.
 */
async function runCleanup(): Promise<void> {
  const lines: string[] = [];
  await cleanupForUninstall({
    dataDir,
    installer: newInstaller(),
    findSavedGames: () => findSavedGames(),
    firewall: new Firewall(),
    ports: [DEFAULT_PORTS.hostUi, port],
    log: (line) => lines.push(`${new Date().toISOString()} ${line}`),
  });
  // Next to the temp files: the data folder may be gone.
  await writeFile(join(tmpdir(), 'slate-uninstall.log'), `${lines.join('\n')}\n`).catch(
    () => undefined,
  );
}

async function main(): Promise<void> {
  if (process.argv.includes(CLEANUP_ARG)) {
    await runCleanup();
    return;
  }

  // Velopack first (installed builds only): it handles its own start arguments
  // and may end the process (install/uninstall hooks, applying an update).
  const velopack = PACKAGED ? loadVelopack() : null;
  velopack?.VelopackApp.build()
    .onBeforeUninstallFastCallback(() => {
      spawnSync(process.execPath, [CLEANUP_ARG], {
        timeout: 25_000,
        windowsHide: true,
        stdio: 'ignore',
      });
    })
    .run();

  // One SLATE per PC: a second start opens the page of the running one.
  if (await probeSlate(port)) {
    if (PACKAGED) openBrowser(pageUrl);
    else process.stderr.write(`SLATE is already running on ${pageUrl}\n`);
    return;
  }

  const store = new StateStore(defaultSlices(BUILD));
  let stopDemo = (): void => undefined;
  let stopRelay = (): Promise<void> => Promise.resolve();
  if (demo) {
    applyDemoState(store, Date.now(), demoKind);
    stopDemo = startDemoTicker(store);
  }
  // Demo mode never touches the real Saved Games folder and joins no session.
  let dcs: DcsIntegration | null = null;
  let relay: { client: RelayClient; hostMode: HostMode; discovery: Discovery } | null = null;
  // LAN access works in demo mode too – handy for layout tests on the iPad.
  let lan: LanAccess | null = null;
  let appControl: AppControl | null = null;
  const handlers = createHandlers(store, {
    get dcs() {
      return dcs;
    },
    get relay() {
      return relay;
    },
    get lan() {
      return lan;
    },
    get app() {
      return appControl;
    },
  });
  const dispatcher = new CommandDispatcher(handlers);
  const app = await createHostServer({
    store,
    dispatcher,
    build: BUILD,
    uiDir,
    logger: PACKAGED ? { level: 'info', file: await rotateLog(dataDir) } : { level: 'info' },
    get lan() {
      return lan;
    },
  });

  // Ends SLATE cleanly: everything closed, the session token kept.
  let stopBridge = (): Promise<void> => Promise.resolve();
  let shuttingDown = false;
  const shutdown = (reason: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${reason} – shutting down`);
    stopDemo();
    updater.stop();
    void stopBridge()
      .then(() => stopRelay())
      .then(() => lan?.close())
      .then(() => app.close())
      .catch((error: unknown) => {
        app.log.warn(`Shutdown: ${String(error)}`);
      })
      .then(() => process.exit(0));
  };

  const updater = new Updater({
    store,
    velopack,
    log: app.log.child({ module: 'update' }),
    exit: () => {
      shutdown('Installing an update');
    },
    source: process.env['SLATE_UPDATE_SOURCE'],
  });
  appControl = {
    updater,
    quit: () => {
      // After the answer reached the screen.
      setTimeout(() => {
        shutdown('Quit from the UI');
      }, 200);
      return { ok: true };
    },
    uninstall: async (wipe) => {
      if (!store.get('host').app.installed) {
        return failed('notPossible', 'Only the installed SLATE can be uninstalled from here');
      }
      if (wipe) await markWipe(dataDir);
      const error = await startUninstaller(APP_ID);
      if (error !== null) return failed('notPossible', error);
      app.log.info(`Uninstall started${wipe ? ' (wipe data)' : ''}`);
      setTimeout(() => {
        shutdown('Uninstalling');
      }, 200);
      return { ok: true };
    },
  };

  if (!demo) {
    dcs = new DcsIntegration({
      store,
      installer: newInstaller(),
      log: app.log.child({ module: 'dcs-folders' }),
    });
    void dcs.rescan();

    const relayLog = app.log.child({ module: 'relay' });
    const client = new RelayClient({
      store,
      tokens: new TokenStore(join(dataDir, 'relays.json')),
      log: app.log.child({ module: 'session' }),
      app: `slate-host ${BUILD}`,
      briefFile: join(dataDir, 'brief.json'),
    });
    const hostMode = new HostMode({
      store,
      dataDir,
      name: `slate-host ${BUILD} (host mode)`,
      log: relayLog,
      ...(process.env['SLATE_RELAY_PORT'] ? { port: Number(process.env['SLATE_RELAY_PORT']) } : {}),
    });
    const discovery = new Discovery({
      store,
      client,
      log: app.log.child({ module: 'discovery' }),
      anySender: process.env['SLATE_DISCOVERY_ANY_SENDER'] === '1',
    });
    relay = { client, hostMode, discovery };
    const clientTick = setInterval(() => {
      client.tick();
    }, 1000);
    stopRelay = async () => {
      clearInterval(clientTick);
      discovery.close();
      client.close();
      await hostMode.stop();
    };
  }

  try {
    await app.listen({ host: '127.0.0.1', port });
  } catch (error) {
    const text = `SLATE can't start: port ${String(port)} is used by another program (${error instanceof Error ? error.message : String(error)}).`;
    app.log.error(text);
    if (PACKAGED) messageBox(text);
    await app.close();
    process.exitCode = 1;
    await stopRelay();
    stopDemo();
    return;
  }
  app.log.info(`SLATE host ${BUILD}${demo ? ' (demo data)' : ''} – open ${pageUrl}`);

  const lanAccess = new LanAccess({
    store,
    devices: new DeviceStore(join(dataDir, 'lan.json')),
    firewall: new Firewall(),
    target: app.server,
    port,
    log: app.log.child({ module: 'lan' }),
  });
  lan = lanAccess;
  await lanAccess.init();

  // The Lua bridge. Without it the UI still works, so a busy port is reported, not fatal.
  if (!demo) {
    const bridgeLog = app.log.child({ module: 'dcs' });
    const bridge = new DcsBridge({
      store,
      log: bridgeLog,
      onChat: (chat) => {
        relay?.discovery.handleChat(chat);
      },
    });
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
      bridgeLog.info(`Listening for the Lua bridge on UDP 127.0.0.1:${String(receiver.port)}`);
      stopBridge = async () => {
        stopTicks();
        await receiver.close();
      };
    } catch (error) {
      stopTicks();
      bridgeLog.error(
        `Can't listen on UDP 127.0.0.1:${String(bridgePort)} for DCS data (${error instanceof Error ? error.message : String(error)}) – is another SLATE host running?`,
      );
    }
  }

  updater.start();
  if (updater.currentVersion) app.log.info(`Installed version ${updater.currentVersion}`);
  if (PACKAGED) openBrowser(pageUrl);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      shutdown(`${signal} received`);
    });
  }
}

// No top-level await: the release build bundles this file as CommonJS (P1.9).
main().catch((error: unknown) => {
  const text = `SLATE stopped: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
  process.stderr.write(`${text}\n`);
  if (PACKAGED) messageBox(text.split('\n')[0] ?? text);
  process.exit(1);
});
