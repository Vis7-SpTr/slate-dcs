// SPDX-License-Identifier: GPL-3.0-or-later
// ESLint flat config for the whole monorepo.

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
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

  // Plain JS (config files, tools): Node globals, no type-aware rules.
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Must stay last: turns off rules that clash with Prettier.
  prettier,
);
