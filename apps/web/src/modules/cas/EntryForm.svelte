<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  A new map entry by typed coordinates (protocol.md §8.4, D4, P2.6) – or a
  change to one (`entry`): position, name, text, size, visibility; the kind and
  AO stay (cm.update). Moving a keyhole's ECHO moves every point on it. IP/CP,
  keyhole (ECHO), friendly, threat, enemy – points; NFA/RFA/ROZ and areas as
  circles. Lines and polygons are drawn on the map in P3. JTACs draw every
  kind, pilots friendly/threat/enemy. The draft is checked with the shared
  schema before it is sent, so mistakes show here.
-->
<script lang="ts">
  import { AO_CM_KINDS, CM_SHAPES, MapEntryDraft, PILOT_CM_KINDS } from '@slate-dcs/shared';
  import type { Altitude, CmKind, LatLon, MapEntry } from '@slate-dcs/shared';
  import { untrack } from 'svelte';

  import AltitudeInput from '../../components/AltitudeInput.svelte';
  import CommandStatus from '../../components/CommandStatus.svelte';
  import CoordInput from '../../components/CoordInput.svelte';
  import Picks from '../../components/Picks.svelte';
  import Stepper from '../../components/Stepper.svelte';
  import { casWho, missionTimeNow } from '../../lib/cas.js';
  import { clock } from '../../lib/clock.svelte.js';
  import { host } from '../../lib/host.svelte.js';
  import { t } from '../../lib/i18n/index.js';
  import { autoEntryName, THREAT_TYPES } from '../../lib/picks.js';

  const {
    aoId,
    entry = null,
    onclose,
  }: { aoId: string | null; entry?: MapEntry | null; onclose: () => void } = $props();

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  const ownPos = $derived.by((): LatLon | null => {
    const pos = slices?.ownship.status?.pos;
    return pos ? { lat: pos.lat, lon: pos.lon } : null;
  });

  const ALL: CmKind[] = ['ip', 'cp', 'keyhole', 'friendly', 'threat', 'enemy', 'nfa', 'rfa', 'roz'];
  const kinds = $derived(
    ALL.filter((k) => (who?.jtac ? true : PILOT_CM_KINDS.has(k))).filter(
      (k) => aoId !== null || !AO_CM_KINDS.has(k),
    ),
  );

  // An entry being changed fills the form once; the relay's later updates don't reset it.
  const start = untrack(() => entry);
  const startGeom = start?.geom as LatLon | { center: LatLon; radiusM: number } | undefined;
  const startCircle = start?.shape === 'circle' && startGeom !== undefined && 'center' in startGeom;
  const nmText = (m: number | null | undefined, d: string) =>
    m === null || m === undefined ? d : String(Math.round((m / 1852) * 10) / 10);
  let kind = $state<CmKind>(start?.kind ?? 'ip');
  let label = $state(start?.label ?? '');
  /**
   * A new entry starts with an automatic name per kind (`IP 1`, `THREAT 3` –
   * ui-design.md §11), so nothing has to be typed; a name typed over stays.
   */
  let autoName = '';
  function nameFor(k: CmKind): void {
    if (start) return;
    const next = autoEntryName(k, host.view.slices?.cas.mapEntries ?? []);
    if (label.trim() === '' || label === autoName) label = next;
    autoName = next;
  }
  nameFor(untrack(() => kind));
  // The form stays open after ADD: once the new entry arrives, the next name follows.
  $effect(() => {
    const count = host.view.slices?.cas.mapEntries.length ?? 0;
    untrack(() => {
      if (count > 0) nameFor(kind);
    });
  });
  const threatPicks = THREAT_TYPES.map((n) => ({ label: n, value: n }));
  let text = $state(start?.text ?? '');
  let at: LatLon | null = $state(
    startGeom === undefined ? null : 'center' in startGeom ? startGeom.center : startGeom,
  );
  let circle = $state(startCircle);
  let radius = $state(startCircle ? nmText((startGeom as { radiusM: number }).radiusM, '1') : '1');
  let ring = $state(nmText(start?.ringM, ''));
  let count = $state(
    start?.count === null || start?.count === undefined ? '' : String(start.count),
  );
  let moving = $state(start?.moving ?? false);
  let floor: Altitude = $state(start?.block?.floor ?? { m: 0, ref: 'sfc' });
  let ceiling: Altitude = $state(start?.block?.ceiling ?? { m: 3048, ref: 'msl' });
  let visibility: 'ao' | 'coalition' = $state(start?.visibility ?? 'ao');
  /** The AO an entry being changed is tied to – it can't move to another (§8.4). */
  const entryAo = start ? start.aoId : null;

  const canCircle = $derived(CM_SHAPES[kind].includes('circle'));
  const onlyCircle = $derived(!CM_SHAPES[kind].includes('point'));
  const isCircle = $derived(onlyCircle || (canCircle && circle));
  const nm = (value: string) => Number(value.replace(',', '.')) * 1852;
  const marker = $derived(kind === 'friendly' || kind === 'threat' || kind === 'enemy');

  const draft = $derived.by(() => {
    if (!at || !slices) return null;
    const ao = start ? entryAo : AO_CM_KINDS.has(kind) || visibility === 'ao' ? aoId : null;
    const fields = {
      kind,
      label: label.trim() === '' ? null : label.trim().toUpperCase(),
      text: text.trim() === '' ? null : text.trim(),
      ringM: kind === 'threat' && ring.trim() !== '' ? nm(ring) : null,
      count: kind === 'enemy' && count.trim() !== '' ? Number(count) : null,
      moving: kind === 'enemy' ? moving : null,
      // A changed marker keeps when it was seen; a new one is seen now.
      observedMtime: start
        ? start.observedMtime
        : marker
          ? missionTimeNow(slices, clock.now)
          : null,
      block: kind === 'roz' ? { floor, ceiling } : null,
      aoId: ao,
      visibility: ao === null ? ('coalition' as const) : visibility,
    };
    return isCircle
      ? { ...fields, shape: 'circle' as const, geom: { center: at, radiusM: nm(radius) } }
      : { ...fields, shape: 'point' as const, geom: at };
  });
  const check = $derived(draft ? MapEntryDraft.safeParse(draft) : null);
  const problem = $derived(check && !check.success ? (check.error.issues[0]?.message ?? '') : null);

  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');
</script>

{#if who}
  <form
    class="form-grid entry"
    onsubmit={(event) => {
      event.preventDefault();
      if (!check?.success) return;
      command = start
        ? host.send({ cmd: 'cm.update', args: { cmId: start.cmId, entry: check.data } })
        : host.send({ cmd: 'cm.create', args: check.data });
    }}
  >
    {#if start}
      <p class="to">
        {t('entry.editing', { kind: t(`cm.${start.kind}`), label: start.label ?? '' })}
      </p>
      {#if start.kind === 'keyhole'}<p class="note">{t('entry.keyholeMove')}</p>{/if}
    {:else}
      <div class="choice kinds" role="group" aria-label={t('entry.kind')}>
        {#each kinds as k (k)}
          <button
            type="button"
            class="btn"
            class:selected={kind === k}
            onclick={() => {
              kind = k;
              nameFor(k);
            }}>{t(`cm.${k}`)}</button
          >
        {/each}
      </div>
    {/if}
    <label class="field">
      <span>{t('entry.label')}</span>
      <input bind:value={label} maxlength="48" placeholder={t('entry.label.placeholder')} />
    </label>
    {#if kind === 'threat'}
      <Picks
        items={threatPicks}
        label={t('entry.threatPicks')}
        selected={label}
        onpick={(n) => {
          label = n;
        }}
      />
    {/if}
    <CoordInput
      bind:value={at}
      label={isCircle ? t('entry.center') : t('entry.position')}
      style={who.style}
      own={ownPos}
    />
    {#if canCircle && !onlyCircle}
      <div class="choice" role="group" aria-label={t('entry.shape')}>
        <button
          type="button"
          class="btn"
          class:selected={!circle}
          onclick={() => {
            circle = false;
          }}>{t('entry.point')}</button
        >
        <button
          type="button"
          class="btn"
          class:selected={circle}
          onclick={() => {
            circle = true;
          }}>{t('entry.circle')}</button
        >
      </div>
    {/if}
    {#if isCircle}
      <label class="field">
        <span>{t('entry.radius')}</span>
        <input class="mono" inputmode="decimal" bind:value={radius} />
      </label>
      <Stepper
        bind:value={radius}
        step={0.5}
        min={0.1}
        presets={[0.5, 1, 2]}
        label={t('entry.radius')}
      />
    {/if}
    {#if kind === 'threat'}
      <label class="field">
        <span>{t('entry.ring')}</span>
        <input class="mono" inputmode="decimal" bind:value={ring} placeholder="5" />
      </label>
      <Stepper bind:value={ring} step={1} min={0} presets={[2, 3, 5, 10]} label={t('entry.ring')} />
    {/if}
    {#if kind === 'enemy'}
      <div class="two">
        <label class="field">
          <span>{t('entry.count')}</span>
          <input class="mono" inputmode="numeric" bind:value={count} />
          <Stepper bind:value={count} step={1} min={1} label={t('entry.count')} />
        </label>
        <div class="choice" role="group" aria-label={t('entry.moving')}>
          <button
            type="button"
            class="btn"
            class:selected={!moving}
            onclick={() => {
              moving = false;
            }}>{t('entry.static')}</button
          >
          <button
            type="button"
            class="btn"
            class:selected={moving}
            onclick={() => {
              moving = true;
            }}>{t('entry.moving')}</button
          >
        </div>
      </div>
    {/if}
    {#if kind === 'roz'}
      <AltitudeInput bind:value={floor} label={t('hold.floor')} />
      <AltitudeInput bind:value={ceiling} label={t('hold.ceiling')} />
    {/if}
    <label class="field">
      <span>{t('entry.text')}</span>
      <input bind:value={text} maxlength="500" />
    </label>
    {#if !AO_CM_KINDS.has(kind) && (start ? entryAo !== null : aoId !== null)}
      <div class="choice" role="group" aria-label={t('entry.visibility')}>
        {#each ['ao', 'coalition'] as const as v (v)}
          <button
            type="button"
            class="btn"
            class:selected={visibility === v}
            onclick={() => {
              visibility = v;
            }}>{t(`visibility.${v}`)}</button
          >
        {/each}
      </div>
    {/if}
    {#if problem}<p class="note amber">{problem}</p>{/if}
    <div class="actions">
      <button type="button" class="btn" onclick={onclose}>{t('action.close')}</button>
      <button type="submit" class="btn primary" disabled={busy || !check?.success}
        >{start ? t('entry.save') : t('entry.create')}</button
      >
    </div>
    <CommandStatus id={command} />
  </form>
{/if}

<style>
  .to {
    margin: 0;
    font-weight: 700;
  }

  .entry {
    margin-top: 0.5rem;
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .kinds .btn {
    flex: 0 1 auto;
    min-width: 5rem;
  }

  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    align-items: end;
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
