// SPDX-License-Identifier: GPL-3.0-or-later
// Status routing (protocol.md §6.4): the full package to the own flight, a
// `status.position` to the rest of the session. JTAC check-ins (P2.2) add the
// full package to the JTACs of the AO the aircraft is checked in to.

import type { StatusUpdate } from '@slate-dcs/shared';

import { RELAY_FROM } from './core.js';
import type { Member, RelayCore } from './core.js';
import type { Flights } from './flights.js';

export class StatusRouter {
  readonly #core: RelayCore;
  readonly #flights: Flights;

  constructor(core: RelayCore, flights: Flights) {
    this.#core = core;
    this.#flights = flights;
  }

  route(member: Member, message: StatusUpdate): void {
    const core = this.#core;
    const session = core.sessions[member.session];
    const flight = member.flight;
    const mates = flight ? [...flight.slots.values()].filter((m) => m !== member) : [];
    if (flight && mates.length > 0) {
      member.lastFull = core.forward(
        session,
        {
          ...message,
          from: member.pid,
          session: member.session,
          to: { scope: 'flight', id: flight.id },
        },
        mates,
      );
    }
    const body = message.body;
    if (body.pos !== null) member.lastPos = { lat: body.pos.lat, lon: body.pos.lon };
    if (body.pos !== null) {
      const others = core
        .inSession(member.session)
        .filter((m) => m !== member && !mates.includes(m));
      member.lastPosition = core.publish(
        session,
        {
          type: 'status.position',
          from: RELAY_FROM,
          session: member.session,
          to: { scope: 'session' },
          body: {
            pid: member.pid,
            callsign: this.#flights.callsign(member),
            type: member.aircraft?.type ?? 'unknown',
            pos: body.pos,
            hdg: body.hdg,
            gs: body.gs,
          },
        },
        others,
        false,
      );
    }
    if (message.ack) core.receipt(member, message.id, session.seq);
  }
}
