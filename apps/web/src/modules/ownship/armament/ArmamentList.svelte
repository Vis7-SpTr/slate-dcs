<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Full armament view for airframes without a station layout: one row per
  station, with the cockpit's station label where known.
-->
<script lang="ts">
  import { stationLabel } from '@slate-dcs/shared';
  import type { Armament } from '@slate-dcs/shared';

  import Row from '../../../components/Row.svelte';
  import SourceTag from '../../../components/SourceTag.svelte';
  import { t } from '../../../lib/i18n/index.js';

  const { armament, type }: { armament: Armament; type: string | null } = $props();
</script>

{#each armament.stations as station (station.st)}
  <Row label={t('aircraft.station', { st: stationLabel(type, station.st) })} mono>
    {station.name} ×{station.count}<SourceTag source={station.source} />
  </Row>
{:else}
  <Row label={t('aircraft.armament')}>{t('aircraft.noStations')}</Row>
{/each}
{#if armament.stores.length > 0}
  <Row label={t('armament.stores')}>
    {armament.stores.map((s) => `${s.name} (${stationLabel(type, s.st)})`).join(' · ')}
  </Row>
{/if}
