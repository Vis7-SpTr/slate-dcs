<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- More: Plan · EFB · DTC · CAS log · Session · Settings · DCS (ui-design.md §3). -->
<script lang="ts">
  import EmptyState from '../../components/EmptyState.svelte';
  import { t } from '../../lib/i18n/index.js';
  import type { SubTabId } from '../../lib/router.svelte.js';
  import DcsView from './DcsView.svelte';
  import SessionView from './SessionView.svelte';
  import SettingsView from './SettingsView.svelte';

  const { sub }: { sub: SubTabId } = $props();
</script>

{#if sub === 'settings'}
  <SettingsView />
{:else if sub === 'session'}
  <SessionView />
{:else if sub === 'dcs'}
  <DcsView />
{:else if sub === 'plan'}
  <EmptyState title={t('soon.plan.title')} text={t('soon.plan.text')} />
{:else if sub === 'efb'}
  <EmptyState title={t('soon.efb.title')} text={t('soon.efb.text')} />
{:else if sub === 'dtc'}
  <EmptyState title={t('soon.dtc.title')} text={t('soon.dtc.text')} />
{:else}
  <EmptyState title={t('soon.log.title')} text={t('soon.log.text')} />
{/if}
