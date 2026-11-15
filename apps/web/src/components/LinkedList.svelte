<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Linked map entries as the reader sees them: name and position in his own
  coordinate format (protocol.md §9.3, §10.4). Entries he can't see (AO-only,
  deleted) are left out.
-->
<script lang="ts">
  import type { CoordStyle } from '@slate-dcs/shared';

  import { linkedEntries, positionText } from '../lib/cas.js';
  import { host } from '../lib/host.svelte.js';

  const { cmIds, style }: { cmIds: readonly string[]; style: CoordStyle } = $props();

  const links = $derived(host.view.slices ? linkedEntries(host.view.slices, cmIds) : []);
</script>

{#if links.length > 0}
  <ul class="linked">
    {#each links as l (l.cmId)}
      <li>
        <span class="name">{l.name}</span>
        {#if l.at}<span class="mono pos">{positionText(l.at, style)[0]}</span>{/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .linked {
    display: grid;
    gap: 0.15rem;
    margin: 0.2rem 0 0;
    padding: 0;
    list-style: none;
    font-size: 0.875rem;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.1rem 0.6rem;
  }

  .name {
    font-weight: 700;
  }

  .pos {
    color: var(--text-dim);
  }
</style>
