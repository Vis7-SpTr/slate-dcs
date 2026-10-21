<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Placeholder for a page whose feature comes in a later phase. -->
<script lang="ts">
  const { title, text }: { title: string; text: string } = $props();
</script>

<div class="empty">
  <h2>{title}</h2>
  <p>{text}</p>
</div>

<style>
  .empty {
    max-width: 32rem;
    margin: 3rem auto 0;
    padding: 1.5rem;
    border: 1px dashed var(--line);
    border-radius: var(--radius);
    text-align: center;
  }

  h2 {
    margin-bottom: 0.5rem;
    font-size: 1.125rem;
  }

  p {
    color: var(--text-dim);
  }
</style>
