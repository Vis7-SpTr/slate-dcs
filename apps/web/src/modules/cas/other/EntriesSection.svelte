<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Other → Map entries (D4, D5, protocol.md §8.4): control measures, keyholes
  and markers as lists by kind, with their positions in the user's format.
  New entries by typed coordinates; on the map from P3. Deleting is
  tap-to-arm; an entry a mission or hold uses can't go (`inUse`).
-->
<script lang="ts">
  import type { CmKind, MapEntry } from '@slate-dcs/shared';

  import CommandStatus from '../../../components/CommandStatus.svelte';
  import ConfirmButton from '../../../components/ConfirmButton.svelte';
  import EmptyState from '../../../components/EmptyState.svelte';
  import { casWho, checkInOf, entryPosition, mtimeText, positionText } from '../../../lib/cas.js';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';
  import EntryForm from '../EntryForm.svelte';

  const slices = $derived(host.view.slices);
  const who = $derived(slices ? casWho(slices) : null);
  /** The AO entries are drawn in: his as a JTAC, his flight's as a pilot. */
  const aoId = $derived(
    who?.ao?.aoId ??
      (slices ? (checkInOf(slices, slices.flight.own?.flightId)?.aoId ?? null) : null),
  );
  const ORDER: CmKind[] = [
    'ip',
    'cp',
    'keyhole',
    'friendly',
    'threat',
    'enemy',
    'nfa',
    'rfa',
    'roz',
    'fscl',
    'cfl',
  ];
  const groups = $derived.by(() => {
    const entries = slices?.cas.mapEntries ?? [];
    return ORDER.map((kind) => ({ kind, entries: entries.filter((e) => e.kind === kind) })).filter(
      (g) => g.entries.length > 0,
    );
  });

  let creating = $state(false);
  /** The entry being changed (screen-local). */
  let editing: string | null = $state(null);
  let command: string | null = $state(null);

  /**
   * Who may change or delete it (§8.4): the AO's JTAC in command every entry
   * of his AO, everyone else what he drew himself.
   */
  function canChange(e: MapEntry): boolean {
    if (!who) return false;
    if (e.author === who.pid) return true;
    return who.aoCommand && who.ao !== null && e.aoId === who.ao.aoId;
  }
</script>

{#if !slices || !who}
  <EmptyState title={t('other.entries')} text={t('cas.noSession')} />
{:else}
  {#if groups.length === 0}<p class="note">{t('entries.none')}</p>{/if}
  {#each groups as g (g.kind)}
    <h3>{t(`cm.${g.kind}`)}</h3>
    <ul class="entries">
      {#each g.entries as e (e.cmId)}
        {@const at = entryPosition(e)}
        <li class={e.kind}>
          <div class="line">
            <span class="who">{e.label ?? t(`cm.${e.kind}`)}</span>
            {#if e.shape === 'circle'}
              <span class="dim"
                >{t('entry.circleOf', {
                  nm: Math.round(((e.geom as { radiusM: number }).radiusM / 1852) * 10) / 10,
                })}</span
              >
            {/if}
            {#if e.kind === 'enemy' && e.count}<span class="dim"
                >×{e.count}{e.moving ? ` · ${t('entry.moving')}` : ''}</span
              >{/if}
            {#if e.ringM}<span class="dim"
                >{t('entry.ringOf', { nm: Math.round((e.ringM / 1852) * 10) / 10 })}</span
              >{/if}
            <span class="tag">{t(`visibility.${e.visibility}`)}</span>
          </div>
          {#if at}<p class="mono pos">{positionText(at, who.style).join(' · ')}</p>{/if}
          {#if e.text || e.observedMtime !== null}
            <p class="dim small">
              {[
                e.text,
                e.observedMtime === null
                  ? null
                  : t('entry.seen', { time: mtimeText(slices, e.observedMtime) }),
              ]
                .filter((part) => part)
                .join(' · ')}
            </p>
          {/if}
          {#if editing === e.cmId}
            <EntryForm
              aoId={e.aoId}
              entry={e}
              onclose={() => {
                editing = null;
              }}
            />
          {:else if canChange(e)}
            <div class="actions">
              <button
                type="button"
                class="btn"
                onclick={() => {
                  editing = e.cmId;
                  creating = false;
                }}>{t('entry.edit')}</button
              >
              <ConfirmButton
                label={t('entry.delete')}
                onconfirm={() => {
                  command = host.send({ cmd: 'cm.delete', args: { cmId: e.cmId } });
                }}
              />
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/each}
  {#if creating}
    <EntryForm
      {aoId}
      onclose={() => {
        creating = false;
      }}
    />
  {:else}
    <div>
      <button
        type="button"
        class="btn primary"
        onclick={() => {
          creating = true;
        }}>{t('entry.new')}</button
      >
    </div>
  {/if}
  <CommandStatus id={command} />
{/if}

<style>
  h3 {
    margin: 0.5rem 0 0.1rem;
    color: var(--text-dim);
    font-size: 0.8125rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .entries {
    display: grid;
    gap: 0.35rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .entries li {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--line);
    border-left: 0.25rem solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  /* Colour with meaning (ui-design.md §1): friendly blue, threat and enemy red. */
  .entries li.friendly {
    border-left-color: var(--blue);
  }

  .entries li.threat,
  .entries li.enemy {
    border-left-color: var(--red);
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
  }

  .who {
    font-weight: 700;
  }

  .pos {
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }

  .dim {
    color: var(--text-dim);
  }

  .small {
    font-size: 0.8125rem;
  }

  .tag {
    padding: 0.1rem 0.45rem;
    border: 1px solid var(--line);
    border-radius: 0.3rem;
    color: var(--text-dim);
    font-size: 0.75rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.4rem;
  }
</style>
