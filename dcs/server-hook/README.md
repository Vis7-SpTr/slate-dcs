# dcs/server-hook

The dedicated server's hook (`architecture.md` §1.1 "Server side"). Optional: without it players join by hand (address and session code), everything else works the same.

- **P1.7 – discovery announcement** (`protocol.md` §2): `Scripts/Hooks/SLATE-server-hook.lua` sends a player the `[SLATE]` line of his coalition when he enters the mission and on every slot change, with `net.send_chat_to` – only to him. The client hook on his PC passes the line to his SLATE app, which joins by itself.
- **P6 – plugin data** (`protocol.md` §13): later, in the same hook.

## Install

Nothing to do by hand. Set `dcsServerFolder` in the relay's `relay.json` to the server's Saved Games folder (e.g. `C:\Users\<you>\Saved Games\DCS.server`). At every start `slate-relay`

1. copies `SLATE-server-hook.lua` to `<dcsServerFolder>\Scripts\Hooks\`, and
2. writes `<dcsServerFolder>\Scripts\SLATE\SLATE-announce.lua` with the lines for blue and red (public address, LAN address, coalition code, fingerprint).

When the relay stops it empties the lines, so the hook announces nothing while the relay is down. Restart the DCS server once after the first install so DCS loads the hook; after that the hook reads the file again for every announcement.

**Autostart** (decided 23 Oct 2026): the packaged `slate-relay` also writes `Scripts\SLATE\SLATE-relay.lua` – its own path, data folder and port. Whenever the DCS server loads a mission, the hook checks whether anything answers on that port on this PC and, if not, starts the relay (minimised console window, at most once a minute). So after the first manual start the relay comes up with the DCS server by itself. Turn it off with `"autoStartWithDcs": false` in `relay.json` (the file is then removed). It needs a relay folder and data folder whose paths are plain ASCII (e.g. `C:\SLATE\relay`) – DCS can't pass other characters on; the relay warns if so. Not for `pnpm relay` from the repo.

Optional `relay.json` keys: `lanAddress` (`ip:port`, if the server PC has several network adapters) and `announceMaxLength` (split the line if DCS cuts long chat lines – to check on the server PC, spike 3.5).

## Rules

- Lives under the **server's** Saved Games only – never in the DCS install folder, so the integrity check is not affected (C1).
- The chat line is its only write to the game (scope C3 exception); it reads nothing about players except their side. Starting `slate-relay` is a program start on the server PC, not a change to the mission.
- Runs only on a multiplayer server; every callback is wrapped in `pcall`.

Tested against a mocked DCS by `apps/host/src/dcs-bridge/lua-bridge.test.ts` (scenario `server` in `dcs/export/test/harness.lua`).
