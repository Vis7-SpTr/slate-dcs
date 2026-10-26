<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Ownship: Aircraft · Flight · Check-in (ui-design.md §8). -->
<script lang="ts">
  import EmptyState from '../../components/EmptyState.svelte';
  import { t } from '../../lib/i18n/index.js';
  import type { SubTabId } from '../../lib/router.svelte.js';
  import { host } from '../../lib/host.svelte.js';
  import AircraftView from './AircraftView.svelte';
  import FlightView from './FlightView.svelte';
  import CheckInView from './CheckInView.svelte';
  import StationView from './StationView.svelte';

  const { sub }: { sub: SubTabId } = $props();
  const session = $derived(host.view.slices?.session ?? null);
</script>

{#if sub === 'aircraft'}
  <AircraftView />
{:else if sub === 'flight'}
  <FlightView />
{:else if !session || session.state === 'notJoined' || session.state === 'confirmFingerprint'}
  <EmptyState title={t('soon.checkIn.title')} text={t('flight.noSession.text')} />
{:else if session.role === 'jtac'}
  <StationView />
{:else}
  <CheckInView />
{/if}
