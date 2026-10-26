<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  A point reference (protocol.md §8.5): an IP or CP of the AO, a keyhole point
  (ECHO, or an axis and NM – no quadrants) or typed coordinates; with
  `optional`, also none. Used for hold points, line 1, the mark position and a
  Type 3 window's centre.
-->
<script lang="ts">
  import type { CoordStyle, KeyholeAxis, LatLon, PointRef } from '@slate-dcs/shared';
  import { untrack } from 'svelte';

  import CoordInput from './CoordInput.svelte';
  import { host } from '../lib/host.svelte.js';
  import { t } from '../lib/i18n/index.js';

  // Svelte needs `let` for a bindable prop; the others are never reassigned.
  /* eslint-disable prefer-const */
  let {
    value = $bindable(),
    aoId,
    label,
    style,
    optional = false,
  }: {
    value: PointRef | null;
    aoId: string;
    label: string;
    style: CoordStyle;
    optional?: boolean;
  } = $props();
  /* eslint-enable prefer-const */

  const points = $derived(
    host.view.slices?.cas.mapEntries.filter(
      (e) => e.aoId === aoId && (e.kind === 'ip' || e.kind === 'cp' || e.kind === 'keyhole'),
    ) ?? [],
  );

  // The starting value is read once; later changes come from this control.
  const start = untrack(() => value);
  const startOptional = untrack(() => optional);
  let mode: 'none' | 'entry' | 'coords' = $state(
    start === null ? (startOptional ? 'none' : 'entry') : 'lat' in start ? 'coords' : 'entry',
  );
  let cmId = $state(start && 'cmId' in start ? start.cmId : '');
  let axis: KeyholeAxis = $state(
    start && 'axis' in start && start.axis !== undefined ? start.axis : 'A',
  );
  let distance = $state(
    start && 'distanceNm' in start && start.distanceNm ? String(start.distanceNm) : '8',
  );
  let coords: LatLon | null = $state(
    start && 'lat' in start ? { lat: start.lat, lon: start.lon } : null,
  );

  const keyhole = $derived(points.find((p) => p.cmId === cmId)?.kind === 'keyhole');
  const point = $derived.by((): PointRef | null => {
    if (mode === 'none') return null;
    if (mode === 'coords') return coords;
    if (cmId === '') return null;
    if (!keyhole) return { cmId };
    if (axis === 'E') return { cmId, axis };
    const nm = Number(distance.replace(',', '.'));
    return nm > 0 ? { cmId, axis, distanceNm: nm } : null;
  });

  $effect(() => {
    value = point;
  });

  const MODES = $derived(
    optional ? (['none', 'entry', 'coords'] as const) : (['entry', 'coords'] as const),
  );
</script>

<div class="point">
  <span class="title">{label}</span>
  <div class="choice" role="group" aria-label={t('point.from', { label })}>
    {#each MODES as m (m)}
      <button
        type="button"
        class="btn"
        class:selected={mode === m}
        aria-pressed={mode === m}
        onclick={() => {
          mode = m;
        }}>{t(`point.${m}`)}</button
      >
    {/each}
  </div>
  {#if mode === 'entry'}
    {#if points.length === 0}
      <p class="note amber">{t('point.noEntries')}</p>
    {:else}
      <label class="field">
        <span>{t('point.entryLabel', { label })}</span>
        <select bind:value={cmId}>
          <option value="" disabled>{t('point.pick')}</option>
          {#each points as p (p.cmId)}
            <option value={p.cmId}>{p.kind.toUpperCase()} {p.label}</option>
          {/each}
        </select>
      </label>
      {#if keyhole}
        <div class="choice axes" role="group" aria-label={t('point.axis')}>
          {#each ['E', 'A', 'B', 'C', 'D'] as const as a (a)}
            <button
              type="button"
              class="btn"
              class:selected={axis === a}
              aria-pressed={axis === a}
              onclick={() => {
                axis = a;
              }}>{t(`keyhole.${a}`)}</button
            >
          {/each}
        </div>
        {#if axis !== 'E'}
          <label class="field">
            <span>{t('point.distance')}</span>
            <input class="mono" inputmode="decimal" bind:value={distance} />
          </label>
        {/if}
      {/if}
    {/if}
  {:else if mode === 'coords'}
    <CoordInput bind:value={coords} label={t('point.coordsLabel', { label })} {style} />
  {/if}
</div>

<style>
  .point {
    display: grid;
    gap: 0.5rem;
  }

  .title {
    color: var(--text-dim);
    font-size: 0.8125rem;
  }

  .axes .btn {
    min-width: 4.5rem;
  }

  .amber {
    color: var(--amber);
  }
</style>
