// SPDX-License-Identifier: GPL-3.0-or-later
// ESLint flat config for the whole monorepo.

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/', '**/dist/', '**/build/', '**/coverage/', '**/.vite/'],
  },

  js.configs.recommended,

  // TypeScript: strict, type-aware rules.
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Numbers in template strings are fine (coordinates, frequencies).
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Unused variables are errors, except ones starting with "_".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Always use `import type` for type-only imports.
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  // Build configs outside the app's tsconfig: no type-aware rules.
  {
    files: ['apps/web/vite.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Svelte components: Svelte's rules plus TypeScript in <script lang="ts">.
  // Types in .svelte files are checked by svelte-check (`pnpm typecheck`).
  ...svelte.configs.recommended,
  {
    // Rune modules (*.svelte.ts) are TypeScript: keep the type-aware rules.
    files: ['**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.svelte'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser, __SLATE_BUILD__: 'readonly' },
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },

  // Plain JS (config files, tools): Node globals, no type-aware rules.
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Must stay last: turns off rules that clash with Prettier.
  prettier,
  ...svelte.configs.prettier,
);
