<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  A position typed in any format – MGRS, DD, DDM, DMS (D1) – and shown back in
  the user's own format (scope §4.1), so a typo is seen before sending. "My
  position" takes the own status position when there is one. In VR it is
  picked rather than typed (ui-design.md §11): MAP ENTRY lists the entries
  with a position, and the caller can offer more (line 6, the last SPI); the
  field opens the coordinate keypad.
-->
<script lang="ts">
  import { parseCoordinates } from '@slate-dcs/shared';
  import type { CoordStyle, LatLon } from '@slate-dcs/shared';
  import { untrack } from 'svelte';

  import { entryName, entryPosition, positionText } from '../lib/cas.js';
  import { host } from '../lib/host.svelte.js';
  import { t } from '../lib/i18n/index.js';

  // Svelte needs `let` for a bindable prop; the others are never reassigned.
  /* eslint-disable prefer-const */
  let {
    value = $bindable(),
    label,
    style,
    own = null,
    picks = [],
  }: {
    value: LatLon | null;
    label: string;
    style: CoordStyle;
    own?: LatLon | null;
    /** More positions to pick, e.g. line 6 of the mission or the last SPI. */
    picks?: readonly { label: string; pos: LatLon }[];
  } = $props();
  /* eslint-enable prefer-const */

  /** Map entries with a position this user can see – picked from MAP ENTRY. */
  const entries = $derived(
    (host.view.slices?.cas.mapEntries ?? []).flatMap((e) => {
      const pos = entryPosition(e);
      return pos ? [{ id: e.cmId, label: entryName(e), pos }] : [];
    }),
  );
  let showEntries = $state(false);

  function take(pos: LatLon): void {
    value = pos;
    text = positionText(pos, style)[0] ?? '';
    showEntries = false;
  }

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
      data-osk="coord"
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
          take(own);
        }}>{t('coord.mine')}</button
      >
    {/if}
  </div>
  {#if picks.length > 0 || entries.length > 0}
    <div class="picks" role="group" aria-label={t('coord.picks')}>
      {#each picks as p (p.label)}
        <button
          type="button"
          class="chip"
          onclick={() => {
            take(p.pos);
          }}>{p.label}</button
        >
      {/each}
      {#if entries.length > 0}
        <button
          type="button"
          class="chip"
          class:selected={showEntries}
          aria-expanded={showEntries}
          onclick={() => {
            showEntries = !showEntries;
          }}>{t('coord.entries')}</button
        >
      {/if}
    </div>
    {#if showEntries}
      <div class="picks" role="group" aria-label={t('coord.entries')}>
        {#each entries as e (e.id)}
          <button
            type="button"
            class="chip"
            onclick={() => {
              take(e.pos);
            }}>{e.label}</button
          >
        {/each}
      </div>
    {/if}
  {/if}
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
