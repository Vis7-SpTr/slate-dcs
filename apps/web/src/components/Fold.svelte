<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  A section that folds to one line (workflow compression): open while it is
  what the user works on, folded to its summary once the next phase is up.
  Tapping the line opens it again.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  const {
    title,
    note = '',
    open = false,
    children,
  }: { title: string; note?: string; open?: boolean; children: Snippet } = $props();
</script>

<details class="fold" {open}>
  <summary>
    <span class="title">{title}</span>
    {#if note}<span class="note">{note}</span>{/if}
  </summary>
  <div class="body">{@render children()}</div>
</details>

<style>
  .fold {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    min-height: var(--touch);
    padding: 0.25rem 0.75rem;
    cursor: pointer;
  }

  .title {
    font-weight: 700;
  }

  .note {
    color: var(--text-dim);
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
  }

  .body {
    display: grid;
    gap: 0.75rem;
    padding: 0 0.5rem 0.5rem;
  }
</style>
