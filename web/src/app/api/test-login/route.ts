import { NextResponse } from "next/server";
import { passwordSignIn } from "@/lib/server/auth";

export const runtime = "nodejs";

/**
 * Password sign-in for automated tests only. Exists only when WML_TEST_LOGIN=1 and the app is not
 * running in production, so it can never be used on the deployed site.
 */
export async function POST(req: Request) {
  if (process.env.WML_TEST_LOGIN !== "1" || process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  try {
    await passwordSignIn(String(email), String(password));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 401 });
  }
}
