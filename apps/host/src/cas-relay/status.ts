// SPDX-License-Identifier: GPL-3.0-or-later
// Status routing (protocol.md §6.4): the full package to the own flight and the
// JTACs of the AO it is checked in to, a `status.position` to everyone else.

import type { StatusUpdate } from '@slate-dcs/shared';

import { RELAY_FROM } from './core.js';
import type { Member, RelayCore } from './core.js';
import type { CheckIns } from './checkins.js';
import type { Flights } from './flights.js';

export class StatusRouter {
  readonly #core: RelayCore;
  readonly #flights: Flights;
  readonly #checkIns: CheckIns;

  constructor(core: RelayCore, parts: { flights: Flights; checkIns: CheckIns }) {
    this.#core = core;
    this.#flights = parts.flights;
    this.#checkIns = parts.checkIns;
  }

  route(member: Member, message: StatusUpdate): void {
    const core = this.#core;
    const session = core.sessions[member.session];
    const flight = member.flight;
    // In full to his flight and to the JTACs of the AO it is checked in to (§6.4).
    const full = [
      ...new Set([
        ...(flight ? [...flight.slots.values()] : []),
        ...this.#checkIns.jtacsOf(member),
      ]),
    ].filter((m) => m !== member);
    if (flight && full.length > 0) {
      member.lastFull = core.forward(
        session,
        {
          ...message,
          from: member.pid,
          session: member.session,
          to: { scope: 'flight', id: flight.id },
        },
        full,
      );
    }
    const body = message.body;
    if (body.pos !== null) member.lastPos = { lat: body.pos.lat, lon: body.pos.lon };
    if (body.pos !== null) {
      const others = core
        .inSession(member.session)
        .filter((m) => m !== member && !full.includes(m));
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
  }
}
