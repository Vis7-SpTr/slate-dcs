<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Ownship → Aircraft (ui-design.md §8): position block, fuel, armament per
  station, each value with its source. Shows "—" until DCS data arrives (P1.2).
  The top-view station layout, joker/bingo marks and the cockpit's fuel unit
  come with their packages.
-->
<script lang="ts">
  import Card from '../../components/Card.svelte';
  import Row from '../../components/Row.svelte';
  import SourceTag from '../../components/SourceTag.svelte';
  import { clock } from '../../lib/clock.svelte.js';
  import {
    formatAge,
    formatAltitudeFt,
    formatHeading,
    formatKg,
    formatLatLon,
    formatSpeedKt,
  } from '../../lib/format.js';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';

  const ownship = $derived(host.view.slices?.ownship ?? null);
  const status = $derived(ownship?.status ?? null);
  const pos = $derived(status?.pos ?? null);
  const latLon = $derived(pos ? formatLatLon(pos.lat, pos.lon) : null);
  const age = $derived(
    ownship?.statusAt != null ? formatAge(clock.now - ownship.statusAt) : t('value.none'),
  );
  const fuel = $derived(status?.fuel ?? null);
  const armament = $derived(status?.armament ?? null);
  const none = t('value.none');
</script>

<div class="aircraft">
  {#if status === null}
    <p class="notice">{t('aircraft.noData')}</p>
  {/if}

  <div class="grid">
    <Card title={t('aircraft.position')}>
      <Row label={t('aircraft.latLon')} mono>
        {#if latLon}{latLon.lat}<br />{latLon.lon}{:else}{none}{/if}
      </Row>
      <Row label={t('aircraft.altMsl')} mono>{formatAltitudeFt(pos?.altMsl)}</Row>
      <Row label={t('aircraft.altAgl')} mono>{formatAltitudeFt(pos?.altAgl)}</Row>
      <Row label={t('aircraft.heading')} mono>{formatHeading(status?.hdg)}</Row>
      <Row label={t('aircraft.gs')} mono>{formatSpeedKt(status?.gs)}</Row>
      <Row label={t('aircraft.ias')} mono>{formatSpeedKt(status?.ias)}</Row>
      <Row label={t('aircraft.age')} mono>{age}</Row>
    </Card>

    <Card title={t('aircraft.fuel')}>
      <Row label={t('aircraft.fuelInternal')} mono>
        {formatKg(fuel?.internalKg)}{#if fuel}<SourceTag source={fuel.source} />{/if}
      </Row>
      <Row label={t('aircraft.fuelExternal')} mono>{formatKg(fuel?.externalKg)}</Row>
      <Row label={t('aircraft.fuelTotal')} mono>
        {fuel ? formatKg(fuel.internalKg + fuel.externalKg) : none}
      </Row>
    </Card>

    <div class="wide">
      <Card title={t('aircraft.armament')}>
        {#if armament === null}
          <Row label={t('aircraft.gun')} mono>{none}</Row>
        {:else}
          {#each armament.stations as station (station.st)}
            <Row label={t('aircraft.station', { st: station.st })} mono>
              {station.name} ×{station.count}<SourceTag source={station.source} />
            </Row>
          {:else}
            <Row label={t('aircraft.armament')}>{t('aircraft.noStations')}</Row>
          {/each}
          <Row label={t('aircraft.gun')} mono>
            {#if armament.gun}
              {t('aircraft.rounds', { rounds: armament.gun.rounds })}<SourceTag
                source={armament.gun.source}
              />
            {:else}{none}{/if}
          </Row>
          {#if armament.stores.length > 0}
            <Row label={t('aircraft.stores')}>
              {armament.stores.map((store) => `${store.name} (${store.st})`).join(', ')}
            </Row>
          {/if}
        {/if}
      </Card>
    </div>
  </div>
</div>

<style>
  .aircraft {
    max-width: 60rem;
    margin-inline: auto;
  }

  .notice {
    margin-bottom: 0.75rem;
    padding: 0.75rem 1rem;
    border-left: 0.25rem solid var(--amber);
    border-radius: 0.25rem;
    background: var(--surface);
    color: var(--text-dim);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: 0.75rem;
  }

  .wide {
    grid-column: 1 / -1;
  }
</style>
