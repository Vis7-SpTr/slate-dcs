# apps/web
Browser UI (Svelte 5 + Vite). One window with anchored areas for any size – iPad portrait is the reference (ui-design.md §2). Works in an OpenKneeboard Web Dashboard tab, desktop browsers and (from P1.8) paired devices.

The host serves the built UI (`dist/`) on `http://127.0.0.1:7792/`. While developing, `pnpm dev` (repo root) runs Vite on `http://127.0.0.1:5173/` with hot reload and passes the WebSocket through to the host.

| Folder | Content |
|---|---|
| `src/shell` | App shell: status strip, sub-tab row, main tabs |
| `src/modules` | Pages per area: map, ownship, cas, checklists, more (settings, DCS) |
| `src/components` | Shared building blocks (cards, rows, source tags, command status) |
| `src/lib` | Host connection (protocol.md §14), routing, clock, formatting, UI texts (`i18n/en.ts`) |

All UI texts live in `src/lib/i18n/en.ts`; all units and times go through `src/lib/format.ts`.
