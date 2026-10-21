// SPDX-License-Identifier: GPL-3.0-or-later
// Vite: builds the UI into dist/ (served by the host on 7792) and runs the dev
// server on 5173 with hot reload, passing the WebSocket through to the host.

import { readFileSync } from 'node:fs';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

/** One version for the whole app: the root package.json (protocol.md §14.6). */
const rootPackage = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };
const BUILD = process.env['SLATE_BUILD'] ?? `${rootPackage.version}-dev`;

/** Where the host listens in development. */
const HOST_URL = `http://127.0.0.1:${process.env['SLATE_PORT'] ?? '7792'}`;

export default defineConfig({
  plugins: [svelte()],
  define: {
    __SLATE_BUILD__: JSON.stringify(BUILD),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // OKB's WebView2, current Chrome/Edge and iPad Safari.
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': {
        target: HOST_URL,
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          // The host only accepts WebSockets from its own origin (architecture.md
          // §1.1). In development the page comes from 5173, so the dev proxy
          // presents the host's own origin instead.
          proxy.on('proxyReqWs', (proxyRequest) => {
            proxyRequest.setHeader('origin', HOST_URL);
          });
        },
      },
    },
  },
});
