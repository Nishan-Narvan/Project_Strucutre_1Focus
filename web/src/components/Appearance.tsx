"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "@/lib/store";
import type { Appearance } from "@/lib/types";
import { CACHE_KEY, DEFAULT_APPEARANCE, glassOf } from "@/lib/appearance";

/**
 * Theme (dark, light or follow the system), glass panels, and a full-screen background image.
 * Settings sync with the account. An uploaded image is kept on its device (IndexedDB): a
 * full-screen photo is too heavy to send with every change. A link to an image syncs everywhere.
 * The last-used look is also cached locally, so the page does not flash before data loads.
 */


const DB = "wml-appearance";
const STORE = "files";

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = fn(open.result.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    };
  });
}
const getDeviceImage = () => idb<Blob | undefined>("readonly", (s) => s.get("background")).catch(() => undefined);
const setDeviceImage = (b: Blob) => idb("readwrite", (s) => s.put(b, "background"));
const clearDeviceImage = () => idb("readwrite", (s) => s.delete("background")).catch(() => undefined);

// Tells every mounted backdrop to reload when the uploaded image changes
const listeners = new Set<() => void>();
let imageVersion = 0;
const bumpImage = () => {
  imageVersion++;
  listeners.forEach((l) => l());
};

/** Large photos are scaled to at most 2560px and re-encoded, so storage and memory stay small. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read that image."))), "image/jpeg", 0.86));
}

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

const PREVIEW = "wml-appearance-preview";

/** Show a look at once while it is being edited, before it is saved. */
const preview = (a: Appearance) => window.dispatchEvent(new CustomEvent(PREVIEW, { detail: a }));

/** The person's look: a live preview while editing, else the saved one, else the cached one before data loads. */
function useAppearance(): Appearance {
  const { state, ready } = useStore();
  const [cached, setCached] = useState<Appearance | null>(null);
  const [live, setLive] = useState<Appearance | null>(null);
  useEffect(() => {
    try {
      setCached(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"));
    } catch {}
    const on = (e: Event) => setLive((e as CustomEvent<Appearance>).detail);
    window.addEventListener(PREVIEW, on);
    return () => window.removeEventListener(PREVIEW, on);
  }, []);
  // Once the saved look catches up with the preview, the preview is no longer needed
  const saved = ready ? state.settings.appearance : undefined;
  const savedKey = JSON.stringify(saved ?? null);
  useEffect(() => {
    if (live && JSON.stringify({ ...DEFAULT_APPEARANCE, ...saved }) === JSON.stringify({ ...DEFAULT_APPEARANCE, ...live })) setLive(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  return { ...DEFAULT_APPEARANCE, ...(live ?? (ready ? saved : cached ?? undefined)) };
}

/** Applies the look to the page and draws the wallpaper. Mounted once, around everything. */
export function AppearanceLayer() {
  const a = useAppearance();
  const systemDark = useSystemDark();
  const [deviceUrl, setDeviceUrl] = useState<string | null>(null);
  const version = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => imageVersion,
    () => 0,
  );

  const theme = a.theme === "system" ? (systemDark ? "dark" : "light") : a.theme;
  const g = glassOf(a);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.glass = g > 0 ? "on" : "off";
    root.style.setProperty("--g", String(g / 100));
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(a));
    } catch {}
  }, [theme, g, a]);

  // The uploaded image lives in IndexedDB; turn it into a URL while it is shown
  useEffect(() => {
    if (a.background !== "device") return setDeviceUrl(null);
    let url: string | null = null;
    let live = true;
    getDeviceImage().then((blob) => {
      if (!live || !blob) return;
      url = URL.createObjectURL(blob);
      setDeviceUrl(url);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [a.background, version]);

  const src = a.background === "url" ? a.backgroundUrl : a.background === "device" ? deviceUrl : null;
  if (!src) return null;
  return <div className="app-backdrop" aria-hidden style={{ backgroundImage: `url(${JSON.stringify(src)})`, opacity: Math.min(100, Math.max(0, a.backgroundOpacity)) / 100 }} />;
}

/**
 * Edit the look: changes show at once and are saved after a short pause (sliders move in many
 * small steps). A change still waiting is saved when leaving the page.
 */
function useLookEditor() {
  const { state, saveSettings } = useStore();
  const saved = { ...DEFAULT_APPEARANCE, ...state.settings.appearance };
  const [a, setA] = useState<Appearance>(saved);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsaved = useRef<Appearance | null>(null);

  // Follow changes made elsewhere (the other control, another device) when nothing is being edited here
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    if (!timer.current) setA(JSON.parse(savedKey));
  }, [savedKey]);

  useEffect(() => {
    const flush = () => {
      if (!unsaved.current) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      saveSettings({ appearance: unsaved.current });
      unsaved.current = null;
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [saveSettings]);

  const update = (patch: Partial<Appearance>, delay = 0) => {
    const next = { ...a, ...patch };
    setA(next);
    preview(next);
    if (timer.current) clearTimeout(timer.current);
    unsaved.current = next;
    timer.current = setTimeout(() => {
      timer.current = null;
      unsaved.current = null;
      saveSettings({ appearance: next });
    }, delay);
  };
  return { a, update };
}

function Slider({ label, value, min, max, unit, onChange, compact }: { label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void; compact?: boolean }) {
  const id = `ap-${label.replace(/\W+/g, "-").toLowerCase()}${compact ? "-quick" : ""}`;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className={compact ? "text-xs text-muted" : "label mb-0"} htmlFor={id}>{label}</label>
        <span className="text-xs text-muted tabular-nums">{value}{unit}</span>
      </div>
      <input id={id} type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="range" />
    </div>
  );
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

/** In the side panel, on every page: the glass slider and a dark/light switch. */
export function QuickLook() {
  const { a, update } = useLookEditor();
  const systemDark = useSystemDark();
  const dark = (a.theme === "system" ? (systemDark ? "dark" : "light") : a.theme) === "dark";
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{dark ? "Dark" : "Light"}</span>
        <button type="button" className="btn btn-quiet btn-sm btn-icon" onClick={() => update({ theme: dark ? "light" : "dark" })} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Switch to light mode" : "Switch to dark mode"}>
          <SunMoon dark={dark} />
        </button>
      </div>
      <Slider compact label="Glass" value={glassOf(a)} min={0} max={100} unit="%" onChange={(v) => update({ glassLevel: v }, 400)} />
    </div>
  );
}

/** Settings: theme, glass and the wallpaper. */
export function AppearanceSettings() {
  const { a, update } = useLookEditor();
  const [url, setUrl] = useState(a.backgroundUrl ?? "");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setMsg({ text: "That is not an image.", bad: true });
    try {
      await setDeviceImage(await shrink(file));
      bumpImage();
      // A wallpaper only shows through see-through panels: add some glass the first time
      update({ background: "device", ...(glassOf(a) === 0 ? { glassLevel: 45 } : {}) });
      setMsg({ text: "Wallpaper set. It is kept on this device only." });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Could not use that image.", bad: true });
    }
  }

  function useLink() {
    const u = url.trim();
    if (!/^https:\/\/\S+$/i.test(u)) return setMsg({ text: "Paste an https:// link to an image.", bad: true });
    update({ background: "url", backgroundUrl: u, ...(glassOf(a) === 0 ? { glassLevel: 45 } : {}) });
    setMsg({ text: "Wallpaper set from the link. It shows on all your devices." });
  }

  return (
    <section className="card space-y-6" aria-labelledby="look-title">
      <h2 id="look-title" className="text-base font-medium">Appearance</h2>

      <div>
        <span className="label">Theme</span>
        <div className="inline-flex rounded-[10px] border border-line bg-panel-2 p-0.5" role="radiogroup" aria-label="Theme">
          {(["dark", "light", "system"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={a.theme === t} onClick={() => update({ theme: t })} className={`h-8 rounded-lg px-3 text-sm transition-colors ${a.theme === t ? "bg-ink text-on-ink" : "text-muted hover:text-ink"}`}>
              {t === "system" ? "Match device" : t === "dark" ? "Dark" : "Light"}
            </button>
          ))}
        </div>
      </div>

      <Slider label="Glass: how see-through and blurred every panel is" value={glassOf(a)} min={0} max={100} unit="%" onChange={(v) => update({ glassLevel: v }, 400)} />

      <div className="space-y-3">
        <span className="label">Wallpaper</span>
        <div className="flex flex-wrap gap-2">
          <label className="btn cursor-pointer">
            Upload an image
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {a.background !== "none" && (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                if (a.background === "device") void clearDeviceImage().then(bumpImage);
                update({ background: "none" });
                setMsg({ text: "Wallpaper removed." });
              }}
            >
              Remove wallpaper
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Or paste an image link: https://…" aria-label="Image link" />
          <button type="button" className="btn" onClick={useLink}>Use link</button>
        </div>
        <p className="text-xs text-muted">
          {a.background === "device" ? "Using an image uploaded on this device. Other devices keep their own." : a.background === "url" ? "Using an image link, on all your devices." : "No wallpaper."} Raise Glass to see it through the panels; the same slider softens the wallpaper itself.
        </p>
        {a.background !== "none" && <Slider label="Wallpaper brightness" value={a.backgroundOpacity} min={5} max={100} unit="%" onChange={(v) => update({ backgroundOpacity: v }, 400)} />}
      </div>

      {msg && <p className={`text-sm ${msg.bad ? "text-bad" : "text-muted"}`} role="status">{msg.text}</p>}
    </section>
  );
}
