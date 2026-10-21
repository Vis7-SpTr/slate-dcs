<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Status strip along the top edge (ui-design.md §2): callsign + position,
  links (DCS, relay), check-in state, DCS mission clock, fuel. When the host
  link is down, the strip shows that instead – in place, so nothing on the
  page moves.
-->
<script lang="ts">
  import { clock } from '../lib/clock.svelte.js';
  import { formatKg, missionClock } from '../lib/format.js';
  import { host } from '../lib/host.svelte.js';
  import { t } from '../lib/i18n/index.js';

  const slices = $derived(host.view.slices);

  const callsign = $derived.by(() => {
    const own = slices?.flight.own;
    const pid = slices?.session.pid;
    if (!own) return t('strip.noFlight');
    const member = own.members.find((m) => m.pid === pid);
    return member ? `${own.display}-${member.pos}` : own.display;
  });

  const time = $derived(
    slices ? missionClock(slices.mission, slices.settings.timeDisplay, clock.now) : null,
  );

  const fuel = $derived.by(() => {
    const f = slices?.ownship.status?.fuel;
    return f ? formatKg(f.internalKg + f.externalKg) : t('value.none');
  });

  const bridge = $derived(slices?.host.bridge.state ?? 'waiting');
  const relay = $derived(slices?.host.relay.state ?? 'notConnected');
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
      <span class="link" data-state={relay}>
        <span class="dot" aria-hidden="true"></span>{t('strip.relay')}
        <span class="word">{t(`link.relay.${relay}`)}</span>
      </span>
    </div>

    <div class="item">
      <span class="label">{t('strip.checkIn')}</span>
      <span class="value">{t('strip.notCheckedIn')}</span>
    </div>

    <div class="item clock">
      {#if time?.time}
        <span class="value mono time">{time.time}<span class="suffix">{time.suffix}</span></span>
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

  .banner {
    width: 100%;
    font-weight: 700;
    color: var(--amber);
  }

  .banner.red {
    color: var(--red);
  }
</style>
