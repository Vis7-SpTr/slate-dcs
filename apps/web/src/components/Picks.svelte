<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Picks for a field (ui-design.md §11): the sensible values as chips, one
  click each – in VR there is no keyboard. The field itself stays for
  anything else (CUSTOM: it opens the on-screen keyboard).
-->
<script lang="ts">
  const {
    items,
    label,
    selected = null,
    onpick,
  }: {
    items: readonly { label: string; value: string }[];
    label: string;
    selected?: string | null;
    onpick: (value: string) => void;
  } = $props();
</script>

{#if items.length > 0}
  <div class="picks" role="group" aria-label={label}>
    {#each items as item (item.value)}
      <button
        type="button"
        class="chip"
        class:selected={selected === item.value}
        aria-pressed={selected === null ? undefined : selected === item.value}
        onclick={() => {
          onpick(item.value);
        }}>{item.label}</button
      >
    {/each}
  </div>
{/if}
