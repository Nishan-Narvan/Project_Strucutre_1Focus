import { NextResponse } from "next/server";
import { withUser } from "@/lib/server/http";
import { loadSecrets, updateSecrets } from "@/lib/server/secrets";
import { applyForUser } from "@/lib/server/state";
import { PROVIDERS } from "@/lib/providers";
import type { ProviderId } from "@/lib/types";

export const runtime = "nodejs";

/**
 * The signed-in user's keys. Saved encrypted; never sent back to the browser.
 *   GET                                         -> { model: { provider, last4 } | null, mcp: string[] }
 *   PUT { kind: "model", provider, apiKey, baseUrl? }
 *   PUT { kind: "mcp", serverId, token }
 *   DELETE { kind: "model" } | { kind: "mcp", serverId }
 */

export async function GET() {
  return withUser(async (user) => {
    const s = await loadSecrets(user.id);
    return NextResponse.json({ model: s.model ? { provider: s.model.provider, last4: s.model.apiKey.slice(-4) } : null, mcp: Object.keys(s.mcp ?? {}) });
  });
}

export async function PUT(req: Request) {
  return withUser(async (user) => {
    const b = (await req.json().catch(() => ({}))) as { kind?: string; provider?: string; apiKey?: string; baseUrl?: string; serverId?: string; token?: string };
    if (b.kind === "model") {
      if (!b.provider || !Object.hasOwn(PROVIDERS, b.provider) || !b.apiKey?.trim()) return NextResponse.json({ error: "Provider and key are required." }, { status: 400 });
      const apiKey = b.apiKey.trim();
      const provider = b.provider as ProviderId;
      await updateSecrets(user.id, (s) => ({ ...s, model: { provider, apiKey, baseUrl: b.baseUrl?.trim() } }));
      const r = await applyForUser(user.id, { type: "save_settings", patch: { keySaved: true, keyProvider: provider, keyLast4: apiKey.slice(-4) } }, "web");
      return NextResponse.json({ ok: true, state: r.state, version: r.version });
    }
    if (b.kind === "mcp") {
      if (!b.serverId) return NextResponse.json({ error: "Which connection?" }, { status: 400 });
      const token = b.token?.trim() ?? "";
      await updateSecrets(user.id, (s) => {
        const mcp = { ...s.mcp };
        if (token) mcp[b.serverId as string] = token;
        else delete mcp[b.serverId as string];
        return { ...s, mcp };
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown kind." }, { status: 400 });
  });
}

export async function DELETE(req: Request) {
  return withUser(async (user) => {
    const b = (await req.json().catch(() => ({}))) as { kind?: string; serverId?: string };
    if (b.kind === "model") {
      await updateSecrets(user.id, (s) => ({ ...s, model: undefined }));
      const r = await applyForUser(user.id, { type: "save_settings", patch: { keySaved: false, keyProvider: undefined, keyLast4: undefined, model: "", fallbacks: [] } }, "web");
      return NextResponse.json({ ok: true, state: r.state, version: r.version });
    }
    if (b.kind === "mcp" && b.serverId) {
      await updateSecrets(user.id, (s) => {
        const mcp = { ...s.mcp };
        delete mcp[b.serverId as string];
        return { ...s, mcp };
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown kind." }, { status: 400 });
  });
}
