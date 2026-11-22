import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { loadSecrets, updateSecrets } from "@/lib/server/secrets";
import { applyForUser } from "@/lib/server/state";
import { loadState } from "@/lib/server/supabase";
import { CALENDAR_NAME, ensureCalendar, exchangeCode, GcalError, primeToken, STATE_COOKIE } from "@/lib/server/gcal";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Google sends the person back here: save the login, make (or find) the app's calendar. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(`${url.origin}/settings?${q}#google-sync`);
  const fail = (msg: string) => back(`gcal_error=${encodeURIComponent(msg)}`);

  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: "/api/gcal" });
  const err = url.searchParams.get("error");
  if (err) return fail(err === "access_denied" ? "Google Calendar was not connected: access was declined." : `Google said: ${err}`);
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) return fail("That sign-in link expired. Press Connect again.");

  const user = await currentUser();
  if (!user) return fail("You are signed out. Sign in, then connect Google Calendar again.");
  try {
    const t = await exchangeCode(url.origin, code);
    primeToken(t.refreshToken, t.accessToken, t.expiresIn);
    const settings = (await loadState(user.id))?.state.settings;
    const calendarId = await ensureCalendar(t.accessToken, settings?.timezone || "UTC", (await loadSecrets(user.id)).gcal?.calendarId);
    await updateSecrets(user.id, (s) => ({ ...s, gcal: { refreshToken: t.refreshToken, calendarId } }));
    const reminderMin = settings?.googleSync?.reminderMin ?? 10;
    await applyForUser(user.id, { type: "save_settings", patch: { googleSync: { calendar: CALENDAR_NAME, reminderMin } } }, "web");
    return back("gcal=connected");
  } catch (e) {
    if (!(e instanceof GcalError)) console.error("[gcal]", e);
    return fail(e instanceof Error ? e.message : "Connecting Google Calendar failed.");
  }
}
