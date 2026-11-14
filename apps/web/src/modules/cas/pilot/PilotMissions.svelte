<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  CAS → Fire missions for a pilot (ui-design.md §7, P2.7): the missions of his
  flight, one chip each – the one that needs him first (an abort, a
  clearance, a change to ACK) – and the open one's card below. Which one is
  open is screen-local; an ABORT banner in the alert bar opens its mission.
-->
<script lang="ts">
  import type { FireMission } from '@slate-dcs/shared';

  import EmptyState from '../../../components/EmptyState.svelte';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';
  import {
    abortNotice,
    CLOSED_STATES,
    pendingRevs,
    pilotClearance,
  } from '../../../lib/missions.js';
  import { alerts } from '../../../shell/alerts.svelte.js';
  import PilotMissionCard from './PilotMissionCard.svelte';

  /** `embedded`: part of the pilot's CAS page – nothing is shown while there is no mission. */
  const { embedded = false }: { embedded?: boolean } = $props();

  const slices = $derived(host.view.slices);
  const pid = $derived(slices?.session.pid ?? null);

  /** Lower = needs him sooner. */
  function urgency(m: FireMission): number {
    if (abortNotice(m, pid)) return 0;
    const c = pilotClearance(m, pid);
    if (c === 'hot' || c === 'dry' || c === 'window') return 1;
    if (pendingRevs(m, pid).length > 0) return 2;
    if (CLOSED_STATES.has(m.state)) return 9;
    return c === 'notAssigned' ? 5 : 3;
  }

  const missions = $derived(
    [...(slices?.missions.missions ?? [])].sort((a, b) => urgency(a) - urgency(b)),
  );
  let picked: string | null = $state(null);
  $effect(() => {
    // The alert bar asked for a mission: show it once.
    if (alerts.wanted !== null) {
      picked = alerts.wanted;
      alerts.wanted = null;
    }
  });
  const current = $derived(missions.find((m) => m.missionId === picked) ?? missions[0] ?? null);
</script>

{#if embedded && missions.length === 0}
  <!-- nothing yet -->
{:else if !slices || slices.session.state !== 'joined'}
  <EmptyState title={t('sub.cas.missions')} text={t('cas.noSession')} />
{:else if missions.length === 0}
  <EmptyState title={t('sub.cas.missions')} text={t('pilot.fm.none')} />
{:else}
  <div class="missions">
    {#if missions.length > 1}
      <div class="chips" role="tablist" aria-label={t('sub.cas.missions')}>
        {#each missions as m (m.missionId)}
          {@const c = pilotClearance(m, pid)}
          <button
            type="button"
            role="tab"
            class="btn chip"
            class:selected={current?.missionId === m.missionId}
            class:aborted={abortNotice(m, pid) !== null}
            aria-selected={current?.missionId === m.missionId}
            onclick={() => {
              picked = m.missionId;
            }}
          >
            <span class="mono">{m.missionId}</span>
            <span class="small">{t(`pilot.clear.${c}`)}</span>
          </button>
        {/each}
      </div>
    {/if}
    {#if current}
      {#key current.missionId}
        <PilotMissionCard mission={current} />
      {/key}
    {/if}
  </div>
{/if}

<style>
  .missions {
    display: grid;
    gap: 0.75rem;
    max-width: 44rem;
    margin-inline: auto;
  }

  .chips {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
  }

  .chip {
    display: grid;
    flex: 0 0 auto;
    gap: 0.1rem;
    min-width: 7rem;
    padding: 0.3rem 0.75rem;
  }

  .chip.aborted {
    border-color: var(--red);
  }

  .small {
    font-size: 0.75rem;
  }
</style>
