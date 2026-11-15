<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Ownship → Aircraft (ui-design.md §8): own aircraft, position block, fuel in
  the cockpit's unit, armament (simple totals or the station diagram, see
  armament/), each value with its source. Shows "—" while DCS has no data.
  JOKER/BINGO levels, marks and send buttons for pilots (P2.7). Position,
  fuel and gun rounds can be entered by hand when DCS gives none.
-->
<script lang="ts">
  import { fuelUnit, unitDisplayName } from '@slate-dcs/shared';
  import type { SpeedKind } from '@slate-dcs/shared';

  import Card from '../../components/Card.svelte';
  import ArmamentCard from './armament/ArmamentCard.svelte';
  import FuelCallsCard from './FuelCallsCard.svelte';
  import ManualCard from './ManualCard.svelte';
  import Row from '../../components/Row.svelte';
  import SourceTag from '../../components/SourceTag.svelte';
  import { clock } from '../../lib/clock.svelte.js';
  import {
    formatAge,
    formatAltitudeFt,
    formatHeading,
    formatFuel,
    formatLatLon,
    formatMach,
    formatSpeedKt,
    formatVerticalSpeed,
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
  const aircraft = $derived(ownship?.aircraft ?? null);
  const unit = $derived(fuelUnit(aircraft?.type));
  const fuel = $derived(status?.fuel ?? null);
  const fuelUnknown = $derived(fuel === null && status?.avail.fuel === true);
  const cm = $derived(ownship?.countermeasures ?? null);
  const air = $derived(ownship?.airData ?? null);
  const speeds = $derived(host.view.slices?.settings.speeds ?? []);

  /** The value of one selected speed, formatted. */
  function speedText(kind: SpeedKind): string {
    switch (kind) {
      case 'ias':
        return formatSpeedKt(status?.ias);
      case 'tas':
        return formatSpeedKt(air?.tas);
      case 'gs':
        return formatSpeedKt(status?.gs);
      case 'mach':
        return formatMach(air?.mach);
      case 'vs':
        return formatVerticalSpeed(air?.vs);
    }
  }
  const none = t('value.none');
</script>

<div class="aircraft">
  <h2 class="ident">
    {#if aircraft}
      {unitDisplayName(aircraft.type)}
      {#if aircraft.unit}<span class="unit">{aircraft.unit}</span>{/if}
    {:else}
      <span class="unit">{t('aircraft.noSlot')}</span>
    {/if}
  </h2>

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
      <Row label={t('aircraft.heading')} mono>
        {#if status?.hdgMag != null}
          {formatHeading(status.hdgMag, 'M')}<span class="secondary"
            >{formatHeading(status.hdg, 'T')}</span
          >
        {:else}
          {formatHeading(status?.hdg, 'T')}
        {/if}
      </Row>
      {#each speeds as kind (kind)}
        <Row label={t(`speed.${kind}`)} mono>{speedText(kind)}</Row>
      {:else}
        <p class="hint">{t('aircraft.noSpeeds')}</p>
      {/each}
      <Row label={t('aircraft.age')} mono>{age}</Row>
    </Card>

    <Card title={t('aircraft.fuel')}>
      <Row label={t('aircraft.fuelInternal')} mono>
        {formatFuel(fuel?.internalKg, unit)}{#if fuel}<SourceTag source={fuel.source} />{/if}
      </Row>
      <Row label={t('aircraft.fuelExternal')} mono>{formatFuel(fuel?.externalKg, unit)}</Row>
      <Row label={t('aircraft.fuelTotal')} mono>
        {fuel ? formatFuel(fuel.internalKg + fuel.externalKg, unit) : none}
      </Row>
      {#if fuelUnknown}<p class="hint">{t('aircraft.fuelUnknown')}</p>{/if}
    </Card>

    {#if aircraft && host.view.slices?.session.role !== 'jtac'}
      <FuelCallsCard />
    {/if}

    <div class="wide">
      <ManualCard />
    </div>

    <div class="wide">
      <ArmamentCard
        armament={status?.armament ?? null}
        type={aircraft?.type ?? null}
        countermeasures={cm}
      />
    </div>
  </div>
</div>

<style>
  .aircraft {
    max-width: 60rem;
    margin-inline: auto;
  }

  .ident {
    margin-bottom: 0.75rem;
    font-size: 1.25rem;
    font-weight: 700;
  }

  .unit {
    margin-left: 0.5rem;
    color: var(--text-dim);
    font-weight: 400;
  }

  .ident .unit:first-child {
    margin-left: 0;
  }

  .secondary {
    margin-left: 0.6rem;
    color: var(--text-dim);
    font-weight: 400;
  }

  .hint {
    margin-top: 0.5rem;
    color: var(--text-dim);
    font-size: 0.875rem;
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
