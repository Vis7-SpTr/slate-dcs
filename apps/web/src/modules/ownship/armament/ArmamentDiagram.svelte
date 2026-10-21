<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Full armament view: a minimal top view of the airframe (wings and centre
  body, packages/shared/src/stations.ts) with each station's cockpit label,
  short weapon name and count in line with the station. Pods and tanks grey,
  empty stations "—", values entered by hand blue. Stations DCS reports that
  the layout doesn't know are listed below the drawing.
-->
<script lang="ts">
  import { shortStoreName, shortWeaponName } from '@slate-dcs/shared';
  import type { Armament, StationLayout } from '@slate-dcs/shared';

  import Row from '../../../components/Row.svelte';
  import SourceTag from '../../../components/SourceTag.svelte';
  import { t } from '../../../lib/i18n/index.js';
  import { placeLabels } from '../../../lib/station-labels.js';

  const { layout, armament }: { layout: StationLayout; armament: Armament } = $props();

  /** Vertical distance between label rows, and from the sketch to the first row (SVG units). */
  const ROW = 20;
  const FIRST = 22;
  const PAD = 6;

  const placement = $derived(placeLabels(layout.stations));
  const firstBelow = $derived(layout.view[1] + FIRST);
  const firstAbove = $derived(layout.view[0] - 14);
  const viewTop = $derived(layout.view[0] - PAD - placement.rowsAbove * ROW);
  const viewHeight = $derived(firstBelow + placement.rowsBelow * ROW - viewTop);

  interface Content {
    text: string;
    kind: 'weapon' | 'store' | 'empty';
    manual: boolean;
    /** Full name for the tooltip / screen readers. */
    title: string;
  }

  function content(dcs: number): Content {
    const weapon = armament.stations.find((s) => s.st === dcs);
    if (weapon) {
      return {
        text: `${shortWeaponName(weapon.name)}×${String(weapon.count)}`,
        kind: weapon.count === 0 ? 'empty' : 'weapon',
        manual: weapon.source === 'manual',
        title: `${weapon.name} ×${String(weapon.count)}`,
      };
    }
    const store = armament.stores.find((s) => s.st === dcs);
    if (store)
      return { text: shortStoreName(store.name), kind: 'store', manual: false, title: store.name };
    return { text: '—', kind: 'empty', manual: false, title: t('armament.empty') };
  }

  const known = $derived(new Set(layout.stations.map((s) => s.dcs)));
  const unknownStations = $derived(armament.stations.filter((s) => !known.has(s.st)));
  const anyManual = $derived(armament.stations.some((s) => s.source === 'manual'));
</script>

<svg
  class="diagram"
  viewBox={`0 ${String(viewTop)} 200 ${String(viewHeight)}`}
  role="img"
  aria-label={t('armament.diagram')}
>
  {#each layout.shapes as d (d)}
    <path {d} class="air" />
  {/each}
  {#each placement.labels as label (label.point.dcs)}
    {@const c = content(label.point.dcs)}
    {@const row =
      label.side === 'below' ? firstBelow + label.row * ROW : firstAbove - label.row * ROW}
    <g class={c.kind} class:manual={c.manual}>
      <title>{label.point.label}: {c.title}</title>
      <line
        class="lead"
        x1={label.point.x}
        y1={label.point.y}
        x2={label.x}
        y2={label.side === 'below' ? row - 9 : row + 6}
      />
      <circle class="dot" cx={label.point.x} cy={label.point.y} r="3.2" />
      <text class="st" x={label.x} y={row - 3.5}>{label.point.label}</text>
      <text class="wp" x={label.x} y={row + 3.5}>{c.text}</text>
    </g>
  {/each}
</svg>

{#if anyManual}
  <p class="hint">
    <span class="manual-word">{t('source.manual')}</span>
    {t('armament.manualHint')}
  </p>
{/if}
{#each unknownStations as station (station.st)}
  <Row label={t('aircraft.station', { st: station.st })} mono>
    {station.name} ×{station.count}<SourceTag source={station.source} />
  </Row>
{/each}

<style>
  .diagram {
    display: block;
    width: 100%;
    max-width: 34rem;
    height: auto;
    margin: 0 auto 0.5rem;
  }

  .air {
    fill: var(--surface-2);
    stroke: var(--text-faint);
    stroke-width: 1;
    stroke-linejoin: round;
  }

  .lead {
    stroke: var(--text-faint);
    stroke-width: 0.4;
  }

  .dot {
    fill: var(--blue);
  }

  .st {
    font: 700 5px var(--mono);
    fill: var(--text-dim);
    text-anchor: middle;
  }

  .wp {
    font: 700 6.2px var(--mono);
    fill: var(--text);
    text-anchor: middle;
  }

  .store .dot {
    fill: var(--text-dim);
  }

  .store .wp {
    fill: var(--text-dim);
    font-weight: 400;
  }

  .empty .dot {
    fill: var(--text-faint);
  }

  .empty .wp {
    fill: var(--text-faint);
  }

  .manual .wp {
    fill: var(--blue);
  }

  .manual .dot {
    stroke: var(--text);
    stroke-width: 1;
  }

  .hint {
    margin-bottom: 0.25rem;
    color: var(--text-dim);
    font-size: 0.8125rem;
  }

  .manual-word {
    color: var(--blue);
    text-transform: uppercase;
    font-size: 0.6875rem;
    letter-spacing: 0.04em;
  }
</style>
