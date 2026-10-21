<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- One label/value row in a card. `mono` for codes, coordinates and numbers. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  const {
    label,
    mono = false,
    children,
  }: { label: string; mono?: boolean; children: Snippet } = $props();
</script>

<div class="row">
  <span class="label">{label}</span>
  <span class="value" class:mono>{@render children()}</span>
</div>

<style>
  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    min-height: 2rem;
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--surface-3);
  }

  .row:last-child {
    border-bottom: 0;
  }

  .label {
    color: var(--text-dim);
  }

  .value {
    text-align: right;
    font-weight: 700;
  }
</style>
