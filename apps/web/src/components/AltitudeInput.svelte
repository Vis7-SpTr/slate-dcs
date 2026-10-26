<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- An altitude typed in feet with its reference (SFC, AGL, MSL); stored in metres (protocol.md §0). -->
<script lang="ts">
  import type { Altitude } from '@slate-dcs/shared';

  import { t } from '../lib/i18n/index.js';

  // Svelte needs `let` for a bindable prop; the others are never reassigned.
  // eslint-disable-next-line prefer-const
  let { value = $bindable(), label }: { value: Altitude; label: string } = $props();

  let feet = $state(value.ref === 'sfc' ? '' : String(Math.round(value.m / 0.3048)));

  function set(ref: Altitude['ref'], text: string): void {
    const ft = Number(text);
    value = ref === 'sfc' ? { m: 0, ref } : { m: Number.isFinite(ft) ? ft * 0.3048 : 0, ref };
  }
</script>

<div class="field">
  <span>{label}</span>
  <div class="line">
    <input
      class="mono"
      inputmode="numeric"
      bind:value={feet}
      disabled={value.ref === 'sfc'}
      placeholder={t('alt.placeholder')}
      oninput={() => {
        set(value.ref, feet);
      }}
    />
    <div class="choice refs" role="group" aria-label={label}>
      {#each ['sfc', 'agl', 'msl'] as const as ref (ref)}
        <button
          type="button"
          class="btn"
          class:selected={value.ref === ref}
          aria-pressed={value.ref === ref}
          onclick={() => {
            set(ref, feet);
          }}>{t(`alt.${ref}`)}</button
        >
      {/each}
    </div>
  </div>
</div>

<style>
  .line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .line input {
    flex: 1 1 6rem;
  }

  .refs .btn {
    min-width: 4rem;
    padding: 0 0.6rem;
  }
</style>
