<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Where a value came from: export, server or manual (ui-design.md §8). -->
<script lang="ts">
  import type { ValueSource } from '@slate-dcs/shared';

  import { t } from '../lib/i18n/index.js';

  const { source }: { source: ValueSource } = $props();
</script>

<span class="tag" data-source={source}>{t(`source.${source}`)}</span>

<style>
  .tag {
    display: inline-block;
    margin-left: 0.5rem;
    padding: 0 0.4rem;
    border: 1px solid var(--line);
    border-radius: 0.25rem;
    color: var(--text-dim);
    font-family: var(--font);
    font-size: 0.6875rem;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    vertical-align: middle;
  }

  .tag[data-source='manual'] {
    border-color: var(--blue);
    color: var(--blue);
  }
</style>
