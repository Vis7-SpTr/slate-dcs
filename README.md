# SLATE — DCS EFB + JTAC/CAS Coordination

SLATE is a kneeboard app for [DCS World](https://www.digitalcombatsimulator.com/): it runs on your PC next to DCS, shows in a browser, in an [OpenKneeboard](https://openkneeboard.com/) web tab in VR, or on an iPad on your home network, and links the pilots and JTACs of a group through a small relay.

> **Status: prototype v0.1 (P1 – the foundation).** It works, but it is early: expect rough edges and breaking changes between versions. Feedback and bug reports are welcome (see [Reporting bugs](#reporting-bugs)).

SLATE is an independent fan project. It is not affiliated with or endorsed by Eagle Dynamics. DCS World is a trademark of Eagle Dynamics SA.

## What v0.1 does

- **Own aircraft, live from DCS** – position, headings, speeds, fuel, weapons per station, countermeasures, the DCS mission clock (Zulu/local). Read through a small Lua bridge in your Saved Games folder.
- **Sessions with your group** – join a relay with a session code, one session per coalition; see who is online; rejoin after a drop with the same identity.
- **Flights** – create or join a flight (open, or private with a code), positions, lead and move-up rules, the flight's fuel, weapons and status age.
- **Discovery** – on a DCS server that runs the relay or announces one hosted elsewhere, SLATE gets the relay address from the server's chat announcement and joins the right coalition by itself.
- **Several screens** – the same live state on every screen: browser, OpenKneeboard, and paired devices on your LAN (pair an iPad with a QR code).
- **Installer and updates** – per-user Windows installer, updates from GitHub Releases (never during a mission), clean uninstall.

**Not in v0.1 yet:** CAS (JTAC check-in, 9-lines, fire missions), the moving map, flight plans, EFB data and charts, checklists and the DTC editor. They follow in the next phases.

## Install (Windows)

1. Download `SLATE-win-Setup.exe` from the [latest release](https://github.com/Vis7-SpTr/slate-dcs/releases/latest) and run it – no admin rights needed. Windows SmartScreen warns about new programs that aren't code-signed yet: *More info → Run anyway*.
2. SLATE runs without a window and opens `http://127.0.0.1:7792/` in your browser. Use that address in an OpenKneeboard *Web Dashboard* tab.
3. **More → DCS**: install SLATE's Lua files into your DCS Saved Games folder, then restart DCS.
4. **More → Session**: join your group's relay (or let the server's announcement do it).

Updates, *Quit* and *Uninstall* are in **More → Settings → SLATE**. The log is `%APPDATA%\SLATE\logs\slate.log`.

### What SLATE changes on your PC

- **DCS:** only `Saved Games\<DCS folder>\Scripts\` – SLATE's own Lua files and one marked block in `Export.lua` (other tools' lines stay untouched; `Export.lua` is backed up first). Nothing in the DCS install folder, so the **integrity check is not affected**. The Lua side only reads; it never changes the mission.
- **Network:** the app listens on `127.0.0.1` only. LAN access for other devices is off until you switch it on (More → Settings → Screens on your network); then it asks once to add a Windows Firewall rule for the *Private* profile.
- **Files:** the program in `%LocalAppData%\SLATE`, your data (saved relays, paired devices, `Export.lua` backups, logs) in `%APPDATA%\SLATE`. *Uninstall* removes the Lua files and the firewall rule and keeps your data; *Uninstall and wipe data* deletes it too.

## Running a relay for your group

Download `slate-relay-<version>-<platform>` (Windows x64, Linux x64, Linux ARM64) from the release and follow the `README.txt` inside. In short: run it on the PC with your DCS server, forward one TCP port (7790), and set `dcsServerFolder` in `relay.json` – the relay then installs a small server hook that announces it in DCS chat and starts the relay with the DCS server. If no port can be opened on the DCS server's network, run the relay on another machine (a Raspberry Pi or a small VPS) and let the DCS server PC only announce it – `remoteRelay` in `relay.json`, see the `README.txt`; nothing then listens on the server PC.

## Reporting bugs

Open an [issue](https://github.com/Vis7-SpTr/slate-dcs/issues) with the SLATE version (More → Settings → SLATE), what you did, what happened, and the log (`%APPDATA%\SLATE\logs\slate.log`; for DCS problems also the `SLATE` lines from `Saved Games\<DCS folder>\Logs\dcs.log`). Please remove session codes and addresses you don't want to share. Security problems: see [SECURITY.md](SECURITY.md).

## Develop

Requirements: Node.js 24 LTS or newer, pnpm (version pinned in `package.json`), Git; Lua 5.1 for the Lua bridge tests (optional locally, required in CI).

```powershell
pnpm install          # install dependencies
pnpm start            # build the UI and start SLATE on http://127.0.0.1:7792 (use this URL in OKB)
pnpm start:demo       # the same with demo data (a running mission and an F/A-18C)
pnpm dev              # development: host + UI with hot reload on http://127.0.0.1:5173
pnpm dev:demo         # development with demo data
pnpm relay            # the standalone relay
pnpm check            # everything CI runs: format, lint, typecheck, test, SPDX + licence checks
pnpm test:watch       # tests in watch mode
pnpm format           # format all files with Prettier
```

| Folder | Purpose |
|---|---|
| `apps/web` | The UI (Svelte 5) for browser, OpenKneeboard and paired devices |
| `apps/host` | The local service: owns all state, serves the UI, Lua bridge receiver, relay client, the relay itself (standalone and host mode), LAN access, installer integration |
| `packages/shared` | Message schemas (Zod) and shared logic for UI, host and relay |
| `packages/dtc` | `.dtc` library (later phase) |
| `dcs/` | Lua for DCS – `export/` on each player's PC, `server-hook/` on the DCS server (Saved Games only) |
| `data/` | Static data (later phases) |
| `tools/` | Licence/SPDX checks and the release build (`tools/release/`) |

Code comments refer to design documents (`protocol.md`, `architecture.md`, `roadmap.md`, `ui-design.md`, …) by section. They are not public yet; a design overview for the repo will follow. The schemas in `packages/shared` are the reference for every message.

### Release

```powershell
pnpm release:app      # Windows: dist\release\slate-<version>-win-x64 (the folder vpk packs)
pnpm release:relay    # this machine's slate-relay folder + archive
```

Releases are built by `.github/workflows/release.yml` on a tag `v<version>` (the same as `package.json`); run it by hand for a test build (artifacts only). Details: `tools/release/build.mjs`. Changes per version: [CHANGELOG.md](CHANGELOG.md).

Every source file starts with `// SPDX-License-Identifier: GPL-3.0-or-later` (Lua: `-- SPDX-License-Identifier: GPL-3.0-or-later`); dependencies must be GPL-compatible (`pnpm check:licenses`). Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Copyright © 2026 Vis7 and contributors.

SLATE is free software under the [GNU General Public License v3.0 or later](LICENSE). Release builds include the licences of everything they bundle (`THIRD-PARTY-LICENSES.txt`).
