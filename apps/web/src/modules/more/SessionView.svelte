<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  More → Session (ui-design.md §3, P1.6c): join a session by hand, check the
  relay fingerprint on the first connect, see who is in the session, leave;
  the DCS server's announcement (P1.7) with "Join the server's session" when
  SLATE didn't join it by itself; and host mode – run a relay for the group
  on this PC.
-->
<script lang="ts">
  import { normalizeSessionCode, unitDisplayName } from '@slate-dcs/shared';
  import type { Coalition } from '@slate-dcs/shared';

  import Card from '../../components/Card.svelte';
  import CommandStatus from '../../components/CommandStatus.svelte';
  import ConfirmButton from '../../components/ConfirmButton.svelte';
  import Row from '../../components/Row.svelte';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';

  const slices = $derived(host.view.slices);
  const session = $derived(slices?.session ?? null);
  const relayHost = $derived(slices?.host.relayHost ?? null);
  const none = t('value.none');

  // The form is screen-local; nick defaults to the DCS player name.
  let address = $state('');
  let code = $state('');
  let coalition: Coalition = $state('blue');
  let nick = $state('');
  let role: 'pilot' | 'jtac' = $state('pilot');
  $effect(() => {
    if (nick === '' && slices?.mission.playerName) nick = slices.mission.playerName;
  });

  const normalized = $derived(normalizeSessionCode(code));
  /** The group code needs a coalition; BLUE-/RED- codes decide it. */
  const needsCoalition = $derived(normalized !== null && !/^(BLUE|RED)-/.test(normalized));
  const canJoin = $derived(address.trim() !== '' && normalized !== null && nick.trim() !== '');

  let joinCommand: string | null = $state(null);
  /** The join sent after confirming the fingerprint – the first one only asked. */
  let acceptCommand: string | null = $state(null);
  let hostCommand: string | null = $state(null);
  let announcedCommand: string | null = $state(null);

  const announced = $derived(session?.announced ?? null);
  /** Already in the announced session (same relay, same coalition)? */
  const inAnnounced = $derived.by(() => {
    if (!announced || !session?.relay || session.state === 'notJoined') return false;
    const here = session.relay.address.toLowerCase();
    const same = [announced.lan, announced.relay].some((a) => a?.toLowerCase() === here);
    return same && session.coalition === announced.coalition;
  });

  function joinAnnounced(): void {
    announcedCommand = host.send({
      cmd: 'session.joinAnnounced',
      args: { nick: nick.trim(), role },
    });
  }
  let leaveCommand: string | null = $state(null);
  const joining = $derived(
    host.pendingOf(joinCommand)?.state === 'pending' ||
      host.pendingOf(acceptCommand)?.state === 'pending' ||
      host.pendingOf(announcedCommand)?.state === 'pending',
  );

  function join(fingerprint: string | null = null): void {
    if (normalized === null) return;
    const id = host.send({
      cmd: 'session.join',
      args: {
        address: address.trim(),
        code: normalized,
        coalition: needsCoalition ? coalition : null,
        nick: nick.trim(),
        role,
        ...(fingerprint ? { fingerprint } : {}),
      },
    });
    if (fingerprint) acceptCommand = id;
    else joinCommand = id;
  }

  function joinOwn(): void {
    if (!relayHost?.codes || relayHost.port === null) return;
    address = `localhost:${String(relayHost.port)}`;
    code = relayHost.codes.group;
    join();
  }

  function setHost(enabled: boolean): void {
    hostCommand = host.send({ cmd: 'session.host', args: { enabled } });
  }
</script>

{#snippet announcedCard(a: NonNullable<typeof announced>)}
  <Card title={t('session.announced.title')}>
    <p class="note">
      {t('session.announced.help', { coalition: t(`coalition.${a.coalition}`) })}
    </p>
    <Row label={t('session.relay')} mono>
      <span class="addrs">
        {#each [a.lan, a.relay].filter(Boolean) as addr (addr)}
          <span class="addr">{addr}</span>
        {/each}
      </span>
    </Row>
    <Row label={t('session.coalition')}>{t(`coalition.${a.coalition}`)}</Row>
    {#if inAnnounced}
      <p class="note ok">{t('session.announced.inIt')}</p>
    {:else}
      {#if nick.trim() === ''}
        <p class="note amber">{t('session.announced.needNick')}</p>
      {/if}
      <div class="actions">
        <button
          type="button"
          class="btn primary"
          disabled={joining || nick.trim() === '' || session?.state === 'connecting'}
          onclick={joinAnnounced}>{t('session.announced.join')}</button
        >
      </div>
      <CommandStatus id={announcedCommand} />
    {/if}
  </Card>
{/snippet}

<div class="session">
  <!-- Not in the announced session: the offer comes first; in it: after the session. -->
  {#if announced && !inAnnounced && session?.state !== 'confirmFingerprint'}
    {@render announcedCard(announced)}
  {/if}

  <Card title={t('session.title')}>
    <p class="state" data-state={session?.state}>
      <span class="dot" aria-hidden="true"></span>{t(
        `session.state.${session?.state ?? 'notJoined'}`,
      )}
    </p>
    {#if session?.error}
      <p class="alert" class:red={session.fingerprintCheck?.known} role="alert">
        {session.error}
      </p>
    {/if}

    {#if session?.state === 'confirmFingerprint' && session.fingerprintCheck}
      {@const check = session.fingerprintCheck}
      <div class="fp">
        <h3>{t('session.fp.title')}</h3>
        <p class="note">{t('session.fp.help')}</p>
        <Row label={t('session.relay')} mono>{check.address}</Row>
        <p class="fingerprint mono">{check.fingerprint}</p>
        {#if check.known}
          <Row label={t('session.fp.changedWas')} mono>{check.known}</Row>
        {/if}
        <div class="actions">
          <button
            type="button"
            class="btn primary"
            disabled={joining || !canJoin}
            onclick={() => {
              join(check.fingerprint);
            }}>{t('session.fp.accept')}</button
          >
          <button
            type="button"
            class="btn"
            onclick={() => {
              acceptCommand = null;
              joinCommand = null;
              host.send({ cmd: 'session.leave', args: {} });
            }}>{t('session.fp.cancel')}</button
          >
        </div>
        <CommandStatus id={acceptCommand} />
      </div>
    {:else if session?.state === 'joined' || session?.state === 'reconnecting'}
      <Row label={t('session.relay')} mono>
        {session.relay?.own ? t('session.relay.own') : (session.relay?.address ?? none)}
      </Row>
      <Row label={t('session.coalition')}>
        {session.coalition ? t(`coalition.${session.coalition}`) : none}
      </Row>
      <Row label={t('session.you')}>
        {session.nick ?? none} · {t(`session.role.${session.role === 'jtac' ? 'jtac' : 'pilot'}`)}
      </Row>
      <h3>{t('session.participants')}</h3>
      <ul class="people">
        {#each session.participants as p (p.pid)}
          <li class:lost={p.presence === 'lost'}>
            <span class="nick">{p.nick}{p.pid === session.pid ? ` (${t('flight.you')})` : ''}</span>
            <span class="dim">
              {t(`session.role.${p.role === 'jtac' ? 'jtac' : 'pilot'}`)}
              {#if p.aircraft}· {unitDisplayName(p.aircraft.type)}{/if}
              · {t(`session.presence.${p.presence === 'lost' ? 'lost' : 'online'}`)}
            </span>
          </li>
        {/each}
      </ul>
      <div class="actions">
        <ConfirmButton
          label={t('session.leave')}
          onconfirm={() => {
            leaveCommand = host.send({ cmd: 'session.leave', args: {} });
          }}
        />
      </div>
      <CommandStatus id={leaveCommand} />
    {:else}
      <h3>{t('session.join')}</h3>
      <p class="note">{t('session.join.help')}</p>
      <form
        class="form-grid"
        onsubmit={(event) => {
          event.preventDefault();
          if (canJoin) join();
        }}
      >
        <label class="field">
          <span>{t('session.address')}</span>
          <input
            bind:value={address}
            placeholder={t('session.address.placeholder')}
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        <label class="field">
          <span>{t('session.code')}</span>
          <input
            class="mono"
            bind:value={code}
            placeholder={t('session.code.placeholder')}
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        {#if code.trim() !== '' && normalized === null}
          <p class="note amber">{t('session.code.bad')}</p>
        {/if}
        {#if needsCoalition}
          <div class="field">
            <span>{t('session.coalition')}</span>
            <div class="choice" role="group" aria-label={t('session.coalition')}>
              {#each ['blue', 'red'] as const as c (c)}
                <button
                  type="button"
                  class="btn"
                  class:selected={coalition === c}
                  aria-pressed={coalition === c}
                  onclick={() => {
                    coalition = c;
                  }}>{t(`coalition.${c}`)}</button
                >
              {/each}
            </div>
          </div>
        {/if}
        <label class="field">
          <span>{t('session.nick')}</span>
          <input bind:value={nick} maxlength="32" autocomplete="off" />
        </label>
        <div class="field">
          <span>{t('session.role')}</span>
          <div class="choice" role="group" aria-label={t('session.role')}>
            {#each ['pilot', 'jtac'] as const as r (r)}
              <button
                type="button"
                class="btn"
                class:selected={role === r}
                aria-pressed={role === r}
                onclick={() => {
                  role = r;
                }}>{t(`session.role.${r}`)}</button
              >
            {/each}
          </div>
        </div>
        <div class="actions">
          <button type="submit" class="btn primary" disabled={!canJoin || joining}
            >{t('session.joinButton')}</button
          >
          {#if relayHost?.state === 'on'}
            <button
              type="button"
              class="btn"
              disabled={joining || nick.trim() === ''}
              onclick={joinOwn}>{t('session.joinOwn')}</button
            >
          {/if}
        </div>
      </form>
      <CommandStatus id={joinCommand} />
    {/if}
  </Card>

  {#if announced && inAnnounced}
    {@render announcedCard(announced)}
  {/if}

  <Card title={t('session.host')}>
    <p class="note">{t('session.host.help')}</p>
    {#if relayHost?.state === 'on' && relayHost.codes}
      <Row label={t('session.host.port')} mono>{relayHost.port}</Row>
      <Row label={t('session.host.addresses')} mono>
        {relayHost.addresses.length > 0 ? relayHost.addresses.join(' · ') : none}
      </Row>
      <Row label={t('session.host.codeBlue')} mono>{relayHost.codes.blue}</Row>
      <Row label={t('session.host.codeRed')} mono>{relayHost.codes.red}</Row>
      <Row label={t('session.host.codeGroup')} mono>{relayHost.codes.group}</Row>
      <Row label={t('session.host.fingerprint')} mono>{relayHost.fingerprint ?? none}</Row>
      <p class="note">{t('session.host.note', { port: relayHost.port ?? 7790 })}</p>
      <div class="actions">
        <ConfirmButton
          label={t('session.host.stop')}
          onconfirm={() => {
            setHost(false);
          }}
        />
      </div>
    {:else}
      {#if relayHost?.state === 'failed' && relayHost.error}
        <p class="alert" role="alert">{relayHost.error}</p>
      {/if}
      <div class="actions">
        <button
          type="button"
          class="btn primary"
          disabled={relayHost?.state === 'starting'}
          onclick={() => {
            setHost(true);
          }}
          >{relayHost?.state === 'starting'
            ? t('session.host.starting')
            : t('session.host.start')}</button
        >
      </div>
    {/if}
    <CommandStatus id={hostCommand} />
  </Card>
</div>

<style>
  .session {
    display: grid;
    gap: 0.75rem;
    max-width: 40rem;
    margin-inline: auto;
  }

  .state {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.75rem;
    font-weight: 700;
  }

  .dot {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    background: var(--text-faint);
  }

  .state[data-state='joined'] .dot {
    background: var(--green);
  }

  .state[data-state='connecting'] .dot,
  .state[data-state='reconnecting'] .dot,
  .state[data-state='confirmFingerprint'] .dot {
    background: var(--amber);
  }

  .state[data-state='reconnecting'],
  .state[data-state='confirmFingerprint'] {
    color: var(--amber);
  }

  h3 {
    margin: 0.75rem 0 0.4rem;
    font-size: 1rem;
  }

  .note {
    margin-bottom: 0.75rem;
  }

  .alert {
    margin-bottom: 0.75rem;
  }

  .fingerprint {
    margin: 0.75rem 0;
    padding: 0.75rem;
    border: 1px solid var(--amber);
    border-radius: var(--radius);
    font-size: 1.25rem;
    letter-spacing: 0.04em;
    text-align: center;
    overflow-wrap: anywhere;
  }

  .people {
    display: grid;
    gap: 0.25rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .people li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.25rem 1rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--surface-3);
  }

  .people li.lost {
    color: var(--amber);
  }

  .nick {
    font-weight: 700;
  }

  .dim {
    color: var(--text-dim);
    font-size: 0.9375rem;
  }

  .amber {
    color: var(--amber);
  }

  .ok {
    color: var(--green);
  }

  /* One address per line (LAN first); a long hostname may still break. */
  .addrs {
    display: grid;
    justify-items: end;
  }

  .addr {
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  form .actions {
    margin-top: 0.25rem;
  }
</style>
