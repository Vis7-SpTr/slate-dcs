# tools
Data import and build scripts.

- `check-licenses.mjs`, `check-spdx.mjs` – run by `pnpm check`.
- `release/build.mjs` – release build (P1.9): the app and the relay as Node single executables with their files; `release/pe.mjs` makes `SLATE.exe` a program without a console window; `release/relay-README.txt` ships with the relay.
