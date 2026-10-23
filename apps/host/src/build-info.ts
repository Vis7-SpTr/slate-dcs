// SPDX-License-Identifier: GPL-3.0-or-later
// Build version reported to screens (protocol.md §14.6).

import rootPackage from '../../../package.json' with { type: 'json' };

/** Set by the release build (tools/release/build.mjs), e.g. `0.1.0+3f2c1ab`. */
declare const SLATE_RELEASE_BUILD: string | undefined;

/**
 * One version for the whole app: the root package.json, which the web UI
 * builds in as well, so host and UI agree in development. The release build
 * (P1.9) puts in its version; `SLATE_BUILD` overrides it for tests.
 */
export const BUILD: string =
  process.env['SLATE_BUILD'] ??
  (typeof SLATE_RELEASE_BUILD === 'string' ? SLATE_RELEASE_BUILD : `${rootPackage.version}-dev`);
