# session

The host's side of a session (`protocol.md` §2–§7, §14): joining a relay, keeping the `session`, `flight` and `traffic` slices, sending the own status, host mode, and discovery.

| File | What |
|---|---|
| `client.ts` | Relay client: join with the pinned fingerprint, rejoin with token + `lastSeq`, relay commands, status packages by the interval rule, `session.update` on slot changes; for discovery several addresses in order, one token key, `session.switch`. |
| `discovery.ts` | The DCS server's `[SLATE]` announcement (P1.7): only the server's lines, split lines joined, `session.announced`, auto-join when in no session, switch on a coalition change, `session.joinAnnounced`. |
| `link.ts` | WSS link with the fingerprint check in the TLS handshake; the direct link to the own relay in host mode. |
| `tokens.ts` | Fingerprint and token per relay address (`relays.json` in SLATE's data folder). Secret. |
| `host-mode.ts` | Runs the relay core inside the host (More → Session → Host a session). |
