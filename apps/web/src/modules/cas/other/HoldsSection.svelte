<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Other → Holds (D5, protocol.md §9.4): the holding stack, highest block on
  top; the own flight's hold highlighted; overlaps flagged (amber + word);
  WILCO shown. A JTAC of the AO assigns, changes and cancels holds.
-->
<script lang="ts">
  import type { Hold } from '@slate-dcs/shared';

  import CommandStatus from '../../../components/CommandStatus.svelte';
  import ConfirmButton from '../../../components/ConfirmButton.svelte';
  import EmptyState from '../../../components/EmptyState.svelte';
  import Ticks from '../../../components/Ticks.svelte';
  import {
    altText,
    casWho,
    flightName,
    holdShapeText,
    mtimeText,
    pointText,
    positionText,
  } from '../../../lib/cas.js';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';
  import HoldForm from '../HoldForm.svelte';

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  const holds = $derived(
    [...(slices?.cas.holds ?? [])].sort(
      (a, b) => b.ceiling.m - a.ceiling.m || b.floor.m - a.floor.m,
    ),
  );
  const ownFlight = $derived(slices?.flight.own?.flightId ?? null);

  let form: { hold: Hold | null } | null = $state(null);
  let command: string | null = $state(null);
</script>

{#if !slices || !who}
  <EmptyState title={t('other.holds')} text={t('cas.noSession')} />
{:else}
  {#if holds.length === 0}
    <p class="note">{t('holds.none')}</p>
  {/if}
  <ul class="stack">
    {#each holds as h (h.holdId)}
      {@const p = pointText(slices, h.point)}
      {@const wilco = slices.cas.holdWilcos.some((w) => w.holdId === h.holdId)}
      <li class:mine={h.flightId === ownFlight} class:conflict={h.conflicts.length > 0}>
        <div class="line top">
          <span class="block mono">{altText(h.floor)} – {altText(h.ceiling)}</span>
          <span class="who">{flightName(slices, h.flightId)}</span>
          {#if h.visibility === 'coalition'}<span class="tag">{t('visibility.coalition')}</span
            >{/if}
          {#if h.conflicts.length > 0}
            <span class="tag amber">
              {t('hold.overlaps', {
                with: h.conflicts
                  .map((id) =>
                    flightName(slices, slices.cas.holds.find((x) => x.holdId === id)?.flightId),
                  )
                  .join(', '),
              })}
            </span>
          {/if}
        </div>
        <div class="line">
          <span>{p.name ?? t('cas.coords')}</span>
          {#if p.at}<span class="mono dim">{positionText(p.at, who.style)[0]}</span>{/if}
        </div>
        <div class="line dim">
          <span>{holdShapeText(h)}</span>
          {#if h.from !== null || h.until !== null}
            <span class="mono">
              {h.from === null ? '' : mtimeText(slices, h.from)} – {h.until === null
                ? t('hold.open')
                : mtimeText(slices, h.until)}
            </span>
          {/if}
          {#if who.ao}
            <Ticks level={wilco ? 'acknowledged' : 'none'} />
          {:else if wilco}
            <span class="green">{t('hold.wilcoSent')}</span>
          {/if}
        </div>
        {#if who.ao && who.ao.aoId === h.aoId}
          <div class="actions">
            <button
              type="button"
              class="btn"
              onclick={() => {
                form = { hold: h };
              }}>{t('hold.change')}</button
            >
            <span class="spacer"></span>
            <ConfirmButton
              label={t('hold.cancel')}
              onconfirm={() => {
                command = host.send({ cmd: 'cas.hold.cancel', args: { holdId: h.holdId } });
              }}
            />
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  {#if who.ao}
    {#if form}
      <HoldForm
        aoId={who.ao.aoId}
        hold={form.hold}
        onclose={() => {
          form = null;
        }}
      />
    {:else}
      <div>
        <button
          type="button"
          class="btn primary"
          disabled={slices.cas.checkIns.every((c) => c.aoId !== who.ao?.aoId)}
          onclick={() => {
            form = { hold: null };
          }}>{t('hold.new')}</button
        >
      </div>
    {/if}
    <CommandStatus id={command} />
  {/if}
{/if}

<style>
  .stack {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .stack li {
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .stack li.mine {
    border-color: var(--blue);
  }

  .stack li.conflict {
    border-left: 0.25rem solid var(--amber);
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    font-size: 0.875rem;
  }

  .top {
    font-size: 1rem;
  }

  .block,
  .who {
    font-weight: 700;
  }

  .dim {
    color: var(--text-dim);
  }

  .green {
    color: var(--green);
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

  .actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .spacer {
    flex: 1;
  }
</style>
