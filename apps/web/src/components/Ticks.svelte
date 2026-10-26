<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Delivery ticks like a messenger (ui-design.md §7, protocol.md §1.2): a
  clock while sending, one tick = the relay took it, two = delivered, two
  green filled = a person acknowledged it. Always with a word for the colour.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index.js';
  import type { TickLevel } from '../lib/cas.js';

  const { level }: { level: TickLevel } = $props();
</script>

{#if level !== 'none'}
  <span class="ticks {level}" title={t(`ticks.${level}`)}>
    <span class="marks mono" aria-hidden="true">
      {level === 'sent' ? '◷' : level === 'relay' ? '✓' : '✓✓'}
    </span>
    <span class="word">{t(`ticks.${level}`)}</span>
  </span>
{/if}

<style>
  .ticks {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--text-dim);
    font-size: 0.8125rem;
    white-space: nowrap;
  }

  .marks {
    font-weight: 700;
    letter-spacing: -0.15em;
  }

  .delivered .marks {
    color: var(--text);
  }

  .acknowledged {
    color: var(--green);
  }
</style>
