import { NextResponse } from "next/server";
import { withUser } from "@/lib/server/http";
import { applyForUser, undoLast } from "@/lib/server/state";
import { needsServerCopy, type Op } from "@/lib/ops";

export const runtime = "nodejs";

/**
 * Apply one change for the signed-in user.
 *   POST { op, requestId, actor? }  -> { state, version }
 *   POST { undo: true }             -> { state, version, undone }
 * The op is re-applied to the server's latest copy with the same rules as everywhere else.
 */
export async function POST(req: Request) {
  return withUser(async (user) => {
    const body = (await req.json().catch(() => null)) as { op?: Op; requestId?: string; actor?: string; undo?: boolean; baseVersion?: number; now?: string } | null;
    if (!body) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    // The browser can speak as the person or as their in-app assistant, never as Claude
    const actor = body.actor === "assistant" ? "assistant" : "web";
    if (body.undo) return NextResponse.json(await undoLast(user.id, actor));
    if (!body.op || typeof body.op.type !== "string") return NextResponse.json({ error: "No change given." }, { status: 400 });
    const requestId = typeof body.requestId === "string" ? body.requestId.slice(0, 80) : undefined;
    const r = await applyForUser(user.id, body.op, actor, requestId, typeof body.now === "string" ? body.now : undefined);
    // The browser already shows this change. Send the whole copy back only when the server's result can
    // differ (re-planning makes new ids), when someone else saved in between, or on a repeated request.
    const same = typeof body.baseVersion === "number" && r.version === body.baseVersion + 1 && !r.duplicate && !needsServerCopy(body.op);
    return NextResponse.json(same ? { version: r.version } : r);
  });
}
