<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  CAS: Flights · Fire missions · Other (ui-design.md §7). P2.6 builds the
  JTAC side; the pilot views of Flights and Fire missions follow in P2.7.
-->
<script lang="ts">
  import EmptyState from '../../components/EmptyState.svelte';
  import { t } from '../../lib/i18n/index.js';
  import { host } from '../../lib/host.svelte.js';
  import type { SubTabId } from '../../lib/router.svelte.js';
  import FlightsBoard from './jtac/FlightsBoard.svelte';
  import MissionsBoard from './jtac/MissionsBoard.svelte';
  import OtherView from './OtherView.svelte';

  const { sub }: { sub: SubTabId } = $props();
  const jtac = $derived(host.view.slices?.session.role === 'jtac');
</script>

{#key sub}
  {#if sub === 'other'}
    <OtherView />
  {:else if sub === 'flights'}
    {#if jtac}
      <FlightsBoard />
    {:else}
      <EmptyState title={t('cas.flights')} text={t('soon.pilotCas')} />
    {/if}
  {:else if jtac}
    <MissionsBoard />
  {:else}
    <EmptyState title={t('sub.cas.missions')} text={t('soon.missions')} />
  {/if}
{/key}
