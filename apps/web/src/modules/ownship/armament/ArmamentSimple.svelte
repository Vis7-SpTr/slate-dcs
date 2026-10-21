<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Simplified armament: weapons left, added up by type and grouped A/A and A/G
  (missiles, then bombs, then rockets), and the pods/tanks carried.
-->
<script lang="ts">
  import { armamentTotals } from '@slate-dcs/shared';
  import type { Armament, WeaponRole } from '@slate-dcs/shared';

  import Row from '../../../components/Row.svelte';
  import SourceTag from '../../../components/SourceTag.svelte';
  import { t } from '../../../lib/i18n/index.js';

  const { armament }: { armament: Armament } = $props();

  const totals = $derived(armamentTotals(armament.stations));
  const manual = $derived((role: WeaponRole) =>
    armament.stations.some((s) => s.role === role && s.source === 'manual' && s.count > 0),
  );
  const none = t('value.none');
</script>

{#each ['aa', 'ag'] as const as role (role)}
  <Row label={t(`armament.${role}`)} mono>
    {#if totals[role].length > 0}
      {totals[role]
        .map((w) => `${String(w.count)}× ${w.name}`)
        .join(' · ')}{#if manual(role)}<SourceTag source="manual" />{/if}
    {:else}{none}{/if}
  </Row>
{/each}
<Row label={t('armament.stores')}>
  {armament.stores.length > 0 ? armament.stores.map((s) => s.name).join(' · ') : none}
</Row>
