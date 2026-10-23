// SPDX-License-Identifier: GPL-3.0-or-later
// HTTP + WebSocket server for the host's screens (protocol.md §14,
// architecture.md §1.1 Multiscreen). Listens on localhost; with LAN access on
// (P1.8, lan/lan.ts) the LAN listeners hand their requests here too, and those
// need a paired device's cookie.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { parseScreenMessage, UI_WEBSOCKET_PATH } from '@slate-dcs/shared';
import type { HostToScreen } from '@slate-dcs/shared';
import Fastify, { LogController } from 'fastify';
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifyServerOptions,
} from 'fastify';
import type { RawData, WebSocket } from 'ws';

import { isAllowedHost, isAllowedOrigin } from './access.js';
import { DEBUG_PAGE_CSS, DEBUG_PAGE_HTML, DEBUG_PAGE_JS } from './debug-page.js';
import type { CommandDispatcher } from '../commands/dispatcher.js';
import type { LanAccess } from '../lan/lan.js';
import { LAN_CSS, NOT_PAIRED_PAGE, PAIR_FAILED_PAGE, PAIRED_PAGE } from '../lan/pages.js';
import type { StateStore } from '../state/store.js';

/** Largest frame a screen may send; commands are small. */
const MAX_FRAME_BYTES = 64 * 1024;

/**
 * Content security policy for every response: only SLATE's own scripts,
 * styles, fonts and WebSocket; no inline scripts, no framing.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export interface HostServerOptions {
  store: StateStore;
  dispatcher: CommandDispatcher;
  /** Build version sent in every snapshot (§14.6). */
  build: string;
  /**
   * Folder with the built web UI (apps/web/dist). If it holds an index.html,
   * the UI is served at `/`; otherwise `/` shows the debug page.
   */
  uiDir?: string;
  logger?: FastifyServerOptions['logger'];
  /** LAN access (P1.8); read at each request, so it can be set after start. */
  readonly lan?: LanAccess | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The paired device a LAN request came from; `null` on localhost. */
    slateDevice: string | null;
  }
}

/** Commands only a screen on this PC may send (P1.9) – a paired iPad can't end or remove SLATE. */
const LOCAL_ONLY = new Set(['app.quit', 'app.uninstall']);

/** Paths a LAN device may open before it is paired. */
const OPEN_ON_LAN = new Set(['/pair', '/lan.css']);

export async function createHostServer(options: HostServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    // No log line per HTTP request – one per page load or reconnect is only noise.
    logController: new LogController({ disableRequestLogging: true }),
  });
  await app.register(websocket, { options: { maxPayload: MAX_FRAME_BYTES } });

  app.decorateRequest('slateDevice', null);

  // Every request must be addressed to the host by its own name (DNS rebinding);
  // one from the LAN also needs a paired device (except the pairing link).
  app.addHook('onRequest', async (request, reply) => {
    const lan = options.lan ?? null;
    if (lan?.isLan(request.raw.socket)) {
      if (!lan.hosts().has((request.headers.host ?? '').toLowerCase())) {
        request.log.warn(
          { host: request.headers.host },
          'Refused LAN request with foreign Host header',
        );
        return reply.code(403).send('Forbidden');
      }
      if (OPEN_ON_LAN.has(request.url.split('?')[0] ?? '')) return;
      const device = lan.device(request.raw);
      if (!device) {
        return reply.code(403).type('text/html; charset=utf-8').send(NOT_PAIRED_PAGE);
      }
      request.slateDevice = device.id;
      return;
    }
    if (!isAllowedHost(request.headers.host, boundPort(app))) {
      request.log.warn({ host: request.headers.host }, 'Refused request with foreign Host header');
      return reply.code(403).send('Forbidden');
    }
  });

  // Pairing (P1.8): the QR code's link exchanges its one-time secret for the cookie.
  app.get('/pair', async (request, reply) => {
    const lan = options.lan ?? null;
    if (!lan?.isLan(request.raw.socket)) return reply.redirect('/');
    const secret = (request.query as Record<string, unknown>)['s'];
    const cookie =
      typeof secret === 'string'
        ? await lan.handlePairing(secret, request.headers['user-agent'])
        : null;
    reply.header('cache-control', 'no-store').type('text/html; charset=utf-8');
    if (cookie === null) return reply.code(403).send(PAIR_FAILED_PAGE);
    return reply.header('set-cookie', cookie).send(PAIRED_PAGE);
  });
  app.get('/lan.css', (_request, reply) => reply.type('text/css; charset=utf-8').send(LAN_CSS));

  app.addHook('onSend', async (_request, reply) => {
    reply.header('content-security-policy', CONTENT_SECURITY_POLICY);
    reply.header('x-content-type-options', 'nosniff');
  });

  // Debug page: always at /debug; at / too while no UI is built.
  const sendDebugPage = (_request: FastifyRequest, reply: FastifyReply) =>
    reply.type('text/html; charset=utf-8').send(DEBUG_PAGE_HTML);
  // "Is SLATE running here?" – a second start opens the running one's page (P1.9).
  app.get('/api/health', () => ({ app: 'slate-host', build: options.build }));

  app.get('/debug', sendDebugPage);
  if (options.uiDir !== undefined && existsSync(join(options.uiDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: options.uiDir,
      prefix: '/',
      // Built assets have content hashes in their names; index.html must always be fresh.
      setHeaders: (response, path) => {
        response.header(
          'cache-control',
          path.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        );
      },
    });
  } else {
    app.get('/', sendDebugPage);
  }
  app.get('/debug.js', (_request, reply) =>
    reply.type('text/javascript; charset=utf-8').send(DEBUG_PAGE_JS),
  );
  app.get('/debug.css', (_request, reply) =>
    reply.type('text/css; charset=utf-8').send(DEBUG_PAGE_CSS),
  );

  app.get(
    UI_WEBSOCKET_PATH,
    {
      websocket: true,
      // Only SLATE's own pages may open the WebSocket (cross-site WebSocket).
      preValidation: async (request, reply) => {
        const lan = options.lan ?? null;
        const allowed = lan?.isLan(request.raw.socket)
          ? request.headers.origin?.toLowerCase() ===
            `http://${(request.headers.host ?? '').toLowerCase()}`
          : isAllowedOrigin(request.headers.origin, boundPort(app));
        if (!allowed) {
          request.log.warn(
            { origin: request.headers.origin },
            'Refused WebSocket from foreign origin',
          );
          return reply.code(403).send('Forbidden');
        }
      },
    },
    (socket, request) => {
      serveScreen(socket, options, request.log, request.slateDevice !== null);
      // A paired device's screen: counted as connected, closed if it's removed.
      const device = request.slateDevice;
      const lan = options.lan ?? null;
      if (device !== null && lan) {
        const detach = lan.attach(device, {
          close: () => {
            socket.close(4001, 'Device removed');
          },
        });
        socket.on('close', detach);
      }
    },
  );

  return app;
}

/** One connected screen: snapshot on connect, live updates, commands (§14.2). */
function serveScreen(
  socket: WebSocket,
  options: HostServerOptions,
  log: FastifyBaseLogger,
  fromLan: boolean,
): void {
  const { store, dispatcher, build } = options;

  const send = (message: HostToScreen): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };
  const sendSnapshot = (): void => {
    const { seq, slices } = store.snapshot();
    send({ t: 'state.snapshot', seq, body: { build, slices } });
  };

  // Subscribe and send the snapshot in the same tick, so no change falls in between.
  const unsubscribe = store.subscribe((change) => {
    send({ t: 'state.update', seq: change.seq, body: { slices: change.slices } });
  });
  sendSnapshot();

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      log.warn('Dropped binary frame from a screen');
      return;
    }
    const parsed = parseScreenMessage(frameText(data));
    if (!parsed.ok) {
      if (parsed.reply === null) {
        log.warn({ detail: parsed.detail }, 'Dropped unreadable frame from a screen');
      } else {
        const { id, code, text } = parsed.reply;
        send({ t: 'cmd.result', id, body: { ok: false, error: { code, text } } });
      }
      return;
    }

    const message = parsed.message;
    if (message.t === 'state.resync') {
      sendSnapshot();
      return;
    }
    if (fromLan && LOCAL_ONLY.has(message.body.cmd)) {
      const text = 'Only possible on the PC that runs SLATE';
      send({
        t: 'cmd.result',
        id: message.id,
        body: { ok: false, error: { code: 'forbidden', text } },
      });
      return;
    }
    void dispatcher.dispatch(message.id, message.body).then((outcome) => {
      // To the sending screen only; the change itself went to every screen as an update.
      send({ t: 'cmd.result', id: message.id, body: outcome });
    });
  });

  socket.on('close', unsubscribe);
}

/** Text of a WebSocket frame; `ws` delivers a Buffer, an ArrayBuffer or fragments. */
function frameText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

/** The port the server listens on (also right for `inject`ed test requests). */
function boundPort(app: FastifyInstance): number {
  const address = app.server.address();
  return address !== null && typeof address === 'object' ? address.port : 0;
}
