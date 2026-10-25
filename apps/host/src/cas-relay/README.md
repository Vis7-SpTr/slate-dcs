# cas-relay

The SLATE relay (`protocol.md` §1–§7): coalition sessions, tokens, presence, status routing and flights between the hosts of one group. The same code runs standalone (`slate-relay` on the server PC) and inside a host (host mode).

| File | What |
|---|---|
| `relay.ts` | The core: handshake, sessions, tokens, presence, status routing, flights, resync. Knows no sockets – a transport hands it text frames and pongs (WSS server and host mode in P1.6c). State in memory only. |
| `codes.ts` | Session codes, participant IDs, tokens, flight IDs and private flight codes. |
| `config.ts` | The relay's files: `relay.json` (port, codes, public address, discovery settings), `cert.pem`, `key.pem` – created on the first start. |
| `tls.ts` | Self-signed certificate and its fingerprint (§3.1). |
| `server.ts` | The WSS transport (`/relay`), pings and the relay's clock. |
| `announce.ts` | Discovery on the server PC (P1.7, §2): installs the server hook into `dcsServerFolder` and writes the chat lines per coalition; empties them on stop. |
| `remote.ts` | A relay hosted somewhere else (25 Oct 2026): `--print-remote` prints the `remoteRelay` block; with `remoteRelay` set, the server PC only checks that relay, installs the hook and announces it, then exits – nothing listens there. |
| `relay-harness.ts` | Tests only: in-memory hosts that check every relay frame against the shared schemas. |
| `flights.test.ts` | Flights (§7), incl. -1 leaving or dropping out (§7.4). |
| `simulation.test.ts` | 8 pilots + 2 JTACs + 1 red player over 10 simulated minutes, with drop-outs and rejoins; then the 8 pilots in two flights of 4. |
