import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarEvents, calendarFeedUrl } from "../src/lib/calendar";

const ics = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:test\r\n${body.trim().split("\n").map((l) => l.trim()).join("\r\n")}\r\nEND:VCALENDAR\r\n`;

const FEED = ics(`
BEGIN:VEVENT
UID:standup
DTSTART;TZID=Asia/Kolkata:20261116T090000
DTEND;TZID=Asia/Kolkata:20261116T093000
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6
EXDATE;TZID=Asia/Kolkata:20261118T090000
SUMMARY:Standup
END:VEVENT
BEGIN:VEVENT
UID:standup
RECURRENCE-ID;TZID=Asia/Kolkata:20261123T090000
DTSTART;TZID=Asia/Kolkata:20261123T110000
DTEND;TZID=Asia/Kolkata:20261123T113000
SUMMARY:Standup (moved)
END:VEVENT
BEGIN:VEVENT
UID:utc
DTSTART:20261117T130000Z
DTEND:20261117T140000Z
SUMMARY:Dentist
LOCATION:Main St
END:VEVENT
BEGIN:VEVENT
UID:allday
DTSTART;VALUE=DATE:20261119
DTEND;VALUE=DATE:20261121
SUMMARY:Trip
END:VEVENT
BEGIN:VEVENT
UID:gone
DTSTART:20261117T150000Z
DTEND:20261117T160000Z
STATUS:CANCELLED
SUMMARY:Cancelled thing
END:VEVENT
BEGIN:VEVENT
UID:late
DTSTART:20261117T220000Z
DTEND:20261118T010000Z
SUMMARY:Late call
END:VEVENT
`);

test("events land in the person's own time zone, repeats expanded", () => {
  const ev = calendarEvents(FEED, "2026-11-16", "2026-11-25", "Asia/Kolkata");
  const standups = ev.filter((e) => e.title.startsWith("Standup"));
  // Mon 16, (Wed 18 excluded), Mon 23 moved to 11:00, Wed 25
  assert.deepEqual(standups.map((e) => `${e.date} ${e.start}-${e.end} ${e.title}`), [
    "2026-11-16 09:00-09:30 Standup",
    "2026-11-23 11:00-11:30 Standup (moved)",
    "2026-11-25 09:00-09:30 Standup",
  ]);
  const dentist = ev.find((e) => e.title === "Dentist");
  assert.equal(`${dentist?.date} ${dentist?.start}-${dentist?.end}`, "2026-11-17 18:30-19:30"); // 13:00 UTC = 18:30 IST
  assert.equal(dentist?.location, "Main St");
  assert.ok(!ev.some((e) => e.title === "Cancelled thing"));
});

test("an event over midnight is split; all-day spans each day; other zones convert", () => {
  const ev = calendarEvents(FEED, "2026-11-16", "2026-11-25", "Europe/London");
  const late = ev.filter((e) => e.title === "Late call").map((e) => `${e.date} ${e.start}-${e.end}`);
  assert.deepEqual(late, ["2026-11-17 22:00-24:00", "2026-11-18 00:00-01:00"]);
  const trip = ev.filter((e) => e.title === "Trip");
  assert.deepEqual(trip.map((e) => e.date), ["2026-11-19", "2026-11-20"]);
  assert.ok(trip.every((e) => e.allDay));
  // 09:00 in Kolkata is 03:30 in London (GMT in November)
  assert.equal(ev.find((e) => e.title === "Standup")?.start, "03:30");
});

test("only the asked dates come back", () => {
  const ev = calendarEvents(FEED, "2026-11-17", "2026-11-17", "Asia/Kolkata");
  assert.ok(ev.length > 0 && ev.every((e) => e.date === "2026-11-17"));
});

test("webcal links become https", () => {
  assert.equal(calendarFeedUrl(" webcal://calendar.google.com/x/basic.ics "), "https://calendar.google.com/x/basic.ics");
});

test("the assistant's calendar tool asks the host to read the connected calendar", async () => {
  const { BY_NAME, runSpec } = await import("../src/lib/tools/registry");
  const { createDemoState } = await import("../src/lib/demo");
  const base = createDemoState();
  const ctx = (state: typeof base) => ({ state, t: "2026-11-16", now: "2026-11-16T08:00:00.000Z" });
  const none = runSpec(BY_NAME.get_calendar_events, {}, ctx(base));
  assert.equal(none.fetchCalendar, undefined, "nothing to read without a calendar");
  const on = { ...base, settings: { ...base.settings, calendar: { name: "Work" } } };
  const out = runSpec(BY_NAME.get_calendar_events, { from: "2026-11-20" }, ctx(on));
  assert.deepEqual(out.fetchCalendar, { from: "2026-11-20", to: "2026-11-26" });
  const tooLong = runSpec(BY_NAME.get_calendar_events, { from: "2026-01-01", to: "2026-12-31" }, ctx(on));
  assert.ok(tooLong.error && /62 days/.test(tooLong.error));
});
