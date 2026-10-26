// SPDX-License-Identifier: GPL-3.0-or-later
// JOKER / BINGO (protocol.md §6.5): never sent automatically. The pilot's
// levels for this sortie – bingo by default 2000 lbs fixed wing, 750 lbs
// rotary wing, joker off – and the prompt on his own dash when internal fuel
// reaches one. A new sortie (another aircraft) starts again from the defaults.

import { defaultBingoKg } from '@slate-dcs/shared';
import type { FuelCallsSlice } from '@slate-dcs/shared';

import type { StateStore } from '../state/store.js';

type Call = 'joker' | 'bingo';

/** Slots that aren't aircraft: no fuel calls. */
const NOT_AIRCRAFT = new Set(['forward_observer', 'artillery_commander', 'observer']);

/** Fuel this far above a level (refuelled) arms its prompt again. */
const REARM = 1.1;

export class FuelCalls {
  readonly #store: StateStore;
  readonly #now: () => number;
  /** The aircraft type of this sortie; `undefined` before the first look. */
  #sortie: string | null | undefined = undefined;
  /** A call may prompt again only once it's armed: after sending or dismissing it isn't. */
  readonly #armed: Record<Call, boolean> = { joker: true, bingo: true };

  constructor(store: StateStore, now: () => number) {
    this.#store = store;
    this.#now = now;
  }

  /** Once a second: a new sortie, then the prompt against internal fuel. */
  tick(): void {
    const ownship = this.#store.get('ownship');
    const type = ownship.aircraft?.type ?? null;
    if (type !== this.#sortie) {
      this.#sortie = type;
      this.#armed.joker = true;
      this.#armed.bingo = true;
      const aircraft = type !== null && !NOT_AIRCRAFT.has(type);
      this.#set({
        jokerKg: null,
        bingoKg: aircraft ? defaultBingoKg(type) : null,
        prompt: null,
        sent: [],
        received: this.#slice.received,
      });
    }
    const internal = ownship.status?.fuel?.internalKg;
    if (internal === undefined) return;
    const slice = this.#slice;
    for (const call of ['joker', 'bingo'] as const) {
      const level = slice[`${call}Kg`];
      if (level !== null && internal > level * REARM) this.#armed[call] = true;
    }
    const due = (call: Call) => {
      const level = slice[`${call}Kg`];
      return level !== null && internal <= level && this.#armed[call];
    };
    // Bingo first: it is the one that matters if both are reached.
    const prompt: Call | null = due('bingo') ? 'bingo' : due('joker') ? 'joker' : null;
    if (prompt !== slice.prompt) this.#set({ ...slice, prompt });
  }

  /** `fuel.setLevels`: this sortie's levels in kg; `null` = off. Both prompt again. */
  setLevels(jokerKg: number | null, bingoKg: number | null): void {
    this.#armed.joker = true;
    this.#armed.bingo = true;
    this.#set({ ...this.#slice, jokerKg, bingoKg });
    this.tick();
  }

  /** `fuel.dismiss`: the prompt goes; it comes back only after refuelling. */
  dismiss(): void {
    const slice = this.#slice;
    if (slice.prompt) this.#armed[slice.prompt] = false;
    this.#set({ ...slice, prompt: null });
  }

  /** The pilot sent a call (with or without a prompt). Bingo also settles joker. */
  sent(call: Call): void {
    this.#armed[call] = false;
    if (call === 'bingo') this.#armed.joker = false;
    const slice = this.#slice;
    const prompt = slice.prompt === call || call === 'bingo' ? null : slice.prompt;
    this.#set({ ...slice, prompt, sent: [...slice.sent, { call, at: this.#now() }] });
  }

  /** Internal fuel for a call, from the own status. */
  internalKg(): number | null {
    return this.#store.get('ownship').status?.fuel?.internalKg ?? null;
  }

  get #slice(): FuelCallsSlice {
    return this.#store.get('fuelCalls');
  }

  #set(slice: FuelCallsSlice): void {
    this.#store.update({ fuelCalls: slice });
  }
}
