import ICAL from "ical.js";
import { addDays } from "./date";

/**
 * Reading a calendar file (iCal / .ics), such as a Google Calendar "secret address in iCal format".
 * Repeating events are expanded, and every time is moved into the person's own time zone.
 */

export interface CalendarEvent {
  title: string;
  date: string; // YYYY-MM-DD, in the person's time zone
  start: string; // HH:MM; "00:00" for all-day events
  end: string; // HH:MM; "24:00" when it runs to midnight
  allDay: boolean;
  location?: string;
}

const MAX_STEPS = 5000;

const validZone = (tz: string | null | undefined): tz is string => {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Year, month, day, hour, minute of an instant as seen in a time zone. */
function partsIn(ms: number, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}

/** The instant at which a wall-clock time happens in a time zone (DST-safe). */
function wallToInstant(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (ms: number) => {
    const p = partsIn(ms, tz);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(ms / 60000) * 60000;
  };
  const first = guess - offset(guess);
  const second = guess - offset(first);
  return second;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (p: { y: number; mo: number; d: number }) => `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
const hm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** An ical.js time as an instant, using the event's own time zone (occurrences lose it otherwise). */
function instant(t: ICAL.Time, eventZone: string | null, userZone: string): number {
  if (t.zone?.tzid === "UTC") return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute);
  const tz = validZone(eventZone) ? eventZone : userZone; // floating or unknown zones: the person's own
  return wallToInstant(t.year, t.month, t.day, t.hour, t.minute, tz);
}

/** Split one event into per-day pieces in the person's time zone. */
function pieces(title: string, location: string | undefined, startMs: number, endMs: number, tz: string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const s = partsIn(startMs, tz);
  const e = partsIn(Math.max(endMs, startMs + 60000), tz);
  let day = ymd(s);
  const last = ymd(e);
  for (let i = 0; i < 60; i++) {
    const from = day === ymd(s) ? s.h * 60 + s.mi : 0;
    const to = day === last ? e.h * 60 + e.mi : 1440;
    if (to > from) out.push({ title, date: day, start: hm(from), end: hm(to), allDay: false, ...(location ? { location } : {}) });
    if (day === last) break;
    day = addDays(day, 1);
  }
  return out;
}

/**
 * Events between two dates (inclusive) in the person's time zone, sorted by date and time.
 * Cancelled events are left out.
 */
export function calendarEvents(ics: string, from: string, to: string, userZone: string): CalendarEvent[] {
  const tz = validZone(userZone) ? userZone : "UTC";
  const root = new ICAL.Component(ICAL.parse(ics));
  const vevents = root.getAllSubcomponents("vevent");
  const masters = new Map<string, ICAL.Event>();
  const singles: ICAL.Event[] = [];
  for (const v of vevents) {
    if (v.hasProperty("recurrence-id")) continue;
    const ev = new ICAL.Event(v);
    if (ev.isRecurring()) masters.set(ev.uid, ev);
    else singles.push(ev);
  }
  // A changed single occurrence of a repeating event replaces that occurrence
  for (const v of vevents) {
    if (!v.hasProperty("recurrence-id")) continue;
    const master = masters.get(String(v.getFirstPropertyValue("uid")));
    if (master) master.relateException(v);
    else singles.push(new ICAL.Event(v));
  }

  // Wall dates can differ from the person's dates by a day either way
  const lo = addDays(from, -1);
  const hi = addDays(to, 1);
  const zoneOf = (c: ICAL.Component) => {
    const p = c.getFirstProperty("dtstart");
    const z = p?.getParameter("tzid");
    return typeof z === "string" ? z : null;
  };
  const wallDate = (t: ICAL.Time) => `${t.year}-${pad(t.month)}-${pad(t.day)}`;
  const out: CalendarEvent[] = [];

  const add = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
    if (String(item.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") return;
    const title = item.summary || "Busy";
    const location = item.location || undefined;
    if (start.isDate) {
      // All-day: the end date is exclusive
      const days = Math.max(1, Math.round((Date.UTC(end.year, end.month - 1, end.day) - Date.UTC(start.year, start.month - 1, start.day)) / 86400000));
      for (let i = 0; i < Math.min(days, 366); i++) {
        const date = addDays(wallDate(start), i);
        out.push({ title, date, start: "00:00", end: "24:00", allDay: true, ...(location ? { location } : {}) });
      }
      return;
    }
    const zone = zoneOf(item.component);
    out.push(...pieces(title, location, instant(start, zone, tz), instant(end, zone, tz), tz));
  };

  for (const ev of singles) {
    if (wallDate(ev.endDate ?? ev.startDate) < lo || wallDate(ev.startDate) > hi) continue;
    add(ev, ev.startDate, ev.endDate ?? ev.startDate);
  }
  for (const ev of masters.values()) {
    const it = ev.iterator();
    for (let i = 0; i < MAX_STEPS; i++) {
      const next = it.next();
      if (!next) break;
      const d = wallDate(next);
      if (d > hi) break;
      const occ = ev.getOccurrenceDetails(next);
      if (wallDate(occ.endDate) < lo) continue;
      add(occ.item, occ.startDate, occ.endDate);
    }
  }

  return out.filter((e) => e.date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

/** Turns a pasted calendar address into the https link to fetch. webcal:// is the same feed over https. */
export const calendarFeedUrl = (raw: string) => raw.trim().replace(/^webcal:\/\//i, "https://");
