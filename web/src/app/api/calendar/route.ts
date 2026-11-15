import { NextResponse } from "next/server";
import { withUser } from "@/lib/server/http";
import { loadSecrets, updateSecrets } from "@/lib/server/secrets";
import { CalendarError, feedName, fetchFeed, forgetFeed, readEvents } from "@/lib/server/calendar";
import { applyForUser, todayIn } from "@/lib/server/state";
import { loadState } from "@/lib/server/supabase";
import { addDays } from "@/lib/date";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * The person's calendar, read through its secret feed address (saved encrypted). Read-only.
 *   GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD[&fresh=1] -> { events }   (at most 62 days)
 *   PUT  { url }                                  -> check the feed and save it
 *   DELETE                                        -> forget it
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const failure = (e: unknown) => {
  if (e instanceof CalendarError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
};

export async function GET(req: Request) {
  return withUser(async (user) => {
    const q = new URL(req.url).searchParams;
    const url = (await loadSecrets(user.id)).calendar;
    if (!url) return NextResponse.json({ error: "Connect a calendar in Settings first.", needsSetup: true }, { status: 400 });
    const tz = (await loadState(user.id))?.state.settings?.timezone ?? "UTC";
    const from = q.get("from") ?? todayIn(tz);
    const to = q.get("to") ?? from;
    if (!DAY.test(from) || !DAY.test(to) || to < from || to > addDays(from, 62)) return NextResponse.json({ error: "Ask for at most 62 days, as from=YYYY-MM-DD&to=YYYY-MM-DD." }, { status: 400 });
    try {
      return NextResponse.json({ events: await readEvents(user.id, url, from, to, tz, q.has("fresh")) });
    } catch (e) {
      return failure(e);
    }
  });
}

export async function PUT(req: Request) {
  return withUser(async (user) => {
    const { url } = (await req.json().catch(() => ({}))) as { url?: string };
    const raw = url?.trim() ?? "";
    if (!raw) return NextResponse.json({ error: "Paste the calendar's secret address." }, { status: 400 });
    try {
      // Prove the address works before saving it
      const name = feedName(await fetchFeed(user.id, raw, true));
      await updateSecrets(user.id, (s) => ({ ...s, calendar: raw }));
      await applyForUser(user.id, { type: "save_settings", patch: { calendar: { name } } }, "web");
      return NextResponse.json({ ok: true, name });
    } catch (e) {
      return failure(e);
    }
  });
}

export async function DELETE() {
  return withUser(async (user) => {
    forgetFeed(user.id);
    await updateSecrets(user.id, (s) => ({ ...s, calendar: undefined }));
    await applyForUser(user.id, { type: "save_settings", patch: { calendar: undefined } }, "web");
    return NextResponse.json({ ok: true });
  });
}
