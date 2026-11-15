import type { Appearance } from "./types";

/** Shared by the server layout (early theme script) and the browser (Appearance.tsx). */

export const DEFAULT_APPEARANCE: Appearance = { theme: "dark", background: "none", backgroundOpacity: 60, glass: false, panelOpacity: 60, blur: 18, glassLevel: 0 };

/** The last-used look, cached on the device so the page can be themed before data loads. */
export const CACHE_KEY = "wml.appearance";

/** The glass level, 0-100. Looks saved before the single slider are converted from their old settings. */
export function glassOf(a: Partial<Appearance>): number {
  const v = a.glassLevel ?? (a.glass ? Math.round((100 - (a.panelOpacity ?? 60)) * 1.25) : 0);
  return Math.min(100, Math.max(0, Math.round(v)));
}
