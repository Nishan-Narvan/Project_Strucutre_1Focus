import "server-only";
import { NextResponse } from "next/server";
import { currentUser, type User } from "./auth";
import { NotConfigured } from "./supabase";
import { Conflict, NoState } from "./state";
import { OpError } from "@/lib/ops";

/** Turn any error from the data layer into a response with a message the person can act on. */
export function errorResponse(e: unknown) {
  const msg = e instanceof Error ? e.message : "Server error.";
  const status = e instanceof OpError ? 400 : e instanceof NoState ? 409 : e instanceof Conflict ? 409 : e instanceof NotConfigured ? 503 : 500;
  if (status === 500) console.error("[api]", e);
  return NextResponse.json({ error: msg }, { status });
}

/** Run a route body for the signed-in user only. */
export async function withUser(fn: (user: User) => Promise<Response>): Promise<Response> {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "You are signed out. Sign in again.", signedIn: false }, { status: 401 });
    return await fn(user);
  } catch (e) {
    return errorResponse(e);
  }
}
