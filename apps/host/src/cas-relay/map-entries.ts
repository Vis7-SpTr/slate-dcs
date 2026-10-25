// SPDX-License-Identifier: GPL-3.0-or-later
// Control measures, markers and keyholes (protocol.md §8.4, §8.5). Relay state:
// only this part changes them. Visibility is enforced here – an `ao` entry
// reaches only the AO's JTACs and the aircraft checked in to it.

import { PILOT_CM_KINDS } from '@slate-dcs/shared';
import type { ErrorCode, MapEntry, Message } from '@slate-dcs/shared';

import { newCmId } from './codes.js';
import { RELAY_FROM } from './core.js';
import type { AoRec, CmRec, Member, RelayCore } from './core.js';
import type { AoListener, Aos } from './aos.js';

type Fail = (code: ErrorCode, text: string) => void;
type Draft = Extract<Message, { type: 'cm.create' }>['body'];

export class MapEntries implements AoListener {
  readonly #core: RelayCore;
  readonly #aos: Aos;
  readonly #entries = new Map<string, CmRec>();
  readonly #inUse: ((cmId: string) => boolean)[] = [];

  constructor(core: RelayCore, aos: Aos) {
    this.#core = core;
    this.#aos = aos;
    aos.listen(this);
  }

  /** Adds a check for "an open mission or hold refers to it" (P2.2, P2.3). */
  addInUseCheck(check: (cmId: string) => boolean): void {
    this.#inUse.push(check);
  }

  get(cmId: string): CmRec | null {
    return this.#entries.get(cmId) ?? null;
  }

  /** Who may see an entry (§8.4): the coalition, or the AO's JTACs and checked-in aircraft. */
  viewers(rec: CmRec): Member[] {
    if (rec.entry.visibility === 'coalition') return this.#core.inSession(rec.session);
    const ao = this.#aos.get(rec.entry.aoId);
    return ao ? this.#aos.audience(ao) : [];
  }

  /** Every entry he may see, for `session.state`. */
  visibleTo(member: Member): MapEntry[] {
    return [...this.#entries.values()]
      .filter((rec) => rec.session === member.session && this.viewers(rec).includes(member))
      .map((rec) => rec.entry);
  }

  /** The AO's `ao`-only entries, e.g. for a flight checking in (P2.2). */
  aoOnly(ao: AoRec): MapEntry[] {
    return [...this.#entries.values()]
      .filter((rec) => rec.entry.aoId === ao.id && rec.entry.visibility === 'ao')
      .map((rec) => rec.entry);
  }

  // -------------------------------------------------------------------------
  // Messages

  create(member: Member, message: Extract<Message, { type: 'cm.create' }>): void {
    const fail: Fail = (code, text) => {
      this.#core.error(member.conn, code, text, message.id);
    };
    const draft = message.body;
    if (!this.#allowed(member, draft, fail)) return;
    if (draft.aoId !== null && member.role === 'jtac' && member.ao?.id !== draft.aoId) {
      fail('forbidden', 'Draw into the AO you are working');
      return;
    }
    const entry = {
      ...draft,
      cmId: newCmId((id) => this.#entries.has(id)),
      author: member.pid,
    };
    const rec: CmRec = { entry, session: member.session };
    this.#entries.set(entry.cmId, rec);
    this.#send('cm.created', rec, withMember(this.viewers(rec), member), message.id);
  }

  /** The full new content (§8.6). The kind and the AO it belongs to stay. */
  update(member: Member, message: Extract<Message, { type: 'cm.update' }>): void {
    const fail: Fail = (code, text) => {
      this.#core.error(member.conn, code, text, message.id);
    };
    const rec = this.#own(member, message.body.cmId, fail);
    if (!rec) return;
    const draft = message.body.entry;
    if (draft.kind !== rec.entry.kind || draft.aoId !== rec.entry.aoId) {
      fail('badMessage', 'An entry keeps its kind and its AO');
      return;
    }
    if (!this.#allowed(member, draft, fail)) return;
    const before = this.viewers(rec);
    rec.entry = { ...draft, cmId: rec.entry.cmId, author: rec.entry.author };
    const after = this.viewers(rec);
    // Visibility changed: who no longer sees it gets `hidden`, who newly does
    // gets it as new, everyone else the update – and the editor his answer.
    const lost = before.filter((m) => !after.includes(m) && m !== member);
    const gained = after.filter((m) => !before.includes(m) && m !== member);
    const stayed = withMember(
      after.filter((m) => before.includes(m)),
      member,
    );
    this.#deleted(rec, lost, true, null);
    this.#send('cm.created', rec, gained, null);
    this.#send('cm.updated', rec, stayed, message.id);
  }

  delete(member: Member, message: Extract<Message, { type: 'cm.delete' }>): void {
    const fail: Fail = (code, text) => {
      this.#core.error(member.conn, code, text, message.id);
    };
    const rec = this.#own(member, message.body.cmId, fail);
    if (!rec) return;
    if (this.#inUse.some((check) => check(rec.entry.cmId))) {
      fail('inUse', 'An open mission or hold refers to it');
      return;
    }
    const viewers = withMember(this.viewers(rec), member);
    this.#entries.delete(rec.entry.cmId);
    this.#deleted(rec, viewers, false, message.id);
  }

  // -------------------------------------------------------------------------
  // AO events

  /** A JTAC joining an AO gets its `ao`-only entries. */
  joined(member: Member, ao: AoRec): void {
    for (const rec of this.#tiedTo(ao)) {
      if (rec.entry.visibility === 'ao') this.#send('cm.created', rec, [member], null);
    }
  }

  /** A JTAC going off-station but staying in the session no longer sees them. */
  left(member: Member, ao: AoRec, stays: boolean): void {
    if (!stays) return;
    for (const rec of this.#tiedTo(ao)) {
      if (rec.entry.visibility === 'ao' && !this.viewers(rec).includes(member)) {
        this.#deleted(rec, [member], true, null);
      }
    }
  }

  /** The AO closed: everything tied to it goes; hosts drop it on `ao.closed` (§8.6). */
  closed(ao: AoRec): void {
    for (const rec of this.#tiedTo(ao)) this.#entries.delete(rec.entry.cmId);
  }

  // -------------------------------------------------------------------------

  /**
   * Who may draw what (§8.4): pilots friendly, threat and enemy entries,
   * always coalition-wide and never tied to an AO; an `ao` entry needs an AO.
   */
  #allowed(member: Member, draft: Draft, fail: Fail): boolean {
    if (member.role !== 'jtac') {
      if (!PILOT_CM_KINDS.has(draft.kind)) {
        fail('forbidden', 'Pilots draw friendly positions, threat and enemy markers');
        return false;
      }
      if (draft.aoId !== null || draft.visibility !== 'coalition') {
        fail('forbidden', 'Entries drawn by pilots are coalition-wide');
        return false;
      }
    }
    if (draft.aoId === null && draft.visibility === 'ao') {
      fail('badMessage', 'An AO-only entry belongs to an AO');
      return false;
    }
    const ao = this.#aos.get(draft.aoId);
    if (draft.aoId !== null && ao?.session !== member.session) {
      fail('badCode', 'No such AO');
      return false;
    }
    return true;
  }

  /**
   * The entry, if he may change it (§8.4): the JTAC in command of its AO may
   * change every entry tied to it; everyone else only his own.
   */
  #own(member: Member, cmId: string, fail: Fail): CmRec | null {
    const rec = this.#entries.get(cmId);
    if (rec?.session !== member.session) {
      fail('badCode', 'No such map entry');
      return null;
    }
    const ao = this.#aos.get(rec.entry.aoId);
    const commands = ao !== null && this.#aos.inCommand(ao) === member;
    if (rec.entry.author !== member.pid && !commands) {
      fail('forbidden', 'Only its author or the JTAC in command of its AO');
      return null;
    }
    return rec;
  }

  #tiedTo(ao: AoRec): CmRec[] {
    return [...this.#entries.values()].filter((rec) => rec.entry.aoId === ao.id);
  }

  #send(
    type: 'cm.created' | 'cm.updated',
    rec: CmRec,
    to: readonly Member[],
    re: string | null,
  ): void {
    if (to.length === 0) return;
    const core = this.#core;
    core.publish(
      core.sessions[rec.session],
      {
        type,
        from: RELAY_FROM,
        session: rec.session,
        to: { scope: 'session' },
        body: rec.entry,
        re,
      },
      to,
      true,
    );
  }

  #deleted(rec: CmRec, to: readonly Member[], hidden: boolean, re: string | null): void {
    if (to.length === 0) return;
    const core = this.#core;
    core.publish(
      core.sessions[rec.session],
      {
        type: 'cm.deleted',
        from: RELAY_FROM,
        session: rec.session,
        to: { scope: 'session' },
        body: { cmId: rec.entry.cmId, hidden },
        re,
      },
      to,
      true,
    );
  }
}

/** The list plus `member`, once. */
function withMember(list: readonly Member[], member: Member): Member[] {
  return list.includes(member) ? [...list] : [...list, member];
}
