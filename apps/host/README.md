# apps/host
Local service on each PC: serves the UI, hosts/joins sessions, relays CAS packages, reads DCS data (read-only).

Start it with `pnpm start` (from the repo root). It listens on `http://127.0.0.1:7792/` – plus the LAN addresses with LAN access on (P1.8) – and serves the built web UI there. `/debug` shows the raw host state. `--demo` (`pnpm start:demo`) fills in demo data for layout tests.

| Folder | Content |
|---|---|
| `src/state` | State store: all state, numbered changes (protocol.md §14.4) |
| `src/commands` | Command dispatcher (applied once per ID) and handlers (§14.5, §14.7) |
| `src/server` | HTTP + WebSocket server, Host/Origin checks, debug page (§14) |
| `src/dcs-bridge` | Lua bridge receiver and own-ship data (§6.1, P1.2) |
| `src/dcs-integration` | Lua files and the Export.lua block in Saved Games (P1.3) |
| `src/cas-relay` | The relay core, WSS server, relay files, discovery on the server PC (P1.6, P1.7) |
| `src/session` | Relay client, host mode, discovery on the player's PC (P1.6, P1.7) |
| `src/lan` | LAN access, pairing, Windows Firewall (P1.8) |
| `src/app` | The installed app: Velopack hooks, uninstall cleanup, updates, browser/message box, log file (P1.9) |

`src/main.ts` starts the host, `src/relay-main.ts` the standalone relay (`pnpm relay`); `src/paths.ts` finds the UI and Lua files in the repo or next to the packaged executable (`tools/release/build.mjs`).
