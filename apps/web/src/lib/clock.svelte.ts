// SPDX-License-Identifier: GPL-3.0-or-later
// One shared "now" that ticks once a second – for the mission clock and data
// ages. One timer for the whole UI keeps redraws cheap inside OKB.

class Clock {
  now = $state(Date.now());

  constructor() {
    window.setInterval(() => {
      this.now = Date.now();
    }, 1000);
  }
}

export const clock = new Clock();
