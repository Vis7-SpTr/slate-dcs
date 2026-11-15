<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  One fire mission for a JTAC (ui-design.md §7, protocol.md §10, P2.6b): who
  owns it and who is in command (offer, accept, return, reclaim), the shared
  steps in fixed slots (EDIT · next step · step back · CANCEL far right), the
  Type 3 window, voice only, changes waiting for the pilots' ACK, the 9-line,
  and one lane per aircraft. Only the JTAC in command steps; any JTAC of the
  AO may abort a cleared lane.
-->
<script lang="ts">
  import type { FireMission } from '@slate-dcs/shared';

  import CommandStatus from '../../../components/CommandStatus.svelte';
  import ConfirmButton from '../../../components/ConfirmButton.svelte';
  import Fold from '../../../components/Fold.svelte';
  import LinkedList from '../../../components/LinkedList.svelte';
  import Ticks from '../../../components/Ticks.svelte';
  import {
    callsignOf,
    casWho,
    deliveryOf,
    flightName,
    mtimeText,
    pointText,
    tickLevel,
  } from '../../../lib/cas.js';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';
  import {
    clearable,
    correlatable,
    fieldKey,
    groupClearConflicts,
    missionRights,
    missionSlots,
    MISSION_STEP_TYPES,
    pendingAcks,
    readyToComplete,
    stepReady,
    unackedChanges,
  } from '../../../lib/missions.js';
  import NineLineView from '../NineLineView.svelte';
  import AssignForm from './AssignForm.svelte';
  import LaneCard from './LaneCard.svelte';
  import MissionEditor from './MissionEditor.svelte';
  import WindowForm from './WindowForm.svelte';

  /** `compact`: inline on a flight card – no back button, the 9-line and command fold away. */
  const {
    mission,
    onclose = () => undefined,
    compact = false,
  }: { mission: FireMission; onclose?: () => void; compact?: boolean } = $props();

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  const rights = $derived(
    slices
      ? missionRights(slices, mission)
      : { jtac: false, inCommand: false, owner: false, offered: false, open: false },
  );
  const slots = $derived(missionSlots(mission, rights));
  const ao = $derived(slices?.cas.aos.find((a) => a.aoId === mission.aoId) ?? null);
  const otherJtacs = $derived(ao?.jtacs.filter((j) => j.pid !== who?.pid) ?? []);
  const type3 = $derived(mission.gamePlan?.control === 3);
  const crew = $derived(mission.lanes.map((l) => l.pid));
  const ticks = $derived.by(() => {
    if (!slices) return 'none' as const;
    const d = deliveryOf(slices, MISSION_STEP_TYPES, mission.missionId, null);
    return tickLevel(d, crew.length > 0 ? crew : null, false);
  });

  let form: 'edit' | 'assign' | 'window' | null = $state(null);
  let offerTo = $state('');
  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');
  const id = $derived({ missionId: mission.missionId });
  const toCorrelate = $derived(correlatable(mission));
  const toClear = $derived(clearable(mission));
  const groupClash = $derived(slices ? groupClearConflicts(slices, mission, toClear) : []);

  /** The same step for several aircraft, one after the other. */
  function all(cmd: 'fm.correlated' | 'fm.clear', pids: string[]): void {
    command = host.sequence(
      pids.map((pid) =>
        cmd === 'fm.clear'
          ? { cmd, args: { ...id, pid, kind: 'hot' as const } }
          : { cmd, args: { ...id, pid } },
      ),
    );
  }

  function step(next: NonNullable<typeof slots.next>): void {
    if (next === 'assign') {
      form = 'assign';
      return;
    }
    command = host.send({ cmd: `fm.${next}`, args: id });
  }

  function back(kind: NonNullable<typeof slots.back>): void {
    command =
      kind === 'unassign'
        ? host.send({ cmd: 'fm.unassign', args: id })
        : host.send({ cmd: 'fm.reattack', args: { ...id, to: 'replan' } });
  }
</script>

{#if slices && who}
  <article class="mission">
    <header>
      {#if !compact}
        <button type="button" class="btn back" onclick={onclose}>{t('fm.back')}</button>
      {/if}
      <h3 class="mono">{mission.missionId}</h3>
      <span class="state {mission.state}">{t(`fm.state.${mission.state}`)}</span>
      {#if mission.gamePlan}<span class="tag"
          >{t('gp.type', { n: String(mission.gamePlan.control) })}</span
        >{/if}
      {#if mission.voiceOnly}<span class="tag amber">{t('fm.voiceOnly')}</span>{/if}
      <Ticks level={ticks} />
    </header>
    <p class="meta">
      {#if mission.assignee}
        {flightName(slices, mission.assignee.flightId)}
        {#if mission.assignee.pids}
          ({mission.assignee.pids.map((p) => callsignOf(slices, p)).join(', ')})
        {/if}
      {:else}
        {t('fm.unassigned')}
      {/if}
      · {t('fm.owner', { who: callsignOf(slices, mission.owner) })}
      · {t('fm.inCommand', { who: callsignOf(slices, mission.inCommand) })}
      · rev {mission.revision}
    </p>

    {#if !compact}
      <!-- Command (§10.2) -->
      <div class="command">
        {#if rights.offered}
          <p class="note">{t('fm.offeredToYou', { who: callsignOf(slices, mission.owner) })}</p>
          <button
            type="button"
            class="btn primary"
            disabled={busy}
            onclick={() => {
              command = host.send({ cmd: 'fm.acceptCommand', args: id });
            }}>{t('fm.accept')}</button
          >
        {/if}
        {#if rights.owner && rights.inCommand && otherJtacs.length > 0}
          {#if mission.commandOffer}
            <p class="note">{t('fm.offered', { who: callsignOf(slices, mission.commandOffer) })}</p>
          {:else}
            <label class="field offer">
              <span>{t('fm.offerTo')}</span>
              <select bind:value={offerTo}>
                <option value="" disabled>{t('fm.offerPick')}</option>
                {#each otherJtacs as j (j.pid)}
                  <option value={j.pid}>{j.callsign}</option>
                {/each}
              </select>
            </label>
            <button
              type="button"
              class="btn"
              disabled={busy || offerTo === ''}
              onclick={() => {
                command = host.send({ cmd: 'fm.offerCommand', args: { ...id, pid: offerTo } });
              }}>{t('fm.offer')}</button
            >
          {/if}
        {/if}
        {#if rights.owner && !rights.inCommand && rights.open}
          <ConfirmButton
            label={t('fm.reclaim')}
            disabled={busy}
            onconfirm={() => {
              command = host.send({ cmd: 'fm.reclaim', args: id });
            }}
          />
        {/if}
        {#if rights.inCommand && !rights.owner}
          <ConfirmButton
            label={t('fm.return')}
            disabled={busy}
            onconfirm={() => {
              command = host.send({ cmd: 'fm.returnCommand', args: id });
            }}
          />
        {/if}
        {#if !rights.inCommand && !rights.owner && !rights.offered && rights.open}
          <p class="note dim">{t('fm.notInCommand')}</p>
        {/if}
      </div>
    {/if}
    <!-- The shared steps in fixed slots (§10.3) -->
    {#if rights.inCommand}
      <div class="slots">
        <button
          type="button"
          class="btn"
          disabled={busy}
          onclick={() => {
            form = form === 'edit' ? null : 'edit';
          }}>{t('fm.edit')}</button
        >
        {#if slots.next}
          {@const next = slots.next}
          {#if next === 'complete' && readyToComplete(mission)}
            <!-- Every aircraft has its BDA: offered with one press. -->
            <button
              type="button"
              class="btn primary"
              disabled={busy}
              onclick={() => {
                step(next);
              }}>{t('fm.step.complete')}</button
            >
          {:else if next === 'complete'}
            <ConfirmButton
              label={t('fm.step.complete')}
              disabled={busy}
              onconfirm={() => {
                step(next);
              }}
            />
          {:else}
            <button
              type="button"
              class="btn primary"
              disabled={busy || !stepReady(mission, next)}
              onclick={() => {
                step(next);
              }}>{t(`fm.step.${next}`)}</button
            >
          {/if}
        {:else}
          <span class="empty" aria-hidden="true"></span>
        {/if}
        {#if slots.back}
          {@const kind = slots.back}
          <ConfirmButton
            label={t(`fm.step.${kind}`)}
            disabled={busy}
            onconfirm={() => {
              back(kind);
            }}
          />
        {:else}
          <span class="empty" aria-hidden="true"></span>
        {/if}
        <ConfirmButton
          label={t('fm.cancel')}
          disabled={busy}
          onconfirm={() => {
            command = host.send({ cmd: 'fm.cancel', args: id });
          }}
        />
      </div>
      {#if slots.next === 'assign' && !stepReady(mission, 'assign')}
        <p class="note amber">{t('fm.needGamePlan')}</p>
      {:else if slots.next === 'brief' && !stepReady(mission, 'brief')}
        <p class="note amber">{t('fm.needNineLine')}</p>
      {:else if mission.state === 'briefed'}
        <p class="note">{t('fm.readbackHint')}</p>
      {:else if readyToComplete(mission)}
        <p class="note ok">{t('fm.allBda')}</p>
      {/if}
      <div class="toggles">
        <button
          type="button"
          class="btn"
          disabled={busy}
          onclick={() => {
            command = host.send({
              cmd: 'fm.create',
              args: {
                aoId: mission.aoId,
                gamePlan: $state.snapshot(mission.gamePlan),
                nineLine: $state.snapshot(mission.nineLine),
                remarks: $state.snapshot(mission.remarks),
              },
            });
          }}>{t('fm.copy')}</button
        >
        <button
          type="button"
          class="btn"
          class:selected={mission.voiceOnly}
          aria-pressed={mission.voiceOnly}
          disabled={busy}
          onclick={() => {
            command = host.send({ cmd: 'fm.voiceOnly', args: { ...id, on: !mission.voiceOnly } });
          }}>{t('fm.voiceOnly')}</button
        >
      </div>
    {/if}
    {#if rights.owner && !rights.open}
      <div class="slots">
        <span class="empty" aria-hidden="true"></span>
        <span class="empty" aria-hidden="true"></span>
        <span class="empty" aria-hidden="true"></span>
        <ConfirmButton
          label={t('fm.delete')}
          disabled={busy}
          onconfirm={() => {
            command = host.send({ cmd: 'fm.delete', args: id });
            onclose();
          }}
        />
      </div>
    {/if}
    <CommandStatus id={command} />

    {#if form === 'edit' && rights.inCommand}
      <MissionEditor
        aoId={mission.aoId}
        {mission}
        onclose={() => {
          form = null;
        }}
        onsaved={() => {
          form = null;
        }}
      />
    {:else if form === 'assign' && mission.state === 'draft'}
      <AssignForm
        {mission}
        onclose={() => {
          form = null;
        }}
      />
    {/if}

    <!-- Type 3 window (§10.6) -->
    {#if type3 && mission.state === 'readbackCorrect'}
      <section class="window">
        <h4>{t('window.title')}</h4>
        {#if mission.window && !mission.window.revoked}
          {@const w = mission.window}
          <p class="mono">
            {mtimeText(slices, w.from)} – {mtimeText(slices, w.until)}
          </p>
          <p>
            {w.area === null
              ? t('window.area.ao')
              : 'cmId' in w.area
                ? (pointText(slices, { cmId: w.area.cmId }).name ?? w.area.cmId)
                : t('window.circleAround', {
                    nm: String(Math.round((w.area.radiusM / 1852) * 10) / 10),
                    point: pointText(slices, w.area.center).name ?? t('window.coords'),
                  })}
          </p>
          <p>{t('window.covers', { who: w.pids.map((p) => callsignOf(slices, p)).join(', ') })}</p>
          {#if w.targets.text}<p>{t('window.targets')}: {w.targets.text}</p>{/if}
          <LinkedList cmIds={w.targets.cmIds} style={who.style} />
          {#each w.restrictions as r (r)}<p class="amber">{r}</p>{/each}
          {#if rights.inCommand}
            <div class="end">
              <ConfirmButton
                label={t('window.revoke')}
                disabled={busy}
                onconfirm={() => {
                  command = host.send({ cmd: 'fm.windowRevoke', args: id });
                }}
              />
            </div>
          {/if}
        {:else if rights.inCommand}
          {#if form === 'window'}
            <WindowForm
              {mission}
              onclose={() => {
                form = null;
              }}
            />
          {:else}
            <button
              type="button"
              class="btn primary"
              disabled={busy}
              onclick={() => {
                form = 'window';
              }}>{t('window.set')}</button
            >
          {/if}
        {:else}
          <p class="dim">{t('window.none')}</p>
        {/if}
      </section>
    {/if}

    {#if mission.lanes.length > 0}
      <section class="lanes">
        <h4>{t('fm.lanes')}</h4>
        {#if rights.inCommand && (toCorrelate.length > 1 || toClear.length > 1)}
          <!-- One press for the whole flight; each aircraft still gets its own step in the log. -->
          <div class="group">
            <!-- Two fixed slots: a second tap on CORRELATED – ALL never lands on a clearance. -->
            {#if toCorrelate.length > 1}
              <button
                type="button"
                class="btn primary"
                disabled={busy}
                onclick={() => {
                  all('fm.correlated', toCorrelate);
                }}>{t('fm.correlateAll')}</button
              >
            {:else}
              <span class="empty" aria-hidden="true"></span>
            {/if}
            {#if toClear.length > 1 && groupClash.length > 0}
              <ConfirmButton
                label={t('fm.clearAll')}
                disabled={busy}
                onconfirm={() => {
                  all('fm.clear', toClear);
                }}
              />
            {:else if toClear.length > 1}
              <button
                type="button"
                class="btn primary"
                disabled={busy}
                onclick={() => {
                  all('fm.clear', toClear);
                }}>{t('fm.clearAll')}</button
              >
            {:else}
              <span class="empty" aria-hidden="true"></span>
            {/if}
          </div>
          {#if toClear.length > 1 && groupClash.length > 0}
            <p class="note amber">
              <strong>{t('warning.laserConflict')}</strong>
              {t('fm.clearAll.conflict', {
                who: groupClash.map((x) => callsignOf(slices, x.pid)).join(', '),
              })}
            </p>
          {/if}
        {/if}
        {#each mission.lanes as lane (lane.pid)}
          <LaneCard {mission} {lane} {rights} />
        {/each}
      </section>
    {/if}
    {#if compact}
      <Fold title={t('fm.details')} note={mission.nineLine?.description ?? ''}>
        <!-- Command (§10.2) -->
        <div class="command">
          {#if rights.offered}
            <p class="note">{t('fm.offeredToYou', { who: callsignOf(slices, mission.owner) })}</p>
            <button
              type="button"
              class="btn primary"
              disabled={busy}
              onclick={() => {
                command = host.send({ cmd: 'fm.acceptCommand', args: id });
              }}>{t('fm.accept')}</button
            >
          {/if}
          {#if rights.owner && rights.inCommand && otherJtacs.length > 0}
            {#if mission.commandOffer}
              <p class="note">
                {t('fm.offered', { who: callsignOf(slices, mission.commandOffer) })}
              </p>
            {:else}
              <label class="field offer">
                <span>{t('fm.offerTo')}</span>
                <select bind:value={offerTo}>
                  <option value="" disabled>{t('fm.offerPick')}</option>
                  {#each otherJtacs as j (j.pid)}
                    <option value={j.pid}>{j.callsign}</option>
                  {/each}
                </select>
              </label>
              <button
                type="button"
                class="btn"
                disabled={busy || offerTo === ''}
                onclick={() => {
                  command = host.send({ cmd: 'fm.offerCommand', args: { ...id, pid: offerTo } });
                }}>{t('fm.offer')}</button
              >
            {/if}
          {/if}
          {#if rights.owner && !rights.inCommand && rights.open}
            <ConfirmButton
              label={t('fm.reclaim')}
              disabled={busy}
              onconfirm={() => {
                command = host.send({ cmd: 'fm.reclaim', args: id });
              }}
            />
          {/if}
          {#if rights.inCommand && !rights.owner}
            <ConfirmButton
              label={t('fm.return')}
              disabled={busy}
              onconfirm={() => {
                command = host.send({ cmd: 'fm.returnCommand', args: id });
              }}
            />
          {/if}
          {#if !rights.inCommand && !rights.owner && !rights.offered && rights.open}
            <p class="note dim">{t('fm.notInCommand')}</p>
          {/if}
        </div>

        <!-- Changes after the brief (§10.5) -->
        {#if mission.changes.length > 0}
          <section class="changes">
            <h4>{t('fm.changes')}</h4>
            {#each mission.changes as c (c.rev)}
              {@const waiting = pendingAcks(mission, c.rev)}
              <p>
                <span class="mono">rev {c.rev}</span>
                {c.fields.map((f) => t(fieldKey(f))).join(', ')} –
                {#if waiting.length === 0}
                  <span class="ok">{t('fm.ackedAll')}</span>
                {:else}
                  <span class="amber">
                    {t('fm.ackWaiting', {
                      who: waiting.map((p) => callsignOf(slices, p)).join(', '),
                    })}
                  </span>
                {/if}
              </p>
            {/each}
          </section>
        {/if}

        <NineLineView {mission} style={who.style} changed={unackedChanges(mission)} />
      </Fold>
    {:else}
      <!-- Changes after the brief (§10.5) -->
      {#if mission.changes.length > 0}
        <section class="changes">
          <h4>{t('fm.changes')}</h4>
          {#each mission.changes as c (c.rev)}
            {@const waiting = pendingAcks(mission, c.rev)}
            <p>
              <span class="mono">rev {c.rev}</span>
              {c.fields.map((f) => t(fieldKey(f))).join(', ')} –
              {#if waiting.length === 0}
                <span class="ok">{t('fm.ackedAll')}</span>
              {:else}
                <span class="amber">
                  {t('fm.ackWaiting', {
                    who: waiting.map((p) => callsignOf(slices, p)).join(', '),
                  })}
                </span>
              {/if}
            </p>
          {/each}
        </section>
      {/if}

      <NineLineView {mission} style={who.style} changed={unackedChanges(mission)} />
    {/if}
  </article>
{/if}

<style>
  .mission {
    display: grid;
    gap: 0.75rem;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.75rem;
  }

  h3 {
    margin: 0;
  }

  h4 {
    margin: 0 0 0.35rem;
    color: var(--text-dim);
    font-size: 0.8125rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .back {
    min-width: 0;
    padding: 0 0.75rem;
  }

  .meta {
    margin: 0;
    color: var(--text-dim);
    font-size: 0.875rem;
  }

  .state,
  .tag {
    padding: 0.1rem 0.45rem;
    border: 1px solid var(--line);
    border-radius: 0.3rem;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .state.readbackCorrect {
    border-color: var(--green);
    color: var(--green);
  }

  .state.briefed,
  .state.assigned {
    border-color: var(--blue);
    color: var(--blue);
  }

  .tag.amber {
    border-color: var(--amber);
  }

  .command {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.5rem;
  }

  .command .note {
    flex-basis: 100%;
    margin: 0;
  }

  .offer {
    flex: 1 1 10rem;
  }

  .slots {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .slots :global(button) {
    min-width: 0;
    padding: 0 0.4rem;
  }

  .toggles,
  .end {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .group {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .group :global(button) {
    min-width: 0;
    padding: 0 0.4rem;
  }

  .window,
  .changes,
  .lanes {
    display: grid;
    gap: 0.4rem;
  }

  .window p,
  .changes p {
    margin: 0;
  }

  .amber {
    color: var(--amber);
  }

  .ok {
    color: var(--green);
  }

  .dim {
    color: var(--text-dim);
  }

  @media (max-width: 30rem) {
    .slots {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
