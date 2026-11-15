<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  NOW and +5 … +30 min for an HHMM field (ui-design.md §11), from the DCS
  mission clock in the user's clock (Zulu/local). Hidden without a mission
  clock – then the time is typed.
-->
<script lang="ts">
  import { missionTimeNow, mtimeText } from '../lib/cas.js';
  import { clock } from '../lib/clock.svelte.js';
  import { host } from '../lib/host.svelte.js';
  import { t } from '../lib/i18n/index.js';
  import { hhmm } from '../lib/picks.js';

  // Svelte needs `let` for a bindable prop; the others are never reassigned.
  /* eslint-disable prefer-const */
  let {
    value = $bindable(),
    label,
    offsets = [0, 5, 10, 15, 30],
  }: { value: string; label: string; offsets?: readonly number[] } = $props();
  /* eslint-enable prefer-const */

  const slices = $derived(host.view.slices);
  const now = $derived(slices ? missionTimeNow(slices, clock.now) : null);
</script>

{#if slices && now !== null}
  <div class="picks" role="group" aria-label={t('picks.times', { field: label })}>
    {#each offsets as min (min)}
      <button
        type="button"
        class="chip mono"
        onclick={() => {
          value = hhmm(mtimeText(slices, now + min * 60)) ?? value;
        }}>{min === 0 ? t('time.now') : `+${String(min)}`}</button
      >
    {/each}
  </div>
{/if}
