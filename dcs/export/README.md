# dcs/export – the SLATE Lua bridge (client side)

Read-only Lua scripts that send the own aircraft's data and the mission state to the SLATE host on the same PC: JSON datagrams over UDP to `127.0.0.1:7791` (`protocol.md` §6.1, rules in `architecture.md` §1.1). Bridge version **3** (2: magnetic heading, 3: TAS, Mach, vertical speed – 21 Oct 2026) – the same number as `BRIDGE_VERSION` in `packages/shared/src/bridge.ts`.

The folder mirrors `Saved Games\DCS\`, so installing is a copy of `Scripts\`:

| File | Lua environment | Sends |
|---|---|---|
| `Scripts/SLATE/SLATE-export.lua` | export (loaded from `Export.lua`) | `own` 4× per second (position, grid and magnetic heading, grid-north point, IAS, TAS, Mach, vertical speed, velocity vector, fuel fraction, payload, gun, chaff/flare), `hello` every 30 s |
| `Scripts/Hooks/SLATE-hook.lua` | GUI hook | `session` on every change and every 5 s (mission, map, date, start time, own slot/side/unit type, player name), `missionCheck` once per mission load, `hello` |
| `Scripts/SLATE/lib/bridge.lua` | both | Version, settings, safe calls, UDP sender |
| `Scripts/SLATE/lib/json.lua` | both | JSON encoder |
| `test/harness.lua` | – (tests only, not installed) | Runs both scripts against a mocked DCS; used by `apps/host/src/dcs-bridge/lua-bridge.test.ts` |

- **Read-only.** Only `LoGet*` getters plus `LoLoCoordinatesToGeoCoordinates` on the export side, only `DCS.get*` / `DCS.is*` / `net.get_*` in the hook. No chat, no commands, nothing that changes the mission.
- **Coexists** with SRS, Tacview, Helios etc.: the export script keeps and calls the previous export callbacks; the hook registers its own callbacks.
- **Never breaks DCS:** every call is wrapped in `pcall`; at most 20 errors per session go to `dcs.log` (prefix `SLATE`).
- **Never blocks:** fire-and-forget UDP, no waiting, no file writes.
- Lives in `Saved Games` only – the DCS install is never touched, so the integrity check is unaffected.
- Optional `Scripts/SLATE/SLATE-config.lua` (`return { port = 7791 }`) changes the port; the app will write it once the port is a setting (removed with SLATE).

## Install

The app does it: **More → DCS → SLATE Lua files** lists every `DCS*` folder in Saved Games with Install, Repair and Remove (`apps/host/src/dcs-integration/`, `architecture.md` §1.2). It copies the four files, adds this block at the end of `Scripts\Export.lua` and backs `Export.lua` up to `%APPDATA%\SLATE\backups\` first:

```lua
-- SLATE BEGIN - managed by SLATE, do not edit
pcall(function() local lfs = require('lfs'); dofile(lfs.writedir() .. [[Scripts\SLATE\SLATE-export.lua]]) end)
-- SLATE END
```

A block added by hand before P1.3 (with an en dash after BEGIN) counts as installed. Hooks are read only at game start, so restart DCS after installing.

## Tests

`pnpm test` runs the harness when a Lua 5.1 interpreter is on the PATH (`lua5.1` or `lua`), and skips it otherwise; CI always runs it.
