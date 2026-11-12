import { NextResponse } from "next/server";
import { fail } from "@/lib/server/net";
import { ackActions, deleteSnapshot, hashToken, listActions, NotConfigured, saveSnapshot, supabaseConfigured, validToken } from "@/lib/server/supabase";
import type { AppState } from "@/lib/types";

export const runtime = "nodejs";

/**
 * The app's side of the claude.ai connector. The browser authenticates with its connector token.
 *   POST   { state, timezone }  save the latest copy of the data (secrets already removed by the browser)
 *   GET                         changes queued from claude.ai, oldest first
 *   PATCH  { ack: number[] }    drop changes the app has applied
 *   DELETE                      remove the copy and the queue (connector turned off)
 *   GET ?check=1                only reports whether the server is set up
 */

const MAX_BYTES = 4_000_000;

async function auth(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return validToken(token) ? hashToken(token) : null;
}

function failure(e: unknown) {
  if (e instanceof NotConfigured) return fail(e.message, 503);
  return fail(e instanceof Error ? e.message : "Server error.", 502);
}

export async function GET(req: Request) {
  if (new URL(req.url).searchParams.has("check")) return NextResponse.json({ configured: supabaseConfigured() });
  const hash = await auth(req);
  if (!hash) return fail("Missing or malformed connector token.", 401);
  try {
    return NextResponse.json({ actions: await listActions(hash) });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  const hash = await auth(req);
  if (!hash) return fail("Missing or malformed connector token.", 401);
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return fail("The data is too large to sync.", 413);
  let body: { state?: AppState; timezone?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("Bad request.", 400);
  }
  const s = body.state;
  if (!s || !Array.isArray(s.goals) || !Array.isArray(s.routines)) return fail("That is not Where MyLife data.", 400);
  // Defence in depth: the browser strips these already, but secrets must never be stored here
  const state: AppState = { ...s, settings: { ...s.settings, apiKey: "", mcp: (s.settings?.mcp ?? []).map((m) => ({ ...m, token: "" })), connector: undefined } };
  try {
    await saveSnapshot(hash, state, typeof body.timezone === "string" ? body.timezone.slice(0, 64) : "UTC");
    return NextResponse.json({ ok: true, at: new Date().toISOString() });
  } catch (e) {
    return failure(e);
  }
}

export async function PATCH(req: Request) {
  const hash = await auth(req);
  if (!hash) return fail("Missing or malformed connector token.", 401);
  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.ack) ? body.ack.filter((n: unknown) => Number.isInteger(n)) : [];
  try {
    await ackActions(hash, ids);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(req: Request) {
  const hash = await auth(req);
  if (!hash) return fail("Missing or malformed connector token.", 401);
  try {
    await deleteSnapshot(hash);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
