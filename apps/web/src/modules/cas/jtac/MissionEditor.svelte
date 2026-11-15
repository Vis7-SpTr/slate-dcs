<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Create or edit a fire mission (protocol.md §10.4, P2.6b): game plan, 9-line
  and remarks. Line 1 and the mark position are point references (IP/CP,
  keyhole point, coordinates); line 6 is typed in any format and kept with the
  text as passed; line 7 says who lases. Checked against the shared schema
  before sending. After the brief, a change is highlighted for the pilots, and
  a change to line 4, 6 or a restriction needs a new readback (§10.5).
-->
<script lang="ts">
  import { MissionContent as MissionContentSchema } from '@slate-dcs/shared';
  import type {
    FireMission,
    LatLon,
    Mark,
    MarkSource,
    MissionContent,
    PointRef,
  } from '@slate-dcs/shared';
  import { untrack } from 'svelte';

  import CommandStatus from '../../../components/CommandStatus.svelte';
  import ChoiceChips from '../../../components/ChoiceChips.svelte';
  import CoordInput from '../../../components/CoordInput.svelte';
  import EntryLinks from '../../../components/EntryLinks.svelte';
  import Picks from '../../../components/Picks.svelte';
  import PointInput from '../../../components/PointInput.svelte';
  import TextChips from '../../../components/TextChips.svelte';
  import TimePicks from '../../../components/TimePicks.svelte';
  import {
    callsignOf,
    casWho,
    flightName,
    laserUses,
    mtimeText,
    parseMissionTime,
    positionText,
  } from '../../../lib/cas.js';
  import { clock } from '../../../lib/clock.svelte.js';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';
  import { canSendBrief, emptyContent, targetFromEntry } from '../../../lib/missions.js';
  import { TEXT_CHIPS } from '../../../lib/picks.js';

  const {
    aoId,
    mission = null,
    flightId = null,
    onclose,
    onsaved = () => undefined,
  }: {
    aoId: string;
    mission?: FireMission | null;
    /** A new mission for this flight: SEND BRIEF creates, assigns and briefs it. */
    flightId?: string | null;
    onclose: () => void;
    onsaved?: () => void;
  } = $props();

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  const ao = $derived(slices?.cas.aos.find((a) => a.aoId === aoId) ?? null);
  const aircraft = $derived(
    slices?.cas.checkIns
      .filter((c) => c.aoId === aoId)
      .flatMap((c) => c.brief.aircraft.map((a) => a.pid)) ?? [],
  );

  const NM = 1852;
  const FT = 0.3048;
  // The form starts from the mission once; later updates from the relay don't reset what is typed.
  const start: MissionContent = structuredClone(
    untrack(() =>
      mission
        ? {
            gamePlan: $state.snapshot(mission.gamePlan),
            nineLine: $state.snapshot(mission.nineLine),
            remarks: $state.snapshot(mission.remarks),
          }
        : emptyContent(),
    ),
  );
  const empty = emptyContent();
  const gp = start.gamePlan ?? (empty.gamePlan as NonNullable<MissionContent['gamePlan']>);
  const nl = start.nineLine ?? (empty.nineLine as NonNullable<MissionContent['nineLine']>);
  const rm = start.remarks;
  const text = (n: number | null, f = 1) => (n === null ? '' : String(Math.round(n * f) / f));

  let control: 1 | 2 | 3 = $state(gp.control);
  let method: 'BOT' | 'BOC' = $state(gp.method);
  let effects = $state(gp.effects);
  let ordnance = $state(gp.ordnance);
  let interval = $state(gp.interval);

  let ipBp: PointRef | null = $state(nl.ipBp);
  let heading = $state(text(nl.headingDeg));
  let offset: 'left' | 'right' | null = $state(nl.offset);
  let distance = $state(nl.distanceM === null ? '' : text(nl.distanceM / NM, 10));
  let elevation = $state(nl.elevationM === null ? '' : text(nl.elevationM / FT));
  let description = $state(nl.description);
  let location: LatLon | null = $state(nl.location);
  let locationText = $state(nl.locationText);
  let markType: Mark['type'] = $state(nl.mark.type);
  let sourceKind: MarkSource['kind'] = $state(nl.mark.source?.kind ?? 'ownship');
  let sourcePid = $state(
    nl.mark.source && nl.mark.source.kind !== 'ownship' ? nl.mark.source.pid : '',
  );
  let code = $state(nl.mark.code === null ? '' : String(nl.mark.code));
  let markAt: PointRef | null = $state(nl.mark.at);
  let markText = $state(nl.mark.text);
  let friendlies = $state(nl.friendlies.text);
  let friendlyLinks: string[] = $state([...nl.friendlies.cmIds]);
  let egress = $state(nl.egress);

  let ltl = $state(text(rm.ltl));
  let fahFrom = $state(rm.finalAttackHeading ? text(rm.finalAttackHeading.fromDeg) : '');
  let fahTo = $state(rm.finalAttackHeading ? text(rm.finalAttackHeading.toDeg) : '');
  let dangerClose = $state(rm.dangerClose);
  let totText = $state('');
  let restrictions = $state(rm.restrictions.join('\n'));
  let hazards = $state(rm.hazards);
  let remarksText = $state(rm.text);

  /** Picks (ui-design.md §11): the flight's ordnance, laser codes in the AO. */
  const ordnancePicks = $derived.by(() => {
    const ids = flightId ?? mission?.assignee?.flightId ?? null;
    const check = slices?.cas.checkIns.find((c) => c.flightId === ids);
    return (check?.brief.ordnance ?? [])
      .filter((o) => !o.name.startsWith('Gun'))
      .map((o) => ({ label: o.name, value: o.name }));
  });
  const codePicks = $derived(
    [...new Set([1688, ...(slices ? laserUses(slices).map((u) => u.code) : [])])].map((c) => ({
      label: String(c),
      value: String(c),
    })),
  );

  /** A typed number, `null` when empty, `NaN` when it isn't one. */
  const num = (s: string): number | null =>
    s.trim() === '' ? null : Number(s.trim().replace(',', '.'));
  const tot = $derived(
    slices && totText.trim() !== '' ? parseMissionTime(slices, totText, clock.now) : rm.tot,
  );
  const pointer = $derived(markType === 'laser' || markType === 'ir');

  const content = $derived.by((): MissionContent => {
    const elevationFt = num(elevation);
    const distanceNm = num(distance);
    const source: MarkSource | null = !pointer
      ? null
      : sourceKind === 'ownship'
        ? { kind: 'ownship' }
        : { kind: sourceKind, pid: sourcePid };
    const from = num(fahFrom);
    const to = num(fahTo);
    return {
      gamePlan: {
        control,
        method,
        effects: effects.trim(),
        ordnance: ordnance.trim(),
        interval: interval.trim(),
      },
      nineLine: {
        ipBp,
        headingDeg: num(heading),
        offset,
        distanceM: distanceNm === null ? null : distanceNm * NM,
        elevationM: elevationFt === null ? null : elevationFt * FT,
        description: description.trim(),
        location,
        locationText:
          locationText.trim() ||
          (location && who ? (positionText(location, who.style)[0] ?? '') : ''),
        mark: {
          type: markType,
          code: markType === 'laser' && sourceKind !== 'ownship' ? num(code) : null,
          source,
          at: markAt,
          text: markText.trim(),
        },
        friendlies: { text: friendlies.trim(), cmIds: friendlyLinks },
        egress: egress.trim(),
      },
      remarks: {
        ltl: num(ltl),
        finalAttackHeading: from === null || to === null ? null : { fromDeg: from, toDeg: to },
        dangerClose,
        tot,
        restrictions: restrictions
          .split('\n')
          .map((r) => r.trim())
          .filter((r) => r !== ''),
        hazards: hazards.trim(),
        text: remarksText.trim(),
      },
    };
  });
  const parsed = $derived(MissionContentSchema.safeParse(content));
  const problem = $derived.by((): string | null => {
    if (totText.trim() !== '' && tot === null) return t('time.bad');
    if (parsed.success) return null;
    const issue = parsed.error.issues[0];
    return issue ? `${issue.path.join('.')}: ${issue.message}` : null;
  });
  const afterBrief = $derived(
    mission !== null && mission.state !== 'draft' && mission.state !== 'assigned',
  );

  let command: string | null = $state(null);
  const pending = $derived(host.pendingOf(command));
  const busy = $derived(pending?.state === 'pending');
  let sent = $state(false);
  /** Create, then assign and brief: the missions known before, to spot the new one. */
  let thenBrief: { known: string[]; flightId: string } | null = $state(null);
  $effect(() => {
    // Close once the relay has taken it: no longer pending, and not failed.
    const done = command !== null && pending === undefined;
    const failed = host.view.lastFailure?.id === command;
    if (failed) thenBrief = null;
    if (sent && done && !failed && thenBrief === null) {
      sent = false;
      onsaved();
    }
  });
  $effect(() => {
    const next = thenBrief;
    if (!next || !slices) return;
    const made = slices.missions.missions.find(
      (m) =>
        m.aoId === aoId &&
        m.owner === slices.session.pid &&
        m.state === 'draft' &&
        !next.known.includes(m.missionId),
    );
    if (!made) return;
    thenBrief = null;
    sent = false;
    const missionId = made.missionId;
    host.sequence([
      { cmd: 'fm.assign', args: { missionId, assignee: { flightId: next.flightId, pids: null } } },
      { cmd: 'fm.brief', args: { missionId } },
    ]);
    onsaved();
  });

  function save(brief = false): void {
    if (!parsed.success) return;
    sent = true;
    if (mission) {
      command = host.send({
        cmd: 'fm.update',
        args: { ...parsed.data, missionId: mission.missionId },
      });
      return;
    }
    if (brief && flightId !== null && slices) {
      thenBrief = { known: slices.missions.missions.map((m) => m.missionId), flightId };
    }
    command = host.send({ cmd: 'fm.create', args: { ...parsed.data, aoId } });
  }

  const targets = $derived(
    slices?.cas.mapEntries.filter(
      (e) => (e.kind === 'enemy' || e.kind === 'threat') && targetFromEntry(e) !== null,
    ) ?? [],
  );
  let targetId = $state('');
  function pickTarget(): void {
    const entry = targets.find((e) => e.cmId === targetId);
    const target = entry ? targetFromEntry(entry) : null;
    if (!target) return;
    description = target.description;
    location = target.location;
    locationText = '';
  }
  const briefable = $derived(parsed.success && canSendBrief(parsed.data));

  const choice = <T,>(list: readonly T[]) => list;
</script>

{#if slices && who && ao}
  <form
    class="form-grid editor"
    onsubmit={(event) => {
      event.preventDefault();
      save();
    }}
  >
    <h3>{mission ? t('fm.edit.title', { id: mission.missionId }) : t('fm.new.title')}</h3>
    {#if afterBrief}
      <p class="note amber">{t('fm.edit.afterBrief')}</p>
    {/if}

    <fieldset>
      <legend>{t('nine.gamePlan')}</legend>
      <div class="choice" role="group" aria-label={t('gp.control')}>
        {#each choice([1, 2, 3] as const) as c (c)}
          <button
            type="button"
            class="btn"
            class:selected={control === c}
            aria-pressed={control === c}
            onclick={() => {
              control = c;
            }}>{t('gp.type', { n: String(c) })}</button
          >
        {/each}
        {#each choice(['BOT', 'BOC'] as const) as m (m)}
          <button
            type="button"
            class="btn"
            class:selected={method === m}
            aria-pressed={method === m}
            onclick={() => {
              method = m;
            }}>{m}</button
          >
        {/each}
      </div>
      <label class="field">
        <span>{t('gp.effects')}</span>
        <input bind:value={effects} maxlength="100" placeholder={t('gp.effects.placeholder')} />
      </label>
      <TextChips
        bind:value={effects}
        chips={TEXT_CHIPS.effects}
        join="replace"
        label={t('gp.effects')}
      />
      <label class="field">
        <span>{t('gp.ordnance')}</span>
        <input bind:value={ordnance} maxlength="100" placeholder="GBU-12 x2" />
      </label>
      <Picks
        items={ordnancePicks}
        label={t('gp.ordnancePicks')}
        selected={ordnance}
        onpick={(o) => {
          ordnance = o;
        }}
      />
      <label class="field">
        <span>{t('gp.interval')}</span>
        <input bind:value={interval} maxlength="100" placeholder={t('gp.interval.placeholder')} />
      </label>
    </fieldset>

    <fieldset>
      <legend>{t('nine.title')}</legend>
      <PointInput bind:value={ipBp} {aoId} label={t('nine.1.input')} style={who.style} optional />
      <div class="two">
        <label class="field">
          <span>{t('nine.2.input')}</span>
          <input class="mono" inputmode="numeric" bind:value={heading} />
        </label>
        <div class="field">
          <span>{t('nine.offset')}</span>
          <div class="choice" role="group" aria-label={t('nine.offset')}>
            {#each choice([null, 'left', 'right'] as const) as o (o ?? 'none')}
              <button
                type="button"
                class="btn"
                class:selected={offset === o}
                aria-pressed={offset === o}
                onclick={() => {
                  offset = o;
                }}>{t(`nine.offset.${o ?? 'none'}`)}</button
              >
            {/each}
          </div>
        </div>
      </div>
      <div class="two">
        <label class="field">
          <span>{t('nine.3.input')}</span>
          <input class="mono" inputmode="decimal" bind:value={distance} />
        </label>
        <label class="field">
          <span>{t('nine.4.input')} <span class="rb">RB</span></span>
          <input class="mono" inputmode="numeric" bind:value={elevation} />
        </label>
      </div>
      {#if targets.length > 0}
        <ChoiceChips
          bind:value={targetId}
          label={t('fm.target')}
          options={targets.map((e) => ({
            value: e.cmId,
            label: `${t(`cm.${e.kind}`)} ${e.label ?? e.text ?? ''}`.trim(),
          }))}
          onchange={pickTarget}
        />
        <p class="note">{t('fm.target.note')}</p>
      {/if}
      <label class="field">
        <span>{t('nine.5.input')}</span>
        <input bind:value={description} maxlength="200" placeholder="2x BMP-2 in treeline" />
      </label>
      <CoordInput bind:value={location} label={t('nine.6.input')} style={who.style} />
      <label class="field">
        <span>{t('nine.6.passed')}</span>
        <input
          class="mono"
          bind:value={locationText}
          maxlength="64"
          placeholder={location ? (positionText(location, who.style)[0] ?? '') : ''}
        />
      </label>

      <div class="field">
        <span>{t('nine.7.input')}</span>
        <div class="choice" role="group" aria-label={t('nine.7.input')}>
          {#each choice(['none', 'laser', 'ir', 'smoke', 'other'] as const) as m (m)}
            <button
              type="button"
              class="btn"
              class:selected={markType === m}
              aria-pressed={markType === m}
              onclick={() => {
                markType = m;
              }}>{t(`mark.${m}`)}</button
            >
          {/each}
        </div>
      </div>
      {#if pointer}
        <div class="choice" role="group" aria-label={t('mark.source')}>
          {#each choice(['ownship', 'jtac', 'aircraft'] as const) as k (k)}
            <button
              type="button"
              class="btn"
              class:selected={sourceKind === k}
              aria-pressed={sourceKind === k}
              onclick={() => {
                sourceKind = k;
                sourcePid = k === 'jtac' ? (who.pid ?? '') : '';
              }}>{t(`mark.source.${k}`)}</button
            >
          {/each}
        </div>
        {#if sourceKind !== 'ownship'}
          <ChoiceChips
            bind:value={sourcePid}
            label={t('mark.who')}
            options={(sourceKind === 'jtac' ? ao.jtacs.map((j) => j.pid) : aircraft).map((pid) => ({
              value: pid,
              label: callsignOf(slices, pid),
            }))}
          />
          {#if markType === 'laser'}
            <label class="field">
              <span>{t('mark.code')}</span>
              <input
                class="mono"
                inputmode="numeric"
                data-osk="laser"
                maxlength="4"
                bind:value={code}
              />
            </label>
            <Picks
              items={codePicks}
              label={t('brief.codePicks')}
              selected={code}
              onpick={(c) => {
                code = c;
              }}
            />
          {/if}
        {:else if markType === 'laser'}
          <p class="note">{t('mark.ownship.note')}</p>
        {/if}
      {/if}
      {#if markType !== 'none'}
        <PointInput bind:value={markAt} {aoId} label={t('mark.at')} style={who.style} optional />
      {/if}
      <label class="field">
        <span>{t('mark.text')}</span>
        <input bind:value={markText} maxlength="64" placeholder={t('mark.text.placeholder')} />
      </label>
      <label class="field">
        <span>{t('nine.8.input')}</span>
        <input bind:value={friendlies} maxlength="500" placeholder="South 800 m" />
      </label>
      <TextChips bind:value={friendlies} chips={TEXT_CHIPS.friendlies} label={t('nine.8.input')} />
      <EntryLinks bind:value={friendlyLinks} kinds={['friendly']} label={t('links.friendlies')} />
      <label class="field">
        <span>{t('nine.9.input')}</span>
        <input bind:value={egress} maxlength="200" placeholder={t('nine.9.placeholder')} />
      </label>
      <TextChips
        bind:value={egress}
        chips={TEXT_CHIPS.egress}
        join="replace"
        label={t('nine.9.input')}
      />
    </fieldset>

    <fieldset>
      <legend>{t('nine.remarks')}</legend>
      <div class="two">
        <label class="field">
          <span>{t('remarks.ltl')} (°)</span>
          <input class="mono" inputmode="numeric" bind:value={ltl} />
        </label>
        <label class="field">
          <span>{t('remarks.tot')}</span>
          <input
            class="mono"
            data-osk="digits"
            bind:value={totText}
            placeholder={rm.tot === null ? t('time.placeholder') : mtimeText(slices, rm.tot)}
          />
          <TimePicks bind:value={totText} label={t('remarks.tot')} offsets={[5, 10, 15, 20, 30]} />
        </label>
      </div>
      <div class="two">
        <label class="field">
          <span>{t('remarks.fah.from')}</span>
          <input class="mono" inputmode="numeric" bind:value={fahFrom} />
        </label>
        <label class="field">
          <span>{t('remarks.fah.to')}</span>
          <input class="mono" inputmode="numeric" bind:value={fahTo} />
        </label>
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={dangerClose} />
        <span>DANGER CLOSE</span>
      </label>
      <label class="field">
        <span>{t('remarks.restrictions.input')} <span class="rb">RB</span></span>
        <textarea bind:value={restrictions} rows="2"></textarea>
      </label>
      <TextChips
        bind:value={restrictions}
        chips={TEXT_CHIPS.restrictions}
        join="line"
        label={t('remarks.restrictions.input')}
      />
      <label class="field">
        <span>{t('remarks.hazards')}</span>
        <input bind:value={hazards} maxlength="500" />
      </label>
      <TextChips bind:value={hazards} chips={TEXT_CHIPS.hazards} label={t('remarks.hazards')} />
      <label class="field">
        <span>{t('remarks.text')}</span>
        <textarea bind:value={remarksText} maxlength="1000" rows="2"></textarea>
      </label>
      <TextChips bind:value={remarksText} chips={TEXT_CHIPS.remarks} label={t('remarks.text')} />
    </fieldset>

    {#if problem}<p class="note amber">{problem}</p>{/if}
    <div class="actions">
      <button type="button" class="btn" onclick={onclose}>{t('action.close')}</button>
      {#if !mission && flightId !== null}
        <button
          type="button"
          class="btn primary"
          disabled={busy || !briefable || problem !== null}
          onclick={() => {
            save(true);
          }}>{t('fm.sendBriefTo', { flight: flightName(slices, flightId) })}</button
        >
        <button type="submit" class="btn" disabled={busy || !parsed.success || problem !== null}
          >{t('fm.saveDraft')}</button
        >
      {:else}
        <button
          type="submit"
          class="btn primary"
          disabled={busy || !parsed.success || problem !== null}
          >{mission ? t('fm.save') : t('fm.create')}</button
        >
      {/if}
    </div>
    <CommandStatus id={command} />
  </form>
{/if}

<style>
  .editor {
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  h3 {
    margin: 0;
  }

  fieldset {
    display: grid;
    gap: 0.6rem;
    min-width: 0;
    margin: 0;
    padding: 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  legend {
    padding: 0 0.3rem;
    color: var(--text-dim);
    font-size: 0.8125rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.5rem;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: var(--touch);
    font-weight: 700;
  }

  .check input {
    width: 1.4rem;
    height: 1.4rem;
  }

  .rb {
    padding: 0 0.3rem;
    border: 1px solid var(--blue);
    border-radius: 0.25rem;
    color: var(--blue);
    font-size: 0.6875rem;
    font-weight: 700;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .amber {
    color: var(--amber);
  }
</style>
