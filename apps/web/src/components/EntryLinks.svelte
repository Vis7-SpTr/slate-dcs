<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Links to map entries (protocol.md §9.3, §10.4, §10.6): the threats, enemy
  or friendly entries a text refers to, picked by tapping. The receiver sees
  them by name and position in his own coordinate format – and on the map
  from P3. At most 20 per field.
-->
<script lang="ts">
  import type { CmKind } from '@slate-dcs/shared';

  import { entryName } from '../lib/cas.js';
  import { host } from '../lib/host.svelte.js';
  import { t } from '../lib/i18n/index.js';

  // Svelte needs `let` for a bindable prop; the others are never reassigned.
  /* eslint-disable prefer-const */
  let {
    value = $bindable(),
    kinds,
    label,
  }: { value: string[]; kinds: readonly CmKind[]; label: string } = $props();
  /* eslint-enable prefer-const */

  const entries = $derived(
    host.view.slices?.cas.mapEntries.filter((e) => kinds.includes(e.kind)) ?? [],
  );

  function toggle(cmId: string): void {
    value = value.includes(cmId)
      ? value.filter((id) => id !== cmId)
      : [...value, cmId].slice(0, 20);
  }
</script>

{#if entries.length > 0}
  <div class="links" role="group" aria-label={label}>
    <span class="label">{label}</span>
    {#each entries as e (e.cmId)}
      <button
        type="button"
        class="chip"
        class:selected={value.includes(e.cmId)}
        aria-pressed={value.includes(e.cmId)}
        onclick={() => {
          toggle(e.cmId);
        }}>{entryName(e)}</button
      >
    {/each}
  </div>
{:else}
  <p class="none">{t('links.none')}</p>
{/if}

<style>
  .links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }

  .label {
    flex-basis: 100%;
    color: var(--text-dim);
    font-size: 0.8125rem;
  }

  .none {
    margin: 0;
    color: var(--text-dim);
    font-size: 0.8125rem;
  }
</style>
