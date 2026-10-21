<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- CAS: Flights · Fire missions · Other (ui-design.md §7) – comes in P2. -->
<script lang="ts">
  import EmptyState from '../../components/EmptyState.svelte';
  import { t } from '../../lib/i18n/index.js';
  import type { SubTabId } from '../../lib/router.svelte.js';

  const { sub }: { sub: SubTabId } = $props();
</script>

{#key sub}
  <EmptyState title={t('soon.cas.title')} text={t('soon.cas.text')} />
{/key}
