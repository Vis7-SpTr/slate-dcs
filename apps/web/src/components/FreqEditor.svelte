<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- The JTAC's frequencies, typed by hand (D10): MHz + optional label, at most six. -->
<script lang="ts">
  import { MAX_FREQUENCIES } from '@slate-dcs/shared';
  import type { Frequency } from '@slate-dcs/shared';

  import { t } from '../lib/i18n/index.js';

  let { value = $bindable() }: { value: Frequency[] } = $props();

  let mhz = $state('');
  let label = $state('');
  const number = $derived(Number(mhz.replace(',', '.')));
  const valid = $derived(
    mhz.trim() !== '' && Number.isFinite(number) && number >= 1 && number <= 1000,
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
