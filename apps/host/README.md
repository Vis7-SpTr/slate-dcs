# apps/host
Local service on each PC: serves the UI, hosts/joins sessions, relays CAS packages, reads DCS data (read-only).

Start it with `pnpm start` (from the repo root). It listens on `http://127.0.0.1:7792/` – localhost only until LAN access (P1.8) – and serves the built web UI there. `/debug` shows the raw host state. `--demo` (`pnpm start:demo`) fills in demo data for layout tests.

| Folder | Content |
|---|---|
| `src/state` | State store: all state, numbered changes (protocol.md §14.4) |
| `src/commands` | Command dispatcher (applied once per ID) and handlers (§14.5, §14.7) |
| `src/server` | HTTP + WebSocket server, Host/Origin checks, debug page (§14) |
