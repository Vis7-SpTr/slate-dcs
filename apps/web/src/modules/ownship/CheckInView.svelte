<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Ownship → Check-in for a pilot (ui-design.md §8, protocol.md §9.1–§9.2,
  P2.7): the brief, prepared now and sent later. Prefilled fields are marked
  AUTO and refreshed at sending until the lead types over one (RESET gives it
  back); the rest he enters, laser codes included. SEND TO an AO or one of its
  JTACs (with their frequencies); CHECK OUT far right. Only the member in
  command sends; his flight mates see the brief and the check-in.
-->
<script lang="ts">
  import { LaserCode, unitDisplayName } from '@slate-dcs/shared';
  import type { BriefField, Capability, CheckInBrief } from '@slate-dcs/shared';
  import { untrack } from 'svelte';

  import Card from '../../components/Card.svelte';
  import CommandStatus from '../../components/CommandStatus.svelte';
  import ConfirmButton from '../../components/ConfirmButton.svelte';
  import Ticks from '../../components/Ticks.svelte';
  import {
    callsignOf,
    casWho,
    checkInOf,
    latestDelivery,
    positionText,
    tickLevel,
  } from '../../lib/cas.js';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  const own = $derived(slices?.flight.own ?? null);
  const lead = $derived(own !== null && own.inCommand === slices?.session.pid);
  const checkIn = $derived(slices && own ? checkInOf(slices, own.flightId) : null);
  const draft = $derived(slices?.cas.briefDraft ?? null);
  /** What the page shows: the lead's draft, a wingman the brief as sent (or the draft). */
  const brief = $derived<CheckInBrief | null>(
    lead ? (draft?.brief ?? null) : (checkIn?.brief ?? draft?.brief ?? null),
  );
  const edited = $derived(new Set<BriefField>(lead ? (draft?.edited ?? []) : []));
  const aos = $derived(slices?.cas.aos ?? []);
  const ticks = $derived(
    slices ? tickLevel(latestDelivery(slices, 'cas.checkIn'), null, false) : 'none',
  );

  const CAPS: readonly Capability[] = ['tgp', 'laser', 'irPointer', 'datalink', 'facA', 'nvg'];

  // The entered fields, typed here and saved to the host's draft on change.
  const start = untrack(() => draft?.brief ?? null);
  let callsign = $state(start?.callsign ?? '');
  let playtime = $state(start?.playtimeMin === null || !start ? '' : String(start.playtimeMin));
  let abortCode = $state(start?.abortCode ?? '');
  let missionNumber = $state(start?.missionNumber ?? '');
  let flightCode = $state(
    start?.laserCodes.flight === null || !start ? '' : String(start.laserCodes.flight),
  );
  let ownCodes: Record<string, string> = $state(
    Object.fromEntries(
      Object.entries(start?.laserCodes.perAircraft ?? {}).map(([pid, code]) => [pid, String(code)]),
    ),
  );
  let remarks = $state(start?.remarks ?? '');

  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');

  /** A typed laser code: `null` when empty, `undefined` when it isn't a valid one. */
  function code(text: string): number | null | undefined {
    if (text.trim() === '') return null;
    const parsed = LaserCode.safeParse(Number(text.trim()));
    return parsed.success ? parsed.data : undefined;
  }
  const badCodes = $derived(
    code(flightCode) === undefined || Object.values(ownCodes).some((c) => code(c) === undefined),
  );

  function save(changes: Partial<CheckInBrief>, reset: BriefField[] = []): void {
    command = host.send({ cmd: 'cas.setBrief', args: { changes, reset } });
  }

  function saveCodes(): void {
    if (badCodes) return;
    const perAircraft: Record<string, number> = {};
    for (const [pid, text] of Object.entries(ownCodes)) {
      const c = code(text);
      if (typeof c === 'number') perAircraft[pid] = c;
    }
    save({ laserCodes: { flight: code(flightCode) ?? null, perAircraft } });
  }

  // SEND TO: an AO, or one JTAC working it (§9.2). Starts at the current check-in.
  let target: { scope: 'ao' | 'pid'; id: string } | null = $state(null);
  const chosen = $derived(
    target ??
      (checkIn
        ? checkIn.primary
          ? { scope: 'pid' as const, id: checkIn.primary }
          : { scope: 'ao' as const, id: checkIn.aoId }
        : aos[0]
          ? { scope: 'ao' as const, id: aos[0].aoId }
          : null),
  );
  const same = (a: { scope: string; id: string } | null, scope: string, id: string) =>
    a?.scope === scope && a.id === id;
  const fullCodes = $derived(brief?.laserCodes ?? { flight: null, perAircraft: {} });
</script>

{#snippet auto(field: BriefField)}
  {#if edited.has(field)}
    <span class="tag typed">{t('brief.typed')}</span>
    {#if lead}
      <button
        type="button"
        class="link"
        onclick={() => {
          save({}, [field]);
        }}>{t('brief.reset')}</button
      >
    {/if}
  {:else}
    <span class="tag auto">{t('brief.auto')}</span>
  {/if}
{/snippet}

<div class="checkin">
  {#if !slices || !who}
    <p></p>
  {:else if !own}
    <Card title={t('brief.title')}>
      <p class="note">{t('brief.noFlight')}</p>
    </Card>
  {:else}
    <Card title={t('brief.state')}>
      {#if checkIn}
        {@const ao = aos.find((a) => a.aoId === checkIn.aoId)}
        <p class="state ok">{t('brief.checkedIn', { ao: ao?.name ?? checkIn.aoId })}</p>
        {#if checkIn.primary}
          <p>{t('cas.primary', { jtac: callsignOf(slices, checkIn.primary) })}</p>
        {/if}
      {:else}
        <p class="state">{t('brief.notCheckedIn')}</p>
      {/if}
      {#if !lead}
        <p class="note dim">
          {t('brief.leadSends', { lead: callsignOf(slices, own.inCommand ?? '') })}
        </p>
      {/if}
    </Card>

    {#if brief}
      <Card title={t('brief.title')}>
        <div class="rows">
          <div class="row">
            <span class="label">{t('brief.callsign')}</span>
            {#if lead}
              <input
                aria-label={t('brief.callsign')}
                bind:value={callsign}
                maxlength="24"
                onchange={() => {
                  if (callsign.trim() !== '') save({ callsign: callsign.trim() });
                }}
              />
            {:else}
              <span class="value">{brief.callsign}</span>
            {/if}
            {@render auto('callsign')}
          </div>
          <div class="row">
            <span class="label">{t('brief.aircraft')}</span>
            <span class="value">
              {brief.aircraft
                .map((a) => `${callsignOf(slices, a.pid)} ${unitDisplayName(a.type)}`)
                .join(' · ')}
            </span>
            {@render auto('aircraft')}
          </div>
          <div class="row">
            <span class="label">{t('brief.position')}</span>
            <span class="value mono">
              {brief.position
                ? `${positionText(brief.position, who.style)[0] ?? ''} · ${String(Math.round(brief.position.altMsl / 0.3048 / 100) * 100)} ft`
                : t('brief.noPosition')}
            </span>
            {@render auto('position')}
          </div>
          <div class="row">
            <span class="label">{t('brief.ordnance')}</span>
            <span class="value">
              {brief.ordnance.map((o) => `${String(o.count)}× ${o.name}`).join(' · ') ||
                t('cas.noOrdnance')}
            </span>
            {@render auto('ordnance')}
          </div>
        </div>

        {#if lead}
          <div class="form-grid entered">
            <div class="two">
              <label class="field">
                <span>{t('brief.playtime')}</span>
                <input
                  class="mono"
                  inputmode="numeric"
                  bind:value={playtime}
                  onchange={() => {
                    const n = Number(playtime);
                    if (playtime.trim() === '') save({ playtimeMin: null });
                    else if (Number.isInteger(n) && n >= 0) save({ playtimeMin: n });
                  }}
                />
              </label>
              <label class="field">
                <span>{t('cas.abortCode')}</span>
                <input
                  class="mono"
                  maxlength="12"
                  bind:value={abortCode}
                  onchange={() => {
                    save({ abortCode: abortCode.trim() || null });
                  }}
                />
              </label>
            </div>
            <label class="field">
              <span>{t('cas.missionNumber')}</span>
              <input
                class="mono"
                maxlength="16"
                bind:value={missionNumber}
                onchange={() => {
                  save({ missionNumber: missionNumber.trim() || null });
                }}
              />
            </label>
            <div class="field">
              <span>{t('cas.capabilities')}</span>
              <div class="choice caps" role="group" aria-label={t('cas.capabilities')}>
                {#each CAPS as cap (cap)}
                  {@const on = brief.capabilities.includes(cap)}
                  <button
                    type="button"
                    class="btn"
                    class:selected={on}
                    aria-pressed={on}
                    disabled={busy}
                    onclick={() => {
                      save({
                        capabilities: on
                          ? brief.capabilities.filter((c) => c !== cap)
                          : [...brief.capabilities, cap],
                      });
                    }}>{t(`cap.${cap}`)}</button
                  >
                {/each}
              </div>
            </div>
            <fieldset class="codes">
              <legend>{t('brief.laserCodes')}</legend>
              <label class="field">
                <span>{t('brief.flightCode')}</span>
                <input
                  class="mono"
                  inputmode="numeric"
                  maxlength="4"
                  bind:value={flightCode}
                  onchange={saveCodes}
                />
              </label>
              {#each brief.aircraft as a (a.pid)}
                <label class="field">
                  <span>{t('brief.ownCode', { who: callsignOf(slices, a.pid) })}</span>
                  <input
                    class="mono"
                    inputmode="numeric"
                    maxlength="4"
                    placeholder={t('brief.ownCode.placeholder')}
                    value={ownCodes[a.pid] ?? ''}
                    oninput={(event) => {
                      ownCodes = { ...ownCodes, [a.pid]: event.currentTarget.value };
                    }}
                    onchange={saveCodes}
                  />
                </label>
              {/each}
              {#if badCodes}<p class="note amber">{t('brief.badCode')}</p>{/if}
            </fieldset>
            <label class="field">
              <span>{t('brief.remarks')}</span>
              <textarea
                rows="2"
                maxlength="500"
                bind:value={remarks}
                onchange={() => {
                  save({ remarks: remarks.trim() });
                }}></textarea>
            </label>
          </div>
        {:else}
          <div class="rows">
            <div class="row">
              <span class="label">{t('brief.playtime')}</span>
              <span class="value">{brief.playtimeMin ?? t('value.none')}</span>
            </div>
            <div class="row">
              <span class="label">{t('brief.laserCodes')}</span>
              <span class="value mono">
                {fullCodes.flight ?? t('value.none')}
                {#each Object.entries(fullCodes.perAircraft) as [pid, c] (pid)}
                  · {callsignOf(slices, pid)} {c}
                {/each}
              </span>
            </div>
            <div class="row">
              <span class="label">{t('cas.capabilities')}</span>
              <span class="value">
                {brief.capabilities.map((c) => t(`cap.${c}`)).join(' · ') || t('value.none')}
              </span>
            </div>
          </div>
        {/if}
      </Card>
    {/if}

    {#if lead}
      <Card title={t('brief.sendTo')}>
        {#if aos.length === 0}
          <p class="note">{t('brief.noAo')}</p>
        {:else}
          <ul class="targets">
            {#each aos as ao (ao.aoId)}
              <li>
                <button
                  type="button"
                  class="target"
                  class:selected={same(chosen, 'ao', ao.aoId)}
                  aria-pressed={same(chosen, 'ao', ao.aoId)}
                  onclick={() => {
                    target = { scope: 'ao', id: ao.aoId };
                  }}
                >
                  <span class="name">{ao.name}</span>
                  <span class="dim">{t('brief.wholeAo')}</span>
                </button>
                {#each ao.jtacs as j (j.pid)}
                  <button
                    type="button"
                    class="target jtac"
                    class:selected={same(chosen, 'pid', j.pid)}
                    aria-pressed={same(chosen, 'pid', j.pid)}
                    onclick={() => {
                      target = { scope: 'pid', id: j.pid };
                    }}
                  >
                    <span class="name">{j.callsign}</span>
                    <span class="mono dim">
                      {j.freqs
                        .map((f) => `${f.mhz.toFixed(3)}${f.label ? ` ${f.label}` : ''}`)
                        .join(' · ') || t('value.none')}
                    </span>
                    {#if j.presence === 'lost'}<span class="amber">{t('flight.lost')}</span>{/if}
                  </button>
                {/each}
              </li>
            {/each}
          </ul>
        {/if}
        <div class="slots">
          <button
            type="button"
            class="btn primary"
            disabled={busy || chosen === null || badCodes}
            onclick={() => {
              if (chosen) command = host.send({ cmd: 'cas.checkIn', args: { target: chosen } });
            }}>{checkIn ? t('brief.update') : t('brief.send')}</button
          >
          <Ticks level={ticks} />
          {#if checkIn}
            <ConfirmButton
              label={t('brief.checkOut')}
              disabled={busy}
              onconfirm={() => {
                command = host.send({ cmd: 'cas.checkOut', args: {} });
              }}
            />
          {:else}
            <span></span>
          {/if}
        </div>
      </Card>
    {/if}
    <CommandStatus id={command} />
  {/if}
</div>

<style>
  .checkin {
    display: grid;
    gap: 0.75rem;
    max-width: 44rem;
    margin-inline: auto;
  }

  .state {
    font-weight: 700;
  }

  .ok {
    color: var(--green);
  }

  .rows {
    display: grid;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(5rem, 8rem) 1fr auto;
    align-items: center;
    gap: 0.25rem 0.5rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--line);
  }

  .row input {
    min-width: 0;
    min-height: var(--touch);
    padding: 0 0.875rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
  }

  .row input:focus {
    outline: 2px solid var(--blue);
  }

  .label {
    color: var(--text-dim);
    font-size: 0.875rem;
  }

  .value {
    overflow-wrap: anywhere;
  }

  .tag {
    padding: 0 0.35rem;
    border: 1px solid var(--line);
    border-radius: 0.25rem;
    font-size: 0.6875rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .tag.auto {
    border-color: var(--blue);
    color: var(--blue);
  }

  .tag.typed {
    border-color: var(--amber);
    color: var(--amber);
  }

  .link {
    grid-column: 3;
    padding: 0;
    border: 0;
    background: none;
    color: var(--blue);
    font-size: 0.8125rem;
    text-decoration: underline;
    cursor: pointer;
  }

  .entered {
    margin-top: 0.75rem;
  }

  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.5rem;
  }

  .caps .btn {
    flex: 1 1 6rem;
  }

  .codes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.5rem;
    margin: 0;
    padding: 0.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  .codes legend {
    color: var(--text-dim);
    font-size: 0.8125rem;
  }

  .codes .note {
    grid-column: 1 / -1;
  }

  .targets {
    display: grid;
    gap: 0.5rem;
    margin: 0 0 0.75rem;
    padding: 0;
    list-style: none;
  }

  .targets li {
    display: grid;
    gap: 0.35rem;
  }

  .target {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    min-height: var(--touch);
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .target.jtac {
    margin-left: 1.25rem;
  }

  .target.selected {
    border-color: var(--blue);
    background: var(--surface-3);
  }

  .name {
    font-weight: 700;
  }

  .slots {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.5rem;
  }

  .slots :global(button) {
    min-width: 0;
  }

  .slots > :global(:last-child) {
    justify-self: end;
  }

  .dim {
    color: var(--text-dim);
  }

  .amber {
    color: var(--amber);
  }
</style>
