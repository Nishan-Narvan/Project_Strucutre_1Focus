import { NextResponse } from "next/server";
import { beginSignIn } from "@/lib/server/auth";

export const runtime = "nodejs";

/** Start Google sign-in. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    return NextResponse.redirect(await beginSignIn(url.origin, url.searchParams.get("next") ?? "/goals"));
  } catch (e) {
    return NextResponse.redirect(`${url.origin}/goals?auth_error=${encodeURIComponent(e instanceof Error ? e.message : "Sign-in is not available.")}`);
  }
}
