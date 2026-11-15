// SPDX-License-Identifier: GPL-3.0-or-later
// The page size SLATE asks OpenKneeboard for (P1.5 follow-up).

import { describe, expect, it } from 'vitest';

import { DEFAULT_CHOICE, IPAD, okbPixelSize, parseChoice } from './okb-size.js';

describe('OpenKneeboard page size', () => {
  it('the tablet’s ratio, scaled to the chosen shorter side', () => {
    // A 16:10 landscape tablet → 1312 × 820.
    expect(okbPixelSize(DEFAULT_CHOICE, { width: 1600, height: 1000 })).toEqual({
      width: 1312,
      height: 820,
    });
    // No tablet info: iPad portrait.
    expect(okbPixelSize(DEFAULT_CHOICE, null)).toEqual(IPAD);
  });

  it('presets and the page size', () => {
    const c = (preset: typeof DEFAULT_CHOICE.preset, shortSide = 820) => ({
      ...DEFAULT_CHOICE,
      preset,
      shortSide,
    });
    expect(okbPixelSize(c('ipad', 600), null)).toEqual({ width: 600, height: 863 });
    expect(okbPixelSize(c('portrait43', 768), null)).toEqual({ width: 768, height: 1024 });
    expect(okbPixelSize(c('landscape43', 768), null)).toEqual({ width: 1024, height: 768 });
    // The shorter side is clamped to 480 … 2000.
    expect(okbPixelSize(c('landscape43', 100), null)).toEqual({ width: 640, height: 480 });
  });

  it('custom sizes stay within OKB’s 1 … 16384 px', () => {
    const custom = {
      ...DEFAULT_CHOICE,
      preset: 'custom' as const,
      custom: { width: 20_000, height: 0 },
    };
    expect(okbPixelSize(custom, null)).toEqual({ width: 16_384, height: 1 });
  });

  it('a broken stored choice falls back to the default', () => {
    expect(parseChoice(null)).toEqual(DEFAULT_CHOICE);
    expect(parseChoice('{no json')).toEqual(DEFAULT_CHOICE);
    expect(parseChoice('{"preset":"huge","shortSide":"x"}')).toEqual(DEFAULT_CHOICE);
    expect(parseChoice('{"preset":"ipad","shortSide":700}')).toMatchObject({
      preset: 'ipad',
      shortSide: 700,
    });
  });
});
