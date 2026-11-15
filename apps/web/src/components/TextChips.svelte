<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Ready-made texts for a free-text field (ui-design.md §11): a click adds the
  text – on its own line (restrictions), after a comma, or in its place
  (abort reason). A text ending in "…" waits for the rest on the keyboard.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index.js';
  import { addChip } from '../lib/picks.js';
  import type { ChipJoin } from '../lib/picks.js';

  // Svelte needs `let` for a bindable prop; the others are never reassigned.
  /* eslint-disable prefer-const */
  let {
    value = $bindable(),
    chips,
    label,
    join = 'comma',
    onchange,
  }: {
    value: string;
    chips: readonly string[];
    label: string;
    join?: ChipJoin;
    /** For forms that save on change. */
    onchange?: (value: string) => void;
  } = $props();
  /* eslint-enable prefer-const */
</script>

<div class="picks" role="group" aria-label={t('picks.texts', { field: label })}>
  {#each chips as chip (chip)}
    <button
      type="button"
      class="chip"
      onclick={() => {
        value = addChip(value, chip, join);
        onchange?.(value);
      }}>{chip.endsWith(' ') ? `${chip.trim()} …` : chip}</button
    >
  {/each}
</div>
