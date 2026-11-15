// SPDX-License-Identifier: GPL-3.0-or-later
// The page size SLATE asks OpenKneeboard for (P1.5 follow-up, ui-design.md
// §10). An OKB Web Dashboard tab can't be resized by hand; the page sets its
// own pixel size and aspect ratio with `OpenKneeboard.SetPreferredPixelSize`.
// Pure functions, tested without OKB.

export type OkbPreset = 'tablet' | 'ipad' | 'portrait43' | 'landscape43' | 'custom';

export interface PixelSize {
  width: number;
  height: number;
}

export interface OkbChoice {
  preset: OkbPreset;
  /** Pixels on the shorter side: smaller = larger text in VR, larger = more on the page. */
  shortSide: number;
  /** Only for `custom`. */
  custom: PixelSize;
}

/** iPad portrait (820 × 1180 CSS px) – SLATE's layout reference (scope §4.7). */
export const IPAD: PixelSize = { width: 820, height: 1180 };

export const DEFAULT_CHOICE: OkbChoice = {
  preset: 'tablet',
  shortSide: 820,
  custom: { ...IPAD },
};

export const SHORT_SIDE = { min: 480, max: 2000, step: 40 } as const;
/** OKB's limit: 1 … 16384 px per side (`D3D11_REQ_TEXTURE2D_U_OR_V_DIMENSION`). */
export const MAX_SIDE = 16_384;

const clampSide = (n: number) => Math.min(MAX_SIDE, Math.max(1, Math.round(n)));

/**
 * The pixel size for a choice. A preset gives the aspect ratio – the graphics
 * tablet's when OKB reports one (else iPad portrait) – scaled so the shorter
 * side has `shortSide` pixels; `custom` is used as typed.
 */
export function okbPixelSize(choice: OkbChoice, tablet: PixelSize | null): PixelSize {
  if (choice.preset === 'custom') {
    return { width: clampSide(choice.custom.width), height: clampSide(choice.custom.height) };
  }
  const ratio: PixelSize =
    choice.preset === 'tablet'
      ? (tablet ?? IPAD)
      : choice.preset === 'ipad'
        ? IPAD
        : choice.preset === 'portrait43'
          ? { width: 3, height: 4 }
          : { width: 4, height: 3 };
  const short = Math.min(SHORT_SIDE.max, Math.max(SHORT_SIDE.min, choice.shortSide));
  const scale = short / Math.min(ratio.width, ratio.height);
  return { width: clampSide(ratio.width * scale), height: clampSide(ratio.height * scale) };
}

/** A stored choice, checked: anything broken falls back to the default. */
export function parseChoice(text: string | null): OkbChoice {
  if (!text) return DEFAULT_CHOICE;
  try {
    const raw = JSON.parse(text) as Partial<OkbChoice>;
    const presets: readonly string[] = ['tablet', 'ipad', 'portrait43', 'landscape43', 'custom'];
    const preset: OkbPreset =
      typeof raw.preset === 'string' && presets.includes(raw.preset) ? raw.preset : 'tablet';
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    return {
      preset,
      shortSide: num(raw.shortSide, DEFAULT_CHOICE.shortSide),
      custom: {
        width: num(raw.custom?.width, IPAD.width),
        height: num(raw.custom?.height, IPAD.height),
      },
    };
  } catch {
    return DEFAULT_CHOICE;
  }
}
