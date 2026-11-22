import { NextResponse } from "next/server";
import { devSignIn } from "@/lib/server/auth";

export const runtime = "nodejs";

/**
 * GET /auth/dev — local development sign-in as the account named in WML_DEV_LOGIN (an email), no Google.
 * Not found in production, without the switch, or when the request does not come to localhost.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = process.env.WML_DEV_LOGIN?.trim();
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (process.env.NODE_ENV === "production" || !email || !local) return new Response("Not found", { status: 404 });
  try {
    await devSignIn(email);
    return NextResponse.redirect(`${url.origin}${url.searchParams.get("next")?.startsWith("/") ? url.searchParams.get("next") : "/goals"}`);
  } catch (e) {
    return NextResponse.redirect(`${url.origin}/goals?auth_error=${encodeURIComponent(e instanceof Error ? e.message : "Local sign-in failed.")}`);
  }
}
