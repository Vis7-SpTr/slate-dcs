<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- A titled card. Rows go in the default slot. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  const { title, children }: { title: string; children: Snippet } = $props();
</script>

<section class="card">
  <h2>{title}</h2>
  {@render children()}
</section>

<style>
  .card {
    padding: 0.875rem 1rem 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  h2 {
    margin-bottom: 0.625rem;
    color: var(--text-dim);
    font-size: 0.8125rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
