<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  JOKER / BINGO on Ownship → Aircraft (protocol.md §6.5, ui-design.md §8,
  P2.7): this sortie's levels in the cockpit's unit (bingo prefilled per
  airframe, joker off until set), where internal fuel stands against them,
  and SEND JOKER · SEND BINGO in fixed slots. Never sent automatically – the
  prompt only asks (the alert bar under the status strip).
-->
<script lang="ts">
  import { fuelUnit, KG_PER_LB } from '@slate-dcs/shared';

  import Card from '../../components/Card.svelte';
  import CommandStatus from '../../components/CommandStatus.svelte';
  import Ticks from '../../components/Ticks.svelte';
  import { latestDelivery, tickLevel } from '../../lib/cas.js';
  import { formatFuel } from '../../lib/format.js';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';

  const slices = $derived(host.view.slices);
  const calls = $derived(slices?.fuelCalls ?? null);
  const unit = $derived(fuelUnit(slices?.ownship.aircraft?.type));
  const internal = $derived(slices?.ownship.status?.fuel?.internalKg ?? null);
  const toUnit = (kg: number) => (unit === 'lbs' ? kg / KG_PER_LB : kg);
  const toKg = (value: number) => (unit === 'lbs' ? value * KG_PER_LB : value);
  const shown = (kg: number | null | undefined) =>
    kg === null || kg === undefined ? '' : String(Math.round(toUnit(kg)));

  let joker = $state('');
  let bingo = $state('');
  let editing = $state(false);

  /** Where internal fuel stands: above both, at or below joker, at or below bingo. */
  const mark = $derived.by((): 'none' | 'ok' | 'joker' | 'bingo' => {
    if (internal === null || !calls) return 'none';
    if (calls.bingoKg !== null && internal <= calls.bingoKg) return 'bingo';
    if (calls.jokerKg !== null && internal <= calls.jokerKg) return 'joker';
    return 'ok';
  });
  const sentOf = (call: 'joker' | 'bingo') => calls?.sent.some((s) => s.call === call) ?? false;
  const ticks = $derived(
    slices ? tickLevel(latestDelivery(slices, 'fuel.call'), null, false) : 'none',
  );

  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');

  function parse(text: string): number | null | undefined {
    if (text.trim() === '') return null;
    const n = Number(text.trim().replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? toKg(n) : undefined;
  }
  const jokerKg = $derived(parse(joker));
  const bingoKg = $derived(parse(bingo));
</script>

{#if calls}
  <Card title={t('fuelCalls.title')}>
    {#if editing}
      <form
        class="form-grid"
        onsubmit={(event) => {
          event.preventDefault();
          if (jokerKg === undefined || bingoKg === undefined) return;
          command = host.send({ cmd: 'fuel.setLevels', args: { jokerKg, bingoKg } });
          editing = false;
        }}
      >
        <div class="two">
          <label class="field">
            <span>{t('fuelCalls.joker', { unit })}</span>
            <input
              class="mono"
              inputmode="numeric"
              bind:value={joker}
              placeholder={t('fuelCalls.off')}
            />
          </label>
          <label class="field">
            <span>{t('fuelCalls.bingo', { unit })}</span>
            <input
              class="mono"
              inputmode="numeric"
              bind:value={bingo}
              placeholder={t('fuelCalls.off')}
            />
          </label>
        </div>
        {#if jokerKg === undefined || bingoKg === undefined}
          <p class="note amber">{t('fuelCalls.bad')}</p>
        {/if}
        <div class="actions">
          <button
            type="button"
            class="btn"
            onclick={() => {
              editing = false;
            }}>{t('action.close')}</button
          >
          <button
            type="submit"
            class="btn primary"
            disabled={busy || jokerKg === undefined || bingoKg === undefined}
            >{t('fuelCalls.save')}</button
          >
        </div>
      </form>
    {:else}
      <div class="levels">
        <span class="label">JOKER</span>
        <span class="mono"
          >{calls.jokerKg === null ? t('fuelCalls.off') : formatFuel(calls.jokerKg, unit)}</span
        >
        {#if sentOf('joker')}<span class="tag">{t('fuelCalls.sent')}</span>{:else}<span></span>{/if}
        <span class="label">BINGO</span>
        <span class="mono"
          >{calls.bingoKg === null ? t('fuelCalls.off') : formatFuel(calls.bingoKg, unit)}</span
        >
        {#if sentOf('bingo')}<span class="tag">{t('fuelCalls.sent')}</span>{:else}<span></span>{/if}
      </div>
      {#if mark !== 'none'}
        <p class="mark {mark}">{t(`fuelCalls.mark.${mark}`)}</p>
      {/if}
      <button
        type="button"
        class="link"
        onclick={() => {
          joker = shown(calls.jokerKg);
          bingo = shown(calls.bingoKg);
          editing = true;
        }}>{t('fuelCalls.change')}</button
      >
    {/if}
    <div class="slots">
      <button
        type="button"
        class="btn"
        class:primary={calls.prompt === 'joker'}
        disabled={busy}
        onclick={() => {
          command = host.send({ cmd: 'fuel.call', args: { call: 'joker' } });
        }}>{t('fuelCalls.sendJoker')}</button
      >
      <button
        type="button"
        class="btn"
        class:primary={calls.prompt === 'bingo'}
        disabled={busy}
        onclick={() => {
          command = host.send({ cmd: 'fuel.call', args: { call: 'bingo' } });
        }}>{t('fuelCalls.sendBingo')}</button
      >
    </div>
    <Ticks level={ticks} />
    <CommandStatus id={command} />
  </Card>
{/if}

<style>
  .levels {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.35rem 0.75rem;
  }

  .label {
    color: var(--text-dim);
    font-weight: 700;
  }

  .tag {
    padding: 0 0.4rem;
    border: 1px solid var(--line);
    border-radius: 0.25rem;
    font-size: 0.75rem;
  }

  .mark {
    margin: 0.5rem 0 0;
    font-weight: 700;
  }

  .mark.ok {
    color: var(--green);
  }

  .mark.joker {
    color: var(--amber);
  }

  .mark.bingo {
    color: var(--red);
  }

  .link {
    margin-top: 0.4rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--blue);
    text-decoration: underline;
    cursor: pointer;
  }

  .slots {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
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
