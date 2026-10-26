# session

The host's side of a session (`protocol.md` §2–§7, §14): joining a relay, keeping the `session`, `flight` and `traffic` slices, sending the own status, host mode, and discovery; from P2.5 the CAS client (§14.8): the `cas`, `missions`, `casLog` and `fuelCalls` slices and the CAS commands.

| File | What |
|---|---|
| `client.ts` | Relay client: join with the pinned fingerprint, rejoin with token + `lastSeq`, relay commands, status packages by the interval rule, `session.update` on slot changes (the slot decides the role); for discovery several addresses in order, one token key, `session.switch`. CAS (P2.5): `mt` on every message, CAS commands with `ack: true` and their ticks, `msg.received` for received `ack` messages. |
| `cas-state.ts` | The CAS picture from the relay's messages and `session.state` – AOs, map entries, holds and WILCOs, check-ins, situation notes, missions, fuel calls received, delivery ticks (P2.5). |
| `brief.ts` | The check-in brief draft: live fields from the flight until typed over, refreshed at sending (§9.1). |
| `fuel-calls.ts` | JOKER/BINGO: defaults per airframe, the prompt on the own dash, never sent automatically (§6.5). |
| `cas-log-copy.ts` | The host's copy of the CAS log, fetched with `log.request` (§12.1). |
| `cas-client.test.ts` | P2.5 done-when: a JTAC and a two-ship on one relay from check-in to BDA; slices unchanged after every link drops and rejoins. |
| `cas-state.test.ts` | The CAS picture, brief draft and log copy rule by rule. |
| `discovery.ts` | The DCS server's `[SLATE]` announcement (P1.7): only the server's lines, split lines joined, `session.announced`, auto-join when in no session, switch on a coalition change, `session.joinAnnounced`. |
| `link.ts` | WSS link with the fingerprint check in the TLS handshake; the direct link to the own relay in host mode. |
| `tokens.ts` | Fingerprint and token per relay address (`relays.json` in SLATE's data folder). Secret. |
| `host-mode.ts` | Runs the relay core inside the host (More → Session → Host a session). |
