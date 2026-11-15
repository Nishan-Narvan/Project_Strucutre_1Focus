"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import type { CalendarEvent } from "@/lib/calendar";
import type { AppState, DayEvent } from "@/lib/types";

/** Events from the person's connected calendar, shown next to the plan. Read-only. */

const memo = new Map<string, { at: number; events: CalendarEvent[] }>();
const FRESH_MS = 60_000;

/** Calendar events for a range of days; empty while loading or when no calendar is connected. */
export function useCalendarEvents(from: string, to: string): { events: CalendarEvent[]; error: string } {
  const { state, ready } = useStore();
  const on = ready && Boolean(state.settings.calendar);
  const key = `${from}|${to}`;
  const [got, setGot] = useState<{ key: string; events: CalendarEvent[]; error: string }>({ key: "", events: [], error: "" });

  useEffect(() => {
    if (!on) return;
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < FRESH_MS) return setGot({ key, events: hit.events, error: "" });
    let live = true;
    fetch(`/api/calendar?from=${from}&to=${to}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!live) return;
        if (!r.ok) return setGot({ key, events: [], error: d.error || "Could not read your calendar." });
        memo.set(key, { at: Date.now(), events: d.events ?? [] });
        setGot({ key, events: d.events ?? [], error: "" });
      })
      .catch(() => live && setGot({ key, events: [], error: "Could not reach your calendar." }));
    return () => {
      live = false;
    };
  }, [on, key, from, to]);

  return on && got.key === key ? got : { events: [], error: "" };
}

/** Timed calendar events as fixed blocks the day's plan is laid out around. All-day ones take no time. */
export const asDayEvents = (events: CalendarEvent[]): DayEvent[] =>
  events.filter((e) => !e.allDay).map((e, i) => ({ id: `cal-${e.date}-${i}`, date: e.date, title: e.title, start: e.start, end: e.end === "24:00" ? "23:59" : e.end }));

/** The state with calendar events added, for laying out a day. Not saved anywhere. */
export const withCalendar = (state: AppState, events: CalendarEvent[]): AppState => (events.length ? { ...state, events: [...state.events, ...asDayEvents(events)] } : state);

export function CalendarSettings() {
  const { state, refresh } = useStore();
  const connected = state.settings.calendar;
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/calendar", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setMsg({ text: d.error || "That did not work.", bad: true });
    memo.clear();
    await refresh();
    setUrl("");
    setMsg({ text: `Connected "${d.name}". Saved encrypted. Your events now show on Today and each day.` });
  }

  return (
    <section className="card space-y-4" aria-labelledby="calendar-title">
      <div>
        <h2 id="calendar-title" className="text-base font-medium">Calendar</h2>
        <p className="mt-1 text-sm text-muted">See your Google Calendar events next to your study plan, so study blocks go around them. The assistant and Claude can read them too. Read-only: nothing is changed in your calendar.</p>
      </div>
      {connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">Connected: {connected.name}</span>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={async () => {
              await fetch("/api/calendar", { method: "DELETE" });
              memo.clear();
              await refresh();
              setMsg({ text: "Calendar disconnected." });
            }}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
            <li>Open <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer" className="text-ink underline">Google Calendar settings</a> on a computer.</li>
            <li>On the left, under Settings for my calendars, pick your calendar, then scroll to Integrate calendar.</li>
            <li>Copy the <span className="text-ink">Secret address in iCal format</span> and paste it below. Outlook and Apple calendar links (.ics or webcal://) work too.</li>
          </ol>
          <form className="flex gap-2" onSubmit={connect}>
            <input className="input" type="password" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" aria-label="Secret calendar address" />
            <button className="btn btn-primary" disabled={busy || !url.trim()}>{busy ? "Checking…" : "Connect"}</button>
          </form>
          <p className="text-xs text-faint">Treat that address like a password: anyone with it can see your events. It is stored encrypted and never shown again. You can reset it in Google Calendar at any time.</p>
        </>
      )}
      {msg && <p className={`text-sm ${msg.bad ? "text-bad" : "text-muted"}`} role="status">{msg.text}</p>}
    </section>
  );
}
