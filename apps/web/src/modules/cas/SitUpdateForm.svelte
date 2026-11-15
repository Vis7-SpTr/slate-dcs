<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Situation update (protocol.md §9.3, P2.6): JP 3-09.3 fields, to one
  checked-in flight or to everyone in the AO. Starts from the last update to
  the same target; shows its ticks and the pilots' COPY.
-->
<script lang="ts">
  import type { SitUpdate } from '@slate-dcs/shared';

  import CommandStatus from '../../components/CommandStatus.svelte';
  import EntryLinks from '../../components/EntryLinks.svelte';
  import Ticks from '../../components/Ticks.svelte';
  import { deliveryOf, tickLevel } from '../../lib/cas.js';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';

  const {
    aoId,
    flightId,
    target,
    onclose,
  }: { aoId: string; flightId: string | null; target: string; onclose: () => void } = $props();

  const slices = $derived(host.view.slices);
  const last = $derived(
    slices?.cas.sitUpdates.find((n) => n.aoId === aoId && n.flightId === flightId) ?? null,
  );

  const empty: SitUpdate = {
    threats: { text: '', cmIds: [] },
    targets: { text: '', cmIds: [] },
    friendlies: { text: '', cmIds: [] },
    fires: '',
    clearanceAuthority: '',
    restrictions: '',
    hazards: '',
  };
  // A copy of the last one, to change and send again.
  const start = (): SitUpdate => structuredClone($state.snapshot(last?.update) ?? empty);
  const update: SitUpdate = $state(start());

  const ticks = $derived(
    slices && last
      ? tickLevel(deliveryOf(slices, 'cas.sitUpdate', flightId ?? aoId), null, last.copied)
      : 'none',
  );

  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');
</script>

<form
  class="form-grid sit"
  onsubmit={(event) => {
    event.preventDefault();
    command = host.send({
      cmd: 'cas.sitUpdate',
      args: { aoId, flightId, update: $state.snapshot(update) },
    });
  }}
>
  <p class="to">{t('sit.to', { target })}</p>
  <label class="field">
    <span>{t('sit.threats')}</span>
    <textarea bind:value={update.threats.text} maxlength="500" rows="2"></textarea>
  </label>
  <EntryLinks bind:value={update.threats.cmIds} kinds={['threat']} label={t('links.threats')} />
  <label class="field">
    <span>{t('sit.targets')}</span>
    <textarea bind:value={update.targets.text} maxlength="500" rows="2"></textarea>
  </label>
  <EntryLinks bind:value={update.targets.cmIds} kinds={['enemy']} label={t('links.targets')} />
  <label class="field">
    <span>{t('sit.friendlies')}</span>
    <textarea bind:value={update.friendlies.text} maxlength="500" rows="2"></textarea>
  </label>
  <EntryLinks
    bind:value={update.friendlies.cmIds}
    kinds={['friendly']}
    label={t('links.friendlies')}
  />
  <label class="field">
    <span>{t('sit.fires')}</span>
    <input bind:value={update.fires} maxlength="500" />
  </label>
  <label class="field">
    <span>{t('sit.authority')}</span>
    <input bind:value={update.clearanceAuthority} maxlength="100" />
  </label>
  <label class="field">
    <span>{t('sit.restrictions')}</span>
    <input bind:value={update.restrictions} maxlength="500" />
  </label>
  <label class="field">
    <span>{t('sit.hazards')}</span>
    <input bind:value={update.hazards} maxlength="500" />
  </label>
  <div class="actions">
    <button type="button" class="btn" onclick={onclose}>{t('action.close')}</button>
    <button type="submit" class="btn primary" disabled={busy}>{t('sit.send')}</button>
    <Ticks level={ticks} />
  </div>
  <CommandStatus id={command} />
</form>

<style>
  .sit {
    margin-top: 0.5rem;
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .to {
    font-weight: 700;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
</style>
