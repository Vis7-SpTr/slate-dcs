<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Ownship → Flight (ui-design.md §8, P1.6c): flight name and number, own
  position, members with type, fuel, weapons and status age; create / join
  (list or private code) / leave; lead actions for the member in command;
  move up to -1 when allowed (protocol.md §7.4).
-->
<script lang="ts">
  import {
    armamentTotals,
    fuelUnit,
    normalizeFlightCode,
    shortWeaponName,
    unitDisplayName,
  } from '@slate-dcs/shared';
  import type { FlightMember, StatusBody } from '@slate-dcs/shared';

  import Card from '../../components/Card.svelte';
  import CommandStatus from '../../components/CommandStatus.svelte';
  import ConfirmButton from '../../components/ConfirmButton.svelte';
  import EmptyState from '../../components/EmptyState.svelte';
  import Picks from '../../components/Picks.svelte';
  import { clock } from '../../lib/clock.svelte.js';
  import { formatAge, formatFuel } from '../../lib/format.js';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';
  import { FLIGHT_CALLSIGNS, unitCallsign } from '../../lib/picks.js';
  import { router } from '../../lib/router.svelte.js';

  const slices = $derived(host.view.slices);
  const session = $derived(slices?.session ?? null);
  const flight = $derived(slices?.flight ?? null);
  const own = $derived(flight?.own ?? null);
  const me = $derived(session?.pid ?? null);
  const inCommand = $derived(own !== null && own.inCommand === me);
  const myPos = $derived(own?.members.find((m) => m.pid === me)?.pos ?? null);

  let name = $state('');
  /**
   * Flight names to pick (ui-design.md §11): the callsign of his own DCS unit
   * first, if it has one, then the DCS callsigns. Anything else is typed.
   */
  const namePicks = $derived.by(() => {
    const own = unitCallsign(slices?.ownship.aircraft?.unit);
    const list = own ? [own, ...FLIGHT_CALLSIGNS.filter((n) => n !== own)] : FLIGHT_CALLSIGNS;
    return list.map((n) => ({
      label: n === own ? t('flight.name.fromMission', { name: n }) : n,
      value: n,
    }));
  });
  let open = $state(true);
  let code = $state('');
  const flightCode = $derived(normalizeFlightCode(code));
  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');

  function nickOf(pid: string): string {
    return session?.participants.find((p) => p.pid === pid)?.nick ?? pid;
  }

  /** Status of a member: own from the own aircraft, mates from their packages. */
  function statusOf(member: FlightMember): { status: StatusBody; at: number } | null {
    if (member.pid === me) {
      const status = slices?.ownship.status;
      const at = slices?.ownship.statusAt;
      return status && at ? { status, at } : null;
    }
    const entry = flight?.status.find((s) => s.pid === member.pid);
    return entry ? { status: entry.status, at: entry.receivedAt } : null;
  }

  function weapons(status: StatusBody): string {
    const stations = status.armament?.stations ?? [];
    const totals = armamentTotals(stations);
    const list = [...totals.aa, ...totals.ag].map(
      (w) => `${String(w.count)}× ${shortWeaponName(w.name)}`,
    );
    return list.length > 0 ? list.join(' ') : t('value.none');
  }

  function wait(ms: number): string {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
  }
</script>

{#if !session || session.state === 'notJoined' || session.state === 'confirmFingerprint'}
  <div class="empty-wrap">
    <EmptyState title={t('flight.noSession')} text={t('flight.noSession.text')} />
    <button
      type="button"
      class="btn primary"
      onclick={() => {
        router.go('more', 'session');
      }}>{t('flight.goSession')}</button
    >
  </div>
{:else if session.role === 'jtac'}
  <EmptyState title={t('flight.jtac')} text={t('flight.jtac.text')} />
{:else if own}
  <div class="flight">
    <Card title={own.display}>
      <p class="pos">
        {#if myPos !== null}<span class="mono">{own.display}-{myPos}</span>{/if}
        {#if inCommand}<span class="tag">{t('flight.inCommand')}</span>{/if}
      </p>
      {#if own.privateCode}
        <p class="note">{t('flight.privateCode')}</p>
        <p class="code mono">{own.privateCode}</p>
      {/if}

      <ul class="members">
        {#each own.members as m (m.pid)}
          {@const s = statusOf(m)}
          <li class:lost={m.presence === 'lost'} class:mine={m.pid === me}>
            <div class="line">
              <span class="mono slot">-{m.pos}</span>
              <span class="who">
                {nickOf(m.pid)}{m.pid === me ? ` (${t('flight.you')})` : ''}
                <span class="dim">{m.aircraft ? unitDisplayName(m.aircraft.type) : ''}</span>
              </span>
              <span class="flags">
                {#if own.inCommand === m.pid}<span class="tag">{t('flight.inCommand')}</span>{/if}
                {#if m.presence === 'lost'}<span class="tag amber">{t('flight.lost')}</span>{/if}
              </span>
            </div>
            <div class="line dim small">
              {#if s}
                <span class="mono">
                  {s.status.fuel
                    ? formatFuel(
                        s.status.fuel.internalKg + s.status.fuel.externalKg,
                        fuelUnit(m.aircraft?.type),
                      )
                    : t('value.none')}
                </span>
                <span class="mono">{weapons(s.status)}</span>
                <span>{formatAge(clock.now - s.at)}</span>
              {:else}
                <span>{t('flight.noStatus')}</span>
              {/if}
            </div>
            {#if inCommand && m.pid !== me && m.pos !== 1}
              <div class="line moves">
                <span class="dim small">{t('flight.moveTo')}</span>
                {#each [2, 3, 4] as pos (pos)}
                  {#if pos !== m.pos && own.members.find((x) => x.pos === pos)?.pid !== me}
                    <button
                      type="button"
                      class="btn small-btn"
                      disabled={busy}
                      onclick={() => {
                        command = host.send({ cmd: 'flight.move', args: { pid: m.pid, pos } });
                      }}>-{pos}</button
                    >
                  {/if}
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      </ul>

      {#if own.moveUp && own.moveUp.pid === me}
        {@const left = own.moveUp.allowedFrom - clock.now}
        <p class="note">{t('flight.moveUp.help')}</p>
        <button
          type="button"
          class="btn primary"
          disabled={busy || left > 0}
          onclick={() => {
            command = host.send({ cmd: 'flight.moveUp', args: {} });
          }}>{left > 0 ? t('flight.moveUp.wait', { time: wait(left) }) : t('flight.moveUp')}</button
        >
      {/if}

      <div class="actions">
        <ConfirmButton
          label={t('flight.leave')}
          disabled={busy}
          onconfirm={() => {
            command = host.send({ cmd: 'flight.leave', args: {} });
          }}
        />
      </div>
      <CommandStatus id={command} />
    </Card>
  </div>
{:else}
  <div class="flight">
    <Card title={t('flight.create')}>
      <form
        class="form-grid"
        onsubmit={(event) => {
          event.preventDefault();
          if (name.trim() === '') return;
          command = host.send({ cmd: 'flight.create', args: { name: name.trim(), open } });
        }}
      >
        <label class="field">
          <span>{t('flight.name')}</span>
          <input bind:value={name} maxlength="24" placeholder={t('flight.name.placeholder')} />
        </label>
        <Picks
          items={namePicks}
          label={t('flight.namePicks')}
          selected={name.trim()}
          onpick={(n) => {
            name = n;
          }}
        />
        <div class="choice" role="group" aria-label={t('flight.create')}>
          <button
            type="button"
            class="btn"
            class:selected={open}
            aria-pressed={open}
            onclick={() => {
              open = true;
            }}>{t('flight.open')}</button
          >
          <button
            type="button"
            class="btn"
            class:selected={!open}
            aria-pressed={!open}
            onclick={() => {
              open = false;
            }}>{t('flight.private')}</button
          >
        </div>
        <div>
          <button type="submit" class="btn primary" disabled={busy || name.trim() === ''}
            >{t('flight.createButton')}</button
          >
        </div>
      </form>
    </Card>

    <Card title={t('flight.list')}>
      {#if (flight?.open.length ?? 0) === 0}
        <p class="note">{t('flight.list.none')}</p>
      {:else}
        <ul class="list">
          {#each flight?.open ?? [] as f (f.flightId)}
            <li>
              <span class="who">
                {f.display}
                <span class="dim">
                  {t('flight.list.members', { count: f.memberCount })} · {f.types
                    .map((type) => unitDisplayName(type))
                    .join(', ')}
                </span>
              </span>
              <button
                type="button"
                class="btn"
                disabled={busy || f.memberCount >= 4}
                onclick={() => {
                  command = host.send({ cmd: 'flight.join', args: { flightId: f.flightId } });
                }}>{t('flight.joinButton')}</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    </Card>

    <Card title={t('flight.byCode')}>
      <form
        class="form-grid"
        onsubmit={(event) => {
          event.preventDefault();
          if (flightCode === null) return;
          command = host.send({ cmd: 'flight.join', args: { privateCode: flightCode } });
        }}
      >
        <label class="field">
          <span>{t('flight.code')}</span>
          <input
            class="mono"
            bind:value={code}
            placeholder={t('flight.code.placeholder')}
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        {#if code.trim() !== '' && flightCode === null}
          <p class="note amber">{t('flight.code.bad')}</p>
        {/if}
        <div>
          <button type="submit" class="btn primary" disabled={busy || flightCode === null}
            >{t('flight.joinButton')}</button
          >
        </div>
      </form>
      <CommandStatus id={command} />
    </Card>
  </div>
{/if}

<style>
  .flight {
    display: grid;
    gap: 0.75rem;
    max-width: 40rem;
    margin-inline: auto;
  }

  .empty-wrap {
    display: grid;
    justify-items: center;
    gap: 1rem;
  }

  .pos {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--blue);
  }

  .code {
    margin: 0.25rem 0 0.75rem;
    font-size: 1.5rem;
    letter-spacing: 0.08em;
  }

  .tag {
    padding: 0.1rem 0.45rem;
    border: 1px solid var(--line);
    border-radius: 0.3rem;
    color: var(--text-dim);
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .tag.amber {
    border-color: var(--amber);
    color: var(--amber);
  }

  .members,
  .list {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .members li {
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .members li.mine {
    border-color: var(--blue);
  }

  .members li.lost {
    opacity: 0.75;
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.9rem;
  }

  .slot {
    min-width: 2rem;
    font-weight: 700;
  }

  .who {
    flex: 1;
    font-weight: 700;
  }

  .flags {
    display: flex;
    gap: 0.4rem;
  }

  .dim {
    margin-left: 0.4rem;
    color: var(--text-dim);
    font-weight: 400;
  }

  .small {
    margin-top: 0.25rem;
    margin-left: 2.4rem;
    font-size: 0.875rem;
  }

  .moves {
    margin-top: 0.4rem;
    margin-left: 2.4rem;
  }

  .moves .dim {
    margin-left: 0;
  }

  .small-btn {
    min-width: 3.5rem;
  }

  .list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--surface-3);
  }

  .amber {
    color: var(--amber);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .note {
    margin: 0.5rem 0;
  }
</style>
