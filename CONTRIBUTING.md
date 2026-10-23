# Contributing

Thanks for your interest. SLATE is an early prototype with a fixed plan for the next phases, so please **open an issue first** before working on a larger change – that saves both of us work.

- **Bugs:** an issue with the version, the steps, what happened and the log (see the README).
- **Ideas:** an issue describing the situation in DCS you want SLATE to help with.
- **Pull requests:** small and focused, with tests. `pnpm check` must pass (format, lint, typecheck, tests, SPDX headers, licence check).

## Rules for code

- Every source file starts with `// SPDX-License-Identifier: GPL-3.0-or-later` (Lua: `-- SPDX-License-Identifier: GPL-3.0-or-later`). By contributing you agree that your contribution is licensed under GPL-3.0-or-later.
- Dependencies must be GPL-compatible (`pnpm check:licenses`).
- **DCS stays read-only and integrity-check safe:** Lua only in `Saved Games\<DCS folder>\Scripts\`, only reading getters on the player's side, everything wrapped in `pcall`. Nothing may be written into the DCS install folder.
- **No DCS-derived data in the repo** (DTC exports, data extracted from terrain files, charts, mission files, tracks) – it is generated on each user's PC from their own DCS install.
- Every message between UI, host and relay is a Zod schema in `packages/shared`.
