// SPDX-License-Identifier: GPL-3.0-or-later
// Page and sub-tab of this screen, kept in the URL hash (#/ownship/aircraft).
// This is screen-local state (protocol.md §14.3): it's never sent to the host,
// survives a reload, and each screen navigates on its own.

export const PAGES = {
  map: ['layers', 'declutter', 'type', 'draw'],
  ownship: ['aircraft', 'flight', 'checkIn'],
  cas: ['flights', 'missions', 'other'],
  checklist: ['normal', 'emergency', 'custom'],
  more: ['plan', 'efb', 'dtc', 'log', 'session', 'settings', 'dcs'],
} as const;

export type PageId = keyof typeof PAGES;
export type SubTabId<P extends PageId = PageId> = (typeof PAGES)[P][number];

export const PAGE_IDS = Object.keys(PAGES) as PageId[];

/**
 * The sub-tabs a role sees (workflow compression): a pilot's CAS is one page,
 * so he has no separate Fire missions tab and checks in there, not on
 * Ownship. The hidden routes still work when opened directly.
 */
export function subTabsFor(page: PageId, role: string | null): readonly SubTabId[] {
  const all: readonly SubTabId[] = PAGES[page];
  if (role === 'jtac') return all;
  if (page === 'cas') return all.filter((id) => id !== 'missions');
  if (page === 'ownship') return all.filter((id) => id !== 'checkIn');
  return all;
}

/** Pages whose sub-tab row holds page controls, not tabs (ui-design.md §2). */
export const CONTROL_ROW_PAGES: readonly PageId[] = ['map'];

interface Route {
  page: PageId;
  sub: SubTabId;
}

const DEFAULT: Route = { page: 'map', sub: 'layers' };

function isPage(value: string | undefined): value is PageId {
  return value !== undefined && value in PAGES;
}

function parse(hash: string): Route {
  const [, page, sub] = hash.replace(/^#/, '').split('/');
  if (!isPage(page)) return DEFAULT;
  const subs: readonly string[] = PAGES[page];
  return { page, sub: (sub !== undefined && subs.includes(sub) ? sub : subs[0]) as SubTabId };
}

class Router {
  route: Route = $state(parse(location.hash));
  /** Last sub-tab per page, so switching main tabs comes back to it. */
  readonly #lastSub = new Map<PageId, SubTabId>();

  constructor() {
    window.addEventListener('hashchange', () => {
      this.route = parse(location.hash);
      this.#lastSub.set(this.route.page, this.route.sub);
    });
    this.#lastSub.set(this.route.page, this.route.sub);
  }

  go(page: PageId, sub?: SubTabId): void {
    const target = sub ?? this.#lastSub.get(page) ?? PAGES[page][0];
    location.hash = `#/${page}/${target}`;
  }
}

export const router = new Router();

/** Text key of a sub-tab: a pilot's CAS is one page under either CAS route. */
export function subTabKey(page: PageId, sub: SubTabId, role: string | null): string {
  return page === 'cas' && sub !== 'other' && role !== 'jtac'
    ? 'sub.cas.pilot'
    : `sub.${page}.${sub}`;
}
