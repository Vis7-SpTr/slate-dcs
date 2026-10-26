// SPDX-License-Identifier: GPL-3.0-or-later
// Screen-local alert state (P2.7): aborts put away on this screen, and the
// mission an alert asked to open. Never sent to the host – each screen keeps
// its own (architecture.md §1.1).

import { SvelteSet } from 'svelte/reactivity';

class Alerts {
  /** Abort notices (`abortNotice().key`) this screen has seen and put away. */
  readonly dismissed = new SvelteSet<string>();
  /** The mission CAS → Fire missions should show next. */
  wanted: string | null = $state(null);

  dismiss(key: string): void {
    this.dismissed.add(key);
  }

  open(missionId: string): void {
    this.wanted = missionId;
  }
}

export const alerts = new Alerts();
