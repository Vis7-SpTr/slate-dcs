// SPDX-License-Identifier: GPL-3.0-or-later
// Checks that every installed dependency (production and dev) uses a
// GPL-3.0-compatible licence (architecture.md §1.4).
// Usage: pnpm check:licenses   (run after pnpm install)

import { execFileSync } from 'node:child_process';

/** SPDX identifiers accepted for dependencies. Extend only after checking GPL-3.0 compatibility. */
const ALLOWED = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-4.0',
  'CC0-1.0',
  'GPL-2.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'ISC',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'Zlib',
]);

/** Accepts simple SPDX expressions: "A", "(A OR B)", "A AND B". */
function isAllowed(expression) {
  const expr = expression.replace(/[()]/g, ' ').trim();
  if (expr.includes(' OR ')) return expr.split(' OR ').some((part) => isAllowed(part));
  if (expr.includes(' AND ')) return expr.split(' AND ').every((part) => isAllowed(part));
  return ALLOWED.has(expr);
}

function list(kind) {
  // On Windows, pnpm is a .cmd shim and needs a shell to run.
  const out = execFileSync('pnpm', ['licenses', 'list', '--json', '-r', kind], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return JSON.parse(out.trim() || '{}');
}

const bad = [];
let count = 0;
for (const kind of ['--prod', '--dev']) {
  for (const [license, packages] of Object.entries(list(kind))) {
    for (const pkg of packages) {
      count += 1;
      if (!isAllowed(license)) bad.push(`${pkg.name}@${pkg.versions.join(', ')}: ${license}`);
    }
  }
}

if (bad.length > 0) {
  console.error('Dependencies with a licence that is not on the allowed list:');
  for (const line of bad) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`Licences OK for ${count} packages.`);
