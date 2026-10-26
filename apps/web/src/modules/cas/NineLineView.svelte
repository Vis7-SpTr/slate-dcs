<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Game plan, 9-line and remarks like the printed form (ui-design.md §7):
  lines numbered 1–9, read-back items marked RB, line 6 large in the reader's
  coordinate format with the text as passed, line 1 as its point name, line 7
  with who lases. Changed fields are highlighted with the old value (§10.5).
  Used by the JTAC now and by the pilot's card in P2.7.
-->
<script lang="ts">
  import { positionText } from '../../lib/cas.js';
  import type { CoordStyle, FireMission } from '@slate-dcs/shared';

  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';
  import { fieldText } from '../../lib/missions.js';

  const {
    mission,
    style,
    changed = {},
  }: { mission: FireMission; style: CoordStyle; changed?: Record<string, unknown> } = $props();

  const slices = $derived(host.view.slices);

  interface Line {
    n: string;
    label: string;
    path: string;
    value: unknown;
    rb?: boolean;
  }

  const nine = $derived(mission.nineLine);
  const lines = $derived.by((): Line[] => {
    if (!nine) return [];
    return [
      { n: '1', label: t('nine.1'), path: 'nineLine.ipBp', value: nine.ipBp },
      { n: '2', label: t('nine.2'), path: 'nineLine.headingDeg', value: nine.headingDeg },
      { n: '', label: t('nine.offset'), path: 'nineLine.offset', value: nine.offset },
      { n: '3', label: t('nine.3'), path: 'nineLine.distanceM', value: nine.distanceM },
      { n: '4', label: t('nine.4'), path: 'nineLine.elevationM', value: nine.elevationM, rb: true },
      { n: '5', label: t('nine.5'), path: 'nineLine.description', value: nine.description },
    ];
  });
  const after = $derived.by((): Line[] => {
    if (!nine) return [];
    return [
      { n: '7', label: t('nine.7'), path: 'nineLine.mark', value: nine.mark },
      { n: '8', label: t('nine.8'), path: 'nineLine.friendlies', value: nine.friendlies },
      { n: '9', label: t('nine.9'), path: 'nineLine.egress', value: nine.egress },
    ];
  });
  const remarks = $derived.by((): Line[] => {
    const r = mission.remarks;
    return [
      { n: '', label: t('remarks.ltl'), path: 'remarks.ltl', value: r.ltl },
      {
        n: '',
        label: t('remarks.fah'),
        path: 'remarks.finalAttackHeading',
        value: r.finalAttackHeading,
      },
      { n: '', label: t('remarks.tot'), path: 'remarks.tot', value: r.tot },
      {
        n: '',
        label: t('remarks.restrictions'),
        path: 'remarks.restrictions',
        value: r.restrictions,
        rb: true,
      },
      { n: '', label: t('remarks.hazards'), path: 'remarks.hazards', value: r.hazards },
      { n: '', label: t('remarks.text'), path: 'remarks.text', value: r.text },
    ];
  });
  const location = $derived(nine?.location ? positionText(nine.location, style) : []);
  const line6Changed = $derived(
    'nineLine.location' in changed || 'nineLine.locationText' in changed,
  );
</script>

{#snippet row(line: Line)}
  {#if slices}
    <div class="line" class:changed={line.path in changed}>
      <span class="n mono">{line.n}</span>
      <span class="label">{line.label}</span>
      <span class="value mono">{fieldText(slices, line.path, line.value, style)}</span>
      {#if line.rb}<span class="rb" title={t('nine.rb.title')}>RB</span>{/if}
      {#if line.path in changed}
        <span class="old mono">
          {t('nine.was')} <s>{fieldText(slices, line.path, changed[line.path], style)}</s>
        </span>
      {/if}
    </div>
  {/if}
{/snippet}

{#if slices}
  <div class="form">
    <div class="block">
      <h4>{t('nine.gamePlan')}</h4>
      <div class="line" class:changed={'gamePlan' in changed}>
        <span class="n"></span>
        <span class="value mono wide">
          {fieldText(slices, 'gamePlan', mission.gamePlan, style)}
        </span>
        {#if 'gamePlan' in changed}
          <span class="old mono">
            {t('nine.was')} <s>{fieldText(slices, 'gamePlan', changed['gamePlan'], style)}</s>
          </span>
        {/if}
      </div>
    </div>

    <div class="block">
      <h4>{t('nine.title')}</h4>
      {#if !nine}
        <p class="dim">{t('nine.empty')}</p>
      {:else}
        {#each lines as line (line.path)}
          {@render row(line)}
        {/each}
        <div class="line six" class:changed={line6Changed}>
          <span class="n mono">6</span>
          <span class="label">{t('nine.6')}</span>
          <span class="rb" title={t('nine.rb.title')}>RB</span>
          <span class="big mono">{location[0] ?? '—'}</span>
          {#each location.slice(1) as other (other)}
            <span class="second mono">{other}</span>
          {/each}
          {#if nine.locationText}
            <span class="passed mono">{t('nine.passed', { text: nine.locationText })}</span>
          {/if}
          {#if line6Changed && slices}
            <span class="old mono">
              {t('nine.was')}
              <s>
                {'nineLine.location' in changed
                  ? fieldText(slices, 'nineLine.location', changed['nineLine.location'], style)
                  : fieldText(
                      slices,
                      'nineLine.locationText',
                      changed['nineLine.locationText'],
                      style,
                    )}
              </s>
            </span>
          {/if}
        </div>
        {#each after as line (line.path)}
          {@render row(line)}
        {/each}
      {/if}
    </div>

    <div class="block">
      <h4>{t('nine.remarks')}</h4>
      {#if mission.remarks.dangerClose}
        <p class="danger">DANGER CLOSE</p>
      {/if}
      {#each remarks as line (line.path)}
        {@render row(line)}
      {/each}
    </div>
  </div>
{/if}

<style>
  .form {
    display: grid;
    gap: 0.75rem;
  }

  h4 {
    margin: 0 0 0.35rem;
    color: var(--text-dim);
    font-size: 0.8125rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .line {
    display: grid;
    grid-template-columns: 1.5rem minmax(6rem, 9rem) 1fr auto;
    align-items: baseline;
    gap: 0.25rem 0.5rem;
    padding: 0.3rem 0.4rem;
    border-bottom: 1px solid var(--line);
  }

  .n {
    color: var(--text-dim);
    font-weight: 700;
  }

  .label {
    color: var(--text-dim);
    font-size: 0.875rem;
  }

  .value {
    overflow-wrap: anywhere;
  }

  .value.wide {
    grid-column: 2 / -1;
  }

  .rb {
    padding: 0 0.3rem;
    border: 1px solid var(--blue);
    border-radius: 0.25rem;
    color: var(--blue);
    font-size: 0.6875rem;
    font-weight: 700;
  }

  .six .rb {
    grid-column: 4;
    grid-row: 1;
  }

  .big,
  .second,
  .passed,
  .old {
    grid-column: 2 / -1;
  }

  .big {
    font-size: 1.375rem;
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .second,
  .passed {
    color: var(--text-dim);
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }

  .changed {
    border-left: 3px solid var(--amber);
    background: var(--surface-3);
  }

  .old {
    color: var(--amber);
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }

  .danger {
    margin: 0 0 0.35rem;
    color: var(--red);
    font-weight: 700;
  }

  .dim {
    color: var(--text-dim);
  }

  @media (max-width: 30rem) {
    .line {
      grid-template-columns: 1.5rem 1fr auto;
    }

    .line .value {
      grid-column: 2 / -1;
    }

    .six .rb {
      grid-column: 3;
    }
  }
</style>
