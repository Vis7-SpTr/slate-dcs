<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Assign a draft (protocol.md §10.1): to a flight checked in to the AO, as a
  whole (every member gets a lane, later joiners too) or to some of its
  aircraft. Assigning passes the game plan.
-->
<script lang="ts">
  import type { FireMission } from '@slate-dcs/shared';

  import CommandStatus from '../../../components/CommandStatus.svelte';
  import { callsignOf } from '../../../lib/cas.js';
  import { host } from '../../../lib/host.svelte.js';
  import { t } from '../../../lib/i18n/index.js';

  const { mission, onclose }: { mission: FireMission; onclose: () => void } = $props();

  const slices = $derived(host.view.slices);
  const flights = $derived(slices?.cas.checkIns.filter((c) => c.aoId === mission.aoId) ?? []);

  let flightId = $state('');
  let whole = $state(true);
  let pids: string[] = $state([]);
  const crew = $derived(flights.find((f) => f.flightId === flightId)?.brief.aircraft ?? []);
  const ready = $derived(flightId !== '' && (whole || pids.length > 0));

  let command: string | null = $state(null);
  const busy = $derived(host.pendingOf(command)?.state === 'pending');
</script>

{#if slices}
  <form
    class="form-grid assign"
    onsubmit={(event) => {
      event.preventDefault();
      command = host.send({
        cmd: 'fm.assign',
        args: {
          missionId: mission.missionId,
          assignee: { flightId, pids: whole ? null : pids },
        },
      });
    }}
  >
    {#if flights.length === 0}
      <p class="note amber">{t('assign.noFlights')}</p>
    {:else}
      <label class="field">
        <span>{t('assign.flight')}</span>
        <select
          bind:value={flightId}
          onchange={() => {
            pids = [];
          }}
        >
          <option value="" disabled>{t('hold.flight.pick')}</option>
          {#each flights as f (f.flightId)}
            <option value={f.flightId}>{f.brief.callsign}</option>
          {/each}
        </select>
      </label>
      {#if flightId !== ''}
        <div class="choice" role="group" aria-label={t('assign.flight')}>
          <button
            type="button"
            class="btn"
            class:selected={whole}
            aria-pressed={whole}
            onclick={() => {
              whole = true;
            }}>{t('assign.whole')}</button
          >
          <button
            type="button"
            class="btn"
            class:selected={!whole}
            aria-pressed={!whole}
            onclick={() => {
              whole = false;
            }}>{t('assign.some')}</button
          >
        </div>
        {#if !whole}
          <div class="crew">
            {#each crew as a (a.pid)}
              <label class="check">
                <input type="checkbox" value={a.pid} bind:group={pids} />
                <span>{callsignOf(slices, a.pid)}</span>
              </label>
            {/each}
          </div>
        {/if}
      {/if}
    {/if}
    <div class="actions">
      <button type="button" class="btn" onclick={onclose}>{t('action.close')}</button>
      <button type="submit" class="btn primary" disabled={busy || !ready}>{t('fm.assign')}</button>
    </div>
    <CommandStatus id={command} />
  </form>
{/if}

<style>
  .assign {
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .crew {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-height: var(--touch);
  }

  .check input {
    width: 1.3rem;
    height: 1.3rem;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .amber {
    color: var(--amber);
  }
</style>
