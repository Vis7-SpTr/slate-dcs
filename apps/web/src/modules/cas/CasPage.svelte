<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  CAS: Flights · Fire missions · Other (ui-design.md §7). A JTAC gets the
  board views (P2.6), a pilot his flight and his own lane (P2.7).
-->
<script lang="ts">
  import { host } from '../../lib/host.svelte.js';
  import type { SubTabId } from '../../lib/router.svelte.js';
  import FlightsBoard from './jtac/FlightsBoard.svelte';
  import MissionsBoard from './jtac/MissionsBoard.svelte';
  import OtherView from './OtherView.svelte';
  import PilotFlights from './pilot/PilotFlights.svelte';
  import PilotMissions from './pilot/PilotMissions.svelte';

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
      <PilotFlights />
    {/if}
  {:else if jtac}
    <MissionsBoard />
  {:else}
    <PilotMissions />
  {/if}
{/key}
