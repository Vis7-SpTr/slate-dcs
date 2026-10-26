<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Other → AO (D5): the AO's settings, centre and JTACs with frequencies; for
  its JTACs the join code; for the JTAC in command name, size and height to
  change and RECENTER (on his position, §8.3); a situation update to everyone
  in the AO. Outside an AO: the session's AOs with their JTACs.
-->
<script lang="ts">
  import type { Altitude } from '@slate-dcs/shared';

  import AltitudeInput from '../../../components/AltitudeInput.svelte';
  import Card from '../../../components/Card.svelte';
  import CommandStatus from '../../../components/CommandStatus.svelte';
  import ConfirmButton from '../../../components/ConfirmButton.svelte';
  import EmptyState from '../../../components/EmptyState.svelte';
  import Row from '../../../components/Row.svelte';
  import { altText, areaText, casWho, checkInOf, positionText } from '../../../lib/cas.js';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';
  import SitUpdateForm from '../SitUpdateForm.svelte';

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  /** His AO as a JTAC, else the one his flight is checked in to. */
  const ao = $derived.by(() => {
    if (!slices || !who) return null;
    if (who.ao) return who.ao;
    const checkIn = checkInOf(slices, slices.flight.own?.flightId);
    return slices.cas.aos.find((a) => a.aoId === checkIn?.aoId) ?? null;
  });

  let editing = $state(false);
  let sit = $state(false);
  let name = $state('');
  let radius = $state('');
  let floor: Altitude = $state({ m: 0, ref: 'sfc' });
  let ceiling: Altitude = $state({ m: 6096, ref: 'msl' });
  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');

  function edit(): void {
    if (!ao) return;
    name = ao.name;
    radius = String(Math.round(((ao.radiusM ?? 0) / 1852) * 10) / 10);
    floor = { ...ao.floor };
    ceiling = { ...ao.ceiling };
    editing = true;
  }
</script>

{#if !slices || !who}
  <EmptyState title={t('other.ao')} text={t('cas.noSession')} />
{:else if ao}
  <Card title={ao.name}>
    {#if ao.joinCode}
      <Row label={t('station.joinCode')} mono>{ao.joinCode}</Row>
    {/if}
    <Row label={t('station.area')}>{areaText(ao)}</Row>
    <Row label={t('station.block')}>{altText(ao.floor)} – {altText(ao.ceiling)}</Row>
    {#if ao.center}
      <Row label={t('station.center')} mono>{positionText(ao.center, who.style).join(' · ')}</Row>
    {/if}
    <ul class="jtacs">
      {#each ao.jtacs as j (j.pid)}
        <li>
          <span class="who">{j.callsign}</span>
          {#if ao.inCommand === j.pid}<span class="tag">{t('station.inCommand')}</span>{/if}
          {#if j.presence === 'lost'}<span class="tag amber">{t('flight.lost')}</span>{/if}
          <span class="freqs mono">
            {j.freqs.map((f) => `${f.mhz.toFixed(3)}${f.label ? ` ${f.label}` : ''}`).join(' · ') ||
              t('value.none')}
          </span>
        </li>
      {/each}
    </ul>

    {#if editing}
      <form
        class="form-grid edit"
        onsubmit={(event) => {
          event.preventDefault();
          const nm = Number(radius.replace(',', '.'));
          command = host.send({
            cmd: 'ao.update',
            args: {
              aoId: ao.aoId,
              changes: {
                name: name.trim().toUpperCase() || ao.name,
                ...(ao.type === 'circle' && nm > 0 ? { radiusM: nm * 1852 } : {}),
                floor,
                ceiling,
              },
            },
          });
          editing = false;
        }}
      >
        <label class="field">
          <span>{t('station.aoName')}</span>
          <input bind:value={name} maxlength="32" />
        </label>
        {#if ao.type === 'circle'}
          <label class="field">
            <span>{t('station.radius')}</span>
            <input class="mono" inputmode="decimal" bind:value={radius} />
          </label>
        {/if}
        <AltitudeInput bind:value={floor} label={t('station.floor')} />
        <AltitudeInput bind:value={ceiling} label={t('station.ceiling')} />
        <div class="actions">
          <button
            type="button"
            class="btn"
            onclick={() => {
              editing = false;
            }}>{t('action.close')}</button
          >
          <button type="submit" class="btn primary" disabled={busy}>{t('ao.save')}</button>
        </div>
      </form>
    {/if}
    {#if sit && who.ao}
      <SitUpdateForm
        aoId={ao.aoId}
        flightId={null}
        target={t('sit.everyone', { ao: ao.name })}
        onclose={() => {
          sit = false;
        }}
      />
    {/if}

    {#if who.ao}
      <div class="actions">
        <button
          type="button"
          class="btn"
          onclick={() => {
            sit = true;
          }}>{t('ao.sitAll')}</button
        >
        {#if who.aoCommand && !editing}
          <button type="button" class="btn" onclick={edit}>{t('ao.edit')}</button>
          <ConfirmButton
            label={t('ao.recenter')}
            disabled={busy}
            onconfirm={() => {
              command = host.send({
                cmd: 'ao.update',
                args: { aoId: ao.aoId, changes: { center: null } },
              });
            }}
          />
        {/if}
      </div>
      <CommandStatus id={command} />
    {/if}
  </Card>
{:else if slices.cas.aos.length === 0}
  <EmptyState title={t('other.ao')} text={t('ao.none')} />
{:else}
  {#each slices.cas.aos as a (a.aoId)}
    <Card title={a.name}>
      <Row label={t('station.area')}>{areaText(a)}</Row>
      <ul class="jtacs">
        {#each a.jtacs as j (j.pid)}
          <li>
            <span class="who">{j.callsign}</span>
            <span class="freqs mono">
              {j.freqs
                .map((f) => `${f.mhz.toFixed(3)}${f.label ? ` ${f.label}` : ''}`)
                .join(' · ') || t('value.none')}
            </span>
          </li>
        {/each}
      </ul>
    </Card>
  {/each}
{/if}

<style>
  .jtacs {
    display: grid;
    gap: 0.35rem;
    margin: 0.5rem 0 0;
    padding: 0;
    list-style: none;
  }

  .jtacs li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem 0.75rem;
  }

  .who {
    font-weight: 700;
  }

  .freqs {
    flex-basis: 100%;
    color: var(--text-dim);
    font-size: 0.875rem;
  }

  .tag {
    padding: 0.1rem 0.45rem;
    border: 1px solid var(--line);
    border-radius: 0.3rem;
    color: var(--text-dim);
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .tag.amber {
    border-color: var(--amber);
    color: var(--amber);
  }

  .edit {
    margin-top: 0.75rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
</style>
