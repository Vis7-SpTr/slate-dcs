// SPDX-License-Identifier: GPL-3.0-or-later
// Checks that every source file starts with the SPDX licence header.
// Usage: pnpm check:spdx

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const HEADER = 'SPDX-License-Identifier: GPL-3.0-or-later';
const SOURCE_DIRS = ['apps', 'packages', 'dcs', 'tools', 'tests'];
const ROOT_FILES = ['eslint.config.js', 'vitest.config.ts'];
const EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs', '.svelte', '.lua']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.vite']);
const HEADER_LINES = 5;

/** Yields every source file below `dir`. */
function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // folder doesn't exist (yet)
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path);
    } else if (EXTENSIONS.has(extname(entry.name))) {
      yield path;
    }
  }
}

const files = [
  ...ROOT_FILES.map((name) => join(ROOT, name)),
  ...SOURCE_DIRS.flatMap((dir) => [...walk(join(ROOT, dir))]),
];

const missing = files.filter((file) => {
  const head = readFileSync(file, 'utf8').split('\n', HEADER_LINES).join('\n');
  return !head.includes(HEADER);
});

if (missing.length > 0) {
  console.error(`Missing "${HEADER}" in the first ${HEADER_LINES} lines of:`);
  for (const file of missing) console.error(`  ${relative(ROOT, file)}`);
  process.exit(1);
}

console.log(`SPDX header OK in ${files.length} files.`);
