<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Other → Lasers (D5, protocol.md §9.5, §10.4): every laser code in the AO –
  the flights' codes and line 7 marks –, which are active now, codes used
  twice (a hint, never blocked) and, for JTACs, the relay's laser warnings.
-->
<script lang="ts">
  import EmptyState from '../../../components/EmptyState.svelte';
  import { callsignOf, casWho, laserUses, sharedCodes } from '../../../lib/cas.js';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  const uses = $derived(slices ? laserUses(slices) : []);
  const shared = $derived(sharedCodes(uses));
  const warnings = $derived(
    slices?.missions.missions.flatMap((m) =>
      m.lanes.flatMap((l) => l.warnings.map((w) => ({ missionId: m.missionId, pid: l.pid, w }))),
    ) ?? [],
  );
</script>

{#if !slices || !who}
  <EmptyState title={t('other.lasers')} text={t('cas.noSession')} />
{:else}
  {#if uses.length === 0}<p class="note">{t('lasers.none')}</p>{/if}
  <ul class="codes">
    {#each uses as u, i (i)}
      <li class:shared={shared.has(u.code)}>
        <span class="code mono">{u.code}</span>
        <span class="who">{u.owner}</span>
        <span class="dim">{t(`lasers.${u.kind}`)}</span>
        {#if u.active}<span class="tag red">{t('lasers.active')}</span>{/if}
        {#if shared.has(u.code)}<span class="tag amber">{t('lasers.shared')}</span>{/if}
      </li>
    {/each}
  </ul>
  {#if who.jtac && warnings.length > 0}
    <h3>{t('lasers.warnings')}</h3>
    <ul class="codes">
      {#each warnings as { missionId, pid, w }, i (i)}
        <li class="shared">
          <span class="tag amber">{t(`warning.${w.kind}`)}</span>
          <span class="who">{callsignOf(slices, pid)}</span>
          <span class="mono">
            {w.kind === 'laserConflict'
              ? t('warning.laserConflict.text', { code: w.code, with: w.with })
              : t('warning.codeMismatch.text', { code: w.code, weapon: w.weaponCode ?? '—' })}
          </span>
          <span class="dim">{missionId}</span>
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .codes {
    display: grid;
    gap: 0.35rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .codes li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .codes li.shared {
    border-left: 0.25rem solid var(--amber);
  }

  .code {
    font-size: 1.125rem;
    font-weight: 700;
  }

  .who {
    font-weight: 700;
  }

  .dim {
    color: var(--text-dim);
  }

  h3 {
    margin: 0.75rem 0 0.1rem;
    color: var(--text-dim);
    font-size: 0.8125rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .tag {
    padding: 0.1rem 0.45rem;
    border: 1px solid var(--line);
    border-radius: 0.3rem;
    font-size: 0.75rem;
    font-weight: 700;
  }

  .tag.amber {
    border-color: var(--amber);
    color: var(--amber);
  }

  .tag.red {
    border-color: var(--red);
    color: var(--red);
  }
</style>
