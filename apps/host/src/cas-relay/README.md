# cas-relay

The SLATE relay (`protocol.md` §1–§7, CAS §8–§12 from P2): coalition sessions, tokens, presence, status routing and flights between the hosts of one group; AOs and map entries (P2.1), check-ins and holds (P2.2), missions and the CAS log (P2.3, P2.4) have their own files on top of `core.ts`. The same code runs standalone (`slate-relay` on the server PC) and inside a host (host mode).

| File | What |
|---|---|
| `relay.ts` | The relay a transport talks to (WSS server, host mode, tests): takes text frames and pongs, checks each message and the rate limit, and hands it to its part. Knows no sockets. Split into the files below at the start of P2.1 (25 Oct 2026; code moved only). |
| `core.ts` | The session core every part shares: connections, participants, coalition sessions, `seq`, the replay buffer, and the outbound helpers (publish to chosen members – also one variant per recipient –, forward unchanged, direct control messages, receipts, errors). State in memory only. |
| `sessions.ts` | Handshake, join with token check, coalition switch, slot updates, leaving, presence and expiry, the snapshot and catch-up on join (§3–§5). |
| `status.ts` | Status routing (§6.4): the full package to the own flight, `status.position` to everyone else. |
| `flights.ts` | Flights (§7): create, join, leave, move, move up, command, end of a flight. |
| `aos.ts` | JTAC on-station and AOs (§8.1–§8.3, P2.1): new AO or join by code, command order, `ao.update`, off-station (also by leaving, switching, an aircraft slot, expiry), closing. The join code only for JTACs. Other parts hear about joins, off-station and closing (`AoListener`) and can add to the AO's audience (checked-in aircraft, P2.2). |
| `map-entries.ts` | Control measures, markers and keyholes (§8.4, §8.5, P2.1): who may draw and change what, visibility (`ao` = the AO's audience), `hidden` when an entry disappears for someone, `inUse` checks (holds, missions – P2.2/P2.3). |
| `checkins.ts` | Check-in (§9.2, P2.2): lands in an AO, a picked JTAC as primary; check-out, release, `aoClosed`, `flightClosed`; checked-in flights join the AO's audience; situation update and COPY (§9.3); fuel calls (§6.5). |
| `holds.ts` | Holds and the holding stack (§9.4, P2.2): assign, change, cancel, WILCO; overlaps flagged on both holds; visibility like map entries; a check-out takes the flight's holds along. |
| `codes.ts` | Session codes, participant IDs, tokens, flight IDs and private flight codes. |
| `config.ts` | The relay's files: `relay.json` (port, codes, public address, discovery settings), `cert.pem`, `key.pem` – created on the first start. |
| `tls.ts` | Self-signed certificate and its fingerprint (§3.1). |
| `server.ts` | The WSS transport (`/relay`), pings and the relay's clock. |
| `announce.ts` | Discovery on the server PC (P1.7, §2): installs the server hook into `dcsServerFolder` and writes the chat lines per coalition; empties them on stop. |
| `remote.ts` | A relay hosted somewhere else (25 Oct 2026): `--print-remote` prints the `remoteRelay` block; with `remoteRelay` set, the server PC only checks that relay, installs the hook and announces it, then exits – nothing listens there. |
| `relay-harness.ts` | Tests only: in-memory hosts that check every relay frame against the shared schemas. |
| `flights.test.ts` | Flights (§7), incl. -1 leaving or dropping out (§7.4). |
| `aos.test.ts` | JTAC on-station, AO command, off-station rules, map entry visibility and rights, the mission-time anchor (P2.1). |
| `checkins.test.ts` | Check-in, who sees whose full status (§6.4), situation update, fuel calls, holds and their conflicts, receipts and level-2 confirmations (P2.2). |
| `simulation.test.ts` | 8 pilots + 2 JTACs + 1 red player over 10 simulated minutes, with drop-outs and rejoins; then the 8 pilots in two flights of 4. |
