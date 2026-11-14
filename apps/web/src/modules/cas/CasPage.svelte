<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  CAS (ui-design.md §7). A JTAC: Flights (his workspace) · Fire missions ·
  Other. A pilot: one CAS page for whatever phase he is in · Other.
-->
<script lang="ts">
  import { host } from '../../lib/host.svelte.js';
  import type { SubTabId } from '../../lib/router.svelte.js';
  import FlightsBoard from './jtac/FlightsBoard.svelte';
  import MissionsBoard from './jtac/MissionsBoard.svelte';
  import OtherView from './OtherView.svelte';
  import PilotCas from './pilot/PilotCas.svelte';

  const { sub }: { sub: SubTabId } = $props();
  const jtac = $derived(host.view.slices?.session.role === 'jtac');
</script>

{#key sub}
  {#if sub === 'other'}
    <OtherView />
  {:else if !jtac}
    <PilotCas />
  {:else if sub === 'flights'}
    <FlightsBoard />
  {:else}
    <MissionsBoard />
  {/if}
{/key}
