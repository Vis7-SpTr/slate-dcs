# cas-relay

The SLATE relay (`protocol.md` §1–§7): coalition sessions, tokens, presence and status routing between the hosts of one group. The same code runs standalone (`slate-relay` on the server PC) and inside a host (host mode).

| File | What |
|---|---|
| `relay.ts` | The core: handshake, sessions, tokens, presence, status routing, resync. Knows no sockets – a transport hands it text frames and pongs (WSS server and host mode in P1.6c). State in memory only. |
| `codes.ts` | Session codes, participant IDs, tokens. |
| `relay-harness.ts` | Tests only: in-memory hosts that check every relay frame against the shared schemas. |
| `simulation.test.ts` | 8 pilots + 2 JTACs + 1 red player over 10 simulated minutes, with drop-outs and rejoins. |

Flights (§7) come in P1.6b; until then their messages answer `unsupported`.
