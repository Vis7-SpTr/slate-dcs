<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Sub-tab row directly above the main tabs. It exists on every page, so the
  rows above keep the same height everywhere (ui-design.md §2). On the map it
  holds page controls instead of tabs.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index.js';
  import type { MessageKey } from '../lib/i18n/index.js';
  import { host } from '../lib/host.svelte.js';
  import { CONTROL_ROW_PAGES, router, subTabKey, subTabsFor } from '../lib/router.svelte.js';
  import type { PageId, SubTabId } from '../lib/router.svelte.js';

  const { page, sub }: { page: PageId; sub: SubTabId } = $props();
  const role = $derived(host.view.slices?.session.role ?? null);
  const tabs = $derived(subTabsFor(page, role));
  const label = (id: SubTabId) => subTabKey(page, id, role) as MessageKey;
</script>

<div class="row">
  {#if CONTROL_ROW_PAGES.includes(page)}
    <p class="note">{t('soon.mapControls')}</p>
  {:else}
    <nav class="sub-tabs" aria-label="Sub">
      {#each tabs as id (id)}
        <button
          type="button"
          class="sub-tab"
          class:active={id === sub}
          aria-current={id === sub ? 'page' : undefined}
          onclick={() => {
            router.go(page, id);
          }}
        >
          {t(label(id))}
        </button>
      {/each}
    </nav>
  {/if}
</div>

<style>
  .row {
    min-height: 2.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .sub-tabs {
    display: flex;
    gap: 0.375rem;
    max-width: 48rem;
    width: 100%;
    /* Lets the row shrink and scroll instead of widening the whole page. */
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .sub-tab {
    flex: 1 1 0;
    min-width: max-content;
    min-height: 2.75rem;
    padding: 0 0.875rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-dim);
    font-size: 0.9375rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .sub-tab:active {
    background: var(--surface-2);
  }

  .sub-tab.active {
    border-color: var(--blue);
    background: var(--blue-bg);
    color: var(--text);
    font-weight: 700;
  }

  .note {
    color: var(--text-faint);
    font-size: 0.875rem;
    text-align: center;
  }
</style>
