<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  CAS → Fire missions for a JTAC (ui-design.md §7, P2.6b): the AO's missions
  as cards sorted by state, anything needing action on top; a command offered
  to him is marked. NEW FIRE MISSION opens the editor; a card opens the
  mission. Which mission is open is screen-local, so two windows can show two.
-->
<script lang="ts">
  import Card from '../../../components/Card.svelte';
  import EmptyState from '../../../components/EmptyState.svelte';
  import { callsignOf, casWho, flightName, sortedMissions } from '../../../lib/cas.js';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';
  import MissionEditor from './MissionEditor.svelte';
  import MissionView from './MissionView.svelte';

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  const ao = $derived(who?.ao ?? null);
  const missions = $derived(
    sortedMissions(slices?.missions.missions.filter((m) => m.aoId === ao?.aoId) ?? []),
  );

  let open: string | null = $state(null);
  let creating = $state(false);
  const current = $derived(missions.find((m) => m.missionId === open) ?? null);

  /** Lane states counted for the card: `2 cleared · 1 open`. */
  function laneSummary(lanes: { state: string }[]): string {
    const counts: Record<string, number> = {};
    for (const l of lanes) counts[l.state] = (counts[l.state] ?? 0) + 1;
    return Object.entries(counts)
      .map(([state, n]) => `${String(n)} ${t(`lane.state.${state as 'open'}`)}`)
      .join(' · ');
  }
</script>

<div class="board">
  {#if !slices || slices.session.state !== 'joined'}
    <EmptyState title={t('sub.cas.missions')} text={t('cas.noSession')} />
  {:else if !ao}
    <EmptyState title={t('sub.cas.missions')} text={t('cas.jtac.offStation')} />
  {:else if current}
    <MissionView
      mission={current}
      onclose={() => {
        open = null;
      }}
    />
  {:else}
    {#if creating}
      <MissionEditor
        aoId={ao.aoId}
        onclose={() => {
          creating = false;
        }}
        onsaved={() => {
          creating = false;
        }}
      />
    {:else}
      <div class="top">
        <button
          type="button"
          class="btn primary"
          onclick={() => {
            creating = true;
          }}>{t('fm.new')}</button
        >
      </div>
    {/if}
    {#if missions.length === 0}
      <p class="dim">{t('fm.none', { ao: ao.name })}</p>
    {/if}
    {#each missions as m (m.missionId)}
      {@const warnings = m.lanes.reduce((n, l) => n + l.warnings.length, 0)}
      <Card title={`${m.missionId} · ${t(`fm.state.${m.state}`)}`}>
        <button
          type="button"
          class="open"
          onclick={() => {
            open = m.missionId;
          }}
        >
          <span class="line">
            {#if m.gamePlan}<span class="tag"
                >{t('gp.type', { n: String(m.gamePlan.control) })}</span
              >{/if}
            <span class="desc">{m.nineLine?.description || t('fm.noNineLine')}</span>
          </span>
          <span class="line dim">
            {m.assignee ? flightName(slices, m.assignee.flightId) : t('fm.unassigned')}
            · {t('fm.inCommand', { who: callsignOf(slices, m.inCommand) })}
          </span>
          {#if m.lanes.length > 0 && m.state !== 'complete' && m.state !== 'cancelled'}
            <span class="line">{laneSummary(m.lanes)}</span>
          {/if}
          {#if m.commandOffer === who?.pid}
            <span class="line amber"
              >{t('fm.offeredToYou', { who: callsignOf(slices, m.owner) })}</span
            >
          {/if}
          {#if warnings > 0}
            <span class="line amber">{t('fm.warnings', { n: String(warnings) })}</span>
          {/if}
          {#if m.voiceOnly}<span class="line amber">{t('fm.voiceOnly')}</span>{/if}
        </button>
      </Card>
    {/each}
  {/if}
</div>

<style>
  .board {
    display: grid;
    gap: 0.75rem;
    max-width: 48rem;
    margin-inline: auto;
  }

  .top {
    display: flex;
  }

  .open {
    display: grid;
    gap: 0.25rem;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.5rem;
  }

  .desc {
    font-weight: 700;
  }

  .tag {
    padding: 0 0.4rem;
    border: 1px solid var(--line);
    border-radius: 0.3rem;
    font-size: 0.75rem;
    font-weight: 700;
  }

  .dim {
    color: var(--text-dim);
  }

  .amber {
    color: var(--amber);
  }
</style>
