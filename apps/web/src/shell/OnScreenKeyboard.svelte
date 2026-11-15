<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  SLATE's own keyboard (ui-design.md §11, P2.7d), docked at the bottom edge
  over the tabs while a field is being typed into. An OKB Web Dashboard tab
  passes clicks but no keyboard input, so in OKB (or with "Always") every text
  field opens it: the smallest layout that can type the field's values. Keys
  never take the focus from the field; OK keeps the value, CANCEL puts the old
  one back. Nothing is sent from here – the form's own buttons send.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';

  import { host } from '../lib/host.svelte.js';
  import { t } from '../lib/i18n/index.js';
  import { mgrsSquare, oskRows } from '../lib/osk-layout.js';
  import type { OskKey } from '../lib/osk-layout.js';
  import { isTextField, osk } from '../lib/osk.svelte.js';

  let panel: HTMLDivElement | null = $state(null);

  const own = $derived.by(() => {
    const pos = host.view.slices?.ownship.status?.pos;
    return pos ? { lat: pos.lat, lon: pos.lon } : null;
  });
  const rows = $derived(
    oskRows(osk.layout, {
      before: osk.before,
      abc: osk.abc,
      upper: osk.upper,
      mgrs: osk.layout.layout === 'coord' ? mgrsSquare(own) : null,
    }),
  );

  onMount(() => {
    // Early, before the browser decides on its own keyboard (iPad with "Always").
    const down = (e: PointerEvent) => {
      if (osk.enabled && isTextField(e.target)) osk.suppress(e.target);
    };
    const focusIn = (e: FocusEvent) => {
      if (!osk.enabled || !isTextField(e.target)) return;
      osk.open(e.target);
      void reveal(e.target);
    };
    const focusOut = (e: FocusEvent) => {
      if (osk.field === null || e.target !== osk.field) return;
      const next = e.relatedTarget;
      if (next instanceof Node && panel?.contains(next)) return;
      if (isTextField(next)) return; // the next field opens it
      osk.close();
    };
    const selection = () => {
      if (osk.field && document.activeElement === osk.field) osk.sync();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('focusin', focusIn);
    document.addEventListener('focusout', focusOut);
    document.addEventListener('selectionchange', selection);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('focusin', focusIn);
      document.removeEventListener('focusout', focusOut);
      document.removeEventListener('selectionchange', selection);
    };
  });

  /** The page makes room for the keyboard; the field stays visible above it. */
  async function reveal(el: HTMLElement): Promise<void> {
    await tick();
    const height = panel?.offsetHeight ?? 0;
    document.documentElement.style.setProperty('--osk-height', `${String(height)}px`);
    el.scrollIntoView({ block: 'nearest' });
    const rect = el.getBoundingClientRect();
    const limit = window.innerHeight - height - 8;
    if (rect.bottom > limit) {
      el.closest('.content')?.scrollBy({ top: rect.bottom - limit });
    }
  }

  $effect(() => {
    if (osk.field === null) document.documentElement.style.removeProperty('--osk-height');
  });

  function press(key: OskKey): void {
    switch (key.kind) {
      case 'text':
        osk.type(key.text);
        return;
      case 'space':
        osk.type(' ');
        return;
      case 'back':
        osk.back();
        return;
      case 'toggle':
        if (key.what === 'abc') osk.abc = !osk.abc;
        else osk.upper = !osk.upper;
        return;
    }
  }

  function label(key: OskKey): string {
    switch (key.kind) {
      case 'text':
        return key.label ?? key.text;
      case 'space':
        return t('osk.space');
      case 'back':
        return '⌫';
      case 'toggle':
        return key.label;
    }
  }

  // Keys (and the gaps between them) never take the focus from the field.
  $effect(() => {
    const el = panel;
    if (!el) return;
    const keep = (e: Event) => {
      e.preventDefault();
    };
    el.addEventListener('mousedown', keep);
    el.addEventListener('pointerdown', keep);
    return () => {
      el.removeEventListener('mousedown', keep);
      el.removeEventListener('pointerdown', keep);
    };
  });
</script>

{#if osk.field}
  <div class="osk {osk.layout.layout}" bind:this={panel} role="group" aria-label={t('osk.title')}>
    <div class="top">
      <button type="button" class="btn" onclick={() => osk.cancel()}>{t('osk.cancel')}</button>
      <span class="what">{t(`osk.layout.${osk.layout.layout}`)}</span>
      <button type="button" class="btn primary" onclick={() => osk.ok()}>{t('osk.ok')}</button>
    </div>
    {#each rows as row, r (r)}
      <div class="row">
        {#each row as key, k (k)}
          <button
            type="button"
            class="key mono"
            class:wide={key.kind === 'space' || (key.kind === 'text' && key.wide === true)}
            class:on={key.kind === 'toggle' && key.on}
            class:fn={key.kind !== 'text'}
            disabled={key.kind === 'text' && key.disabled === true}
            aria-label={key.kind === 'back' ? t('osk.back') : undefined}
            onclick={() => {
              press(key);
            }}>{label(key)}</button
          >
        {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  .osk {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 50;
    display: grid;
    gap: 0.3rem;
    margin: 0 auto;
    padding: 0.5rem 0.5rem calc(0.5rem + env(safe-area-inset-bottom));
    border-top: 2px solid var(--blue);
    background: var(--surface);
    box-shadow: 0 -0.5rem 1.5rem rgb(0 0 0 / 0.45);
  }

  /* Only as big as needed: the keypads stay narrow, letters take the width. */
  .osk.digits,
  .osk.laser {
    max-width: 22rem;
    border-right: 1px solid var(--line);
    border-left: 1px solid var(--line);
    border-radius: var(--radius) var(--radius) 0 0;
  }

  .osk.coord,
  .osk.letters {
    max-width: 48rem;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .top .btn {
    min-width: 6rem;
  }

  .what {
    flex: 1;
    color: var(--text-dim);
    font-size: 0.8125rem;
    text-align: center;
  }

  .row {
    display: flex;
    gap: 0.3rem;
  }

  .key {
    flex: 1 1 0;
    min-width: 0;
    min-height: var(--touch);
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text);
    font-size: 1.125rem;
    font-weight: 700;
    cursor: pointer;
  }

  .key.wide {
    flex-grow: 2.5;
  }

  .key.fn {
    background: var(--surface-3);
    font-size: 0.9375rem;
  }

  .key.on {
    border-color: var(--blue);
  }

  .key:disabled {
    opacity: 0.3;
    cursor: default;
  }
</style>
