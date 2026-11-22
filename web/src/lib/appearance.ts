import type { Appearance } from "./types";

/** Shared by the server layout (early theme script) and the browser (Appearance.tsx). */

export const DEFAULT_APPEARANCE: Appearance = { theme: "dark", background: "none", backgroundOpacity: 85, glass: false, panelOpacity: 60, blur: 18, glassLevel: 0 };

/** The last-used look, cached on the device so the page can be themed before data loads. */
export const CACHE_KEY = "wml.appearance";

