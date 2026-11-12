import { NextResponse } from "next/server";
import { finishSignIn } from "@/lib/server/auth";

export const runtime = "nodejs";

/** Supabase sends the person back here after Google. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = (msg: string) => NextResponse.redirect(`${url.origin}/goals?auth_error=${encodeURIComponent(msg)}`);
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (error) return fail(error);
  const code = url.searchParams.get("code");
  if (!code) return fail("Google did not send a sign-in code back. Try again.");
  try {
    return NextResponse.redirect(`${url.origin}${await finishSignIn(code)}`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Sign-in failed.");
  }
}
