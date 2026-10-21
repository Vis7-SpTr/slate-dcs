// SPDX-License-Identifier: GPL-3.0-or-later
// Text lookup. English only for now (scope §6.8); more languages = more
// message files with the same keys.

import { en } from './en.js';
import type { MessageKey } from './en.js';

export type { MessageKey };

/** The text for `key`, with `{name}` parameters filled in. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
