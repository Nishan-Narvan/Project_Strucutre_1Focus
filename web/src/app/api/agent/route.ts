import { NextResponse } from "next/server";
import { PROVIDERS } from "@/lib/providers";
import { connectBest, errorText, listModels } from "@/lib/server/models";
import { fail, publicHttpsUrl } from "@/lib/server/net";
import { currentUser } from "@/lib/server/auth";
import { loadSecrets, type Secrets } from "@/lib/server/secrets";
import type { ProviderId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Relay between the signed-in user and their model provider. The key is the one saved (encrypted)
 * for the account; a request may carry an explicit key only to test a new one before it is saved.
 * Keys are never logged.
 *   { action: "models", provider, apiKey?, baseUrl? }                    -> { models: string[] }
 *   { action: "connect", provider, apiKey?, baseUrl?, current? }          -> { model, ms, fallbacks, models }
 *   { action: "chat", provider, apiKey?, baseUrl?, model, messages, tools? } -> { message }
 */

function baseFor(provider: ProviderId, baseUrl: unknown): string | null {
  if (provider !== "custom") return PROVIDERS[provider].base;
  return publicHttpsUrl(baseUrl)?.toString().replace(/\/+$/, "") ?? null;
}


export async function POST(req: Request) {
  const user = await currentUser().catch(() => null);
  if (!user) return fail("You are signed out. Sign in again.", 401);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return fail("Bad request.", 400);
  const { action, provider, apiKey, model, messages, tools, current } = body as Record<string, unknown>;
  let { baseUrl } = body as Record<string, unknown>;

  if (typeof provider !== "string" || !Object.hasOwn(PROVIDERS, provider)) return fail("Unknown provider.", 400);
  let key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) {
    const saved = (await loadSecrets(user.id).catch(() => ({}) as Secrets)).model;
    if (!saved) return fail("No API key is saved. Connect a model in Settings.", 400);
    if (saved.provider !== provider) return fail(`The saved key is for ${PROVIDERS[saved.provider].label}, not ${PROVIDERS[provider as ProviderId].label}. Connect again in Settings.`, 400);
    key = saved.apiKey;
    baseUrl = baseUrl || saved.baseUrl;
  }
  const base = baseFor(provider as ProviderId, baseUrl);
  if (!base) return fail("The custom base URL must be a public https address.", 400);

  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };

  try {
    if (action === "models") {
      const listed = await listModels(provider as ProviderId, base, key);
      return "error" in listed ? fail(listed.error, listed.status) : NextResponse.json({ models: listed.models });
    }

    if (action === "connect") {
      const r = await connectBest(provider as ProviderId, base, key, typeof current === "string" ? current : "");
      return "error" in r ? fail(r.error, r.status) : NextResponse.json(r);
    }

    if (action === "chat") {
      if (typeof model !== "string" || !model) return fail("Pick a model in Settings first.", 400);
      if (!Array.isArray(messages) || messages.length === 0) return fail("Nothing to send.", 400);
      // No sampling settings are sent: some models reject anything but their defaults
      const payload: Record<string, unknown> = { model, messages };
      if (Array.isArray(tools) && tools.length) {
        payload.tools = tools;
        payload.tool_choice = "auto";
      }
      const r = await fetch(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(55000) });
      const raw = await r.text();
      if (!r.ok) {
        const error = errorText(raw, r.status);
        // Shown in the server console so a failing provider can be diagnosed. Never includes the key.
        console.warn(`[agent] ${provider} ${model} answered ${r.status}: ${error}`);
        // How long the provider asks us to wait, from the header or from its message ("retry in 23.5s")
        const wait = Number(r.headers.get("retry-after")) || Number(error.match(/retry in (\d+(?:\.\d+)?)\s*s/i)?.[1]) || undefined;
        return NextResponse.json({ error, ...(wait ? { retryAfter: Math.ceil(wait) } : {}) }, { status: r.status });
      }
      const message = JSON.parse(raw)?.choices?.[0]?.message;
      if (!message) return fail("The model sent back an empty reply.", 502);
      return NextResponse.json({ message });
    }

    return fail("Unknown action.", 400);
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return fail(timedOut ? "The provider took too long to answer. Try again." : "Could not reach the provider.", 502);
  }
}

