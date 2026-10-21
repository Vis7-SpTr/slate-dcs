<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Inline status of the last command a control sent (protocol.md §14.5):
  pending → nothing to do; no answer after 5 s → retry with the same ID;
  refused → the reason. Takes a fixed height, so nothing moves.
-->
<script lang="ts">
  import { host } from '../lib/host.svelte.js';
  import { t } from '../lib/i18n/index.js';

  const { id }: { id: string | null } = $props();

  const pending = $derived(host.pendingOf(id));
  const failure = $derived(
    id !== null && host.view.lastFailure?.id === id ? host.view.lastFailure : null,
  );
</script>

<div class="status" aria-live="polite">
  {#if pending?.state === 'pending'}
    <span class="dim">{t('cmd.pending')}</span>
  {:else if pending?.state === 'noAnswer'}
    <span class="amber">{t('cmd.noAnswer')}</span>
    <button
      type="button"
      onclick={() => {
        host.retry(pending.id);
      }}>{t('cmd.retry')}</button
    >
  {:else if failure}
    <span class="amber">{t('cmd.failed', { text: failure.error.text })}</span>
    <button
      type="button"
      onclick={() => {
        host.dismissFailure();
      }}>{t('cmd.dismiss')}</button
    >
  {/if}
</div>

<style>
  .status {
    min-height: 2rem;
    margin-top: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.875rem;
  }

  .dim {
    color: var(--text-dim);
  }

  .amber {
    color: var(--amber);
  }

  button {
    min-height: 2.5rem;
    padding: 0 0.875rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    cursor: pointer;
  }
</style>
