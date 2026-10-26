<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Pilot alerts under the status strip, on every page (ui-design.md §7, §8,
  P2.7): ABORT on his own lane as a full-width red banner the moment it
  arrives, and the JOKER/BINGO prompt on his own dash (never sent by itself).
  An abort can be put away on this screen; the mission card keeps showing it
  until he is cleared again.
-->
<script lang="ts">
  import { casWho, callsignOf } from '../lib/cas.js';
  import { host } from '../lib/host.svelte.js';
  import { t } from '../lib/i18n/index.js';
  import { abortNotice } from '../lib/missions.js';
  import { router } from '../lib/router.svelte.js';
  import { alerts } from './alerts.svelte.js';

  const slices = $derived(host.view.slices);
  const pilot = $derived(slices !== null && !casWho(slices).jtac);
  const pid = $derived(slices?.session.pid ?? null);
  const aborts = $derived(
    pilot && slices
      ? slices.missions.missions
          .map((m) => ({ m, notice: abortNotice(m, pid) }))
          .filter(
            (x): x is { m: typeof x.m; notice: NonNullable<typeof x.notice> } =>
              x.notice !== null && !alerts.dismissed.has(x.notice.key),
          )
      : [],
  );
  const prompt = $derived(pilot ? (slices?.fuelCalls.prompt ?? null) : null);
</script>

{#if slices && (aborts.length > 0 || prompt)}
  <div class="alerts">
    {#each aborts as { m, notice } (notice.key)}
      <div class="abort" role="alert">
        <button
          type="button"
          class="text"
          onclick={() => {
            alerts.open(m.missionId);
            router.go('cas', 'missions');
          }}
        >
          <strong>ABORT – {notice.reason}</strong>
          <span>
            {m.missionId}
            {m.nineLine?.description ? `· ${m.nineLine.description}` : ''}
            · {notice.by === 'relay' ? 'SLATE' : callsignOf(slices, notice.by)}
            ({t(`abort.channel.${notice.channel}`)})
          </span>
        </button>
        <button
          type="button"
          class="btn close"
          onclick={() => {
            alerts.dismiss(notice.key);
          }}>{t('alert.seen')}</button
        >
      </div>
    {/each}
    {#if prompt}
      <div class="fuel {prompt}" role="alert">
        <strong class="text">{t(`alert.${prompt}`)}</strong>
        <button
          type="button"
          class="btn primary"
          onclick={() => {
            host.send({ cmd: 'fuel.call', args: { call: prompt } });
          }}>{t(prompt === 'bingo' ? 'fuelCalls.sendBingo' : 'fuelCalls.sendJoker')}</button
        >
        <button
          type="button"
          class="btn"
          onclick={() => {
            host.send({ cmd: 'fuel.dismiss', args: {} });
          }}>{t('alert.dismiss')}</button
        >
      </div>
    {/if}
  </div>
{/if}

<style>
  .alerts {
    display: grid;
    gap: 0.35rem;
    padding: 0.35rem 0.5rem 0;
  }

  .abort,
  .fuel {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius);
  }

  .abort {
    border: 2px solid var(--red);
    background: color-mix(in srgb, var(--red) 25%, var(--surface));
  }

  .fuel {
    border: 2px solid var(--amber);
    background: var(--surface-2);
  }

  .fuel.bingo {
    border-color: var(--red);
  }

  .text {
    display: grid;
    flex: 1 1 12rem;
    gap: 0.15rem;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .abort strong {
    font-size: 1.25rem;
    letter-spacing: 0.02em;
  }

  .close {
    min-width: 0;
    padding: 0 0.9rem;
  }
</style>
