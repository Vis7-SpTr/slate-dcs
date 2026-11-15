<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Ownship → Aircraft → Enter by hand (protocol.md §6.2, §14.7): own position,
  fuel and gun rounds typed in when DCS gives none – a JTAC in the F10 /
  Operator slot, or a server that blocks export. A manual value wins until the
  DCS value changes; BACK TO DCS drops it. A manual position also gives the
  JTAC "My position" for his AO and points.
-->
<script lang="ts">
  import { fuelUnit, KG_PER_LB } from '@slate-dcs/shared';
  import type { LatLon } from '@slate-dcs/shared';

  import CommandStatus from '../../components/CommandStatus.svelte';
  import CoordInput from '../../components/CoordInput.svelte';
  import Fold from '../../components/Fold.svelte';
  import { casWho } from '../../lib/cas.js';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  const overrides = $derived(slices?.ownship.overrides ?? null);
  const status = $derived(slices?.ownship.status ?? null);
  const unit = $derived(fuelUnit(slices?.ownship.aircraft?.type));
  const toKg = (v: number) => (unit === 'lbs' ? v * KG_PER_LB : v);
  const jtac = $derived(slices?.session.role === 'jtac');
  const anyManual = $derived(
    overrides !== null &&
      (overrides.position !== null || overrides.fuel !== null || overrides.gun !== null),
  );

  let position: LatLon | null = $state(null);
  let altFt = $state('');
  let internal = $state('');
  let external = $state('');
  let rounds = $state('');
  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');
  const num = (s: string) => Number(s.trim().replace(',', '.'));
  const ok = (s: string) => s.trim() !== '' && Number.isFinite(num(s)) && num(s) >= 0;
</script>

{#if slices && who}
  <Fold
    title={t('manual.title')}
    note={anyManual ? t('manual.active') : t('manual.note')}
    open={anyManual || (jtac && status?.pos == null)}
  >
    <div class="manual">
      <form
        class="form-grid part"
        onsubmit={(event) => {
          event.preventDefault();
          if (!position) return;
          command = host.send({
            cmd: 'ownship.setPosition',
            args: {
              lat: position.lat,
              lon: position.lon,
              altMsl: altFt.trim() === '' ? 0 : num(altFt) * 0.3048,
            },
          });
        }}
      >
        <h4>{t('manual.position')}</h4>
        <CoordInput bind:value={position} label={t('manual.positionInput')} style={who.style} />
        <label class="field">
          <span>{t('manual.alt')}</span>
          <input class="mono" inputmode="numeric" bind:value={altFt} />
        </label>
        <div class="actions">
          <button type="submit" class="btn primary" disabled={busy || position === null}
            >{t('manual.set')}</button
          >
          {#if overrides?.position}
            <button
              type="button"
              class="btn"
              disabled={busy}
              onclick={() => {
                command = host.send({ cmd: 'ownship.setPosition', args: null });
              }}>{t('manual.back')}</button
            >
          {/if}
        </div>
      </form>

      {#if !jtac}
        <form
          class="form-grid part"
          onsubmit={(event) => {
            event.preventDefault();
            command = host.send({
              cmd: 'ownship.setFuel',
              args: {
                internalKg: toKg(num(internal)),
                externalKg: external.trim() === '' ? 0 : toKg(num(external)),
              },
            });
          }}
        >
          <h4>{t('manual.fuel')}</h4>
          <div class="two">
            <label class="field">
              <span>{t('manual.internal', { unit })}</span>
              <input class="mono" inputmode="numeric" bind:value={internal} />
            </label>
            <label class="field">
              <span>{t('manual.external', { unit })}</span>
              <input class="mono" inputmode="numeric" bind:value={external} />
            </label>
          </div>
          <div class="actions">
            <button type="submit" class="btn primary" disabled={busy || !ok(internal)}
              >{t('manual.set')}</button
            >
            {#if overrides?.fuel}
              <button
                type="button"
                class="btn"
                disabled={busy}
                onclick={() => {
                  command = host.send({ cmd: 'ownship.setFuel', args: null });
                }}>{t('manual.back')}</button
              >
            {/if}
          </div>
        </form>

        <form
          class="form-grid part"
          onsubmit={(event) => {
            event.preventDefault();
            command = host.send({
              cmd: 'ownship.setGun',
              args: { rounds: Math.round(num(rounds)) },
            });
          }}
        >
          <h4>{t('manual.gun')}</h4>
          <label class="field">
            <span>{t('manual.rounds')}</span>
            <input class="mono" inputmode="numeric" bind:value={rounds} />
          </label>
          <div class="actions">
            <button type="submit" class="btn primary" disabled={busy || !ok(rounds)}
              >{t('manual.set')}</button
            >
            {#if overrides?.gun}
              <button
                type="button"
                class="btn"
                disabled={busy}
                onclick={() => {
                  command = host.send({ cmd: 'ownship.setGun', args: null });
                }}>{t('manual.back')}</button
              >
            {/if}
          </div>
        </form>
      {/if}
      <p class="note">{t('manual.rule')}</p>
      <CommandStatus id={command} />
    </div>
  </Fold>
{/if}

<style>
  .manual {
    display: grid;
    gap: 0.75rem;
  }

  .part {
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--line);
  }

  h4 {
    margin: 0;
    color: var(--text-dim);
    font-size: 0.8125rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: 0.5rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
