<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Tap-to-arm (ui-design.md §1): the first click turns the button into
  CONFIRM for 3 s, the second click runs the action. Keeps its width, so
  nothing moves.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';

  import { t } from '../lib/i18n/index.js';

  const {
    label,
    onconfirm,
    disabled = false,
    danger = false,
  }: { label: string; onconfirm: () => void; disabled?: boolean; danger?: boolean } = $props();

  /** How long the button stays armed. */
  const ARMED_MS = 3000;

  let armed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function disarm(): void {
    clearTimeout(timer);
    armed = false;
  }

  function click(): void {
    if (armed) {
      disarm();
      onconfirm();
      return;
    }
    armed = true;
    timer = setTimeout(disarm, ARMED_MS);
  }

  onDestroy(disarm);
</script>

<button type="button" class:armed class:danger {disabled} aria-live="polite" onclick={click}>
  <span class="label" class:hidden={armed}>{label}</span>
  <span class="label confirm" class:hidden={!armed}>{t('action.confirm')}</span>
</button>

<style>
  button {
    display: inline-grid;
    min-height: var(--touch);
    min-width: 7rem;
    padding: 0 1.25rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    font-weight: 700;
    cursor: pointer;
  }

  /* Both labels share one grid cell, so the button is as wide as the longer one. */
  .label {
    grid-area: 1 / 1;
    align-self: center;
  }

  .hidden {
    visibility: hidden;
  }

  /* ABORT and the like: red at rest too, always with its word (ui-design.md §1). */
  button.danger {
    border-color: var(--red);
    color: var(--red);
  }

  button.armed {
    border-color: var(--red);
    color: var(--red);
    background: var(--surface-3);
  }

  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
