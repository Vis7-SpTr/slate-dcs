# cas-relay

The SLATE relay (`protocol.md` §1–§7): coalition sessions, tokens, presence, status routing and flights between the hosts of one group. The same code runs standalone (`slate-relay` on the server PC) and inside a host (host mode).

| File | What |
|---|---|
| `relay.ts` | The core: handshake, sessions, tokens, presence, status routing, flights, resync. Knows no sockets – a transport hands it text frames and pongs (WSS server and host mode in P1.6c). State in memory only. |
| `codes.ts` | Session codes, participant IDs, tokens, flight IDs and private flight codes. |
| `relay-harness.ts` | Tests only: in-memory hosts that check every relay frame against the shared schemas. |
| `flights.test.ts` | Flights (§7), incl. -1 leaving or dropping out (§7.4). |
| `simulation.test.ts` | 8 pilots + 2 JTACs + 1 red player over 10 simulated minutes, with drop-outs and rejoins; then the 8 pilots in two flights of 4. |
