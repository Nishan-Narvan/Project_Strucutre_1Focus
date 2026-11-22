"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useStore } from "@/lib/store";
import type { Appearance } from "@/lib/types";
import { CACHE_KEY, DEFAULT_APPEARANCE } from "@/lib/appearance";

/**
 * The theme: dark, light, or follow the device. Solid panels only (no wallpaper, no glass blur),
 * so every screen paints fast. The last-used theme is cached locally so the page never flashes.
 */

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");
function useSystemDark() {
  return useSyncExternalStore(
    (cb) => {
      const q = darkQuery();
      q.addEventListener("change", cb);
      return () => q.removeEventListener("change", cb);
    },
    () => darkQuery().matches,
    () => true,
  );
}

/** The saved theme, or the cached one before data loads. */
function useTheme(): Appearance["theme"] {
  const { state, ready } = useStore();
  const [cached, setCached] = useState<Appearance["theme"] | null>(null);
  useEffect(() => {
    try {
      setCached((JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Appearance | null)?.theme ?? null);
    } catch {}
  }, []);
  return (ready ? state.settings.appearance?.theme : cached) ?? DEFAULT_APPEARANCE.theme;
}

/** Applies the theme to the page. Mounted once, around everything. */
export function AppearanceLayer() {
  const chosen = useTheme();
  const systemDark = useSystemDark();
  const theme = chosen === "system" ? (systemDark ? "dark" : "light") : chosen;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    delete root.dataset.glass;
    root.style.removeProperty("--g");
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ theme: chosen }));
    } catch {}
  }, [theme, chosen]);

  // Wallpapers are gone: drop an image an earlier version kept on this device
  useEffect(() => {
    try {
      indexedDB.deleteDatabase("wml-appearance");
    } catch {}
  }, []);

  return null;
}

function useThemeSetter() {
  const { state, saveSettings } = useStore();
  const theme = state.settings.appearance?.theme ?? DEFAULT_APPEARANCE.theme;
  const set = (t: Appearance["theme"]) => saveSettings({ appearance: { ...DEFAULT_APPEARANCE, ...state.settings.appearance, theme: t } });
  return { theme, set };
}

const SunMoon = ({ dark }: { dark: boolean }) => (
  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
    {dark ? (
      <path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8Z" />
    ) : (
      <>
        <circle cx="10" cy="10" r="3.5" />
        <path d="M10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.3 4.3l1.1 1.1M14.6 14.6l1.1 1.1M4.3 15.7l1.1-1.1M14.6 5.4l1.1-1.1" />
      </>
    )}
  </svg>
);

/** In the side panel, on every page: a dark/light switch. */
export function QuickLook() {
  const { theme, set } = useThemeSetter();
  const systemDark = useSystemDark();
  const dark = (theme === "system" ? (systemDark ? "dark" : "light") : theme) === "dark";
  return (
    <div className="flex items-center">
      <span className="text-xs text-muted">{dark ? "Dark" : "Light"}</span>
      <button type="button" className="btn btn-quiet btn-sm btn-icon ml-auto" onClick={() => set(dark ? "light" : "dark")} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Switch to light mode" : "Switch to dark mode"}>
        <SunMoon dark={dark} />
      </button>
    </div>
  );
}

/** Settings: the theme. */
export function AppearanceSettings() {
  const { theme, set } = useThemeSetter();
  return (
    <section className="card space-y-4" aria-labelledby="look-title">
      <h2 id="look-title" className="text-base font-medium">Appearance</h2>
      <div>
        <span className="label">Theme</span>
        <div className="inline-flex rounded-[10px] border border-line bg-panel-2 p-0.5" role="radiogroup" aria-label="Theme">
          {(["dark", "light", "system"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} onClick={() => set(t)} className={`h-8 rounded-lg px-3 text-sm transition-colors ${theme === t ? "bg-ink text-on-ink" : "text-muted hover:text-ink"}`}>
              {t === "system" ? "Match device" : t === "dark" ? "Dark" : "Light"}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
