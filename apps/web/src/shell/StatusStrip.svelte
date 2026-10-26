<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Status strip along the top edge (ui-design.md §2): callsign + position,
  links (DCS, relay), check-in state, DCS mission clock, fuel. When the host
  link is down, the strip shows that instead – in place, so nothing on the
  page moves.
-->
<script lang="ts">
  import { clock } from '../lib/clock.svelte.js';
  import { fuelUnit } from '@slate-dcs/shared';

  import { casWho, checkInOf } from '../lib/cas.js';
  import { formatFuel, missionClock } from '../lib/format.js';
  import { host } from '../lib/host.svelte.js';
  import { t } from '../lib/i18n/index.js';
  import { router } from '../lib/router.svelte.js';

  const slices = $derived(host.view.slices);

  const callsign = $derived.by(() => {
    const own = slices?.flight.own;
    const pid = slices?.session.pid;
    // A JTAC on-station goes by his AO callsign (§8.2).
    const jtac = slices?.cas.aos.flatMap((a) => a.jtacs).find((j) => j.pid === pid);
    if (jtac) return jtac.callsign;
    if (!own) return t('strip.noFlight');
    const member = own.members.find((m) => m.pid === pid);
    return member ? `${own.display}-${member.pos}` : own.display;
  });

  const time = $derived(
    slices ? missionClock(slices.mission, slices.settings.timeDisplay, clock.now) : null,
  );

  const fuel = $derived.by(() => {
    const ownship = slices?.ownship;
    const f = ownship?.status?.fuel;
    return f
      ? formatFuel(f.internalKg + f.externalKg, fuelUnit(ownship?.aircraft?.type))
      : t('value.none');
  });

  /** A JTAC's AO while on-station, a pilot's AO while his flight is checked in (§8, §9). */
  const checkIn = $derived.by(() => {
    if (!slices) return null;
    const ao = casWho(slices).ao;
    if (ao) return { text: ao.name, on: true };
    const own = checkInOf(slices, slices.flight.own?.flightId);
    const name = slices.cas.aos.find((a) => a.aoId === own?.aoId)?.name;
    return name ? { text: name, on: true } : null;
  });
  const bridge = $derived(slices?.host.bridge.state ?? 'waiting');
  const relay = $derived(slices?.host.relay.state ?? 'notConnected');
  /** A DCS folder whose SLATE files need repair (P1.3) – tap goes to More → DCS. */
  const repair = $derived(slices?.dcs.folders.some((f) => f.state === 'needsRepair') ?? false);
</script>

<header class="strip">
  {#if host.reloadNeeded}
    <p class="banner amber" role="alert">{t('strip.reloadNeeded')}</p>
  {:else if host.view.link !== 'connected' || slices === null}
    <p class="banner" class:red={host.view.link === 'disconnected'} role="status">
      {host.view.link === 'disconnected' ? t('strip.hostLost') : t('strip.hostConnecting')}
    </p>
  {:else}
    <div class="item callsign">
      <span class="value">{callsign}</span>
    </div>

    <div class="item links">
      <span class="link" data-state={bridge}>
        <span class="dot" aria-hidden="true"></span>{t('strip.dcs')}
        <span class="word">{t(`link.bridge.${bridge}`)}</span>
      </span>
      {#if repair}
        <button
          type="button"
          class="repair"
          onclick={() => {
            router.go('more', 'dcs');
          }}>{t('strip.dcsRepair')}</button
        >
      {/if}
      <!-- Tap: More → Session (join, host mode). -->
      <button
        type="button"
        class="link link-button"
        data-state={relay}
        onclick={() => {
          router.go('more', 'session');
        }}
      >
        <span class="dot" aria-hidden="true"></span>{t('strip.relay')}
        <span class="word">{t(`link.relay.${relay}`)}</span>
      </button>
    </div>

    <div class="item">
      <span class="label">{t('strip.checkIn')}</span>
      <span class="value" class:on={checkIn?.on}>{checkIn?.text ?? t('strip.notCheckedIn')}</span>
    </div>

    <div class="item clock">
      {#if time?.time}
        <span class="value mono time">{time.time}<span class="suffix">{time.suffix}</span></span>
        {#if time.paused}<span class="paused">{t('strip.paused')}</span>{/if}
      {:else}
        <span class="value dim">{t('strip.noMission')}</span>
      {/if}
    </div>

    <div class="item fuel">
      <span class="label">{t('strip.fuel')}</span>
      <span class="value mono">{fuel}</span>
    </div>
  {/if}
</header>

<style>
  .strip {
    min-height: 3.5rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 1.25rem;
    padding: 0.5rem 1rem;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }

  .item {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    white-space: nowrap;
  }

  .label {
    color: var(--text-dim);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .value {
    font-size: 1rem;
    font-weight: 700;
  }

  .dim {
    color: var(--text-dim);
    font-weight: 400;
  }

  /* Checked in / on-station: green with its name (ui-design.md §1). */
  .value.on {
    color: var(--green);
  }

  .callsign .value {
    color: var(--blue);
  }

  .links {
    gap: 0.9rem;
  }

  .link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.875rem;
    color: var(--text-dim);
  }

  .link-button {
    min-height: 2rem;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  .link .word {
    color: var(--text);
  }

  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--text-faint);
  }

  /* Colour + word: live/connected green, stale/connecting amber, off/waiting neutral. */
  .link[data-state='receiving'] .dot,
  .link[data-state='connected'] .dot {
    background: var(--green);
  }
  .link[data-state='stale'] .dot,
  .link[data-state='connecting'] .dot {
    background: var(--amber);
  }
  .link[data-state='stale'] .word,
  .link[data-state='connecting'] .word {
    color: var(--amber);
  }

  .repair {
    min-height: 2rem;
    padding: 0 0.6rem;
    border: 1px solid var(--amber);
    border-radius: var(--radius);
    background: transparent;
    color: var(--amber);
    font-size: 0.8125rem;
    font-weight: 700;
    cursor: pointer;
  }

  .clock {
    margin-left: auto;
  }

  .time {
    font-size: 1.25rem;
    letter-spacing: 0.02em;
  }

  .suffix {
    margin-left: 0.1rem;
    color: var(--text-dim);
    font-size: 0.9rem;
  }

  .paused {
    color: var(--amber);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .banner {
    width: 100%;
    font-weight: 700;
    color: var(--amber);
  }

  .banner.red {
    color: var(--red);
  }
</style>
