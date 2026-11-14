<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  CAS → Flights for a pilot (ui-design.md §7, P2.7): his own flight in full –
  check-in, the AO's JTACs with their frequencies, members with fuel and
  status age, laser codes, his hold with WILCO, the situation updates with
  COPY, fuel calls – and the other flights in the AO as slim cards (callsign,
  hold, altitude block) from the holding stack.
-->
<script lang="ts">
  import { fuelUnit, unitDisplayName } from '@slate-dcs/shared';
  import type { SitUpdateNote } from '@slate-dcs/shared';

  import Card from '../../../components/Card.svelte';
  import CommandStatus from '../../../components/CommandStatus.svelte';
  import EmptyState from '../../../components/EmptyState.svelte';
  import Fold from '../../../components/Fold.svelte';
  import Ticks from '../../../components/Ticks.svelte';
  import {
    altText,
    callsignOf,
    casWho,
    checkInOf,
    deliveryOf,
    flightName,
    holdShapeText,
    mtimeText,
    pointText,
    positionText,
    tickLevel,
  } from '../../../lib/cas.js';
  import { clock } from '../../../lib/clock.svelte.js';
  import { formatAge, formatFuel } from '../../../lib/format.js';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';

  /** `folded`: a mission is up – hold, updates and flight fold to one line each. */
  const { folded = false }: { folded?: boolean } = $props();

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  const own = $derived(slices?.flight.own ?? null);
  const checkIn = $derived(slices && own ? checkInOf(slices, own.flightId) : null);
  const ao = $derived(slices?.cas.aos.find((a) => a.aoId === checkIn?.aoId) ?? null);
  const hold = $derived(slices?.cas.holds.find((h) => h.flightId === own?.flightId) ?? null);
  const others = $derived(
    slices?.cas.holds.filter((h) => h.flightId !== own?.flightId && h.aoId === ao?.aoId) ?? [],
  );
  const notes = $derived(
    slices?.cas.sitUpdates.filter(
      (n) => n.aoId === checkIn?.aoId && (n.flightId === null || n.flightId === own?.flightId),
    ) ?? [],
  );
  const members = $derived([...(own?.members ?? [])].sort((a, b) => a.pos - b.pos));
  const calls = $derived(slices?.fuelCalls.received ?? []);

  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');

  function fuelOf(pid: string): number | null {
    if (!slices) return null;
    if (pid === slices.session.pid) return slices.ownship.status?.fuel?.internalKg ?? null;
    return slices.flight.status.find((s) => s.pid === pid)?.status.fuel?.internalKg ?? null;
  }

  function ageOf(pid: string): string {
    if (!slices) return '';
    const at =
      pid === slices.session.pid
        ? slices.ownship.statusAt
        : (slices.flight.status.find((s) => s.pid === pid)?.receivedAt ?? null);
    return at === null ? t('flight.noStatus') : formatAge(clock.now - at);
  }

  const sitFields = ['threats', 'targets', 'friendlies'] as const;
  const sitTexts = ['fires', 'clearanceAuthority', 'restrictions', 'hazards'] as const;
  const sitLabel = {
    threats: 'sit.threats',
    targets: 'sit.targets',
    friendlies: 'sit.friendlies',
    fires: 'sit.fires',
    clearanceAuthority: 'sit.authority',
    restrictions: 'sit.restrictions',
    hazards: 'sit.hazards',
  } as const;
  const filled = (n: SitUpdateNote) => [
    ...sitFields.filter((f) => n.update[f].text !== '').map((f) => [f, n.update[f].text] as const),
    ...sitTexts.filter((f) => n.update[f] !== '').map((f) => [f, n.update[f]] as const),
  ];
</script>

{#if !slices || !who || slices.session.state !== 'joined'}
  <EmptyState title={t('cas.flights')} text={t('cas.noSession')} />
{:else if !own}
  <EmptyState title={t('cas.flights')} text={t('brief.noFlight')} />
{:else}
  <div class="board">
    {#if hold}
      {@const p = pointText(slices, hold.point)}
      {@const wilco = deliveryOf(slices, 'cas.hold.wilco', hold.holdId)}
      {@const wilcoed = slices.cas.holdWilcos.some(
        (w) => w.holdId === hold.holdId && w.pid === slices.session.pid,
      )}
      <Fold
        title={t('cas.hold')}
        note={`${p.name ?? t('cas.coords')} · ${altText(hold.floor)} – ${altText(hold.ceiling)}${wilcoed ? ' · WILCO' : ''}`}
        open={!folded || !wilcoed}
      >
        <Card title={p.name ?? t('cas.coords')}>
          {#if p.at}<p class="mono">{positionText(p.at, who.style).join(' · ')}</p>{/if}
          <p class="mono">{altText(hold.floor)} – {altText(hold.ceiling)}</p>
          <p>{holdShapeText(hold)}</p>
          <p class="dim">
            {hold.from === null ? '' : mtimeText(slices, hold.from)} –
            {hold.until === null ? t('hold.open') : mtimeText(slices, hold.until)}
          </p>
          <div class="row-actions">
            {#if wilcoed}
              <span class="ok">{t('pilot.wilcoSent')}</span>
            {:else}
              <button
                type="button"
                class="btn primary"
                disabled={busy}
                onclick={() => {
                  command = host.send({ cmd: 'cas.hold.wilco', args: { holdId: hold.holdId } });
                }}>WILCO</button
              >
            {/if}
            <Ticks level={tickLevel(wilco, null, false)} />
          </div>
        </Card>
      </Fold>
    {/if}

    {#each notes as n (n.id)}
      <Fold
        title={n.flightId === null
          ? t('pilot.sitAll', { from: callsignOf(slices, n.from) })
          : t('pilot.sit', { from: callsignOf(slices, n.from) })}
        note={n.copied ? t('pilot.copied') : ''}
        open={!folded || !n.copied}
      >
        <Card title={t('cas.sitUpdate')}>
          {#each filled(n) as [field, text] (field)}
            <p class="line">
              <span class="label">{t(sitLabel[field])}</span>
              <span>{text}</span>
            </p>
          {:else}
            <p class="dim">{t('value.none')}</p>
          {/each}
          <div class="row-actions">
            {#if n.copied}
              <span class="ok">{t('pilot.copied')}</span>
            {:else}
              <button
                type="button"
                class="btn primary"
                disabled={busy}
                onclick={() => {
                  command = host.send({ cmd: 'cas.sitCopy', args: { id: n.id } });
                }}>COPY</button
              >
            {/if}
          </div>
        </Card>
      </Fold>
    {/each}

    <Fold
      title={own.display}
      note={checkIn
        ? t('brief.checkedIn', { ao: ao?.name ?? checkIn.aoId })
        : t('brief.notCheckedIn')}
      open={!folded}
    >
      <Card title={own.display}>
        {#if checkIn}
          <p class="state ok">{t('brief.checkedIn', { ao: ao?.name ?? checkIn.aoId })}</p>
          {#if checkIn.primary}
            <p class="dim">{t('cas.primary', { jtac: callsignOf(slices, checkIn.primary) })}</p>
          {/if}
        {:else}
          <p class="state">{t('brief.notCheckedIn')}</p>
          <p class="dim">{t('pilot.checkInHint')}</p>
        {/if}

        {#if ao}
          <h4>{t('station.jtacs')}</h4>
          <ul class="list">
            {#each ao.jtacs as j (j.pid)}
              <li>
                <span class="who">{j.callsign}</span>
                {#if ao.inCommand === j.pid}<span class="dim">{t('station.inCommand')}</span>{/if}
                {#if j.presence === 'lost'}<span class="amber">{t('flight.lost')}</span>{/if}
                <span class="mono freqs">
                  {j.freqs
                    .map((f) => `${f.mhz.toFixed(3)}${f.label ? ` ${f.label}` : ''}`)
                    .join(' · ') || t('value.none')}
                </span>
              </li>
            {/each}
          </ul>
        {/if}

        <h4>{t('pilot.members')}</h4>
        <ul class="list">
          {#each members as m (m.pid)}
            {@const code =
              checkIn?.brief.laserCodes.perAircraft[m.pid] ?? checkIn?.brief.laserCodes.flight}
            <li class:me={m.pid === slices.session.pid}>
              <span class="who">{own.display}-{m.pos}</span>
              <span>{m.aircraft?.type ? unitDisplayName(m.aircraft.type) : '—'}</span>
              <span class="mono">{formatFuel(fuelOf(m.pid), fuelUnit(m.aircraft?.type))}</span>
              {#if code}<span class="mono">{t('cas.code', { code })}</span>{/if}
              {#if m.presence === 'lost'}<span class="amber">{t('flight.lost')}</span>{/if}
              <span class="dim">{ageOf(m.pid)}</span>
            </li>
          {/each}
        </ul>

        {#each calls as c, i (i)}
          <p class="call {c.call}">
            {c.callsign}
            {c.call.toUpperCase()} · {formatFuel(
              c.internalKg,
              fuelUnit(slices.ownship.aircraft?.type),
            )}
          </p>
        {/each}
      </Card>
    </Fold>

    {#if others.length > 0}
      <h4>{t('pilot.others')}</h4>
      {#each others as h (h.holdId)}
        {@const p = pointText(slices, h.point)}
        <div class="slim">
          <span class="who">{flightName(slices, h.flightId)}</span>
          <span>{p.name ?? t('cas.coords')}</span>
          <span class="mono">{altText(h.floor)} – {altText(h.ceiling)}</span>
          {#if h.conflicts.includes(hold?.holdId ?? '')}
            <span class="amber">{t('hold.conflict')}</span>
          {/if}
        </div>
      {/each}
    {/if}
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

  h4 {
    margin: 0.75rem 0 0.35rem;
    color: var(--text-dim);
    font-size: 0.8125rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .state {
    font-weight: 700;
  }

  .ok {
    color: var(--green);
  }

  .list {
    display: grid;
    gap: 0.35rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .list li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .list li.me {
    border-color: var(--blue);
  }

  .who {
    font-weight: 700;
  }

  .freqs {
    flex-basis: 100%;
  }

  .big {
    font-size: 1.25rem;
    font-weight: 700;
  }

  .line {
    display: grid;
    grid-template-columns: minmax(6rem, 9rem) 1fr;
    gap: 0.5rem;
    margin: 0;
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--line);
  }

  .label {
    color: var(--text-dim);
  }

  .row-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.6rem;
  }

  .call {
    margin: 0.4rem 0 0;
    font-weight: 700;
    color: var(--amber);
  }

  .call.bingo {
    color: var(--red);
  }

  .slim {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  .dim {
    color: var(--text-dim);
  }

  .amber {
    color: var(--amber);
  }
</style>
