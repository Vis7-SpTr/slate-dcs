// SPDX-License-Identifier: GPL-3.0-or-later
// The host's copy of the CAS log (protocol.md §12.1, §12.3; P2.5): what the
// relay lets this player export – a JTAC his AO, a pilot his flight's
// missions and check-ins – fetched with `log.request` and kept in the
// `casLog` slice, so it stays readable when the relay is gone. After CAS
// messages it asks for what is new; entries are kept across AOs and flights.
// The screens export it with the shared Markdown/CSV functions (§12.5).

import type { CasLogSlice, LogEntry, Message } from '@slate-dcs/shared';

import type { StateStore } from '../state/store.js';

export interface LogScope {
  scope: 'ao' | 'flight';
  id: string;
}
type LogRequestBody = Extract<Message, { type: 'log.request' }>['body'];
type Entries = Extract<Message, { type: 'log.entries' }>['body'];

/** Sends one `log.request`; its answer or an error text. */
export type LogRequester = (body: LogRequestBody) => Promise<Entries | string>;

/** Entries kept in the host. */
const KEEP = 5000;
/** At most this many pages per fetch (500 each). */
const MAX_PAGES = 40;
/** Waits this long after a CAS message, so a burst is one request. */
const DEBOUNCE_MS = 750;

const key = (e: LogEntry) =>
  `${String(e.seq)}|${String(e.rts)}|${e.kind}|${e.pid ?? ''}|${e.summary}`;

export class CasLogCopy {
  readonly #store: StateStore;
  readonly #request: LogRequester;
  /** Per scope: the `seq` to ask from next. */
  readonly #from = new Map<string, number>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | null = null;
  #again = false;

  constructor(store: StateStore, request: LogRequester) {
    this.#store = store;
    this.#request = request;
  }

  /** After a CAS message: look for new entries soon. */
  changed(scope: () => LogScope | null): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      const target = scope();
      if (target) void this.sync(target);
    }, DEBOUNCE_MS);
  }

  /** A new session or relay: every scope is asked from the start again. */
  reset(): void {
    clearTimeout(this.#timer);
    this.#from.clear();
  }

  stop(): void {
    clearTimeout(this.#timer);
  }

  /** New entries of one scope since the last fetch; one at a time. */
  async sync(scope: LogScope): Promise<void> {
    if (this.#running) {
      this.#again = true;
      await this.#running;
      return;
    }
    const id = `${scope.scope}:${scope.id}`;
    this.#running = this.fetch({ ...scope, from: this.#from.get(id) ?? null, to: null }).then(
      (result) => {
        if (typeof result !== 'string' && result.last !== null) this.#from.set(id, result.last);
      },
    );
    try {
      await this.#running;
    } finally {
      this.#running = null;
    }
    if (this.#again) {
      this.#again = false;
      await this.sync(scope);
    }
  }

  /**
   * `log.request` (§12.3) through every page; the entries join the copy.
   * Returns the newest `seq` seen, or the relay's refusal as text.
   */
  async fetch(body: LogRequestBody): Promise<{ count: number; last: number | null } | string> {
    let from = body.from;
    let count = 0;
    let last: number | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const answer = await this.#request({ ...body, from });
      if (typeof answer === 'string') return answer;
      this.#merge(answer.entries);
      count += answer.entries.length;
      last = answer.entries.at(-1)?.seq ?? last;
      if (answer.next === null) break;
      from = answer.next;
    }
    return { count, last };
  }

  #merge(entries: readonly LogEntry[]): void {
    if (entries.length === 0) return;
    const slice: CasLogSlice = this.#store.get('casLog');
    const seen = new Set(slice.entries.map(key));
    const added = entries.filter((e) => !seen.has(key(e)));
    if (added.length === 0) return;
    const all = [...slice.entries, ...added].sort((a, b) => a.rts - b.rts || a.seq - b.seq);
    this.#store.update({ casLog: { entries: all.slice(-KEEP) } });
  }
}
