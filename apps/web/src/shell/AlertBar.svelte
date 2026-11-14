<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Pilot alerts under the status strip, on every page (ui-design.md §7, §8,
  P2.7): ABORT on his own lane as a full-width red banner the moment it
  arrives, the JOKER/BINGO prompt on his own dash (never sent by itself), and
  what he still has to answer – ACK a change, WILCO a hold, COPY a situation
  update, ACK a BDA – each with its one button, so he never has to leave the
  page he is on. An abort can be put away on this screen; the mission card
  keeps showing it until he is cleared again.
-->
<script lang="ts">
  import { casWho, callsignOf, pointText } from '../lib/cas.js';
  import { host } from '../lib/host.svelte.js';
  import { t } from '../lib/i18n/index.js';
  import { abortNotice, fieldKey, pilotTodos } from '../lib/missions.js';
  import type { PilotTodo } from '../lib/missions.js';
  import { router } from '../lib/router.svelte.js';
  import { alerts } from './alerts.svelte.js';

  const slices = $derived(host.view.slices);
  const pilot = $derived(slices !== null && !casWho(slices).jtac);
  const pid = $derived(slices?.session.pid ?? null);
  const aborts = $derived(
    pilot && slices
      ? slices.missions.missions
          .map((m) => ({ m, notice: abortNotice(m, pid) }))
          .filter(
            (x): x is { m: typeof x.m; notice: NonNullable<typeof x.notice> } =>
              x.notice !== null && !alerts.dismissed.has(x.notice.key),
          )
      : [],
  );
  const prompt = $derived(pilot ? (slices?.fuelCalls.prompt ?? null) : null);
  /** At most this many at once, so the bar never takes the page. */
  const SHOWN = 3;
  const todos = $derived(pilot && slices ? pilotTodos(slices) : []);

  /**
   * After an answer the next item moves up into the same place: the buttons
   * rest for a moment, so a second tap can't answer something unread.
   */
  let resting = $state(false);

  function answer(todo: PilotTodo): void {
    resting = true;
    window.setTimeout(() => {
      resting = false;
    }, 1200);
    switch (todo.kind) {
      case 'ack':
        host.sequence(
          todo.revs.map((rev) => ({
            cmd: 'fm.ackChange' as const,
            args: { missionId: todo.missionId, rev },
          })),
        );
        return;
      case 'wilco':
        host.send({ cmd: 'cas.hold.wilco', args: { holdId: todo.holdId } });
        return;
      case 'copy':
        host.send({ cmd: 'cas.sitCopy', args: { id: todo.noteId } });
        return;
      case 'ackBda':
        host.send({ cmd: 'fm.ackBda', args: { missionId: todo.missionId } });
        return;
    }
  }

  function show(todo: PilotTodo): void {
    if (todo.kind === 'ack' || todo.kind === 'ackBda') alerts.open(todo.missionId);
    router.go('cas', 'flights');
  }

  const BUTTON = { ack: 'ACK', wilco: 'WILCO', copy: 'COPY', ackBda: 'ACK BDA' } as const;
</script>

{#if slices && (aborts.length > 0 || prompt || todos.length > 0)}
  <div class="alerts">
    {#each aborts as { m, notice } (notice.key)}
      <div class="abort" role="alert">
        <button
          type="button"
          class="text"
          onclick={() => {
            alerts.open(m.missionId);
            router.go('cas', 'flights');
          }}
        >
          <strong>ABORT – {notice.reason}</strong>
          <span>
            {m.missionId}
            {m.nineLine?.description ? `· ${m.nineLine.description}` : ''}
            · {notice.by === 'relay' ? 'SLATE' : callsignOf(slices, notice.by)}
            ({t(`abort.channel.${notice.channel}`)})
          </span>
        </button>
        <button
          type="button"
          class="btn close"
          onclick={() => {
            alerts.dismiss(notice.key);
          }}>{t('alert.seen')}</button
        >
      </div>
    {/each}
    {#each todos.slice(0, SHOWN) as todo (todo.key)}
      <div class="todo" role="alert">
        <button
          type="button"
          class="text"
          onclick={() => {
            show(todo);
          }}
        >
          {#if todo.kind === 'ack'}
            <strong>{t('todo.ack', { id: todo.missionId })}</strong>
            <span>{todo.fields.map((f) => t(fieldKey(f))).join(', ')}</span>
          {:else if todo.kind === 'wilco'}
            <strong>{t('todo.wilco')}</strong>
            <span>{pointText(slices, todo.point).name ?? t('cas.coords')}</span>
          {:else if todo.kind === 'copy'}
            <strong>{t('todo.copy', { from: callsignOf(slices, todo.from) })}</strong>
            <span>{todo.whole ? t('todo.copy.ao') : t('todo.copy.flight')}</span>
          {:else}
            <strong>{t('todo.bda', { id: todo.missionId })}</strong>
            <span>{t(`bda.effect.${todo.effect as 'destroyed'}`)} – {todo.target || '—'}</span>
          {/if}
        </button>
        <button
          type="button"
          class="btn primary"
          disabled={resting}
          onclick={() => {
            answer(todo);
          }}>{BUTTON[todo.kind]}</button
        >
      </div>
    {/each}
    {#if todos.length > SHOWN}
      <p class="more">{t('todo.more', { n: String(todos.length - SHOWN) })}</p>
    {/if}
    {#if prompt}
      <div class="fuel {prompt}" role="alert">
        <strong class="text">{t(`alert.${prompt}`)}</strong>
        <button
          type="button"
          class="btn primary"
          onclick={() => {
            host.send({ cmd: 'fuel.call', args: { call: prompt } });
          }}>{t(prompt === 'bingo' ? 'fuelCalls.sendBingo' : 'fuelCalls.sendJoker')}</button
        >
        <button
          type="button"
          class="btn"
          onclick={() => {
            host.send({ cmd: 'fuel.dismiss', args: {} });
          }}>{t('alert.dismiss')}</button
        >
      </div>
    {/if}
  </div>
{/if}

<style>
  .alerts {
    display: grid;
    gap: 0.35rem;
    padding: 0.35rem 0.5rem 0;
  }

  .abort,
  .todo,
  .fuel {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius);
  }

  .abort {
    border: 2px solid var(--red);
    background: color-mix(in srgb, var(--red) 25%, var(--surface));
  }

  .todo {
    border: 2px solid var(--amber);
    background: var(--surface-2);
  }

  .more {
    margin: 0;
    color: var(--text-dim);
    font-size: 0.875rem;
    text-align: center;
  }

  .fuel {
    border: 2px solid var(--amber);
    background: var(--surface-2);
  }

  .fuel.bingo {
    border-color: var(--red);
  }

  .text {
    display: grid;
    flex: 1 1 12rem;
    gap: 0.15rem;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .abort strong {
    font-size: 1.25rem;
    letter-spacing: 0.02em;
  }

  .close {
    min-width: 0;
    padding: 0 0.9rem;
  }
</style>
