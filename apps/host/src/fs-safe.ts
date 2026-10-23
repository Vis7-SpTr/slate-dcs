// SPDX-License-Identifier: GPL-3.0-or-later
// Writing a file so a crash never leaves half of it: write a temporary file,
// then rename it over the real one. On Windows that rename can fail for a
// moment (EPERM/EBUSY/EACCES) while another program – antivirus, the search
// indexer, a second writer – has the file open, so it is retried briefly.
// Every writer gets its own temporary name, so two never collide.

import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const ATTEMPTS = 10;

let counter = 0;

/** `rename`, retried while Windows reports the target as busy (about 1 s at most). */
export async function renameRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!TRANSIENT.has(code) || attempt >= ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}

/** Writes `path` atomically (temporary file + rename); creates the folder. */
export async function writeFileAtomic(
  path: string,
  data: string | Buffer,
  options: { mode?: number } = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  counter += 1;
  const temp = `${path}.${String(process.pid)}-${String(counter)}.slate-tmp`;
  try {
    await writeFile(temp, data, options);
    await renameRetry(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
