// SPDX-License-Identifier: GPL-3.0-or-later
// Build version reported to screens (protocol.md §14.6).

import rootPackage from '../../../package.json' with { type: 'json' };

/**
 * One version for the whole app: the root package.json, which the web UI
 * builds in as well, so host and UI agree in development.
 * `SLATE_BUILD` is set by the release build (P1.9), e.g. `0.1.0+3f2c1ab`.
 */
export const BUILD: string = process.env['SLATE_BUILD'] ?? `${rootPackage.version}-dev`;
