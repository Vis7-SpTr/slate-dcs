// SPDX-License-Identifier: GPL-3.0-or-later
// Svelte compiler options. TypeScript in <script lang="ts"> needs no
// preprocessor in Svelte 5.

/** @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig} */
export default {
  compilerOptions: {
    runes: true,
  },
};
