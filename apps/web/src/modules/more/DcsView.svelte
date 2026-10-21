<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  More → DCS: the DCS integration page. Shows the bridge and mission state;
  installing/checking/repairing the Lua files comes with P1.3.
-->
<script lang="ts">
  import Card from '../../components/Card.svelte';
  import Row from '../../components/Row.svelte';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';

  const slices = $derived(host.view.slices);
  const bridge = $derived(slices?.host.bridge.state ?? 'waiting');
  const mission = $derived(slices?.mission ?? null);
</script>

<div class="dcs">
  <Card title={t('dcs.bridge')}>
    <p class="state" data-state={bridge}>
      <span class="dot" aria-hidden="true"></span>{t(`dcs.bridge.${bridge}`)}
    </p>
  </Card>

  <Card title={t('dcs.mission')}>
    {#if mission?.running}
      <Row label={t('dcs.mission.map')}>{mission.theatre ?? t('value.none')}</Row>
      <Row label={t('dcs.mission.date')} mono>{mission.startDate ?? t('value.none')}</Row>
    {:else}
      <p class="dim">{t('dcs.mission.none')}</p>
    {/if}
  </Card>

  <Card title={t('dcs.install')}>
    <p class="dim">{t('dcs.install.text')}</p>
  </Card>
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
</style>
