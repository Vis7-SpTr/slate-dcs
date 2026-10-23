<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  More → Settings → SLATE (P1.9, ui-design.md §3): versions, updates (check,
  install – never during a mission), Quit (SLATE runs without a window) and
  Uninstall / Uninstall and wipe data. Quit and uninstall only on this PC –
  a paired device doesn't get them (the host refuses them too).
-->
<script lang="ts">
  import Card from '../../components/Card.svelte';
  import CommandStatus from '../../components/CommandStatus.svelte';
  import ConfirmButton from '../../components/ConfirmButton.svelte';
  import Row from '../../components/Row.svelte';
  import { clock } from '../../lib/clock.svelte.js';
  import { formatAge } from '../../lib/format.js';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';

  const slices = $derived(host.view.slices);
  const app = $derived(slices?.host.app ?? null);
  const update = $derived(app?.update ?? null);
  const missionRunning = $derived(slices?.mission.running ?? false);
  /** Opened on this PC (not a paired device on the LAN). */
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);

  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');
</script>

<Card title={t('app.title')}>
  <Row label={t('settings.build')} mono>{__SLATE_BUILD__}</Row>
  <Row label={t('settings.hostBuild')} mono>{host.view.hostBuild ?? t('value.none')}</Row>

  {#if app && update}
    <h3>{t('app.updates')}</h3>
    {#if !app.installed}
      <p class="help">{t('app.notInstalled')}</p>
    {:else}
      <p class="state" data-state={update.state}>
        {t(`app.update.${update.state}`, {
          version: update.version ?? '',
          progress: update.progress ?? 0,
        })}
      </p>
      {#if update.error}
        <p class="alert" role="alert">{update.error}</p>
      {/if}
      {#if update.checkedAt}
        {@const age = formatAge(clock.now - update.checkedAt)}
        <p class="help">
          {age === 'now' ? t('app.update.checkedNow') : t('app.update.checked', { age })}
        </p>
      {/if}
      <div class="actions">
        {#if update.state === 'available'}
          <button
            type="button"
            class="btn primary"
            disabled={busy || missionRunning}
            onclick={() => {
              command = host.send({ cmd: 'app.installUpdate', args: {} });
            }}>{t('app.update.install', { version: update.version ?? '' })}</button
          >
        {/if}
        <button
          type="button"
          class="btn"
          disabled={busy || update.state === 'checking' || update.state === 'downloading'}
          onclick={() => {
            command = host.send({ cmd: 'app.checkUpdate', args: {} });
          }}>{t('app.update.check')}</button
        >
      </div>
      {#if update.state === 'available' && missionRunning}
        <p class="help amber">{t('app.update.afterMission')}</p>
      {/if}
    {/if}

    {#if local}
      <h3>{t('app.runtime')}</h3>
      <p class="help">{t('app.quit.help')}</p>
      <div class="actions">
        <ConfirmButton
          label={t('app.quit')}
          disabled={busy}
          onconfirm={() => {
            command = host.send({ cmd: 'app.quit', args: {} });
          }}
        />
      </div>

      {#if app.installed}
        <h3>{t('app.uninstall')}</h3>
        <p class="help">{t('app.uninstall.help')}</p>
        <div class="actions">
          <ConfirmButton
            label={t('app.uninstall.keep')}
            disabled={busy}
            onconfirm={() => {
              command = host.send({ cmd: 'app.uninstall', args: { wipe: false } });
            }}
          />
          <ConfirmButton
            label={t('app.uninstall.wipe')}
            disabled={busy}
            onconfirm={() => {
              command = host.send({ cmd: 'app.uninstall', args: { wipe: true } });
            }}
          />
        </div>
      {/if}
    {/if}
    <CommandStatus id={command} />
  {/if}
  <p class="help screen">{t('settings.screen.help')}</p>
</Card>

<style>
  h3 {
    margin: 1rem 0 0.4rem;
    font-size: 1rem;
  }

  .help {
    margin-bottom: 0.5rem;
    color: var(--text-dim);
    font-size: 0.9375rem;
  }

  .screen {
    margin: 0.75rem 0 0;
  }

  .state {
    margin-bottom: 0.5rem;
    font-weight: 700;
  }

  .state[data-state='available'] {
    color: var(--blue);
  }

  .state[data-state='upToDate'] {
    color: var(--green);
  }

  .state[data-state='failed'] {
    color: var(--amber);
  }

  .alert {
    margin-bottom: 0.5rem;
  }

  .amber {
    color: var(--amber);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0.25rem 0 0.5rem;
  }
</style>
