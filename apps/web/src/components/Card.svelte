<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- A titled card. Rows go in the default slot; `actions` (optional) sit at the right of the title. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  const { title, actions, children }: { title: string; actions?: Snippet; children: Snippet } =
    $props();
</script>

<section class="card">
  <div class="head">
    <h2>{title}</h2>
    {#if actions}{@render actions()}{/if}
  </div>
  {@render children()}
</section>

<style>
  .card {
    padding: 0.875rem 1rem 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.625rem;
  }

  h2 {
    color: var(--text-dim);
    font-size: 0.8125rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
