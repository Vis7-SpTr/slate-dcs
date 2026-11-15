<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  More → Settings. Settings live in the host and are shared by all of the
  user's screens (scope §4.7): a change here shows on every screen at once.
-->
<script lang="ts">
  import { SpeedKind } from '@slate-dcs/shared';
  import type { TimeDisplay } from '@slate-dcs/shared';

  import Card from '../../components/Card.svelte';
  import CommandStatus from '../../components/CommandStatus.svelte';
  import AppCard from './AppCard.svelte';
  import LanCard from './LanCard.svelte';
  import OkbCard from './OkbCard.svelte';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';

  const SCALE_STEP = 0.1;
  const SCALE_MIN = 0.5;
  const SCALE_MAX = 3;

  const settings = $derived(host.view.slices?.settings ?? null);
  let timeCommand: string | null = $state(null);
  let scaleCommand: string | null = $state(null);
  let speedsCommand: string | null = $state(null);

  /** Switches one speed on or off; the list keeps the fixed order of `SpeedKind`. */
  function toggleSpeed(kind: SpeedKind): void {
    if (settings === null) return;
    const on = settings.speeds.includes(kind);
    const speeds = SpeedKind.options.filter((k) =>
      k === kind ? !on : settings.speeds.includes(k),
    );
    speedsCommand = host.send({ cmd: 'settings.set', args: { speeds } });
  }

  function setTime(timeDisplay: TimeDisplay): void {
    timeCommand = host.send({ cmd: 'settings.set', args: { timeDisplay } });
  }

  function changeScale(direction: 1 | -1): void {
    if (settings === null) return;
    const next = Math.round((settings.uiScale + direction * SCALE_STEP) * 100) / 100;
    const uiScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, next));
    scaleCommand = host.send({ cmd: 'settings.set', args: { uiScale } });
  }
</script>

<div class="settings">
  {#if settings}
    <Card title={t('settings.time')}>
      <p class="help">{t('settings.time.help')}</p>
      <div class="segmented" role="group" aria-label={t('settings.time')}>
        {#each ['zulu', 'local'] as const as option (option)}
          <button
            type="button"
            class:selected={settings.timeDisplay === option}
            aria-pressed={settings.timeDisplay === option}
            onclick={() => {
              setTime(option);
            }}
          >
            {t(`settings.time.${option}`)}
          </button>
        {/each}
      </div>
      <CommandStatus id={timeCommand} />
    </Card>

    <Card title={t('settings.scale')}>
      <p class="help">{t('settings.scale.help')}</p>
      <div class="stepper">
        <button
          type="button"
          disabled={settings.uiScale <= SCALE_MIN}
          onclick={() => {
            changeScale(-1);
          }}>{t('settings.scale.down')}</button
        >
        <span class="scale">{settings.uiScale.toFixed(2)}×</span>
        <button
          type="button"
          disabled={settings.uiScale >= SCALE_MAX}
          onclick={() => {
            changeScale(1);
          }}>{t('settings.scale.up')}</button
        >
      </div>
      <CommandStatus id={scaleCommand} />
    </Card>

    <Card title={t('settings.speeds')}>
      <p class="help">{t('settings.speeds.help')}</p>
      <div class="toggles" role="group" aria-label={t('settings.speeds')}>
        {#each SpeedKind.options as kind (kind)}
          <button
            type="button"
            class:selected={settings.speeds.includes(kind)}
            aria-pressed={settings.speeds.includes(kind)}
            onclick={() => {
              toggleSpeed(kind);
            }}
          >
            {t(`speed.${kind}`)}
          </button>
        {/each}
      </div>
      <CommandStatus id={speedsCommand} />
    </Card>

    <OkbCard />

    <LanCard />

    <AppCard />
  {/if}
</div>

<style>
  .settings {
    display: grid;
    gap: 0.75rem;
    max-width: 40rem;
    margin-inline: auto;
  }

  .help {
    margin-bottom: 0.75rem;
    color: var(--text-dim);
    font-size: 0.9375rem;
  }

  .segmented,
  .stepper {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  button {
    min-height: var(--touch);
    min-width: 7rem;
    padding: 0 1.25rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    font-weight: 700;
    cursor: pointer;
  }

  button:active:not(:disabled) {
    background: var(--surface-3);
  }

  button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .segmented button {
    flex: 1;
  }

  .toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .toggles button {
    min-width: 6rem;
  }

  .segmented button.selected,
  .toggles button.selected {
    border-color: var(--blue);
    background: var(--blue-bg);
    color: var(--text);
  }

  .scale {
    min-width: 5rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
    font-size: 1.25rem;
    font-weight: 700;
  }
</style>
