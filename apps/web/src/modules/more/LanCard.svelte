<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  More → Settings → Screens on your network (P1.8, decided 23 Oct 2026): the
  LAN switch, the Windows Firewall rule, pairing by QR code and the paired
  devices – each stays paired until removed here (unused 90 days: dropped).
-->
<script lang="ts">
  import Card from '../../components/Card.svelte';
  import CommandStatus from '../../components/CommandStatus.svelte';
  import ConfirmButton from '../../components/ConfirmButton.svelte';
  import QrCode from '../../components/QrCode.svelte';
  import Row from '../../components/Row.svelte';
  import { clock } from '../../lib/clock.svelte.js';
  import { formatAge } from '../../lib/format.js';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';

  const lan = $derived(host.view.slices?.host.lan ?? null);
  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');

  function left(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
  }

  const date = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
</script>

<Card title={t('lan.title')}>
  <p class="help">{t('lan.help')}</p>
  <div class="choice" role="group" aria-label={t('lan.title')}>
    {#each [false, true] as on (on)}
      <button
        type="button"
        class="btn"
        class:selected={lan?.enabled === on}
        aria-pressed={lan?.enabled === on}
        disabled={busy}
        onclick={() => {
          command = host.send({ cmd: 'lan.set', args: { enabled: on } });
        }}>{t(on ? 'lan.on' : 'lan.off')}</button
      >
    {/each}
  </div>

  {#if lan?.enabled}
    {#if lan.error}
      <p class="alert" role="alert">{lan.error}</p>
    {/if}
    <Row label={t('lan.addresses')} mono>
      {lan.addresses.length > 0 ? lan.addresses.join(' · ') : t('value.none')}
    </Row>
    {#if lan.firewall === 'ok'}
      <Row label={t('lan.firewall')}>{t('lan.firewall.ok')}</Row>
    {:else if lan.firewall === 'missing'}
      <p class="alert">{t('lan.firewall.missing', { port: lan.port })}</p>
      <button
        type="button"
        class="btn"
        disabled={busy}
        onclick={() => {
          command = host.send({ cmd: 'lan.addFirewallRule', args: {} });
        }}>{t('lan.firewall.add')}</button
      >
    {:else if lan.firewall === 'publicNetwork'}
      <p class="alert">{t('lan.firewall.public')}</p>
    {/if}

    <h3>{t('lan.pair')}</h3>
    {#if lan.pairing && lan.pairing.expiresAt > clock.now}
      <div class="pairing">
        <QrCode text={lan.pairing.url} label={t('lan.qr')} />
        <p class="note">{t('lan.pair.scan')}</p>
        <p class="url mono">{lan.pairing.url}</p>
        <p class="note">{t('lan.pair.valid', { time: left(lan.pairing.expiresAt - clock.now) })}</p>
        <button
          type="button"
          class="btn"
          onclick={() => {
            command = host.send({ cmd: 'lan.cancelPair', args: {} });
          }}>{t('lan.pair.cancel')}</button
        >
      </div>
    {:else}
      <div class="actions">
        {#each lan.addresses as address (address)}
          <button
            type="button"
            class="btn primary"
            disabled={busy}
            onclick={() => {
              command = host.send({ cmd: 'lan.pair', args: { address } });
            }}
            >{lan.addresses.length > 1
              ? t('lan.pair.at', { address })
              : t('lan.pair.button')}</button
          >
        {/each}
      </div>
    {/if}
    <p class="note">{t('lan.pair.addressNote')}</p>
  {/if}

  {#if (lan?.devices.length ?? 0) > 0}
    <h3>{t('lan.devices')}</h3>
    <ul class="devices">
      {#each lan?.devices ?? [] as d (d.id)}
        <li>
          <div class="who">
            <span class="name">{d.name}</span>
            <span class="dim">
              {t('lan.device.paired', { date: date(d.pairedAt) })} ·
              {d.connected
                ? t('lan.device.connected')
                : t('lan.device.seen', { age: formatAge(clock.now - d.lastSeen) })}
            </span>
          </div>
          <ConfirmButton
            label={t('lan.device.remove')}
            disabled={busy}
            onconfirm={() => {
              command = host.send({ cmd: 'lan.removeDevice', args: { id: d.id } });
            }}
          />
        </li>
      {/each}
    </ul>
    {#if (lan?.devices.length ?? 0) > 1}
      <div class="actions">
        <ConfirmButton
          label={t('lan.device.removeAll')}
          disabled={busy}
          onconfirm={() => {
            command = host.send({ cmd: 'lan.removeAll', args: {} });
          }}
        />
      </div>
    {/if}
  {/if}
  <CommandStatus id={command} />
</Card>

<style>
  .help {
    margin-bottom: 0.75rem;
    color: var(--text-dim);
    font-size: 0.9375rem;
  }

  .alert {
    margin: 0.75rem 0 0.5rem;
  }

  h3 {
    margin: 1rem 0 0.5rem;
    font-size: 1rem;
  }

  .pairing {
    display: grid;
    justify-items: start;
    gap: 0.5rem;
  }

  .url {
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
    color: var(--text-dim);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .note {
    margin-top: 0.5rem;
  }

  .devices {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .devices li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--surface-3);
  }

  .who {
    display: grid;
  }

  .name {
    font-weight: 700;
  }

  .dim {
    color: var(--text-dim);
    font-size: 0.875rem;
  }

  .btn {
    margin-top: 0.25rem;
  }
</style>
