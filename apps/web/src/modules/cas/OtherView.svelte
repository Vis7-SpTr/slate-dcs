<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  CAS → Other (ui-design.md §7): two sections – AO · Map entries. Under the AO,
  the holding stack and the laser codes fold open (they also show on the
  flight cards and lanes). The log is in More → CAS log. Same page for every
  role; a JTAC gets the actions, a pilot sees what the relay sent him. The
  section is screen-local state.
-->
<script lang="ts">
  import AoSection from './other/AoSection.svelte';
  import EntriesSection from './other/EntriesSection.svelte';
  import HoldsSection from './other/HoldsSection.svelte';
  import LasersSection from './other/LasersSection.svelte';
  import { t } from '../../lib/i18n/index.js';

  const SECTIONS = ['ao', 'entries'] as const;
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
    <details>
      <summary>{t('other.holds')}</summary>
      <HoldsSection />
    </details>
    <details>
      <summary>{t('other.lasers')}</summary>
      <LasersSection />
    </details>
  {:else}
    <EntriesSection />
  {/if}
</div>

<style>
  .other {
    display: grid;
    gap: 0.75rem;
    max-width: 44rem;
    margin-inline: auto;
  }

  details {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0 0.75rem;
  }

  details[open] {
    padding-bottom: 0.75rem;
  }

  summary {
    min-height: var(--touch);
    display: flex;
    align-items: center;
    color: var(--text-dim);
    font-weight: 700;
    cursor: pointer;
  }

  .sections .btn {
    flex: 1 1 5rem;
    min-width: 0;
    padding: 0 0.5rem;
  }
</style>
