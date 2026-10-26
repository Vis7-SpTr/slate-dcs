<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Assign or change a hold (protocol.md §9.4, P2.6): a checked-in flight, a
  point – an IP/CP, a keyhole axis point or typed coordinates (no quadrants) –,
  the altitude block, orbit or racetrack, times. Overlaps are flagged after
  sending, never blocked.
-->
<script lang="ts">
  import type { Altitude, Hold, PointRef } from '@slate-dcs/shared';
  import { untrack } from 'svelte';

  import AltitudeInput from '../../components/AltitudeInput.svelte';
  import CommandStatus from '../../components/CommandStatus.svelte';
  import PointInput from '../../components/PointInput.svelte';
  import { casWho, flightName, mtimeText, parseMissionTime } from '../../lib/cas.js';
  import { clock } from '../../lib/clock.svelte.js';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';

  const {
    aoId,
    flightId: fixedFlight = null,
    hold = null,
    onclose,
  }: { aoId: string; flightId?: string | null; hold?: Hold | null; onclose: () => void } = $props();

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  const flights = $derived(slices?.cas.checkIns.filter((c) => c.aoId === aoId) ?? []);
  const NM = 1852;
  // The form starts from the hold being changed (or none) once; later prop changes don't reset it.
  const start = untrack(() => hold);
  let flightId = $state(start?.flightId ?? untrack(() => fixedFlight) ?? '');
  let point: PointRef | null = $state(start?.point ?? null);
  let floor: Altitude = $state(start?.floor ?? { m: 4572, ref: 'msl' });
  let ceiling: Altitude = $state(start?.ceiling ?? { m: 5181.6, ref: 'msl' });
  let turns: 'left' | 'right' = $state(start?.turns ?? 'left');
  let shape: 'orbit' | 'racetrack' = $state(start?.shape ?? 'orbit');
  let radius = $state(start?.radiusM ? String(Math.round((start.radiusM / NM) * 10) / 10) : '3');
  let leg = $state(start?.legM ? String(Math.round((start.legM / NM) * 10) / 10) : '5');
  let inbound = $state(
    start?.inboundDeg !== null && start?.inboundDeg !== undefined
      ? String(start.inboundDeg)
      : '270',
  );
  let fromText = $state('');
  let untilText = $state('');
  let visibility: 'ao' | 'coalition' = $state(start?.visibility ?? 'ao');

  const from = $derived(
    slices && fromText.trim() !== ''
      ? parseMissionTime(slices, fromText, clock.now)
      : (hold?.from ?? null),
  );
  const until = $derived(
    slices && untilText.trim() !== ''
      ? parseMissionTime(slices, untilText, clock.now)
      : (hold?.until ?? null),
  );
  const badTime = $derived(
    (fromText.trim() !== '' && from === null) || (untilText.trim() !== '' && until === null),
  );
  const num = (text: string) => Number(text.replace(',', '.'));
  const ready = $derived(
    flightId !== '' &&
      point !== null &&
      !badTime &&
      (shape === 'orbit'
        ? num(radius) > 0
        : num(leg) > 0 && num(inbound) >= 0 && num(inbound) < 360),
  );

  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');

  function send(): void {
    if (!point) return;
    const draft = {
      flightId,
      point,
      floor,
      ceiling,
      turns,
      shape,
      radiusM: shape === 'orbit' ? num(radius) * NM : null,
      legM: shape === 'racetrack' ? num(leg) * NM : null,
      inboundDeg: shape === 'racetrack' ? num(inbound) : null,
      from,
      until,
      visibility,
    };
    command = hold
      ? host.send({ cmd: 'cas.hold.update', args: { holdId: hold.holdId, hold: draft } })
      : host.send({ cmd: 'cas.hold.assign', args: draft });
  }
</script>

{#if slices && who}
  <form
    class="form-grid hold"
    onsubmit={(event) => {
      event.preventDefault();
      send();
    }}
  >
    {#if fixedFlight === null && !hold}
      <label class="field">
        <span>{t('hold.flight')}</span>
        <select bind:value={flightId}>
          <option value="" disabled>{t('hold.flight.pick')}</option>
          {#each flights as f (f.flightId)}
            <option value={f.flightId}>{f.brief.callsign}</option>
          {/each}
        </select>
      </label>
    {:else}
      <p class="to">{t('hold.for', { flight: flightName(slices, flightId) })}</p>
    {/if}

    <PointInput bind:value={point} {aoId} label={t('hold.point')} style={who.style} />

    <AltitudeInput bind:value={floor} label={t('hold.floor')} />
    <AltitudeInput bind:value={ceiling} label={t('hold.ceiling')} />

    <div class="choice" role="group" aria-label={t('hold.shape')}>
      {#each ['orbit', 'racetrack'] as const as s (s)}
        <button
          type="button"
          class="btn"
          class:selected={shape === s}
          onclick={() => {
            shape = s;
          }}>{t(`hold.${s}`)}</button
        >
      {/each}
      {#each ['left', 'right'] as const as turn (turn)}
        <button
          type="button"
          class="btn"
          class:selected={turns === turn}
          onclick={() => {
            turns = turn;
          }}>{t(`hold.turns.${turn}`)}</button
        >
      {/each}
    </div>
    {#if shape === 'orbit'}
      <label class="field">
        <span>{t('hold.radius')}</span>
        <input class="mono" inputmode="decimal" bind:value={radius} />
      </label>
    {:else}
      <div class="two">
        <label class="field">
          <span>{t('hold.leg')}</span>
          <input class="mono" inputmode="decimal" bind:value={leg} />
        </label>
        <label class="field">
          <span>{t('hold.inbound')}</span>
          <input class="mono" inputmode="numeric" bind:value={inbound} />
        </label>
      </div>
    {/if}
    <div class="two">
      <label class="field">
        <span>{t('hold.from')}</span>
        <input
          class="mono"
          bind:value={fromText}
          placeholder={hold?.from ? mtimeText(slices, hold.from) : t('time.placeholder')}
        />
      </label>
      <label class="field">
        <span>{t('hold.until')}</span>
        <input
          class="mono"
          bind:value={untilText}
          placeholder={hold?.until ? mtimeText(slices, hold.until) : t('hold.open')}
        />
      </label>
    </div>
    {#if badTime}<p class="note amber">{t('time.bad')}</p>{/if}
    <div class="choice" role="group" aria-label={t('entry.visibility')}>
      {#each ['ao', 'coalition'] as const as v (v)}
        <button
          type="button"
          class="btn"
          class:selected={visibility === v}
          onclick={() => {
            visibility = v;
          }}>{t(`visibility.${v}`)}</button
        >
      {/each}
    </div>
    <div class="actions">
      <button type="button" class="btn" onclick={onclose}>{t('action.close')}</button>
      <button type="submit" class="btn primary" disabled={busy || !ready}
        >{hold ? t('hold.update') : t('hold.assign')}</button
      >
    </div>
    <CommandStatus id={command} />
  </form>
{/if}

<style>
  .hold {
    margin-top: 0.5rem;
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .to {
    font-weight: 700;
  }

  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .amber {
    color: var(--amber);
  }
</style>
