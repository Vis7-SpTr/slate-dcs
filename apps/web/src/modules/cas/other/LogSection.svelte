<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  The live CAS log this user may see (protocol.md §12; the host's copy, §14.8),
  newest first, by area. Shown in More → CAS log, above its export.
-->
<script lang="ts">
  import type { LogArea } from '@slate-dcs/shared';

  import EmptyState from '../../../components/EmptyState.svelte';
  import { mtimeText } from '../../../lib/cas.js';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';

  const slices = $derived(host.view.slices);
  const AREAS: LogArea[] = ['mission', 'checkIn', 'situation', 'fuel', 'ao'];
  let area: LogArea | 'all' = $state('all');
  /** At most this many on screen; the export has them all. */
  const SHOWN = 200;
  const entries = $derived(
    [...(slices?.casLog.entries ?? [])]
      .filter((e) => area === 'all' || e.area === area)
      .reverse()
      .slice(0, SHOWN),
  );
</script>

{#if !slices}
  <EmptyState title={t('other.log')} text={t('cas.noSession')} />
{:else}
  <div class="choice areas" role="group" aria-label={t('other.log')}>
    {#each ['all', ...AREAS] as const as a (a)}
      <button
        type="button"
        class="btn"
        class:selected={area === a}
        onclick={() => {
          area = a;
        }}>{t(`log.area.${a}`)}</button
      >
    {/each}
  </div>
  {#if entries.length === 0}<p class="note">{t('log.none')}</p>{/if}
  <ol class="log">
    {#each entries as e, i (`${String(e.seq)}-${String(i)}`)}
      <li>
        <span class="time mono">{mtimeText(slices, e.mtime)}</span>
        <span class="text">{e.summary}</span>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .areas .btn {
    flex: 1 1 4.5rem;
    min-width: 0;
    padding: 0 0.4rem;
    font-size: 0.875rem;
  }

  .log {
    display: grid;
    gap: 0.2rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .log li {
    display: grid;
    grid-template-columns: 7.5rem 1fr;
    gap: 0.6rem;
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--surface-3);
    font-size: 0.875rem;
  }

  .time {
    color: var(--text-dim);
  }

  .text {
    overflow-wrap: anywhere;
  }
</style>
