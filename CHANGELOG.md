# Changelog

SemVer for the app and the relay. Protocol and Lua bridge have their own version numbers (shown in More → DCS and in the relay log).

## 0.1.0 – prototype (P1)

First public version: the foundation everything else builds on.

- **DCS:** Lua bridge (bridge version 4) for own-aircraft data, payload, countermeasures and the mission clock; installed, checked, repaired and removed from More → DCS, with `Export.lua` backups; integrity-check safe.
- **App:** one host per PC that owns all state; UI for browser, OpenKneeboard and paired devices (status strip, Ownship, Session, Flight, Settings, DCS pages); demo mode.
- **Sessions and flights:** relay with per-coalition session codes, pinned TLS fingerprint, rejoin with token, status packages by an interval rule, flights (open/private, positions, lead, move-up after a drop).
- **Relay:** standalone `slate-relay` for Windows x64, Linux x64 and Linux ARM64, or host mode inside the app; tested with 8 pilots and 2 JTACs.
- **Discovery:** server hook that announces the relay in DCS chat and starts the relay with the DCS server – or announces a relay hosted elsewhere (`remoteRelay`, Raspberry Pi / VPS) with no open port on the server PC; the app joins the announced session by itself and follows coalition changes.
- **LAN access:** opt-in, Windows Firewall rule for the Private profile, QR pairing, devices listed and removable.
- **Installer:** per-user Windows installer (no window, opens in the browser), updates from GitHub Releases (never during a mission), uninstall that removes the Lua files and the firewall rule, optional wipe of the data folder.
