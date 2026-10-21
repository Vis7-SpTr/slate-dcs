<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Ownship: Aircraft · Flight · Check-in (ui-design.md §8). -->
<script lang="ts">
  import EmptyState from '../../components/EmptyState.svelte';
  import { t } from '../../lib/i18n/index.js';
  import type { SubTabId } from '../../lib/router.svelte.js';
  import AircraftView from './AircraftView.svelte';

  const { sub }: { sub: SubTabId } = $props();
</script>

{#if sub === 'aircraft'}
  <AircraftView />
{:else if sub === 'flight'}
  <EmptyState title={t('soon.flight.title')} text={t('soon.flight.text')} />
{:else}
  <EmptyState title={t('soon.checkIn.title')} text={t('soon.checkIn.text')} />
{/if}
