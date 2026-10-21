<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Main tabs at the bottom edge (ui-design.md §3): Map · Ownship · CAS · Checklist · More. -->
<script lang="ts">
  import { t } from '../lib/i18n/index.js';
  import type { MessageKey } from '../lib/i18n/index.js';
  import { PAGE_IDS, router } from '../lib/router.svelte.js';
  import type { PageId } from '../lib/router.svelte.js';

  const { page }: { page: PageId } = $props();
</script>

<nav class="main-tabs" aria-label="Main">
  {#each PAGE_IDS as id (id)}
    <button
      type="button"
      class="tab"
      class:active={id === page}
      aria-current={id === page ? 'page' : undefined}
      onclick={() => {
        router.go(id);
      }}
    >
      <span class="long">{t(`tab.${id}` as MessageKey)}</span>
      <span class="short">{t(`tab.${id}.short` as MessageKey)}</span>
    </button>
  {/each}
</nav>

<style>
  .main-tabs {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    max-width: 48rem;
    margin-inline: auto;
    background: var(--surface);
    border-top: 1px solid var(--line);
  }

  .tab {
    min-height: 4rem;
    padding: 0 0.25rem;
    border: 0;
    border-top: 0.2rem solid transparent;
    background: transparent;
    color: var(--text-dim);
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab:active {
    background: var(--surface-2);
  }

  .tab.active {
    border-top-color: var(--blue);
    background: var(--surface-2);
    color: var(--text);
  }

  .short {
    display: none;
  }

  /* Below the minimum width, labels shorten first (ui-design.md §2). */
  @container shell (max-width: 26rem) {
    .long {
      display: none;
    }
    .short {
      display: inline;
    }
  }
</style>
