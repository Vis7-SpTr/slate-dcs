<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Checklist: Normal · Emergency · Custom (ui-design.md §9) – comes in P4. -->
<script lang="ts">
  import EmptyState from '../../components/EmptyState.svelte';
  import { t } from '../../lib/i18n/index.js';
  import type { SubTabId } from '../../lib/router.svelte.js';

  const { sub }: { sub: SubTabId } = $props();
</script>

{#key sub}
  <EmptyState title={t('soon.checklist.title')} text={t('soon.checklist.text')} />
{/key}
