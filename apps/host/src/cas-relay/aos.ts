// SPDX-License-Identifier: GPL-3.0-or-later
// JTAC on-station and AOs (protocol.md §8.1–§8.3). AOs are relay state: only
// this part changes them, and it tells the session with `ao.created` /
// `ao.updated` / `ao.closed`. The join code goes only to participants with
// the JTAC role.

import { Ao, AO_RULES } from '@slate-dcs/shared';
import type { AoSpec, ErrorCode, Message } from '@slate-dcs/shared';
import { z } from 'zod';

import { newAoId, newPrivateCode } from './codes.js';
import { RELAY_FROM } from './core.js';
import type { AoArea, AoRec, Member, RelayCore } from './core.js';

/** What other parts need to know about AOs (map entries now, check-ins in P2.2). */
export interface AoListener {
  /** A JTAC came on-station in this AO – a new one or by join code. */
  joined?(member: Member, ao: AoRec): void;
  /** A JTAC went off-station; `stays` = he is still in the session. */
  left?(member: Member, ao: AoRec, stays: boolean): void;
  /** The AO closed: its last JTAC went off-station. Everything tied to it goes. */
  closed?(ao: AoRec): void;
}

type Fail = (code: ErrorCode, text: string) => void;

export class Aos {
  readonly #core: RelayCore;
  readonly #aos = new Map<string, AoRec>();
  readonly #listeners: AoListener[] = [];
  readonly #audiences: ((ao: AoRec) => Member[])[] = [];

  constructor(core: RelayCore) {
    this.#core = core;
  }

  listen(listener: AoListener): void {
    this.#listeners.push(listener);
  }

  /** Adds who else counts as "in the AO" – the checked-in aircraft (P2.2). */
  addAudience(audience: (ao: AoRec) => Member[]): void {
    this.#audiences.push(audience);
  }

  get(aoId: string | null): AoRec | null {
    return aoId === null ? null : (this.#aos.get(aoId) ?? null);
  }

  all(): AoRec[] {
    return [...this.#aos.values()];
  }

  /** The first JTAC in joining order who is online (§8.3); `null` while all are lost. */
  inCommand(ao: AoRec): Member | null {
    return ao.jtacs.find((jtac) => jtac.member.presence === 'online')?.member ?? null;
  }

  /** Everyone working the AO or checked in to it (§1.1 `ao`), who hasn't left. */
  audience(ao: AoRec): Member[] {
    const members = new Set(ao.jtacs.map((jtac) => jtac.member));
    for (const more of this.#audiences) for (const m of more(ao)) members.add(m);
    return [...members].filter((m) => m.presence !== 'left');
  }

  // -------------------------------------------------------------------------
  // Messages

  onStation(member: Member, message: Extract<Message, { type: 'jtac.onStation' }>): void {
    const core = this.#core;
    const fail: Fail = (code, text) => {
      core.error(member.conn, code, text, message.id);
    };
    if (member.role !== 'jtac') {
      fail('forbidden', 'Only a JTAC goes on-station');
      return;
    }
    if (member.ao) {
      fail('alreadyOnStation', `Already on-station in ${member.ao.name} – go off-station first`);
      return;
    }
    const body = message.body;
    const jtac = { member, callsign: body.callsign, since: core.now(), freqs: body.freqs };

    if ('joinCode' in body && body.joinCode !== undefined) {
      const ao = this.all().find(
        (a) => a.session === member.session && a.joinCode === body.joinCode,
      );
      if (!ao) {
        fail('badCode', 'No AO with that join code');
        return;
      }
      ao.jtacs.push(jtac);
      member.ao = ao;
      this.#updated(ao, message.id);
      for (const listener of this.#listeners) listener.joined?.(member, ao);
      core.log?.info(`${core.who(member)} joined ${ao.name} (${ao.id})`);
      return;
    }

    const spec: AoSpec = ('ao' in body ? body.ao : null) ?? {};
    const area = this.#area(spec, null, member, fail);
    if (!area) return;
    const codes = new Set(this.all().map((a) => a.joinCode));
    const ao: AoRec = {
      id: newAoId((id) => this.#aos.has(id)),
      joinCode: newPrivateCode((code) => codes.has(code)),
      session: member.session,
      name: spec.name ?? `AO ${body.callsign.toUpperCase()}`.slice(0, 32),
      area,
      jtacs: [jtac],
    };
    if (!this.#valid(ao, member, fail)) return;
    this.#aos.set(ao.id, ao);
    member.ao = ao;
    core.publish(
      core.sessions[ao.session],
      (viewer) => ({
        type: 'ao.created',
        from: RELAY_FROM,
        session: ao.session,
        to: { scope: 'session' },
        body: this.view(ao, viewer),
        re: message.id,
      }),
      core.inSession(ao.session),
      true,
    );
    for (const listener of this.#listeners) listener.joined?.(member, ao);
    core.log?.info(`${core.who(member)} on-station: new ${ao.name} (${ao.id})`);
  }

  /** `ao.update` – the JTAC in command only (§8.3). `center: null` = recenter on his position. */
  update(member: Member, message: Extract<Message, { type: 'ao.update' }>): void {
    const fail: Fail = (code, text) => {
      this.#core.error(member.conn, code, text, message.id);
    };
    const ao = this.get(message.body.aoId);
    if (!ao || member.ao !== ao) {
      fail('forbidden', 'Not on-station in this AO');
      return;
    }
    if (this.inCommand(ao) !== member) {
      fail('forbidden', 'Only the JTAC in command changes the AO');
      return;
    }
    const { changes } = message.body;
    const area = this.#area(changes, ao.area, member, fail);
    if (!area) return;
    const next: AoRec = { ...ao, area, name: changes.name ?? ao.name };
    if (!this.#valid(next, member, fail)) return;
    ao.area = area;
    ao.name = next.name;
    this.#updated(ao, message.id);
  }

  offStation(member: Member, message: Extract<Message, { type: 'jtac.offStation' }>): void {
    if (member.ao?.id !== message.body.aoId) {
      this.#core.error(member.conn, 'forbidden', 'Not on-station in this AO', message.id);
      return;
    }
    this.leave(member, message.id, true);
  }

  // -------------------------------------------------------------------------
  // Hooks from the session part

  /**
   * Takes a JTAC off-station (§8.2, §8.3): he leaves the order of command for
   * good, the next JTAC takes over; the last one out closes the AO.
   */
  leave(member: Member, re: string | null, stays: boolean): void {
    const ao = member.ao;
    if (!ao) return;
    ao.jtacs = ao.jtacs.filter((jtac) => jtac.member !== member);
    member.ao = null;
    for (const listener of this.#listeners) listener.left?.(member, ao, stays);
    const core = this.#core;
    if (ao.jtacs.length > 0) {
      this.#updated(ao, re);
      core.log?.info(`${core.who(member)} off-station from ${ao.name}`);
      return;
    }
    this.#aos.delete(ao.id);
    for (const listener of this.#listeners) listener.closed?.(ao);
    core.publish(
      core.sessions[ao.session],
      {
        type: 'ao.closed',
        from: RELAY_FROM,
        session: ao.session,
        to: { scope: 'session' },
        body: { aoId: ao.id },
        re,
      },
      core.inSession(ao.session),
      true,
    );
    core.log?.info(`${core.who(member)} off-station: ${ao.name} closed`);
  }

  /**
   * His presence changed (§8.3): `left` takes him off-station; lost or back
   * changes who is in command, so the session gets the AO again. `skip`
   * doesn't get it (he just got the state).
   */
  presenceChanged(member: Member, presence: Member['presence'], skip: Member | null): void {
    const ao = member.ao;
    if (!ao) return;
    if (presence === 'left') this.leave(member, null, false);
    else this.#updated(ao, null, skip);
  }

  /**
   * His role changed (slot change, §5): an aircraft slot takes a JTAC
   * off-station, and the join codes he may see change, so he gets every AO again.
   */
  roleChanged(member: Member, before: string, re: string | null): void {
    if (before === member.role) return;
    if (member.ao && member.role !== 'jtac') this.leave(member, re, true);
    const core = this.#core;
    for (const ao of this.all().filter((a) => a.session === member.session)) {
      core.publish(
        core.sessions[ao.session],
        {
          type: 'ao.updated',
          from: RELAY_FROM,
          session: ao.session,
          to: { scope: 'session' },
          body: this.view(ao, member),
          re,
        },
        [member],
        true,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Views

  /** The AO as one participant sees it: the join code only for JTACs (§8.1). */
  view(ao: AoRec, viewer: Member): Ao {
    return {
      aoId: ao.id,
      joinCode: viewer.role === 'jtac' ? ao.joinCode : null,
      name: ao.name,
      ...ao.area,
      jtacs: ao.jtacs.map((jtac) => ({
        pid: jtac.member.pid,
        callsign: jtac.callsign,
        since: jtac.since,
        presence: jtac.member.presence === 'online' ? 'online' : 'lost',
        freqs: jtac.freqs,
      })),
      inCommand: this.inCommand(ao)?.pid ?? null,
    };
  }

  /** Every AO of his session as he sees it, for `session.state`. */
  views(viewer: Member): Ao[] {
    return this.all()
      .filter((ao) => ao.session === viewer.session)
      .map((ao) => this.view(ao, viewer));
  }

  /** `ao.updated` to the session (each with his own view), minus `skip`. */
  #updated(ao: AoRec, re: string | null, skip: Member | null = null): void {
    const core = this.#core;
    core.publish(
      core.sessions[ao.session],
      (viewer) => ({
        type: 'ao.updated',
        from: RELAY_FROM,
        session: ao.session,
        to: { scope: 'session' },
        body: this.view(ao, viewer),
        re,
      }),
      core.inSession(ao.session).filter((m) => m !== skip),
      true,
    );
  }

  /**
   * The area after a spec (new AO) or changes (update), with the defaults
   * (§8.1): circle of 10 NM, floor SFC, ceiling FL200 until set; the centre at
   * his position when not given (new AO) or given as `null` (Recenter).
   * Fields the type doesn't use are cleared.
   */
  #area(spec: AoSpec, base: AoArea | null, member: Member, fail: Fail): AoArea | null {
    const type = spec.type ?? base?.type ?? 'circle';
    // A field given in the spec wins, then the AO's current value, then the default.
    const pick = <K extends keyof AoArea>(key: K, fallback: AoArea[K]): AoArea[K] =>
      (spec as Partial<AoArea>)[key] ?? base?.[key] ?? fallback;
    let center = pick('center', null);
    const recenter = spec.center === null || (base === null && spec.center === undefined);
    if (type !== 'polygon' && (recenter || center === null)) {
      center = member.lastPos;
      if (center === null) {
        fail('badMessage', 'No position yet – enter the AO centre or your position first');
        return null;
      }
    }
    const area: AoArea = {
      type,
      center: type === 'polygon' ? null : center,
      radiusM: type === 'circle' ? pick('radiusM', AO_RULES.defaultRadiusM) : null,
      lengthM: type === 'square' ? pick('lengthM', null) : null,
      widthM: type === 'square' ? pick('widthM', null) : null,
      headingDeg: type === 'square' ? pick('headingDeg', 0) : null,
      points: type === 'polygon' ? pick('points', null) : null,
      floor: pick('floor', { ...AO_RULES.defaultFloor }),
      ceiling: spec.ceiling ?? base?.ceiling ?? { ...AO_RULES.defaultCeiling },
    };
    return area;
  }

  /** Checks a new or changed AO against the shared schema (area rules, block). */
  #valid(ao: AoRec, viewer: Member, fail: Fail): boolean {
    const parsed = Ao.safeParse(this.view(ao, viewer));
    if (!parsed.success) fail('badMessage', z.prettifyError(parsed.error));
    return parsed.success;
  }
}
