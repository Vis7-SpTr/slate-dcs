<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  ± steps and presets for a number field (ui-design.md §11): altitudes in
  500 ft, playtime in 5 min, counts and radii – picked instead of typed.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index.js';
  import { stepValue } from '../lib/picks.js';

  // Svelte needs `let` for a bindable prop; the others are never reassigned.
  /* eslint-disable prefer-const */
  let {
    value = $bindable(),
    step,
    label,
    min = 0,
    max,
    from,
    presets = [],
    unit = '',
    onchange,
  }: {
    value: string;
    step: number;
    label: string;
    min?: number;
    max?: number;
    /** What an empty field counts as. */
    from?: number;
    presets?: readonly number[];
    unit?: string;
    onchange?: (value: string) => void;
  } = $props();
  /* eslint-enable prefer-const */

  function set(next: string): void {
    value = next;
    onchange?.(next);
  }
</script>

<div class="picks" role="group" aria-label={t('picks.steps', { field: label })}>
  <button
    type="button"
    class="chip mono"
    onclick={() => {
      set(stepValue(value, -step, { min, max, from }));
    }}>−{step}</button
  >
  <button
    type="button"
    class="chip mono"
    onclick={() => {
      set(stepValue(value, step, { min, max, from }));
    }}>+{step}</button
  >
  {#each presets as p (p)}
    <button
      type="button"
      class="chip mono"
      class:selected={Number(value) === p}
      onclick={() => {
        set(String(p));
      }}>{p}{unit}</button
    >
  {/each}
</div>
