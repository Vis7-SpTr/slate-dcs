// SPDX-License-Identifier: GPL-3.0-or-later
// SLATE inside an OpenKneeboard Web Dashboard tab (P1.5 follow-up): detects
// OKB, asks it for the graphics tablet's aspect ratio, and sets the page's
// pixel size with `OpenKneeboard.SetPreferredPixelSize` – OKB tabs can't be
// resized by hand. The choice is this screen's own (kept in the OKB browser's
// storage); other screens are unaffected. API: openkneeboard.com/api/web-dashboards/

import { DEFAULT_CHOICE, okbPixelSize, parseChoice } from './okb-size.js';
import type { OkbChoice, PixelSize } from './okb-size.js';

/** The parts of OpenKneeboard's page API SLATE uses (v1.8+; promises from v1.9). */
interface OkbApi {
  SetPreferredPixelSize?: (width: number, height: number) => unknown;
  GetVersion?: () => Promise<{ HumanReadable?: string }>;
  EnableExperimentalFeature?: (name: string, version: number) => Promise<unknown>;
  GetGraphicsTabletInfo?: () => Promise<{
    HaveTablet: boolean;
    SuggestedPixelSize: { Width: number; Height: number };
  }>;
}

const STORAGE_KEY = 'slate.okbSize';
/** Experimental in OKB v1.9.15+; may change with any OKB update – we fall back without it. */
const TABLET_FEATURE = { name: 'GraphicsTabletInfo', version: 2025012901 } as const;

function api(): OkbApi | null {
  const w = globalThis as { OpenKneeboard?: OkbApi };
  return w.OpenKneeboard ?? null;
}

class Okb {
  /** This screen is an OpenKneeboard Web Dashboard tab. */
  readonly present = api() !== null;
  version: string | null = $state(null);
  /** The tablet's suggested size (its aspect ratio), when OKB reports one. */
  tablet: PixelSize | null = $state(null);
  haveTablet = $state(false);
  choice: OkbChoice = $state(DEFAULT_CHOICE);
  applied: PixelSize | null = $state(null);
  error: string | null = $state(null);

  /** Reads what OKB offers and applies the stored choice. Does nothing outside OKB. */
  async start(): Promise<void> {
    const okb = api();
    if (!okb) return;
    try {
      this.choice = parseChoice(localStorage.getItem(STORAGE_KEY));
    } catch {
      this.choice = DEFAULT_CHOICE;
    }
    try {
      this.version = (await okb.GetVersion?.())?.HumanReadable ?? null;
    } catch {
      this.version = null;
    }
    try {
      await okb.EnableExperimentalFeature?.(TABLET_FEATURE.name, TABLET_FEATURE.version);
      const info = await okb.GetGraphicsTabletInfo?.();
      if (info) {
        this.haveTablet = info.HaveTablet;
        this.tablet = {
          width: info.SuggestedPixelSize.Width,
          height: info.SuggestedPixelSize.Height,
        };
      }
    } catch {
      // Older OKB or the experiment changed: presets still work, "tablet" uses iPad portrait.
      this.tablet = null;
    }
    await this.apply();
  }

  /** The size the current choice gives. */
  get size(): PixelSize {
    return okbPixelSize(this.choice, this.tablet);
  }

  async set(choice: OkbChoice): Promise<void> {
    this.choice = choice;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    } catch {
      // Storage blocked: the choice holds until the page reloads.
    }
    await this.apply();
  }

  async apply(): Promise<void> {
    const okb = api();
    if (!okb?.SetPreferredPixelSize) {
      if (okb)
        this.error = 'This OpenKneeboard has no SetPreferredPixelSize (v1.8 or newer needed).';
      return;
    }
    const { width, height } = this.size;
    try {
      await okb.SetPreferredPixelSize(width, height);
      this.applied = { width, height };
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }
}

export const okb = new Okb();
