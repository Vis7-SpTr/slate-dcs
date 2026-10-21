<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Ownship → Aircraft → Armament (ui-design.md §8), with a Simple / Full switch
  in the box. Simple: weapons added up by type, grouped A/A and A/G. Full: the
  station diagram of the airframe, or a station list for airframes without a
  layout. Gun and chaff/flare in both. The switch belongs to this screen only
  (remembered in the browser), so VR can show Simple while the iPad shows Full.
-->
<script lang="ts">
  import { stationLayout } from '@slate-dcs/shared';
  import type { Armament, Countermeasures } from '@slate-dcs/shared';

  import Card from '../../../components/Card.svelte';
  import Row from '../../../components/Row.svelte';
  import SourceTag from '../../../components/SourceTag.svelte';
  import { t } from '../../../lib/i18n/index.js';
  import ArmamentDiagram from './ArmamentDiagram.svelte';
  import ArmamentList from './ArmamentList.svelte';
  import ArmamentSimple from './ArmamentSimple.svelte';

  const {
    armament,
    type,
    countermeasures,
  }: { armament: Armament | null; type: string | null; countermeasures: Countermeasures | null } =
    $props();

  type View = 'simple' | 'full';
  const STORAGE_KEY = 'slate.armamentView';

  function loadView(): View {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'full' ? 'full' : 'simple';
    } catch {
      return 'simple';
    }
  }

  let view: View = $state(loadView());

  function setView(next: View): void {
    view = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
  }

  const layout = $derived(stationLayout(type));
  const none = t('value.none');
</script>

<Card title={t('aircraft.armament')}>
  {#snippet actions()}
    <div class="switch" role="group" aria-label={t('armament.view')}>
      {#each ['simple', 'full'] as const as option (option)}
        <button
          type="button"
          class:selected={view === option}
          aria-pressed={view === option}
          onclick={() => {
            setView(option);
          }}>{t(`armament.${option}`)}</button
        >
      {/each}
    </div>
  {/snippet}

  {#if armament === null}
    <p class="dim">{t('armament.none')}</p>
  {:else if view === 'simple'}
    <ArmamentSimple {armament} />
  {:else if layout}
    <ArmamentDiagram {layout} {armament} />
  {:else}
    <ArmamentList {armament} {type} />
  {/if}

  <Row label={t('aircraft.gun')} mono>
    {#if armament?.gun}
      {t('aircraft.rounds', { rounds: armament.gun.rounds })}<SourceTag
        source={armament.gun.source}
      />
    {:else}{none}{/if}
  </Row>
  <Row label={t('aircraft.countermeasures')} mono>
    {countermeasures ? `${String(countermeasures.chaff)} / ${String(countermeasures.flare)}` : none}
  </Row>
</Card>

<style>
  .switch {
    display: flex;
    gap: 0.25rem;
  }

  .switch button {
    min-height: 2.5rem;
    min-width: 4.5rem;
    padding: 0 0.875rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    font-weight: 700;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .switch button.selected {
    border-color: var(--blue);
    background: var(--blue-bg);
    color: var(--text);
  }

  .dim {
    margin-bottom: 0.5rem;
    color: var(--text-dim);
  }
</style>
