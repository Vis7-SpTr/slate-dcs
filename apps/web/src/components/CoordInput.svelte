<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  A position typed in any format – MGRS, DD, DDM, DMS (D1) – and shown back in
  the user's own format (scope §4.1), so a typo is seen before sending. "My
  position" takes the own status position when there is one.
-->
<script lang="ts">
  import { parseCoordinates } from '@slate-dcs/shared';
  import type { CoordStyle, LatLon } from '@slate-dcs/shared';
  import { untrack } from 'svelte';

  import { positionText } from '../lib/cas.js';
  import { t } from '../lib/i18n/index.js';

  // Svelte needs `let` for a bindable prop; the others are never reassigned.
  /* eslint-disable prefer-const */
  let {
    value = $bindable(),
    label,
    style,
    own = null,
  }: { value: LatLon | null; label: string; style: CoordStyle; own?: LatLon | null } = $props();
  /* eslint-enable prefer-const */

  let text = $state('');
  const parsed = $derived(text.trim() === '' ? null : parseCoordinates(text));

  // A value set from outside (an existing mission, a picked map entry) shows as text.
  $effect(() => {
    const v = value;
    untrack(() => {
      if (v && (parsed?.lat !== v.lat || parsed.lon !== v.lon)) {
        text = positionText(v, style)[0] ?? '';
      }
    });
  });
</script>

<div class="field coord">
  <span>{label}</span>
  <div class="line">
    <input
      class="mono"
      aria-label={label}
      bind:value={text}
      placeholder={t('coord.placeholder')}
      autocomplete="off"
      spellcheck="false"
      oninput={() => {
        value = parsed;
      }}
    />
    {#if own}
      <button
        type="button"
        class="btn"
        onclick={() => {
          value = own;
          text = positionText(own, style)[0] ?? '';
        }}>{t('coord.mine')}</button
      >
    {/if}
  </div>
  <p class="preview mono" class:bad={text.trim() !== '' && parsed === null}>
    {#if text.trim() !== '' && parsed === null}
      {t('coord.bad')}
    {:else if value}
      {positionText(value, style).join(' · ')}
    {:else}
      &nbsp;
    {/if}
  </p>
</div>

<style>
  .line {
    display: flex;
    gap: 0.5rem;
  }

  .line input {
    flex: 1;
  }

  .preview {
    min-height: 1.25rem;
    color: var(--text-dim);
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }

  .preview.bad {
    color: var(--amber);
  }
</style>
