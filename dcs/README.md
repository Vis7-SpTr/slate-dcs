# dcs
Lua for DCS. Installed only under Saved Games (`Scripts\Hooks`, `Export.lua` block) so the integrity check stays intact. Read-only.

- `export/` – the client-side Lua bridge (own aircraft, mission state) → the SLATE host on the same PC.
- `server-hook/` – the dedicated server's hook (chat announcement P1.7, plugin data P6).
