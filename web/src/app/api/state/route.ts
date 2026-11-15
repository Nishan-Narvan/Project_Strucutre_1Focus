import { NextResponse } from "next/server";
import { withUser } from "@/lib/server/http";
import { createState, loadState, supabaseConfigured } from "@/lib/server/supabase";
import { updateSecrets } from "@/lib/server/secrets";
import { applyForUser } from "@/lib/server/state";
import { createDemoState } from "@/lib/demo";
import { emptyState, normalizeState } from "@/lib/ops";
import type { AppState } from "@/lib/types";

export const runtime = "nodejs";

/**
 * The signed-in user's data.
 *   GET                       -> { state, version, user } | { needsSetup: true, user } | 401
 *   GET ?since=<version>      -> { unchanged: true, user } when nothing changed (cheap polling)
 *   POST { mode, state? }     -> create the account's data once: "import" (from this browser), "demo" or "empty"
 */

export async function GET(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: "Accounts are not set up on this server yet.", configured: false }, { status: 503 });
  return withUser(async (user) => {
    const row = await loadState(user.id);
    if (!row) return NextResponse.json({ needsSetup: true, user });
    const since = Number(new URL(req.url).searchParams.get("since"));
    if (since && since === row.version) return NextResponse.json({ unchanged: true, version: row.version, user });
    return NextResponse.json({ state: row.state, version: row.version, user });
  });
}

const MAX_BYTES = 5_000_000;

export async function POST(req: Request) {
  return withUser(async (user) => {
    const raw = await req.text();
    if (raw.length > MAX_BYTES) return NextResponse.json({ error: "That data is too large to import." }, { status: 413 });
    const body = JSON.parse(raw || "{}") as { mode?: string; state?: AppState; timezone?: string };

    let state: AppState;
    if (body.mode === "import") {
      if (!body.state || !Array.isArray(body.state.goals)) return NextResponse.json({ error: "That is not Where MyLife data." }, { status: 400 });
      state = normalizeState(body.state);
      // Keys saved in the browser move into the encrypted store, so they never need entering again
      const s = body.state.settings;
      if (s?.apiKey || s?.mcp?.some((m) => m.token)) {
        await updateSecrets(user.id, (sec) => ({
          ...sec,
          ...(s.apiKey ? { model: { provider: s.provider, apiKey: s.apiKey, baseUrl: s.baseUrl } } : {}),
          mcp: { ...sec.mcp, ...Object.fromEntries((s.mcp ?? []).filter((m) => m.token).map((m) => [m.id, m.token])) },
        }));
        state.settings = {
          ...state.settings,
          ...(s.apiKey ? { keySaved: true, keyProvider: s.provider, keyLast4: s.apiKey.slice(-4) } : {}),
          mcp: state.settings.mcp.map((m) => ({ ...m, hasToken: Boolean(s.mcp?.find((x) => x.id === m.id)?.token) })),
        };
      }
    } else if (body.mode === "demo") {
      state = normalizeState(createDemoState());
    } else if (body.mode === "empty") {
      state = emptyState();
    } else {
      return NextResponse.json({ error: "Choose import, demo or empty." }, { status: 400 });
    }
    if (typeof body.timezone === "string") state.settings.timezone = body.timezone.slice(0, 64);

    const created = await createState(user.id, state);
    if (!created) return NextResponse.json({ error: "This account already has data, so nothing was replaced." }, { status: 409 });
    const row = await loadState(user.id);
    return NextResponse.json({ state: row?.state ?? state, version: row?.version ?? 1, user });
  });
}

/** Keep the server's idea of the person's time zone current (they may travel). */
export async function PATCH(req: Request) {
  return withUser(async (user) => {
    const { timezone } = (await req.json().catch(() => ({}))) as { timezone?: string };
    if (typeof timezone !== "string" || !timezone) return NextResponse.json({ error: "No time zone." }, { status: 400 });
    const r = await applyForUser(user.id, { type: "save_settings", patch: { timezone: timezone.slice(0, 64) } }, "web");
    return NextResponse.json({ version: r.version });
  });
}
