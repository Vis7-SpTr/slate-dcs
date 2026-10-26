<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  One fire mission on the pilot's screen (ui-design.md §7, protocol.md §10,
  P2.7): only his own lane. A full-width red ABORT banner the moment one
  stands; the clearance in a fixed slot, worded for dual clearance ("CLEARED
  HOT – confirm voice", NOT CLEARED otherwise); changes highlighted in the
  9-line with one ACK; the 9-line in his airframe's coordinate format; his
  SPI; BDA with ACK; ABORT for his own lane far right, tap-to-arm.
-->
<script lang="ts">
  import type { FireMission, LatLon } from '@slate-dcs/shared';

  import CommandStatus from '../../../components/CommandStatus.svelte';
  import ConfirmButton from '../../../components/ConfirmButton.svelte';
  import CoordInput from '../../../components/CoordInput.svelte';
  import Ticks from '../../../components/Ticks.svelte';
  import {
    callsignOf,
    casWho,
    deliveryOf,
    mtimeText,
    pointText,
    positionText,
    tickLevel,
  } from '../../../lib/cas.js';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';
  import {
    abortNotice,
    ownLane,
    pendingRevs,
    pilotClearance,
    spiOffset,
    unackedChanges,
    weaponCode,
  } from '../../../lib/missions.js';
  import NineLineView from '../NineLineView.svelte';

  const { mission }: { mission: FireMission } = $props();

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  const pid = $derived(slices?.session.pid ?? null);
  const lane = $derived(ownLane(mission, pid));
  const clearance = $derived(pilotClearance(mission, pid));
  const abort = $derived(abortNotice(mission, pid));
  const pending = $derived(pendingRevs(mission, pid));
  const changed = $derived(pid ? unackedChanges(mission, pid) : {});
  const offset = $derived(slices && lane ? spiOffset(slices, mission, lane) : null);
  const myCode = $derived(slices && pid ? weaponCode(slices, mission, pid) : null);
  const cleared = $derived(clearance === 'hot' || clearance === 'dry' || clearance === 'window');
  const win = $derived(mission.window && !mission.window.revoked ? mission.window : null);
  const spiTicks = $derived(
    slices ? tickLevel(deliveryOf(slices, 'fm.spi', mission.missionId), null, false) : 'none',
  );

  let spi: LatLon | null = $state(null);
  let spiElevation = $state('');
  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');

  function ack(): void {
    // One ACK for every change he hasn't acknowledged yet (§10.5).
    for (const rev of pending) {
      command = host.send({ cmd: 'fm.ackChange', args: { missionId: mission.missionId, rev } });
    }
  }

  function sendSpi(): void {
    if (!spi) return;
    const ft = Number(spiElevation.replace(',', '.'));
    command = host.send({
      cmd: 'fm.spi',
      args: {
        missionId: mission.missionId,
        spi: {
          lat: spi.lat,
          lon: spi.lon,
          elevM: spiElevation.trim() === '' || !Number.isFinite(ft) ? null : ft * 0.3048,
        },
      },
    });
  }
</script>

{#if slices && who}
  <article class="card">
    {#if abort}
      <div class="abort" role="alert">
        <strong>ABORT – {abort.reason}</strong>
        <span>
          {abort.by === 'relay' ? 'SLATE' : callsignOf(slices, abort.by)} ({t(
            `abort.channel.${abort.channel}`,
          )}) · {t('pilot.fm.abortHint')}
        </span>
      </div>
    {/if}
    {#if mission.voiceOnly}
      <div class="voice" role="status">{t('pilot.fm.voiceOnly')}</div>
    {/if}

    <header>
      <h3 class="mono">{mission.missionId}</h3>
      {#if mission.gamePlan}<span class="tag"
          >{t('gp.type', { n: String(mission.gamePlan.control) })}</span
        >{/if}
      <span class="tag">{t(`fm.state.${mission.state}`)}</span>
      <span class="dim">{t('fm.inCommand', { who: callsignOf(slices, mission.inCommand) })}</span>
    </header>

    <!-- The clearance slot: always here, always worded for dual clearance (§10.6). -->
    <div class="clearance {cleared ? 'cleared' : clearance}" aria-live="assertive">
      {#if clearance === 'hot' || clearance === 'dry' || clearance === 'window'}
        <strong>{t(`pilot.clear.${clearance}`)}</strong>
        <span>{t('pilot.clear.confirmVoice')}</span>
        {#if clearance === 'window' && win}
          <span class="mono">
            {mtimeText(slices, win.from)} – {mtimeText(slices, win.until)}
            {win.area === null
              ? t('window.area.ao')
              : 'cmId' in win.area
                ? (pointText(slices, { cmId: win.area.cmId }).name ?? '')
                : t('window.circleAround', {
                    nm: String(Math.round((win.area.radiusM / 1852) * 10) / 10),
                    point: pointText(slices, win.area.center).name ?? t('window.coords'),
                  })}
          </span>
        {/if}
      {:else}
        <strong>{t(`pilot.clear.${clearance}`)}</strong>
        <span>{t(`pilot.clear.${clearance}.hint`)}</span>
      {/if}
    </div>

    {#if pending.length > 0}
      <div class="changed" role="alert">
        <span>{t('pilot.fm.changed')}</span>
      </div>
    {/if}

    {#if lane?.bda}
      <div class="bda">
        <span class="label">BDA</span>
        <span>{t(`bda.effect.${lane.bda.effect}`)} – {lane.bda.target || '—'}</span>
        {#if lane.bda.remarks}<span class="dim">{lane.bda.remarks}</span>{/if}
        {#if lane.bda.acked}<span class="ok">{t('lane.bdaAcked')}</span>{/if}
      </div>
    {/if}

    <!-- Fixed slots: ACK (changes or BDA) · – · ABORT far right. -->
    <div class="slots">
      {#if pending.length > 0}
        <button type="button" class="btn primary big" disabled={busy} onclick={ack}>ACK</button>
      {:else if lane?.bda && !lane.bda.acked}
        <button
          type="button"
          class="btn primary big"
          disabled={busy}
          onclick={() => {
            command = host.send({ cmd: 'fm.ackBda', args: { missionId: mission.missionId } });
          }}>{t('pilot.fm.ackBda')}</button
        >
      {:else}
        <span class="empty" aria-hidden="true"></span>
      {/if}
      <span class="empty" aria-hidden="true"></span>
      {#if lane && clearance !== 'closed' && lane.state === 'cleared'}
        <ConfirmButton
          label={t('lane.abort')}
          danger
          disabled={busy}
          onconfirm={() => {
            if (pid)
              command = host.send({
                cmd: 'fm.abort',
                args: {
                  missionId: mission.missionId,
                  pid,
                  channel: 'app',
                  reason: t('pilot.fm.abortReason'),
                },
              });
          }}
        />
      {:else}
        <span class="empty" aria-hidden="true"></span>
      {/if}
    </div>
    <CommandStatus id={command} />

    <NineLineView {mission} style={who.style} {changed} />

    {#if mission.nineLine?.mark.type === 'laser' && myCode !== null}
      <p class="note">{t('pilot.fm.weaponCode', { code: String(myCode) })}</p>
    {/if}

    {#if lane && clearance !== 'closed'}
      <section class="spi">
        <h4>{t('pilot.fm.spi')}</h4>
        {#if lane.spi}
          <p class="mono">
            {positionText(lane.spi, who.style)[0]}
            {#if offset}
              <span class="dim">
                {t('lane.spiOffset', {
                  m: String(Math.round(offset.distanceM)),
                  deg: String(offset.bearingDeg).padStart(3, '0'),
                })}
              </span>
            {/if}
          </p>
        {/if}
        <CoordInput bind:value={spi} label={t('pilot.fm.spiInput')} style={who.style} />
        <div class="spi-send">
          <label class="field">
            <span>{t('pilot.fm.spiElevation')}</span>
            <input class="mono" inputmode="numeric" bind:value={spiElevation} />
          </label>
          <button type="button" class="btn" disabled={busy || spi === null} onclick={sendSpi}
            >{t('pilot.fm.sendSpi')}</button
          >
          <Ticks level={spiTicks} />
        </div>
      </section>
    {/if}
  </article>
{/if}

<style>
  .card {
    display: grid;
    gap: 0.6rem;
  }

  .abort {
    display: grid;
    gap: 0.2rem;
    padding: 0.75rem 1rem;
    border: 2px solid var(--red);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--red) 25%, var(--surface));
  }

  .abort strong {
    font-size: 1.5rem;
    letter-spacing: 0.02em;
  }

  .voice {
    padding: 0.5rem 0.75rem;
    border: 2px solid var(--amber);
    border-radius: var(--radius);
    color: var(--amber);
    font-weight: 700;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.75rem;
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

  .tag {
    padding: 0.05rem 0.45rem;
    border: 1px solid var(--line);
    border-radius: 0.3rem;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .clearance {
    display: grid;
    gap: 0.2rem;
    min-height: 4.5rem;
    padding: 0.6rem 1rem;
    border: 2px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .clearance strong {
    font-size: 1.5rem;
    letter-spacing: 0.02em;
  }

  .clearance.cleared {
    border-color: var(--green);
    color: var(--green);
  }

  .clearance.waitingBda,
  .clearance.bda,
  .clearance.closed {
    color: var(--text-dim);
  }

  .changed {
    padding: 0.5rem 0.75rem;
    border: 2px solid var(--amber);
    border-radius: var(--radius);
    color: var(--amber);
    font-weight: 700;
  }

  .bda {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  .label {
    color: var(--text-dim);
    font-weight: 700;
  }

  .slots {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .slots :global(button) {
    min-width: 0;
    padding: 0 0.4rem;
  }

  .big {
    font-size: 1.125rem;
  }

  .spi {
    display: grid;
    gap: 0.4rem;
  }

  .spi p {
    margin: 0;
  }

  .spi-send {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.5rem;
  }

  .spi-send .field {
    flex: 1 1 8rem;
  }

  .dim {
    color: var(--text-dim);
  }

  .ok {
    color: var(--green);
  }
</style>
