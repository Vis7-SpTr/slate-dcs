<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  More → CAS log (ui-design.md §3, protocol.md §12.3): the host's copy of the
  CAS log – a JTAC's AO, a pilot's flight – newest first, and its export as a
  Markdown timeline or CSV, in the user's clock (Zulu or local).
-->
<script lang="ts">
  import { casLogCsv, casLogMarkdown, mapUtcOffsetHours } from '@slate-dcs/shared';

  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';
  import LogSection from '../cas/other/LogSection.svelte';

  const slices = $derived(host.view.slices);
  const entries = $derived(slices?.casLog.entries ?? []);

  function save(name: string, type: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportAs(kind: 'md' | 'csv' | 'csv;'): void {
    if (!slices) return;
    const options = {
      display: slices.settings.timeDisplay,
      utcOffsetHours: mapUtcOffsetHours(slices.mission.theatre),
    };
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    if (kind === 'md') {
      const title = `CAS log – ${slices.mission.name ?? 'SLATE'}`;
      save(`cas-log-${stamp}.md`, 'text/markdown', casLogMarkdown(entries, { ...options, title }));
    } else {
      const delimiter = kind === 'csv;' ? ';' : ',';
      save(`cas-log-${stamp}.csv`, 'text/csv', casLogCsv(entries, { ...options, delimiter }));
    }
  }
</script>

<div class="log-page">
  <div class="export">
    <span class="dim">{t('log.export', { n: String(entries.length) })}</span>
    <button
      type="button"
      class="btn"
      disabled={entries.length === 0}
      onclick={() => {
        exportAs('md');
      }}>Markdown</button
    >
    <button
      type="button"
      class="btn"
      disabled={entries.length === 0}
      onclick={() => {
        exportAs('csv');
      }}>CSV</button
    >
    <button
      type="button"
      class="btn"
      disabled={entries.length === 0}
      onclick={() => {
        exportAs('csv;');
      }}>{t('log.csvSemicolon')}</button
    >
  </div>
  <LogSection />
</div>

<style>
  .log-page {
    display: grid;
    gap: 0.75rem;
    max-width: 44rem;
    margin-inline: auto;
  }

  .export {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .export .btn {
    min-width: 0;
    padding: 0 0.9rem;
  }

  .dim {
    flex: 1 1 8rem;
    color: var(--text-dim);
  }
</style>
