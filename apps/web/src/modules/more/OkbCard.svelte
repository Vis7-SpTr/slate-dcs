<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  More → Settings → OpenKneeboard (P1.5 follow-up, ui-design.md §10). An OKB
  Web Dashboard tab can't be resized by hand, so SLATE sets its own pixel size
  and ratio there: match the graphics tablet (default), iPad portrait, 3:4,
  4:3 or custom; "page size" sets the pixels on the shorter side – fewer
  pixels show larger in VR. This screen only; other screens keep their size.
-->
<script lang="ts">
  import Card from '../../components/Card.svelte';
  import { t } from '../../lib/i18n/index.js';
  import { okb } from '../../lib/okb.svelte.js';
  import { SHORT_SIDE } from '../../lib/okb-size.js';
  import type { OkbPreset } from '../../lib/okb-size.js';

  const PRESETS: readonly OkbPreset[] = ['tablet', 'ipad', 'portrait43', 'landscape43', 'custom'];

  let width = $state(String(okb.choice.custom.width));
  let height = $state(String(okb.choice.custom.height));
  const customOk = $derived(
    [width, height].every(
      (v) => Number.isInteger(Number(v)) && Number(v) >= 200 && Number(v) <= 8000,
    ),
  );

  function preset(p: OkbPreset): void {
    void okb.set({ ...okb.choice, preset: p });
  }

  function shortSide(direction: 1 | -1): void {
    const next = okb.choice.shortSide + direction * SHORT_SIDE.step;
    const clamped = Math.min(SHORT_SIDE.max, Math.max(SHORT_SIDE.min, next));
    void okb.set({ ...okb.choice, shortSide: clamped });
  }
</script>

<Card title={t('okb.title')}>
  {#if !okb.present}
    <p class="help">{t('okb.notHere')}</p>
  {:else}
    <p class="help">{t('okb.help')}</p>
    <p class="status">
      {okb.version ?? 'OpenKneeboard'} ·
      {okb.tablet
        ? okb.haveTablet
          ? t('okb.tablet', { w: String(okb.tablet.width), h: String(okb.tablet.height) })
          : t('okb.noTablet')
        : t('okb.tabletUnknown')}
    </p>
    <div class="choice presets" role="group" aria-label={t('okb.ratio')}>
      {#each PRESETS as p (p)}
        <button
          type="button"
          class="btn"
          class:selected={okb.choice.preset === p}
          aria-pressed={okb.choice.preset === p}
          onclick={() => {
            preset(p);
          }}>{t(`okb.preset.${p}`)}</button
        >
      {/each}
    </div>
    {#if okb.choice.preset === 'custom'}
      <form
        class="custom"
        onsubmit={(event) => {
          event.preventDefault();
          if (!customOk) return;
          void okb.set({ ...okb.choice, custom: { width: Number(width), height: Number(height) } });
        }}
      >
        <label class="field">
          <span>{t('okb.width')}</span>
          <input class="mono" inputmode="numeric" bind:value={width} />
        </label>
        <label class="field">
          <span>{t('okb.height')}</span>
          <input class="mono" inputmode="numeric" bind:value={height} />
        </label>
        <button type="submit" class="btn primary" disabled={!customOk}>{t('okb.apply')}</button>
      </form>
    {:else}
      <div class="row">
        <span class="label">{t('okb.pageSize')}</span>
        <button
          type="button"
          class="btn"
          disabled={okb.choice.shortSide <= SHORT_SIDE.min}
          onclick={() => {
            shortSide(-1);
          }}>{t('okb.bigger')}</button
        >
        <span class="mono value">{okb.choice.shortSide} px</span>
        <button
          type="button"
          class="btn"
          disabled={okb.choice.shortSide >= SHORT_SIDE.max}
          onclick={() => {
            shortSide(1);
          }}>{t('okb.more')}</button
        >
      </div>
    {/if}
    <p class="status mono">
      {okb.applied
        ? t('okb.applied', { w: String(okb.applied.width), h: String(okb.applied.height) })
        : t('okb.notApplied')}
    </p>
    {#if okb.error}<p class="note amber">{okb.error}</p>{/if}
  {/if}
</Card>

<style>
  .help,
  .status {
    margin: 0 0 0.5rem;
    color: var(--text-dim);
  }

  .presets .btn {
    flex: 1 1 8rem;
  }

  .custom {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
    align-items: end;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .label {
    flex: 1 1 100%;
    color: var(--text-dim);
  }

  .value {
    min-width: 5rem;
    text-align: center;
  }

  .amber {
    color: var(--amber);
  }
</style>
