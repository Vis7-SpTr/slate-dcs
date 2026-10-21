// SPDX-License-Identifier: GPL-3.0-or-later
// What the host remembers per relay address (protocol.md §3.1, §4.3): the
// pinned certificate fingerprint and the current token. The token is secret –
// it stays in this file and never reaches a screen.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

const Entry = z.object({ fingerprint: z.string().nullable(), token: z.string().nullable() });
const File = z.record(z.string(), Entry);
export type RelayEntry = z.infer<typeof Entry>;

export class TokenStore {
  readonly #path: string;
  #entries: Record<string, RelayEntry> | null = null;

  constructor(path: string) {
    this.#path = path;
  }

  async get(address: string): Promise<RelayEntry | undefined> {
    return (await this.#load())[address];
  }

  async set(address: string, entry: RelayEntry): Promise<void> {
    const entries = await this.#load();
    entries[address] = entry;
    await mkdir(dirname(this.#path), { recursive: true });
    const temp = `${this.#path}.slate-tmp`;
    await writeFile(temp, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, this.#path);
  }

  async #load(): Promise<Record<string, RelayEntry>> {
    if (this.#entries) return this.#entries;
    try {
      const parsed = File.safeParse(JSON.parse(await readFile(this.#path, 'utf8')));
      this.#entries = parsed.success ? parsed.data : {};
    } catch {
      this.#entries = {};
    }
    return this.#entries;
  }
}
