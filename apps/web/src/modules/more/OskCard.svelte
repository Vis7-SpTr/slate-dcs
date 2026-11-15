<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  More → Settings → On-screen keyboard (ui-design.md §11, P2.7d): Auto (on in
  an OpenKneeboard tab, which passes no keyboard input), Always, Off. This
  screen only, kept in its browser storage like the OKB page size.
-->
<script lang="ts">
  import Card from '../../components/Card.svelte';
  import { t } from '../../lib/i18n/index.js';
  import { osk } from '../../lib/osk.svelte.js';
  import type { OskMode } from '../../lib/osk.svelte.js';

  const MODES: readonly OskMode[] = ['auto', 'always', 'off'];
</script>

<Card title={t('osk.title')}>
  <p class="help">{t('osk.help')}</p>
  <div class="choice" role="group" aria-label={t('osk.title')}>
    {#each MODES as m (m)}
      <button
        type="button"
        class="btn"
        class:selected={osk.mode === m}
        aria-pressed={osk.mode === m}
        onclick={() => {
          osk.setMode(m);
        }}>{t(`osk.mode.${m}`)}</button
      >
    {/each}
  </div>
  <p class="state">{osk.enabled ? t('osk.state.on') : t('osk.state.off')}</p>
</Card>

<style>
  .help,
  .state {
    margin: 0;
    color: var(--text-dim);
    font-size: 0.875rem;
  }

  .choice {
    margin: 0.5rem 0;
  }
</style>
