<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  The app shell: one main window with anchored areas (ui-design.md §2).
  Top: status strip, page title. Middle: content. Bottom, from the bottom up:
  main tabs → sub-tab row. Resizing only changes the space between them.
-->
<script lang="ts">
  import { host } from '../lib/host.svelte.js';
  import { t } from '../lib/i18n/index.js';
  import type { MessageKey } from '../lib/i18n/index.js';
  import { router, subTabKey } from '../lib/router.svelte.js';
  import CasPage from '../modules/cas/CasPage.svelte';
  import ChecklistPage from '../modules/checklists/ChecklistPage.svelte';
  import MapPage from '../modules/map/MapPage.svelte';
  import MorePage from '../modules/more/MorePage.svelte';
  import OwnshipPage from '../modules/ownship/OwnshipPage.svelte';
  import AlertBar from './AlertBar.svelte';
  import MainTabs from './MainTabs.svelte';
  import OnScreenKeyboard from './OnScreenKeyboard.svelte';
  import StatusStrip from './StatusStrip.svelte';
  import SubTabRow from './SubTabRow.svelte';

  const page = $derived(router.route.page);
  /** Shown values are only live while the host link is up. */
  const live = $derived(host.view.link === 'connected' && host.view.slices !== null);
  const sub = $derived(router.route.sub);

  // UI scale is a host setting, shared by all of the user's screens.
  $effect(() => {
    const scale = host.view.slices?.settings.uiScale ?? 1;
    document.documentElement.style.setProperty('--ui-scale', String(scale));
  });

  const role = $derived(host.view.slices?.session.role ?? null);
  const title = $derived(page === 'map' ? null : t(subTabKey(page, sub, role) as MessageKey));
</script>

<div class="shell">
  <div class="strip"><StatusStrip /></div>
  <div class="alerts"><AlertBar /></div>

  {#if title !== null}
    <h1 class="title">{title}</h1>
  {/if}

  <main class="content" class:full={page === 'map'} class:stale={!live}>
    {#if page === 'map'}
      <MapPage />
    {:else if page === 'ownship'}
      <OwnshipPage {sub} />
    {:else if page === 'cas'}
      <CasPage {sub} />
    {:else if page === 'checklist'}
      <ChecklistPage {sub} />
    {:else}
      <MorePage {sub} />
    {/if}
  </main>

  <div class="subtabs"><SubTabRow {page} {sub} /></div>
  <div class="tabs"><MainTabs {page} /></div>
</div>
<OnScreenKeyboard />

<style>
  .shell {
    height: 100dvh;
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr) auto auto;
    /* One column that never grows past the window: a wide row (e.g. 7 sub-tabs
       at phone width) scrolls inside itself instead. */
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'strip' 'alerts' 'title' 'content' 'subtabs' 'tabs';
    container: shell / inline-size;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
      env(safe-area-inset-left);
  }

  .strip {
    grid-area: strip;
  }

  .alerts {
    grid-area: alerts;
  }

  .title {
    grid-area: title;
    padding: 0.75rem 1rem 0.25rem;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-dim);
  }

  .content {
    grid-area: content;
    min-height: 0;
    overflow-y: auto;
    /* Room for the on-screen keyboard, so the field stays visible above it (§11). */
    padding: 0.5rem 1rem calc(1rem + var(--osk-height, 0px));
  }

  /* Host link down: keep the last values visible but clearly not live. */
  .content.stale {
    opacity: 0.45;
  }

  .content.full {
    padding: 0;
    overflow: hidden;
  }

  .subtabs {
    grid-area: subtabs;
    /* Gap that separates the two bottom rows (fewer wrong-row clicks in VR). */
    padding: 0.5rem 0.5rem 0.75rem;
    border-top: 1px solid var(--line);
    background: var(--bg);
  }

  .tabs {
    grid-area: tabs;
  }
</style>
