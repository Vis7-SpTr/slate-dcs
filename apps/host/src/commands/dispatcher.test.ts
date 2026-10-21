// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { CommandDispatcher, failed } from './dispatcher.js';
import type { CommandHandlers } from './dispatcher.js';

const ID_1 = '01JABD2K7Q0M3N4P5R6S7T8V9W';
const ID_2 = '01JABD2K7Q0M3N4P5R6S7T8V9X';
const setZulu = { cmd: 'settings.set', args: { timeDisplay: 'zulu' } } as const;

/** Handlers that all answer OK, with `settings.set` replaced by `settingsSet`. */
function handlers(settingsSet: CommandHandlers['settings.set']): CommandHandlers {
  const ok = () => ({ ok: true as const });
  return {
    'session.join': ok,
    'session.leave': ok,
    'session.host': ok,
    'flight.create': ok,
    'flight.join': ok,
    'flight.leave': ok,
    'flight.move': ok,
    'flight.moveUp': ok,
    'ownship.setPosition': ok,
    'ownship.setFuel': ok,
    'ownship.setStation': ok,
    'ownship.clearStation': ok,
    'ownship.setGun': ok,
    'dcs.rescan': ok,
    'dcs.install': ok,
    'dcs.repair': ok,
    'dcs.remove': ok,
    'settings.set': settingsSet,
  };
}

describe('CommandDispatcher', () => {
  it('runs a command and returns its outcome', async () => {
    const handler = vi.fn(() => ({ ok: true as const }));
    const dispatcher = new CommandDispatcher(handlers(handler));
    await expect(dispatcher.dispatch(ID_1, setZulu)).resolves.toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith({ timeDisplay: 'zulu' });
  });

  it('applies a repeated command ID only once and repeats its outcome', async () => {
    const handler = vi.fn(() => failed('notPossible', 'nope'));
    const dispatcher = new CommandDispatcher(handlers(handler));
    const first = await dispatcher.dispatch(ID_1, setZulu);
    const second = await dispatcher.dispatch(ID_1, setZulu);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('applies a repeat once even while the first run is still going', async () => {
    let finish: () => void = () => undefined;
    const handler = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          finish = () => {
            resolve({ ok: true });
          };
        }),
    );
    const dispatcher = new CommandDispatcher(handlers(handler));
    const first = dispatcher.dispatch(ID_1, setZulu);
    const repeat = dispatcher.dispatch(ID_1, setZulu);
    finish();
    await expect(Promise.all([first, repeat])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('runs different command IDs separately', async () => {
    const handler = vi.fn(() => ({ ok: true as const }));
    const dispatcher = new CommandDispatcher(handlers(handler));
    await dispatcher.dispatch(ID_1, setZulu);
    await dispatcher.dispatch(ID_2, setZulu);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('forgets a command ID after 10 minutes', async () => {
    let now = 0;
    const handler = vi.fn(() => ({ ok: true as const }));
    const dispatcher = new CommandDispatcher(handlers(handler), { now: () => now });
    await dispatcher.dispatch(ID_1, setZulu);
    now = 10 * 60_000 - 1;
    await dispatcher.dispatch(ID_1, setZulu);
    expect(handler).toHaveBeenCalledTimes(1);
    now = 10 * 60_000;
    expect(dispatcher.rememberedCount).toBe(0);
    await dispatcher.dispatch(ID_1, setZulu);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('turns a handler that throws into notPossible', async () => {
    const dispatcher = new CommandDispatcher(
      handlers(() => {
        throw new Error('broken');
      }),
    );
    await expect(dispatcher.dispatch(ID_1, setZulu)).resolves.toEqual({
      ok: false,
      error: { code: 'notPossible', text: 'broken' },
    });
  });
});
