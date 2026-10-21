<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  More → DCS → SLATE Lua files (P1.3): one row per DCS folder in Saved Games
  with its state and what needs repair; Install, Repair, Remove (tap-to-arm)
  and Check again. The host does the work (dcs.* commands, protocol.md §14.7).
-->
<script lang="ts">
  import type { Command, DcsFolder } from '@slate-dcs/shared';

  import Card from '../../components/Card.svelte';
  import CommandStatus from '../../components/CommandStatus.svelte';
  import ConfirmButton from '../../components/ConfirmButton.svelte';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';

  const dcs = $derived(host.view.slices?.dcs ?? null);
  /** The last command sent from this card – one status line for all of it. */
  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');

  function send(cmd: Command): void {
    command = host.send(cmd);
  }

  const action = (cmd: 'dcs.install' | 'dcs.repair' | 'dcs.remove', folder: DcsFolder) => {
    send({ cmd, args: { folder: folder.name } });
  };
</script>

<Card title={t('dcs.install')}>
  <p class="help">{t('dcs.install.help')}</p>

  {#if dcs === null || dcs.scannedAt === null}
    <p class="dim">{t('dcs.install.scanning')}</p>
  {:else if dcs.error !== null}
    <p class="warning" role="alert">{t('dcs.install.error', { error: dcs.error })}</p>
  {:else if dcs.folders.length === 0}
    <p class="warning">{t('dcs.install.noFolder', { path: dcs.savedGames ?? '' })}</p>
  {:else}
    <ul class="folders">
      {#each dcs.folders as folder (folder.name)}
        <li class="folder" data-state={folder.state}>
          <div class="head">
            <span class="name mono">{folder.name}</span>
            <span class="state"
              ><span class="dot" aria-hidden="true"></span>{t(`dcs.folder.${folder.state}`)}</span
            >
          </div>
          <p class="path mono">{folder.path}</p>
          {#if folder.problems.length > 0}
            <ul class="problems">
              {#each folder.problems as problem (problem)}
                <li>{t(`dcs.problem.${problem}`)}</li>
              {/each}
            </ul>
          {/if}
          <div class="actions">
            {#if folder.state === 'notInstalled'}
              <button
                type="button"
                class="primary"
                disabled={busy}
                onclick={() => {
                  action('dcs.install', folder);
                }}>{t('dcs.action.install')}</button
              >
            {:else}
              {#if folder.state === 'needsRepair'}
                <button
                  type="button"
                  class="primary"
                  disabled={busy}
                  onclick={() => {
                    action('dcs.repair', folder);
                  }}>{t('dcs.action.repair')}</button
                >
              {/if}
              <ConfirmButton
                label={t('dcs.action.remove')}
                disabled={busy}
                onconfirm={() => {
                  action('dcs.remove', folder);
                }}
              />
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="footer">
    <button
      type="button"
      disabled={busy}
      onclick={() => {
        send({ cmd: 'dcs.rescan', args: {} });
      }}>{t('dcs.action.rescan')}</button
    >
    <p class="note">{t('dcs.install.note')}</p>
  </div>
  <CommandStatus id={command} />
</Card>

<style>
  .help {
    margin-bottom: 0.75rem;
    color: var(--text-dim);
    font-size: 0.9375rem;
  }

  .dim {
    color: var(--text-dim);
  }

  .warning {
    padding: 0.6rem 0.8rem;
    border-left: 0.25rem solid var(--amber);
    background: var(--surface-2);
    color: var(--amber);
  }

  .folders {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .folder {
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .folder[data-state='needsRepair'] {
    border-color: var(--amber);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }

  .name {
    font-size: 1.0625rem;
    font-weight: 700;
  }

  .state {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .dot {
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 50%;
    background: var(--text-faint);
  }

  [data-state='installed'] .dot {
    background: var(--green);
  }

  [data-state='needsRepair'] .state {
    color: var(--amber);
  }

  [data-state='needsRepair'] .dot {
    background: var(--amber);
  }

  .path {
    margin-top: 0.15rem;
    color: var(--text-dim);
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }

  .problems {
    margin: 0.5rem 0 0;
    padding-left: 1.1rem;
    color: var(--amber);
    font-size: 0.9375rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    margin-top: 0.75rem;
  }

  .note {
    flex: 1 1 14rem;
    color: var(--text-dim);
    font-size: 0.875rem;
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

  .folder button {
    background: var(--surface-3);
  }

  button.primary {
    border-color: var(--blue);
    background: var(--blue-bg);
  }

  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
