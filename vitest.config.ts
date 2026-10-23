// SPDX-License-Identifier: GPL-3.0-or-later

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{apps,packages}/*/src/**/*.test.ts', 'tests/**/*.test.ts', 'tools/**/*.test.mjs'],
  },
});
