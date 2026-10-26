<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  CAS → Other (ui-design.md §7, D5, P2.6): five sections – AO · Holds · Map
  entries · Lasers · Log. Same page for every role; a JTAC gets the actions
  (AO settings, recenter, situation update to the AO, holds, entries), a pilot
  sees what the relay sent him. The section is screen-local state.
-->
<script lang="ts">
  import AoSection from './other/AoSection.svelte';
  import EntriesSection from './other/EntriesSection.svelte';
  import HoldsSection from './other/HoldsSection.svelte';
  import LasersSection from './other/LasersSection.svelte';
  import LogSection from './other/LogSection.svelte';
  import { t } from '../../lib/i18n/index.js';

  const SECTIONS = ['ao', 'holds', 'entries', 'lasers', 'log'] as const;
  let section: (typeof SECTIONS)[number] = $state('ao');
</script>

<div class="other">
  <div class="choice sections" role="tablist" aria-label={t('sub.cas.other')}>
    {#each SECTIONS as s (s)}
      <button
        type="button"
        role="tab"
        class="btn"
        class:selected={section === s}
        aria-selected={section === s}
        onclick={() => {
          section = s;
        }}>{t(`other.${s}`)}</button
      >
    {/each}
  </div>
  {#if section === 'ao'}
    <AoSection />
  {:else if section === 'holds'}
    <HoldsSection />
  {:else if section === 'entries'}
    <EntriesSection />
  {:else if section === 'lasers'}
    <LasersSection />
  {:else}
    <LogSection />
  {/if}
</div>

<style>
  .other {
    display: grid;
    gap: 0.75rem;
    max-width: 44rem;
    margin-inline: auto;
  }

  .sections .btn {
    flex: 1 1 5rem;
    min-width: 0;
    padding: 0 0.5rem;
  }
</style>
