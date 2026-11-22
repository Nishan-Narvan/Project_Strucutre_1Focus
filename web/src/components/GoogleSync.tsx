"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";

const REMINDERS = [0, 5, 10, 15, 30, 60];

/**
 * Settings card: write study sessions into a "Where MyLife" calendar in the person's Google
 * account, so Google reminds them on phone and computer. The connect button leaves for Google's
 * permission screen and comes back here with ?gcal=connected or ?gcal_error=...
 */
export function GoogleSyncSettings() {
  const { state, refresh, saveSettings } = useStore();
  const sync = state.settings.googleSync;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  // The answer from Google's round trip, read once and then removed from the address bar
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const error = q.get("gcal_error");
    if (q.get("gcal") === "connected") {
      setMsg({ text: 'Connected. A calendar called "Where MyLife" was added to your Google Calendar.' });
      void refresh();
    } else if (error) setMsg({ text: error, bad: true });
    if (error || q.has("gcal")) {
      q.delete("gcal");
      q.delete("gcal_error");
      window.history.replaceState(null, "", `${window.location.pathname}${q.size ? `?${q}` : ""}${window.location.hash}`);
    }
  }, [refresh]);

  async function disconnect() {
    setBusy(true);
    const res = await fetch("/api/gcal", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setMsg({ text: "Could not disconnect. Try again.", bad: true });
    await refresh();
    setMsg({ text: 'Disconnected. The "Where MyLife" calendar stays in Google Calendar; delete it there if you no longer want it.' });
  }

  return (
    <section id="google-sync" className="card scroll-mt-24 space-y-4" aria-labelledby="google-sync-title">
      <div>
        <h2 id="google-sync-title" className="text-base font-medium">Google Calendar sync</h2>
        <p className="mt-1 text-sm text-muted">
          Put your study sessions in your Google Calendar, with a reminder before each one, so your phone tells you when to study. They go into a separate calendar called
          &ldquo;Where MyLife&rdquo;. The app cannot see or change any of your other calendars.
        </p>
      </div>

      {sync ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">Connected: {sync.calendar}</span>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={disconnect}>Disconnect</button>
          </div>
          <label className="flex flex-wrap items-center gap-2 text-sm text-muted">
            Remind me
            <select
              className="input w-auto"
              value={sync.reminderMin}
              onChange={(e) => saveSettings({ googleSync: { ...sync, reminderMin: Number(e.target.value) } })}
            >
              {REMINDERS.map((m) => <option key={m} value={m}>{m === 0 ? "when it starts" : m === 60 ? "1 hour before" : `${m} minutes before`}</option>)}
            </select>
          </label>
          {sync.error ? <p className="text-sm text-bad">Last sync failed: {sync.error}</p> : sync.lastSync ? <p className="text-xs text-faint">Last synced {new Date(sync.lastSync).toLocaleString()}</p> : null}
        </>
      ) : (
        <>
          <a href="/api/gcal" className="btn btn-primary inline-flex">Connect Google Calendar</a>
          <p className="text-xs text-faint">Google will ask to let Where MyLife &ldquo;make secondary calendars and see, edit, share and permanently delete the calendars it creates&rdquo;. That is the narrowest calendar permission Google offers.</p>
        </>
      )}
      {msg && <p className={`text-sm ${msg.bad ? "text-bad" : "text-muted"}`} role="status">{msg.text}</p>}
    </section>
  );
}
