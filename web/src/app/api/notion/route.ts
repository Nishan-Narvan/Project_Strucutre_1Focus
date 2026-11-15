import { NextResponse } from "next/server";
import { withUser } from "@/lib/server/http";
import { loadSecrets, updateSecrets } from "@/lib/server/secrets";
import { NotionError, notionMarkdown, readNotionCached } from "@/lib/server/notion";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Notion for the signed-in user, through their own integration secret (saved encrypted).
 *   GET  ?url=<notion link>[&format=md][&fresh=1]  -> the page or database, ready to show (or Markdown)
 *   GET  ?status=1                                  -> { connected }
 *   PUT  { token }                                   -> check the secret against Notion and save it
 *   DELETE                                           -> forget the secret
 */

export async function GET(req: Request) {
  return withUser(async (user) => {
    const q = new URL(req.url).searchParams;
    const token = (await loadSecrets(user.id)).notion;
    if (q.has("status")) return NextResponse.json({ connected: Boolean(token) });
    if (!token) return NextResponse.json({ error: "Connect Notion in Settings first (one integration secret).", needsSetup: true }, { status: 400 });
    const url = q.get("url") ?? "";
    try {
      const doc = await readNotionCached(user.id, token, url, q.has("fresh"));
      return q.get("format") === "md" ? NextResponse.json({ title: doc.title, markdown: notionMarkdown(doc) }) : NextResponse.json({ doc });
    } catch (e) {
      if (e instanceof NotionError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
    }
  });
}

export async function PUT(req: Request) {
  return withUser(async (user) => {
    const { token } = (await req.json().catch(() => ({}))) as { token?: string };
    const t = token?.trim() ?? "";
    if (!/^(secret_|ntn_)[A-Za-z0-9]{20,}$/.test(t)) return NextResponse.json({ error: "That does not look like a Notion integration secret (it starts with ntn_ or secret_)." }, { status: 400 });
    // Prove the secret works before saving it
    const me = await fetch("https://api.notion.com/v1/users/me", { headers: { Authorization: `Bearer ${t}`, "Notion-Version": "2025-09-03" }, signal: AbortSignal.timeout(15000) });
    if (!me.ok) return NextResponse.json({ error: "Notion did not accept that secret." }, { status: 400 });
    const bot = (await me.json().catch(() => ({}))) as { name?: string };
    await updateSecrets(user.id, (s) => ({ ...s, notion: t }));
    return NextResponse.json({ ok: true, name: bot.name ?? "your integration" });
  });
}

export async function DELETE() {
  return withUser(async (user) => {
    await updateSecrets(user.id, (s) => ({ ...s, notion: undefined }));
    return NextResponse.json({ ok: true });
  });
}

