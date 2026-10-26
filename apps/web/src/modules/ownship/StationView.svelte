<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Ownship → Check-in for a JTAC (ui-design.md §8, protocol.md §8.2, P2.6):
  the on-station call. Create an AO – a circle in P2, by default around his
  position – or join one by its join code; callsign and frequencies typed in.
  On-station: the AO with the join code to pass on, its JTACs, OFF-STATION.
-->
<script lang="ts">
  import { AO_RULES, normalizeAoJoinCode } from '@slate-dcs/shared';
  import type { Altitude, Frequency, LatLon } from '@slate-dcs/shared';

  import AltitudeInput from '../../components/AltitudeInput.svelte';
  import Card from '../../components/Card.svelte';
  import CommandStatus from '../../components/CommandStatus.svelte';
  import ConfirmButton from '../../components/ConfirmButton.svelte';
  import CoordInput from '../../components/CoordInput.svelte';
  import FreqEditor from '../../components/FreqEditor.svelte';
  import Row from '../../components/Row.svelte';
  import { altText, areaText, casWho, positionText } from '../../lib/cas.js';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  const ao = $derived(who?.ao ?? null);
  const ownPos = $derived.by((): LatLon | null => {
    const pos = slices?.ownship.status?.pos;
    return pos ? { lat: pos.lat, lon: pos.lon } : null;
  });

  let mode: 'new' | 'join' = $state('new');
  let callsign = $state('');
  let freqs: Frequency[] = $state([]);
  let name = $state('');
  let radiusNm = $state(String(AO_RULES.defaultRadiusM / 1852));
  let floor: Altitude = $state({ ...AO_RULES.defaultFloor });
  let ceiling: Altitude = $state({ ...AO_RULES.defaultCeiling });
  let center: LatLon | null = $state(null);
  let code = $state('');
  const joinCode = $derived(normalizeAoJoinCode(code));
  const radius = $derived(Number(radiusNm.replace(',', '.')));
  /** A new AO needs a centre: typed, or his own position (the relay takes it). */
  const canCreate = $derived(
    callsign.trim() !== '' && radius > 0 && radius <= 100 && (center !== null || ownPos !== null),
  );

  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');

  function goOnStation(): void {
    const base = { callsign: callsign.trim(), freqs };
    if (mode === 'join') {
      if (joinCode === null) return;
      command = host.send({ cmd: 'jtac.onStation', args: { ...base, joinCode } });
      return;
    }
    command = host.send({
      cmd: 'jtac.onStation',
      args: {
        ...base,
        ao: {
          ...(name.trim() === '' ? {} : { name: name.trim().toUpperCase() }),
          type: 'circle',
          // `null` = his position (§8.2); typed coordinates win.
          center: center ?? null,
          radiusM: radius * 1852,
          floor,
          ceiling,
        },
      },
    });
  }
</script>

<div class="station">
  {#if ao && who}
    <Card title={t('station.on')}>
      <p class="ao-name">{ao.name}</p>
      {#if ao.joinCode}
        <p class="note">{t('station.joinCode')}</p>
        <p class="code mono">{ao.joinCode}</p>
      {/if}
      <Row label={t('station.area')}>{areaText(ao)}</Row>
      <Row label={t('station.block')}>{altText(ao.floor)} – {altText(ao.ceiling)}</Row>
      {#if ao.center}
        <Row label={t('station.center')} mono>{positionText(ao.center, who.style).join(' · ')}</Row>
      {/if}
      <h3>{t('station.jtacs')}</h3>
      <ul class="jtacs">
        {#each ao.jtacs as j (j.pid)}
          <li class:mine={j.pid === who.pid}>
            <span class="who">{j.callsign}</span>
            {#if ao.inCommand === j.pid}<span class="tag">{t('station.inCommand')}</span>{/if}
            {#if j.presence === 'lost'}<span class="tag amber">{t('flight.lost')}</span>{/if}
            <span class="freqs mono">
              {j.freqs
                .map((f) => `${f.mhz.toFixed(3)}${f.label ? ` ${f.label}` : ''}`)
                .join(' · ') || t('value.none')}
            </span>
          </li>
        {/each}
      </ul>
      <div class="actions">
        <ConfirmButton
          label={t('station.off')}
          disabled={busy}
          onconfirm={() => {
            command = host.send({ cmd: 'jtac.offStation', args: { aoId: ao.aoId } });
          }}
        />
      </div>
      <CommandStatus id={command} />
    </Card>
  {:else if who}
    <Card title={t('station.call')}>
      <form
        class="form-grid"
        onsubmit={(event) => {
          event.preventDefault();
          goOnStation();
        }}
      >
        <label class="field">
          <span>{t('station.callsign')}</span>
          <input bind:value={callsign} maxlength="24" placeholder="Axeman 11" />
        </label>
        <FreqEditor bind:value={freqs} />
        <div class="choice" role="group" aria-label={t('station.call')}>
          <button
            type="button"
            class="btn"
            class:selected={mode === 'new'}
            aria-pressed={mode === 'new'}
            onclick={() => {
              mode = 'new';
            }}>{t('station.new')}</button
          >
          <button
            type="button"
            class="btn"
            class:selected={mode === 'join'}
            aria-pressed={mode === 'join'}
            onclick={() => {
              mode = 'join';
            }}>{t('station.join')}</button
          >
        </div>
        {#if mode === 'new'}
          <label class="field">
            <span>{t('station.aoName')}</span>
            <input bind:value={name} maxlength="32" placeholder={t('station.aoName.placeholder')} />
          </label>
          <label class="field">
            <span>{t('station.radius')}</span>
            <input class="mono" inputmode="decimal" bind:value={radiusNm} />
          </label>
          <AltitudeInput bind:value={floor} label={t('station.floor')} />
          <AltitudeInput bind:value={ceiling} label={t('station.ceiling')} />
          <CoordInput
            bind:value={center}
            label={t('station.centerInput')}
            style={who.style}
            own={ownPos}
          />
          {#if center === null}
            <p class="note" class:amber={ownPos === null}>
              {ownPos === null ? t('station.noPosition') : t('station.aroundMe')}
            </p>
          {/if}
        {:else}
          <label class="field">
            <span>{t('station.code')}</span>
            <input
              class="mono"
              bind:value={code}
              placeholder="Q4T-8MZ"
              autocomplete="off"
              spellcheck="false"
            />
          </label>
          {#if code.trim() !== '' && joinCode === null}
            <p class="note amber">{t('station.code.bad')}</p>
          {/if}
        {/if}
        <div>
          <button
            type="submit"
            class="btn primary"
            disabled={busy ||
              callsign.trim() === '' ||
              (mode === 'new' ? !canCreate : joinCode === null)}>{t('station.go')}</button
          >
        </div>
      </form>
      <CommandStatus id={command} />
    </Card>
  {/if}
</div>

<style>
  .station {
    display: grid;
    gap: 0.75rem;
    max-width: 40rem;
    margin-inline: auto;
  }

  .ao-name {
    margin-bottom: 0.5rem;
    color: var(--blue);
    font-size: 1.25rem;
    font-weight: 700;
  }

  .code {
    margin: 0.25rem 0 0.75rem;
    font-size: 1.75rem;
    letter-spacing: 0.08em;
  }

  h3 {
    margin: 0.75rem 0 0.4rem;
    color: var(--text-dim);
    font-size: 0.8125rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .jtacs {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .jtacs li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.75rem;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .jtacs li.mine {
    border-color: var(--blue);
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

  .tag.amber,
  .amber {
    border-color: var(--amber);
    color: var(--amber);
  }

  .actions {
    margin-top: 0.75rem;
  }
</style>
