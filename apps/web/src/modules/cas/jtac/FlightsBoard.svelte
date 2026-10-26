<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  CAS → Flights for a JTAC (ui-design.md §7, P2.6): one card per flight
  checked in to his AO – callsign, aircraft, playtime left, ordnance, fuel and
  status age per aircraft, laser codes, hold, missions, fuel calls. Opening a
  card shows the rest of the brief. SIT UPDATE, HOLD and RELEASE in fixed slots.
-->
<script lang="ts">
  import { fuelUnit, unitDisplayName } from '@slate-dcs/shared';
  import type { CheckIn } from '@slate-dcs/shared';

  import Card from '../../../components/Card.svelte';
  import CommandStatus from '../../../components/CommandStatus.svelte';
  import ConfirmButton from '../../../components/ConfirmButton.svelte';
  import EmptyState from '../../../components/EmptyState.svelte';
  import { callsignOf, casWho, mtimeText, pointText, altText } from '../../../lib/cas.js';
  import { clock } from '../../../lib/clock.svelte.js';
  import { formatAge, formatFuel } from '../../../lib/format.js';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';
  import HoldForm from '../HoldForm.svelte';
  import SitUpdateForm from '../SitUpdateForm.svelte';

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  const ao = $derived(who?.ao ?? null);
  const checkIns = $derived(slices?.cas.checkIns.filter((c) => c.aoId === ao?.aoId) ?? []);

  /** Screen-local: which card is open and which form shows. */
  let openCard: string | null = $state(null);
  let form: { flightId: string; kind: 'sit' | 'hold' } | null = $state(null);
  let command: string | null = $state(null);

  function types(c: CheckIn): string {
    const counts: Record<string, number> = {};
    for (const a of c.brief.aircraft) {
      const name = unitDisplayName(a.type);
      counts[name] = (counts[name] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, n]) => `${String(n)}× ${name}`)
      .join(', ');
  }

  /** Minutes on station left, from the playtime at check-in. */
  function playtimeLeft(c: CheckIn): number | null {
    if (c.brief.playtimeMin === null) return null;
    return Math.round(c.brief.playtimeMin - (clock.now - c.since) / 60_000);
  }

  function statusOf(pid: string) {
    return slices?.flight.status.find((s) => s.pid === pid) ?? null;
  }

  function codeOf(c: CheckIn, pid: string): number | null {
    return c.brief.laserCodes.perAircraft[pid] ?? c.brief.laserCodes.flight;
  }
</script>

{#if !slices || !who}
  <EmptyState title={t('cas.flights')} text={t('cas.noSession')} />
{:else if !ao}
  <EmptyState title={t('cas.flights')} text={t('cas.jtac.offStation')} />
{:else if checkIns.length === 0}
  <EmptyState title={t('cas.flights')} text={t('cas.flights.none', { ao: ao.name })} />
{:else}
  <div class="board">
    {#each checkIns as c (c.checkInId)}
      {@const left = playtimeLeft(c)}
      {@const hold = slices.cas.holds.find((h) => h.flightId === c.flightId)}
      {@const missions = slices.missions.missions.filter(
        (m) => m.assignee?.flightId === c.flightId,
      )}
      {@const calls = slices.fuelCalls.received.filter((f) =>
        c.brief.aircraft.some((a) => a.pid === f.pid),
      )}
      <Card title={c.brief.callsign}>
        <button
          type="button"
          class="summary"
          aria-expanded={openCard === c.checkInId}
          onclick={() => {
            openCard = openCard === c.checkInId ? null : c.checkInId;
          }}
        >
          <span class="types">{types(c)}</span>
          <span class="dim">
            {c.primary ? t('cas.primary', { jtac: callsignOf(slices, c.primary) }) : t('cas.toAo')}
          </span>
          {#if left !== null}
            <span class="tag" class:amber={left <= 10}
              >{t('cas.playtime', { min: Math.max(0, left) })}</span
            >
          {/if}
          {#each calls.slice(-1) as call (call.receivedAt)}
            <span class="tag amber">{call.call.toUpperCase()} {call.callsign}</span>
          {/each}
        </button>

        <p class="ordnance mono">
          {c.brief.ordnance.map((o) => `${String(o.count)}× ${o.name}`).join(' · ') ||
            t('cas.noOrdnance')}
        </p>

        <ul class="aircraft">
          {#each c.brief.aircraft as a, i (a.pid)}
            {@const s = statusOf(a.pid)}
            <li>
              <span class="mono slot">-{i + 1}</span>
              <span class="who">{callsignOf(slices, a.pid)}</span>
              <span class="dim">{unitDisplayName(a.type)}</span>
              <span class="mono">
                {s?.status.fuel
                  ? formatFuel(
                      s.status.fuel.internalKg + s.status.fuel.externalKg,
                      fuelUnit(a.type),
                    )
                  : t('value.none')}
              </span>
              <span class="mono">{t('cas.code', { code: codeOf(c, a.pid) ?? '—' })}</span>
              <span class="dim"
                >{s ? formatAge(clock.now - s.receivedAt) : t('flight.noStatus')}</span
              >
            </li>
          {/each}
        </ul>

        {#if hold}
          {@const p = pointText(slices, hold.point)}
          <p class="line">
            <span class="label">{t('cas.hold')}</span>
            <span
              >{p.name ?? t('cas.coords')} · {altText(hold.floor)} – {altText(hold.ceiling)}</span
            >
            {#if hold.conflicts.length > 0}<span class="tag amber">{t('hold.conflict')}</span>{/if}
          </p>
        {/if}
        {#if missions.length > 0}
          <p class="line">
            <span class="label">{t('cas.missions')}</span>
            <span
              >{missions.map((m) => `${m.missionId} ${t(`fm.state.${m.state}`)}`).join(' · ')}</span
            >
          </p>
        {/if}

        {#if openCard === c.checkInId}
          <div class="details">
            <p class="line">
              <span class="label">{t('cas.since')}</span>
              <span>{formatAge(clock.now - c.since)}</span>
            </p>
            <p class="line">
              <span class="label">{t('cas.capabilities')}</span>
              <span
                >{c.brief.capabilities.map((cap) => t(`cap.${cap}`)).join(', ') ||
                  t('value.none')}</span
              >
            </p>
            <p class="line">
              <span class="label">{t('cas.abortCode')}</span><span class="mono"
                >{c.brief.abortCode ?? t('value.none')}</span
              >
            </p>
            {#if c.brief.missionNumber}
              <p class="line">
                <span class="label">{t('cas.missionNumber')}</span><span class="mono"
                  >{c.brief.missionNumber}</span
                >
              </p>
            {/if}
            {#if c.brief.remarks}<p class="remarks">{c.brief.remarks}</p>{/if}
            {#each slices.cas.sitUpdates.filter((n) => n.flightId === c.flightId) as note (note.id)}
              <p class="line">
                <span class="label">{t('cas.lastSit')}</span>
                <span>{note.copied ? t('sit.copied') : t('sit.notCopied')}</span>
              </p>
            {/each}
            {#if hold?.from !== undefined && hold.from !== null}
              <p class="line">
                <span class="label">{t('hold.from')}</span><span class="mono"
                  >{mtimeText(slices, hold.from)}</span
                >
              </p>
            {/if}
          </div>
        {/if}

        {#if form?.flightId === c.flightId && form.kind === 'sit'}
          <SitUpdateForm
            aoId={ao.aoId}
            flightId={c.flightId}
            target={c.brief.callsign}
            onclose={() => {
              form = null;
            }}
          />
        {:else if form?.flightId === c.flightId && form.kind === 'hold'}
          <HoldForm
            aoId={ao.aoId}
            flightId={c.flightId}
            hold={hold ?? null}
            onclose={() => {
              form = null;
            }}
          />
        {/if}

        <!-- Fixed slots (ui-design.md §6): RELEASE always far right. -->
        <div class="actions">
          <button
            type="button"
            class="btn"
            onclick={() => {
              form = { flightId: c.flightId, kind: 'sit' };
            }}>{t('cas.sitUpdate')}</button
          >
          <button
            type="button"
            class="btn"
            onclick={() => {
              form = { flightId: c.flightId, kind: 'hold' };
            }}>{hold ? t('cas.holdChange') : t('cas.holdAssign')}</button
          >
          <span class="spacer"></span>
          <ConfirmButton
            label={t('cas.release')}
            onconfirm={() => {
              command = host.send({ cmd: 'cas.release', args: { flightId: c.flightId } });
            }}
          />
        </div>
      </Card>
    {/each}
    <CommandStatus id={command} />
  </div>
{/if}

<style>
  .board {
    display: grid;
    gap: 0.75rem;
    max-width: 44rem;
    margin-inline: auto;
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.75rem;
    width: 100%;
    min-height: var(--touch);
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
  }

  .types {
    font-weight: 700;
  }

  .dim {
    color: var(--text-dim);
  }

  .tag {
    padding: 0.1rem 0.45rem;
    border: 1px solid var(--line);
    border-radius: 0.3rem;
    color: var(--text-dim);
    font-size: 0.75rem;
    font-weight: 700;
  }

  .tag.amber {
    border-color: var(--amber);
    color: var(--amber);
  }

  .ordnance {
    margin: 0.4rem 0;
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }

  .aircraft {
    display: grid;
    gap: 0.3rem;
    margin: 0 0 0.5rem;
    padding: 0;
    list-style: none;
  }

  .aircraft li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.2rem 0.75rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    font-size: 0.875rem;
  }

  .slot,
  .who {
    font-weight: 700;
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.75rem;
    margin: 0.25rem 0;
    font-size: 0.875rem;
  }

  .label {
    min-width: 7rem;
    color: var(--text-dim);
  }

  .details {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--surface-3);
  }

  .remarks {
    margin: 0.4rem 0;
    font-size: 0.875rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .spacer {
    flex: 1;
  }
</style>
