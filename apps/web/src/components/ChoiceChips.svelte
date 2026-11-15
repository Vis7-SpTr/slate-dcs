<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  One choice from a list, as buttons (ui-design.md §11, P2.7d) – in place of
  a dropdown: its list opens as a separate popup, which an OpenKneeboard tab
  doesn't show, and it needs a second precise click in VR.
-->
<script lang="ts">
  // Svelte needs `let` for a bindable prop; the others are never reassigned.
  /* eslint-disable prefer-const */
  let {
    value = $bindable(),
    options,
    label,
    onchange,
  }: {
    value: string;
    options: readonly { value: string; label: string; disabled?: boolean }[];
    label: string;
    onchange?: (value: string) => void;
  } = $props();
  /* eslint-enable prefer-const */
</script>

<div class="field">
  <span>{label}</span>
  <div class="picks" role="group" aria-label={label}>
    {#each options as o (o.value)}
      <button
        type="button"
        class="chip"
        class:selected={value === o.value}
        aria-pressed={value === o.value}
        disabled={o.disabled === true}
        onclick={() => {
          value = o.value;
          onchange?.(o.value);
        }}>{o.label}</button
      >
    {/each}
  </div>
</div>
