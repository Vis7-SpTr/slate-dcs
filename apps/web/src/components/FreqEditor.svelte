<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  The JTAC's frequencies, typed by hand (D10): MHz + optional label, at most
  six. In VR picked from the AO's JTAC frequencies and the ones used last on
  this screen (ui-design.md §11).
-->
<script lang="ts">
  import { MAX_FREQUENCIES } from '@slate-dcs/shared';
  import type { Frequency } from '@slate-dcs/shared';

  import { host } from '../lib/host.svelte.js';
  import { t } from '../lib/i18n/index.js';
  import { frequencyPicks, recentFrequencies } from '../lib/picks.js';

  let { value = $bindable() }: { value: Frequency[] } = $props();

  let mhz = $state('');
  let label = $state('');
  const number = $derived(Number(mhz.replace(',', '.')));
  const valid = $derived(
    mhz.trim() !== '' && Number.isFinite(number) && number >= 1 && number <= 1000,
  );
  const recent = recentFrequencies();
  /** The AO's JTAC frequencies and the recent ones, not already in the list. */
  const picks = $derived(
    frequencyPicks([
      (host.view.slices?.cas.aos ?? []).flatMap((ao) => ao.jtacs.flatMap((j) => j.freqs)),
      recent,
    ]).filter((f) => !value.some((v) => v.mhz.toFixed(3) === f.mhz.toFixed(3))),
  );
</script>

<div class="field">
  <span>{t('freq.title')}</span>
  {#if value.length > 0}
    <ul class="freqs">
      {#each value as f, i (i)}
        <li>
          <span class="mono">{f.mhz.toFixed(3)}</span>
          <span class="dim">{f.label ?? ''}</span>
          <button
            type="button"
            class="btn remove"
            onclick={() => {
              value = value.filter((_, j) => j !== i);
            }}>{t('freq.remove')}</button
          >
        </li>
      {/each}
    </ul>
  {/if}
  {#if value.length < MAX_FREQUENCIES}
    {#if picks.length > 0}
      <div class="picks" role="group" aria-label={t('freq.picks')}>
        {#each picks as f (f.mhz)}
          <button
            type="button"
            class="chip mono"
            onclick={() => {
              value = [...value, f];
            }}>{f.mhz.toFixed(3)}{f.label ? ` ${f.label}` : ''}</button
          >
        {/each}
      </div>
    {/if}
    <div class="add">
      <input class="mono" inputmode="decimal" bind:value={mhz} placeholder="251.000" />
      <input bind:value={label} maxlength="24" placeholder={t('freq.label')} />
      <button
        type="button"
        class="btn"
        disabled={!valid}
        onclick={() => {
          value = [...value, { mhz: number, label: label.trim() === '' ? null : label.trim() }];
          mhz = '';
          label = '';
        }}>{t('freq.add')}</button
      >
    </div>
  {/if}
</div>

<style>
  .freqs {
    display: grid;
    gap: 0.3rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .freqs li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .dim {
    flex: 1;
    color: var(--text-dim);
  }

  .remove {
    min-width: 5rem;
  }

  .add {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .add input {
    flex: 1 1 6rem;
    min-width: 0;
    min-height: var(--touch);
    padding: 0 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
  }
</style>
