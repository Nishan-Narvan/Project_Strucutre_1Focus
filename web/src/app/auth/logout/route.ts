import { NextResponse } from "next/server";
import { signOut } from "@/lib/server/auth";

export const runtime = "nodejs";

/** Sign out. POST only, so a link elsewhere cannot sign someone out. */
export async function POST(req: Request) {
  await signOut();
  return NextResponse.redirect(`${new URL(req.url).origin}/goals`, { status: 303 });
}
