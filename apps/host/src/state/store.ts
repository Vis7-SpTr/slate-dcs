// SPDX-License-Identifier: GPL-3.0-or-later
// The host's state store: owns all state, numbers every change (protocol.md §14.4).

import { SliceChanges } from '@slate-dcs/shared';
import type { SliceName, Slices } from '@slate-dcs/shared';

/** One change of the state: the slices it replaced and its sequence number. */
export interface StateChange {
  seq: number;
  slices: Partial<Slices>;
}

export type StateListener = (change: StateChange) => void;

/**
 * Holds all slices and a sequence number that grows by exactly 1 per change.
 * Screens never change state themselves; commands go through the host, which
 * calls `update` (architecture.md §1.1, Multiscreen).
 */
export class StateStore {
  #slices: Slices;
  #seq = 0;
  readonly #listeners = new Set<StateListener>();

  constructor(initial: Slices) {
    this.#slices = structuredClone(initial);
  }

  /** Current sequence number; 0 until the first change. */
  get seq(): number {
    return this.#seq;
  }

  /** A copy of the full state, for `state.snapshot`. */
  snapshot(): { seq: number; slices: Slices } {
    return { seq: this.#seq, slices: structuredClone(this.#slices) };
  }

  /** A copy of one slice. */
  get<K extends SliceName>(name: K): Slices[K] {
    return structuredClone(this.#slices[name]);
  }

  /**
   * Replaces one or more slices completely and tells every listener in one
   * change (protocol.md §14.2). Changes are validated, so a bug in the host
   * can't push broken state to the screens. Returns the new sequence number.
   */
  update(changes: Partial<Slices>): number {
    const valid = SliceChanges.parse(changes);
    this.#slices = { ...this.#slices, ...structuredClone(valid) };
    this.#seq += 1;
    const change: StateChange = { seq: this.#seq, slices: structuredClone(valid) };
    for (const listener of this.#listeners) listener(change);
    return this.#seq;
  }

  /** Calls `listener` on every change until the returned function is called. */
  subscribe(listener: StateListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
