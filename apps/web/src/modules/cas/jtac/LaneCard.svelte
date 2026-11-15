<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  One aircraft's lane for the JTAC (ui-design.md §7, protocol.md §10.3,
  §10.6–§10.8): its phase, SPI with distance and bearing from line 6, the
  laser it uses, warnings, runs and BDA. Buttons in four fixed slots – next
  step, dry or BDA, re-attack, ABORT far right – so nothing moves between
  phases. A laser conflict is shown before clearing and makes the clearance
  tap-to-arm: flagged, never blocked.
-->
<script lang="ts">
  import type { FireMission, Lane } from '@slate-dcs/shared';

  import CommandStatus from '../../../components/CommandStatus.svelte';
  import ChoiceChips from '../../../components/ChoiceChips.svelte';
  import ConfirmButton from '../../../components/ConfirmButton.svelte';
  import CoordInput from '../../../components/CoordInput.svelte';
  import TextChips from '../../../components/TextChips.svelte';
  import Ticks from '../../../components/Ticks.svelte';
  import {
    callsignOf,
    casWho,
    deliveryOf,
    missionTimeNow,
    mtimeText,
    positionText,
    tickLevel,
  } from '../../../lib/cas.js';
  import { clock } from '../../../lib/clock.svelte.js';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';
  import { TEXT_CHIPS } from '../../../lib/picks.js';
  import {
    clearConflicts,
    laneLaser,
    laneSlots,
    LANE_STEP_TYPES,
    spiOffset,
    weaponCode,
  } from '../../../lib/missions.js';
  import type { LaneButton, MissionRights } from '../../../lib/missions.js';

  const { mission, lane, rights }: { mission: FireMission; lane: Lane; rights: MissionRights } =
    $props();

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  const slots = $derived(laneSlots(mission, lane, rights));
  const laser = $derived(slices ? laneLaser(slices, mission, lane.pid) : null);
  const conflicts = $derived(
    slices && lane.state === 'correlated' ? clearConflicts(slices, mission, lane.pid) : [],
  );
  const offset = $derived(slices ? spiOffset(slices, mission, lane) : null);
  const run = $derived(lane.runs.at(-1) ?? null);
  const ticks = $derived.by(() => {
    if (!slices) return 'none' as const;
    const d = deliveryOf(slices, LANE_STEP_TYPES, mission.missionId, lane.pid);
    return tickLevel(d, [lane.pid], d?.type === 'fm.bda' && lane.bda?.acked === true);
  });

  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');
  let reason = $state('');
  let bdaOpen = $state(false);
  let bdaTarget = $state('');
  let bdaEffect: 'destroyed' | 'damaged' | 'neutralised' | 'noEffect' | 'unknown' =
    $state('destroyed');
  let bdaLocation: { lat: number; lon: number } | null = $state(null);
  let bdaRemarks = $state('');

  const base = $derived({ missionId: mission.missionId, pid: lane.pid });

  function step(button: LaneButton): void {
    switch (button) {
      case 'correlated':
        command = host.send({ cmd: 'fm.correlated', args: base });
        return;
      case 'hot':
      case 'dry':
        command = host.send({ cmd: 'fm.clear', args: { ...base, kind: button } });
        return;
      case 'waitingBda':
        command = host.send({ cmd: 'fm.waitingBda', args: base });
        return;
      case 'bda':
        bdaTarget = mission.nineLine?.description ?? '';
        bdaOpen = true;
        return;
      case 'reattack':
        command = host.send({ cmd: 'fm.reattack', args: { ...base, to: 'attack' } });
        return;
    }
  }

  function abort(channel: 'app' | 'voice'): void {
    command = host.send({
      cmd: 'fm.abort',
      args: { ...base, channel, reason: reason.trim() || t('lane.abort.reason') },
    });
    reason = '';
  }

  function sendBda(): void {
    if (!slices) return;
    const bda = {
      cmd: 'fm.bda' as const,
      args: {
        ...base,
        target: bdaTarget.trim(),
        effect: bdaEffect,
        location: bdaLocation,
        mtime: missionTimeNow(slices, clock.now),
        remarks: bdaRemarks.trim(),
      },
    };
    // From a cleared lane: the attack is over and the BDA passed in one press.
    command =
      lane.state === 'cleared'
        ? host.sequence([{ cmd: 'fm.waitingBda', args: base }, bda])
        : host.send(bda);
    bdaOpen = false;
  }

  /** Clearing past a laser conflict is tap-to-arm (flagged, not blocked). */
  const armed = (button: LaneButton | null) =>
    (button === 'hot' || button === 'dry') && conflicts.length > 0;
</script>

{#snippet slot(button: LaneButton | null)}
  {#if button === null}
    <span class="empty" aria-hidden="true"></span>
  {:else if armed(button)}
    <ConfirmButton
      label={t(`lane.${button}`)}
      disabled={busy}
      onconfirm={() => {
        step(button);
      }}
    />
  {:else}
    <button
      type="button"
      class="btn"
      class:primary={button === 'hot' || button === 'correlated'}
      disabled={busy}
      onclick={() => {
        step(button);
      }}>{t(`lane.${button}`)}</button
    >
  {/if}
{/snippet}

{#if slices && who}
  <section class="lane {lane.state}" aria-label={callsignOf(slices, lane.pid)}>
    <header>
      <span class="who">{callsignOf(slices, lane.pid)}</span>
      <span class="state">{t(`lane.state.${lane.state}`)}</span>
      {#if lane.runs.length > 0}<span class="dim"
          >{t('lane.runs', { n: String(lane.runs.length) })}</span
        >{/if}
      <Ticks level={ticks} />
    </header>

    {#if run}
      <p class="run" class:aborted={run.abort !== null}>
        {#if run.abort}
          {t('lane.aborted', {
            reason: run.abort.reason,
            channel: t(`abort.channel.${run.abort.channel}`),
            by: run.abort.by === 'relay' ? 'SLATE' : callsignOf(slices, run.abort.by),
          })}
        {:else}
          {t(`clearance.${run.clearance.kind}`)} · {mtimeText(slices, run.clearance.mtime)}
        {/if}
      </p>
    {/if}

    <p class="row">
      <span class="label">{t('lane.spi')}</span>
      {#if lane.spi}
        <span class="mono">{positionText(lane.spi, who.style)[0]}</span>
        {#if offset}
          <span class="mono dim">
            {t('lane.spiOffset', {
              m: String(Math.round(offset.distanceM)),
              deg: String(offset.bearingDeg).padStart(3, '0'),
            })}
          </span>
        {/if}
      {:else}
        <span class="dim">{t('lane.noSpi')}</span>
      {/if}
    </p>
    {#if mission.nineLine && mission.nineLine.mark.type === 'laser'}
      <p class="row">
        <span class="label">{t('lane.laser')}</span>
        {#if laser}
          <span class="mono">
            {laser.code} – {laser.source === lane.pid
              ? t('mark.source.ownship')
              : callsignOf(slices, laser.source)}
          </span>
        {/if}
        <span class="dim mono">
          {t('lane.weaponCode', { code: String(weaponCode(slices, mission, lane.pid) ?? '—') })}
        </span>
      </p>
    {/if}
    {#each lane.warnings as w, i (i)}
      <p class="warning">
        <strong>{t(`warning.${w.kind}`)}</strong>
        {w.kind === 'laserConflict'
          ? t('warning.laserConflict.text', { code: String(w.code), with: w.with })
          : t('warning.codeMismatch.text', {
              code: String(w.code),
              weapon: String(w.weaponCode ?? '—'),
            })}
      </p>
    {/each}
    {#if conflicts.length > 0 && (slots.first === 'hot' || slots.second === 'dry')}
      <p class="warning">
        <strong>{t('warning.laserConflict')}</strong>
        {t('lane.conflictBefore', {
          code: String(laser?.code ?? ''),
          with: conflicts.map((c) => `${callsignOf(slices, c.pid)} (${c.missionId})`).join(', '),
        })}
      </p>
    {/if}
    {#if lane.bda}
      <p class="row">
        <span class="label">BDA</span>
        <span>{t(`bda.effect.${lane.bda.effect}`)} – {lane.bda.target || '—'}</span>
        <span class:ok={lane.bda.acked} class="dim">
          {lane.bda.acked ? t('lane.bdaAcked') : t('lane.bdaNotAcked')}
        </span>
      </p>
    {/if}

    {#if bdaOpen}
      <form
        class="form-grid bda"
        onsubmit={(event) => {
          event.preventDefault();
          sendBda();
        }}
      >
        <label class="field">
          <span>{t('bda.target')}</span>
          <input bind:value={bdaTarget} maxlength="200" />
        </label>
        <ChoiceChips
          bind:value={bdaEffect}
          label={t('bda.effect')}
          options={(['destroyed', 'damaged', 'neutralised', 'noEffect', 'unknown'] as const).map(
            (e) => ({ value: e, label: t(`bda.effect.${e}`) }),
          )}
        />
        <CoordInput
          bind:value={bdaLocation}
          label={t('bda.location')}
          style={who.style}
          picks={mission.nineLine?.location
            ? [{ label: t('coord.line6'), pos: mission.nineLine.location }]
            : []}
        />
        <label class="field">
          <span>{t('bda.remarks')}</span>
          <input bind:value={bdaRemarks} maxlength="500" />
        </label>
        <TextChips bind:value={bdaRemarks} chips={TEXT_CHIPS.bda} label={t('bda.remarks')} />
        <div class="bda-actions">
          <button
            type="button"
            class="btn"
            onclick={() => {
              bdaOpen = false;
            }}>{t('action.close')}</button
          >
          <button type="submit" class="btn primary" disabled={busy}>{t('bda.send')}</button>
        </div>
      </form>
    {/if}

    {#if slots.abort}
      <label class="field reason">
        <span>{t('lane.abort.reasonInput')}</span>
        <input bind:value={reason} maxlength="100" placeholder={t('lane.abort.reason')} />
      </label>
      <TextChips
        bind:value={reason}
        chips={TEXT_CHIPS.abort}
        join="replace"
        label={t('lane.abort.reasonInput')}
      />
    {/if}
    <div class="slots">
      {@render slot(slots.first)}
      {@render slot(slots.second)}
      {@render slot(slots.third)}
      {#if slots.abort}
        <ConfirmButton
          label={t('lane.abort')}
          danger
          disabled={busy}
          onconfirm={() => {
            abort('app');
          }}
        />
      {:else}
        <span class="empty" aria-hidden="true"></span>
      {/if}
    </div>
    {#if slots.abort}
      <div class="voice">
        <ConfirmButton
          label={t('lane.abortVoice')}
          disabled={busy}
          onconfirm={() => {
            abort('voice');
          }}
        />
      </div>
    {/if}
    <CommandStatus id={command} />
  </section>
{/if}

<style>
  .lane {
    display: grid;
    gap: 0.35rem;
    padding: 0.6rem;
    border: 1px solid var(--line);
    border-left: 4px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .lane.correlated {
    border-left-color: var(--blue);
  }

  .lane.cleared {
    border-left-color: var(--green);
  }

  .lane.waitingBda,
  .lane.bda {
    border-left-color: var(--text-dim);
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem 0.75rem;
  }

  .who {
    font-weight: 700;
  }

  .state {
    padding: 0.05rem 0.45rem;
    border: 1px solid var(--line);
    border-radius: 0.3rem;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .cleared .state {
    border-color: var(--green);
    color: var(--green);
  }

  .correlated .state {
    border-color: var(--blue);
    color: var(--blue);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.6rem;
    margin: 0;
    font-size: 0.9375rem;
  }

  .label {
    min-width: 3.5rem;
    color: var(--text-dim);
  }

  .run {
    margin: 0;
    font-weight: 700;
  }

  .run.aborted {
    color: var(--red);
  }

  .warning {
    margin: 0;
    color: var(--amber);
    font-size: 0.875rem;
  }

  .dim {
    color: var(--text-dim);
  }

  .ok {
    color: var(--green);
  }

  .slots {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .empty {
    min-height: var(--touch);
  }

  @media (max-width: 30rem) {
    .slots {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .slots :global(button) {
    min-width: 0;
    padding: 0 0.4rem;
  }

  .voice {
    display: flex;
    justify-content: flex-end;
  }

  .bda {
    padding: 0.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  .bda-actions {
    display: flex;
    gap: 0.5rem;
  }
</style>
