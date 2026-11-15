import "server-only";
import ICAL from "ical.js";
import { calendarEvents, calendarFeedUrl, type CalendarEvent } from "@/lib/calendar";
import { publicHttpsUrl } from "./net";

/** Fetching the person's calendar feed. The address is a secret: it is never logged or sent to the browser. */

export class CalendarError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const MAX_BYTES = 8_000_000;
const CACHE_MS = 120_000;
const cache = new Map<string, { at: number; url: string; text: string }>();

/** The feed's text, fetched at most every two minutes per person. */
export async function fetchFeed(userId: string, rawUrl: string, fresh = false): Promise<string> {
  const url = publicHttpsUrl(calendarFeedUrl(rawUrl));
  if (!url) throw new CalendarError("The calendar address must be a public https (or webcal) link.");
  const hit = cache.get(userId);
  if (!fresh && hit && hit.url === url.toString() && Date.now() - hit.at < CACHE_MS) return hit.text;

  let res: Response;
  try {
    // Redirects are refused, so a public address cannot bounce the request somewhere private
    res = await fetch(url, { headers: { Accept: "text/calendar, */*" }, redirect: "error", signal: AbortSignal.timeout(20000), cache: "no-store" });
  } catch {
    throw new CalendarError("Could not reach the calendar. Check the address.", 502);
  }
  if (res.status === 404 || res.status === 401 || res.status === 403) throw new CalendarError("The calendar refused that address. If you reset the secret address in Google Calendar, paste the new one.", 400);
  if (!res.ok) throw new CalendarError(`The calendar answered with status ${res.status}.`, 502);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new CalendarError("That calendar is too large to read.", 413);
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) throw new CalendarError("That address does not lead to a calendar file. In Google Calendar copy the \"Secret address in iCal format\".");
  cache.set(userId, { at: Date.now(), url: url.toString(), text });
  return text;
}

/** The calendar's own name, for showing what is connected. */
export function feedName(text: string): string {
  try {
    const name = new ICAL.Component(ICAL.parse(text)).getFirstPropertyValue("x-wr-calname");
    return typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : "Your calendar";
  } catch {
    throw new CalendarError("That calendar file could not be read.");
  }
}

export async function readEvents(userId: string, rawUrl: string, from: string, to: string, timezone: string, fresh = false): Promise<CalendarEvent[]> {
  const text = await fetchFeed(userId, rawUrl, fresh);
  try {
    return calendarEvents(text, from, to, timezone);
  } catch {
    throw new CalendarError("That calendar file could not be read.");
  }
}

export const forgetFeed = (userId: string) => cache.delete(userId);
