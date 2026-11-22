import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/server/http";
import { loadSecrets, updateSecrets } from "@/lib/server/secrets";
import { applyForUser } from "@/lib/server/state";
import { authUrl, GcalError, revoke, STATE_COOKIE } from "@/lib/server/gcal";

export const runtime = "nodejs";

/**
 * Google Calendar write access (study sessions go into a calendar the app makes).
 *   GET     -> send the browser to Google's permission screen; Google returns to /api/gcal/callback
 *   DELETE  -> withdraw access in Google and forget the login (the calendar itself is left in place)
 */

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  return withUser(async (user) => {
    const state = randomBytes(24).toString("base64url");
    try {
      const to = authUrl(origin, state, user.email);
      (await cookies()).set(STATE_COOKIE, state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/gcal", maxAge: 600 });
      return NextResponse.redirect(to);
    } catch (e) {
      const msg = e instanceof GcalError ? e.message : "Could not start Google sign-in.";
      return NextResponse.redirect(`${origin}/settings?gcal_error=${encodeURIComponent(msg)}#google-sync`);
    }
  });
}

export async function DELETE() {
  return withUser(async (user) => {
    const saved = (await loadSecrets(user.id)).gcal;
    if (saved) await revoke(saved.refreshToken);
    await updateSecrets(user.id, (s) => ({ ...s, gcal: undefined }));
    await applyForUser(user.id, { type: "save_settings", patch: { googleSync: undefined } }, "web");
    return NextResponse.json({ ok: true });
  });
}
