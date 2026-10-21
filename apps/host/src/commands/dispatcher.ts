// SPDX-License-Identifier: GPL-3.0-or-later
// Runs screen commands exactly once per command ID (protocol.md §14.5).

import { UI_TIMING } from '@slate-dcs/shared';
import type { Command, CommandName, UiErrorCode } from '@slate-dcs/shared';

export type CommandOutcome =
  { ok: true } | { ok: false; error: { code: UiErrorCode; text: string } };

/** Handler for one command; gets the command's validated arguments. */
export type CommandHandlers = {
  [K in CommandName]: (
    args: Extract<Command, { cmd: K }>['args'],
  ) => CommandOutcome | Promise<CommandOutcome>;
};

interface Remembered {
  outcome: Promise<CommandOutcome>;
  expiresAt: number;
}

/** Shortcut for a failed outcome. */
export function failed(code: UiErrorCode, text: string): CommandOutcome {
  return { ok: false, error: { code, text } };
}

/**
 * Dispatches commands to their handlers and remembers each command ID for
 * 10 minutes: a repeat – also one that arrives while the first is still
 * running – gets the same outcome and is not applied again.
 */
export class CommandDispatcher {
  readonly #handlers: CommandHandlers;
  readonly #now: () => number;
  readonly #memoryMs: number;
  readonly #remembered = new Map<string, Remembered>();

  constructor(handlers: CommandHandlers, options: { now?: () => number; memoryMs?: number } = {}) {
    this.#handlers = handlers;
    this.#now = options.now ?? Date.now;
    this.#memoryMs = options.memoryMs ?? UI_TIMING.commandMemoryMin * 60_000;
  }

  /** Number of command IDs currently remembered (for tests and diagnostics). */
  get rememberedCount(): number {
    this.#forgetExpired();
    return this.#remembered.size;
  }

  dispatch(id: string, command: Command): Promise<CommandOutcome> {
    this.#forgetExpired();
    const known = this.#remembered.get(id);
    if (known) return known.outcome;

    const outcome = this.#run(command);
    this.#remembered.set(id, { outcome, expiresAt: this.#now() + this.#memoryMs });
    return outcome;
  }

  async #run(command: Command): Promise<CommandOutcome> {
    // The union of handler signatures can't be called with the union of
    // arguments directly; `command.cmd` and `command.args` always belong together.
    const handler = this.#handlers[command.cmd] as (
      args: Command['args'],
    ) => CommandOutcome | Promise<CommandOutcome>;
    try {
      return await handler(command.args);
    } catch (error) {
      return failed('notPossible', error instanceof Error ? error.message : String(error));
    }
  }

  #forgetExpired(): void {
    const now = this.#now();
    for (const [id, entry] of this.#remembered) {
      if (entry.expiresAt <= now) this.#remembered.delete(id);
    }
  }
}
