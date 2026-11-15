// SPDX-License-Identifier: GPL-3.0-or-later
// The on-screen keyboard's state (ui-design.md §11, P2.7d): whether it is on
// for this screen, which field it types into, and the editing itself. A key
// press changes the field like typing would (an `input` event), so every
// form's own `bind:value` and checks keep working; nothing is ever sent by the
// keyboard. The setting is this screen's own (browser storage), like the OKB
// page size.

import { fieldLayout, fits } from './osk-layout.js';
import type { OskField } from './osk-layout.js';
import { okb } from './okb.svelte.js';

export type OskMode = 'auto' | 'always' | 'off';

type Field = HTMLInputElement | HTMLTextAreaElement;

const STORAGE_KEY = 'slate.osk';

function loadMode(): OskMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'always' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** A text field the keyboard can type into (not checkboxes, not read-only). */
export function isTextField(el: EventTarget | null): el is Field {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (!(el instanceof HTMLInputElement)) return false;
  const textual = ['text', 'search', 'tel', 'url', 'email', ''].includes(el.type);
  return textual && !el.readOnly && !el.disabled;
}

class Osk {
  mode: OskMode = $state(loadMode());
  /** The field being typed into; `null` = closed. */
  field: Field | null = $state(null);
  layout: OskField = $state({ layout: 'letters', dot: true, minus: true });
  /** Text before the caret (for the laser rule), refreshed after every change. */
  before = $state('');
  abc = $state(false);
  upper = $state(true);
  #original = '';
  #inputMode: string | null = null;

  /** On for this screen: always, or automatically inside OpenKneeboard. */
  get enabled(): boolean {
    return this.mode === 'always' || (this.mode === 'auto' && okb.present);
  }

  setMode(mode: OskMode): void {
    this.mode = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage blocked: the setting holds until the page reloads.
    }
    if (!this.enabled) this.close();
  }

  /** Keeps the system keyboard away from a field this keyboard will type into. */
  suppress(el: Field): void {
    if (el.getAttribute('inputmode') === 'none') return;
    el.dataset['oskInputmode'] = el.getAttribute('inputmode') ?? '';
    el.setAttribute('inputmode', 'none');
  }

  open(el: Field): void {
    if (this.field === el) return;
    if (this.field) this.#done(this.field);
    const saved = el.dataset['oskInputmode'];
    this.#inputMode = saved ?? el.getAttribute('inputmode');
    this.layout = fieldLayout(el.dataset['osk'], this.#inputMode ?? '');
    this.suppress(el);
    this.#original = el.value;
    this.abc = false;
    this.field = el;
    this.sync();
  }

  /** Refreshes what depends on the caret (after a click into the field). */
  sync(): void {
    const el = this.field;
    if (!el) return;
    this.before = el.value.slice(0, el.selectionStart ?? el.value.length);
  }

  type(text: string): void {
    const el = this.field;
    if (!el || text === '') return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    if (!fits(el.value, end - start, el.maxLength)) return;
    el.setRangeText(text, start, end, 'end');
    this.#changed(el);
  }

  back(): void {
    const el = this.field;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    if (start === end && start === 0) return;
    el.setRangeText('', start === end ? start - 1 : start, end, 'end');
    this.#changed(el);
  }

  /** OK: keep the value and close. */
  ok(): void {
    const el = this.field;
    this.close();
    el?.blur();
  }

  /** CANCEL: the value from before the keyboard opened, then close. */
  cancel(): void {
    const el = this.field;
    if (el && el.value !== this.#original) {
      el.value = this.#original;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    this.close();
    el?.blur();
  }

  close(): void {
    if (this.field) this.#done(this.field);
    this.field = null;
  }

  /**
   * Leaving a field: a changed value fires `change` like typing would (forms
   * that save on `change` – the check-in brief – rely on it); then the field's
   * own `inputmode` comes back.
   */
  #done(el: Field): void {
    if (el.value !== this.#original) {
      this.#original = el.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.#release(el);
  }

  #release(el: Field): void {
    const mode = this.#inputMode;
    delete el.dataset['oskInputmode'];
    if (mode) el.setAttribute('inputmode', mode);
    else el.removeAttribute('inputmode');
  }

  #changed(el: Field): void {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    this.before = el.value.slice(0, el.selectionStart ?? el.value.length);
  }
}

export const osk = new Osk();
