# SLATE — DCS EFB + JTAC/CAS Coordination

Local web app for DCS World, viewable in a browser or OpenKneeboard.

## Modules
- **EFB** — frequencies, VFR/IFR charts, airfield/waypoint info, terrain, weather
- **CAS** — JTAC ↔ pilot check-in, fire missions, assignment, 2-way nav/coords, TGP export
- **Checklists** — interactive, pilot ticks each step manually
- **DTC** — pre-flight build/edit of native .dtc files

## Constraints
- Min. 8 pilots + 2 JTACs per session
- Runs locally on each PC; only CAS data packages are exchanged
- Optional hybrid mode with a DCS server plugin for extra data
- DCS connection read-only; never breaks the integrity check

## Layout
| Folder | Purpose |
|---|---|
| apps/web | Browser / OpenKneeboard UI |
| apps/host | Local service: serves UI, session hub, CAS relay, DCS bridge |
| packages/shared | Data models, CAS message protocol, coordinate math |
| packages/dtc | .dtc read/write library |
| dcs/ | Optional read-only DCS Lua hooks (Saved Games only) |
| data/ | Static data: airfields, frequencies, charts, checklists, DTC templates |
| tools/ | Data import / build scripts |
| tests/ | Cross-module and integration tests |

## Develop

Requirements: Node.js 24 LTS or newer, pnpm (version pinned in `package.json`), Git.

```powershell
pnpm install          # install dependencies
pnpm check            # everything CI runs: format, lint, typecheck, test, SPDX + licence checks
pnpm test:watch       # tests in watch mode
pnpm format           # format all files with Prettier
```

Every source file starts with `// SPDX-License-Identifier: GPL-3.0-or-later` (Lua: `-- SPDX-License-Identifier: GPL-3.0-or-later`).

## Licence

SLATE is free software under the [GNU General Public License v3.0 or later](LICENSE).
