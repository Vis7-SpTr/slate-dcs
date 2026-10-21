<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  More → DCS: the DCS integration page. Shows the bridge and mission state as
  the host sees them, and installs, checks, repairs and removes the SLATE Lua
  files (P1.3).
-->
<script lang="ts">
  import { BRIDGE_VERSION, unitDisplayName } from '@slate-dcs/shared';

  import Card from '../../components/Card.svelte';
  import Row from '../../components/Row.svelte';
  import DcsFolders from './DcsFolders.svelte';
  import { clock } from '../../lib/clock.svelte.js';
  import { missionClock } from '../../lib/format.js';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';

  const slices = $derived(host.view.slices);
  const bridge = $derived(slices?.host.bridge.state ?? 'waiting');
  const version = $derived(slices?.host.bridge.version ?? null);
  const dcsVersion = $derived(slices?.host.bridge.dcsVersion ?? null);
  const mismatch = $derived(version !== null && version !== BRIDGE_VERSION);
  const mission = $derived(slices?.mission ?? null);
  const aircraft = $derived(slices?.ownship.aircraft ?? null);
  const local = $derived(mission ? missionClock(mission, 'local', clock.now) : null);
  const none = t('value.none');
</script>

<div class="dcs">
  <Card title={t('dcs.bridge')}>
    <p class="state" data-state={bridge}>
      <span class="dot" aria-hidden="true"></span>{t(`dcs.bridge.${bridge}`)}
    </p>
    {#if mismatch}
      <p class="warning" role="alert">
        {t('dcs.bridge.mismatch', { found: version ?? 0, needed: BRIDGE_VERSION })}
      </p>
    {/if}
    <Row label={t('dcs.bridge.files')}>
      {version === null ? none : t('dcs.bridge.filesVersion', { version })}
    </Row>
    <Row label={t('dcs.bridge.dcsVersion')}>{dcsVersion ?? none}</Row>
  </Card>

  <Card title={t('dcs.mission')}>
    {#if mission?.running}
      <Row label={t('dcs.mission.name')}>{mission.name ?? none}</Row>
      <Row label={t('dcs.mission.map')}>{mission.theatre ?? none}</Row>
      <Row label={t('dcs.mission.date')} mono>{mission.startDate ?? none}</Row>
      <Row label={t('dcs.mission.clock')} mono>
        {local?.time ? `${local.time} L` : none}{#if local?.paused}
          <span class="amber">{t('dcs.mission.paused')}</span>{/if}
      </Row>
      <Row label={t('dcs.mission.session')}>
        {mission.multiplayer === null
          ? none
          : t(mission.multiplayer ? 'dcs.mission.multiplayer' : 'dcs.mission.singlePlayer')}
      </Row>
      <Row label={t('dcs.mission.player')}>{mission.playerName ?? none}</Row>
      <Row label={t('dcs.mission.coalition')}>
        {t(mission.coalition === null ? 'coalition.none' : `coalition.${mission.coalition}`)}
      </Row>
      <Row label={t('dcs.mission.slot')}>
        {#if aircraft}
          {unitDisplayName(aircraft.type)}{aircraft.unit ? ` – ${aircraft.unit}` : ''}
        {:else}{none}{/if}
      </Row>
    {:else}
      <p class="dim">{t('dcs.mission.none')}</p>
    {/if}
  </Card>

  <DcsFolders />
</div>

<style>
  .dcs {
    display: grid;
    gap: 0.75rem;
    max-width: 40rem;
    margin-inline: auto;
  }

  .state {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-weight: 700;
  }

  .dot {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    background: var(--text-faint);
  }

  .state[data-state='receiving'] .dot {
    background: var(--green);
  }

  .state[data-state='stale'] {
    color: var(--amber);
  }

  .state[data-state='stale'] .dot {
    background: var(--amber);
  }

  .dim {
    color: var(--text-dim);
  }

  .amber {
    margin-left: 0.4rem;
    color: var(--amber);
  }

  .warning {
    margin: 0.5rem 0 0.75rem;
    padding: 0.6rem 0.8rem;
    border-left: 0.25rem solid var(--amber);
    background: var(--surface-2);
    color: var(--amber);
  }
</style>
