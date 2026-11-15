<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Type 3 "cleared to engage" (protocol.md §10.6, P2.6b): which correlated
  lanes, from and until in mission time (typed in the user's clock), where –
  the whole AO, an existing map entry, or a circle around a point (default
  line 6) – targets and restrictions. Expired or revoked = not cleared; the
  relay ends it by its own clock.
-->
<script lang="ts">
  import { WindowDraft } from '@slate-dcs/shared';
  import type { FireMission, PointRef, WindowArea } from '@slate-dcs/shared';
  import { untrack } from 'svelte';

  import CommandStatus from '../../../components/CommandStatus.svelte';
  import EntryLinks from '../../../components/EntryLinks.svelte';
  import PointInput from '../../../components/PointInput.svelte';
  import {
    callsignOf,
    casWho,
    missionTimeNow,
    mtimeText,
    parseMissionTime,
  } from '../../../lib/cas.js';
  import { clock } from '../../../lib/clock.svelte.js';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';

  const { mission, onclose }: { mission: FireMission; onclose: () => void } = $props();

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  const correlated = $derived(mission.lanes.filter((l) => l.state === 'correlated'));
  const entries = $derived(
    slices?.cas.mapEntries.filter(
      (e) => e.aoId === mission.aoId && (e.shape === 'circle' || e.shape === 'polygon'),
    ) ?? [],
  );

  const NM = 1852;
  const start = untrack(() => mission);
  let picked: string[] = $state(
    start.lanes.filter((l) => l.state === 'correlated').map((l) => l.pid),
  );
  let fromText = $state('');
  let untilText = $state('');
  let minutes = $state('20');
  let areaKind: 'ao' | 'entry' | 'circle' = $state('ao');
  let cmId = $state('');
  let center: PointRef | null = $state(start.nineLine?.location ?? null);
  let radius = $state('1');
  let targets = $state(start.nineLine?.description ?? '');
  let targetLinks: string[] = $state([]);
  let restrictions = $state(start.remarks.restrictions.join('\n'));

  const now = $derived(slices ? missionTimeNow(slices, clock.now) : null);
  const from = $derived(
    slices && fromText.trim() !== '' ? parseMissionTime(slices, fromText, clock.now) : now,
  );
  const until = $derived.by(() => {
    if (slices && untilText.trim() !== '') return parseMissionTime(slices, untilText, clock.now);
    const n = Number(minutes.replace(',', '.'));
    return from !== null && n > 0 ? from + n * 60 : null;
  });
  const area = $derived.by((): WindowArea | null => {
    if (areaKind === 'entry') return cmId === '' ? null : { cmId };
    if (areaKind === 'circle' && center) {
      return { center, radiusM: Number(radius.replace(',', '.')) * NM };
    }
    return null;
  });
  const draft = $derived({
    pids: picked.length === correlated.length ? null : picked,
    from: from ?? -1,
    until: until ?? -1,
    area,
    targets: { text: targets.trim(), cmIds: targetLinks },
    restrictions: restrictions
      .split('\n')
      .map((r) => r.trim())
      .filter((r) => r !== ''),
  });
  const parsed = $derived(WindowDraft.safeParse(draft));
  const areaMissing = $derived(areaKind !== 'ao' && area === null);
  const ready = $derived(parsed.success && picked.length > 0 && !areaMissing);

  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');

  function send(): void {
    if (!parsed.success) return;
    command = host.send({
      cmd: 'fm.window',
      args: { missionId: mission.missionId, window: parsed.data },
    });
  }
</script>

{#if slices && who}
  <form
    class="form-grid window"
    onsubmit={(event) => {
      event.preventDefault();
      send();
    }}
  >
    <h4>{t('window.title')}</h4>
    {#if now === null}
      <p class="note amber">{t('window.noClock')}</p>
    {/if}
    {#if correlated.length === 0}
      <p class="note amber">{t('window.noLanes')}</p>
    {:else}
      <fieldset class="lanes">
        <legend>{t('window.lanes')}</legend>
        {#each correlated as lane (lane.pid)}
          <label class="check">
            <input type="checkbox" value={lane.pid} bind:group={picked} />
            <span>{callsignOf(slices, lane.pid)}</span>
          </label>
        {/each}
      </fieldset>
    {/if}
    <div class="two">
      <label class="field">
        <span>{t('window.from')}</span>
        <input
          class="mono"
          bind:value={fromText}
          placeholder={now === null ? t('time.placeholder') : t('window.now')}
        />
      </label>
      <label class="field">
        <span>{t('window.until')}</span>
        <input
          class="mono"
          bind:value={untilText}
          placeholder={until === null ? t('time.placeholder') : mtimeText(slices, until)}
        />
      </label>
    </div>
    {#if untilText.trim() === ''}
      <label class="field">
        <span>{t('window.minutes')}</span>
        <input class="mono" inputmode="numeric" bind:value={minutes} />
      </label>
    {/if}
    <div class="choice" role="group" aria-label={t('window.area')}>
      {#each ['ao', 'entry', 'circle'] as const as k (k)}
        <button
          type="button"
          class="btn"
          class:selected={areaKind === k}
          aria-pressed={areaKind === k}
          onclick={() => {
            areaKind = k;
          }}>{t(`window.area.${k}`)}</button
        >
      {/each}
    </div>
    {#if areaKind === 'entry'}
      {#if entries.length === 0}
        <p class="note amber">{t('window.noEntries')}</p>
      {:else}
        <label class="field">
          <span>{t('window.area.entry')}</span>
          <select bind:value={cmId}>
            <option value="" disabled>{t('point.pick')}</option>
            {#each entries as e (e.cmId)}
              <option value={e.cmId}>{t(`cm.${e.kind}`)} {e.label ?? ''}</option>
            {/each}
          </select>
        </label>
      {/if}
    {:else if areaKind === 'circle'}
      <PointInput
        bind:value={center}
        aoId={mission.aoId}
        label={t('window.center')}
        style={who.style}
      />
      <label class="field">
        <span>{t('window.radius')}</span>
        <input class="mono" inputmode="decimal" bind:value={radius} />
      </label>
    {/if}
    <label class="field">
      <span>{t('window.targets')}</span>
      <input bind:value={targets} maxlength="500" />
    </label>
    <EntryLinks bind:value={targetLinks} kinds={['enemy']} label={t('links.targets')} />
    <label class="field">
      <span>{t('window.restrictions')}</span>
      <textarea bind:value={restrictions} rows="2"></textarea>
    </label>
    {#if !parsed.success && from !== null && until !== null}
      <p class="note amber">{parsed.error.issues[0]?.message}</p>
    {/if}
    <div class="actions">
      <button type="button" class="btn" onclick={onclose}>{t('action.close')}</button>
      <button type="submit" class="btn primary" disabled={busy || !ready}>{t('window.send')}</button
      >
    </div>
    <CommandStatus id={command} />
  </form>
{/if}

<style>
  .window {
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  h4 {
    margin: 0;
  }

  .lanes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    margin: 0;
    padding: 0.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  legend {
    color: var(--text-dim);
    font-size: 0.8125rem;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-height: var(--touch);
  }

  .check input {
    width: 1.3rem;
    height: 1.3rem;
  }

  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.5rem;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .amber {
    color: var(--amber);
  }
</style>
