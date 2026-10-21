# dcs-bridge

The host side of the Lua bridge (`protocol.md` §6.1, `architecture.md` §1.1). Read-only: it only listens; nothing is ever sent to DCS.

| File | Job |
|---|---|
| `receiver.ts` | UDP socket on `127.0.0.1:7791` (`SLATE_BRIDGE_PORT`) |
| `service.ts` | Reads the datagrams, keeps the `host.bridge`, `mission` and `ownship` slices up to date, logs what arrives |
| `convert.ts` | Raw DCS values → SLATE units: true heading, ground speed, fuel weight |
| `payload.ts` | Payload → armament: weapon kind from the type code, names for pods and tanks |
| `ownship.ts` | Own status from export values plus manual overrides |

The Lua side lives in `dcs/export/`.
