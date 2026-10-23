// SPDX-License-Identifier: GPL-3.0-or-later
// Discovery on the player's PC (P1.7, protocol.md §2, architecture.md
// "Discovery"): the client hook passes the server's `[SLATE]` chat lines on;
// this puts them together, shows the announcement (`session.announced`) and
// joins by itself – but only when not in a session already (decided 23 Oct
// 2026). Otherwise the screen offers "Join the server's session". While in a
// session joined this way, a re-announce with the other coalition's code
// moves it there (`session.switch`). The announcement is dropped when the
// mission stops (leaving the server, or the next mission).

import { announcedCoalition, AnnouncementReader, PROTOCOL_VERSION } from '@slate-dcs/shared';
import type { Announcement, BridgeChat, Command } from '@slate-dcs/shared';

import { failed } from '../commands/dispatcher.js';
import type { CommandOutcome } from '../commands/dispatcher.js';
import type { StateStore } from '../state/store.js';
import type { RelayClient } from './client.js';
import { normalizeAddress } from './link.js';

export interface DiscoveryLog {
  info(message: string): void;
  warn(message: string): void;
}

export interface DiscoveryOptions {
  store: StateStore;
  client: RelayClient;
  log: DiscoveryLog;
  now?: () => number;
  /**
   * Test only (`SLATE_DISCOVERY_ANY_SENDER=1`): also follow `[SLATE]` lines
   * that don't come from the server – in case DCS reports another sender for
   * `net.send_chat_to` than the hook expects (to check on the server, 3.5).
   */
  anySender?: boolean;
}

type JoinAnnounced = Extract<Command, { cmd: 'session.joinAnnounced' }>['args'];

/** The address token and fingerprint are kept under: the public one, if any. */
export function relayKey(a: Pick<Announcement, 'relay' | 'lan'>): string {
  return normalizeAddress(a.relay ?? a.lan ?? '');
}

export class Discovery {
  readonly #o: DiscoveryOptions;
  readonly #reader = new AnnouncementReader();
  readonly #now: () => number;
  #last: Announcement | null = null;
  #warnedPlayer = false;
  #warnedProtocol = false;
  readonly #unsubscribe: () => void;

  constructor(options: DiscoveryOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
    this.#unsubscribe = options.store.subscribe((change) => {
      if (change.slices.mission?.running !== false || this.#last === null) return;
      this.#last = null;
      queueMicrotask(() => {
        this.#o.store.update({ session: { ...this.#o.store.get('session'), announced: null } });
      });
    });
  }

  close(): void {
    this.#unsubscribe();
  }

  /** A `chat` datagram from the client hook. */
  handleChat(chat: BridgeChat): void {
    const sender = `from ${String(chat.from ?? '?')}, server ${String(chat.serverId ?? '?')}`;
    if (!chat.server && !this.#o.anySender) {
      // A player typed a [SLATE] line – never followed (it could point anywhere).
      if (!this.#warnedPlayer) {
        this.#warnedPlayer = true;
        this.#o.log.warn(
          `Ignored a [SLATE] chat line that did not come from the server (${sender}) – set SLATE_DISCOVERY_ANY_SENDER=1 to follow it anyway (test only)`,
        );
      }
      return;
    }
    if (!chat.server)
      this.#o.log.warn(`Following a [SLATE] line not from the server (${sender}) – test mode`);
    const announcement = this.#reader.feed(chat.text, this.#now());
    if (!announcement) return;
    if (announcement.protocol !== PROTOCOL_VERSION) {
      if (!this.#warnedProtocol) {
        this.#warnedProtocol = true;
        this.#o.log.warn(
          `The server announces SLATE protocol v${String(announcement.protocol)}, this SLATE speaks v${String(PROTOCOL_VERSION)} – update SLATE`,
        );
      }
      return;
    }
    this.#last = announcement;
    const coalition = announcedCoalition(announcement);
    this.#o.store.update({
      session: {
        ...this.#o.store.get('session'),
        announced: {
          relay: announcement.relay,
          lan: announcement.lan,
          code: announcement.code,
          coalition,
          fingerprint: announcement.fingerprint,
          receivedAt: this.#now(),
        },
      },
    });
    this.#o.log.info(
      `Server announces a SLATE relay: ${[announcement.lan, announcement.relay].filter(Boolean).join(' / ')} (${coalition})`,
    );
    void this.#follow(announcement);
  }

  /** `session.joinAnnounced`: the user joins the announced session (leaves the current one). */
  joinAnnounced(args: JoinAnnounced): Promise<CommandOutcome> {
    const a = this.#last;
    if (!a) return Promise.resolve(failed('notPossible', 'The server announced no session'));
    return this.#join(a, args.nick, args.role);
  }

  async #follow(a: Announcement): Promise<void> {
    const client = this.#o.client;
    const target = client.target;
    const key = relayKey(a);
    if (target === null) {
      if (client.declined === key) return; // left it on purpose: the button stays
      const nick = this.#o.store.get('mission').playerName;
      if (!nick) return; // no DCS player name yet: the button asks
      const outcome = await this.#join(a, nick.slice(0, 32), 'pilot');
      if (!outcome.ok)
        this.#o.log.warn(`Joining the announced session failed: ${outcome.error.text}`);
      return;
    }
    if (target.source === 'discovery' && target.key === key && target.code !== a.code) {
      const outcome = await client.switchTo(a.code);
      if (!outcome.ok) {
        this.#o.log.warn(
          `Switching to the ${announcedCoalition(a)} session failed: ${outcome.error.text}`,
        );
      }
    }
  }

  #join(a: Announcement, nick: string, role: string): Promise<CommandOutcome> {
    const addresses = [a.lan, a.relay].filter((x): x is string => x !== null);
    return this.#o.client.join(
      {
        address: addresses[0] ?? '',
        code: a.code,
        coalition: null,
        nick,
        role,
        fingerprint: a.fingerprint,
      },
      null,
      { addresses, key: relayKey(a) },
    );
  }
}
