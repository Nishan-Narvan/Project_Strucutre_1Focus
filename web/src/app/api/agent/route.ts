import { NextResponse } from "next/server";
import { PROVIDERS } from "@/lib/providers";
import { fail, publicHttpsUrl } from "@/lib/server/net";
import type { ProviderId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Thin, stateless relay between the browser and the user's model provider.
 * The key arrives with each request, is used once and is never stored or logged.
 *   { action: "models", provider, apiKey, baseUrl? }                    -> { models: string[] }
 *   { action: "chat", provider, apiKey, baseUrl?, model, messages, tools? } -> { message }
 */

function baseFor(provider: ProviderId, baseUrl: unknown): string | null {
  if (provider !== "custom") return PROVIDERS[provider].base;
  return publicHttpsUrl(baseUrl)?.toString().replace(/\/+$/, "") ?? null;
}

/** Pull a readable message out of whatever error shape the provider returned. */
function errorText(raw: string, status: number): string {
  try {
    const j = JSON.parse(raw);
    const e = Array.isArray(j) ? j[0]?.error : j.error;
    const m = typeof e === "string" ? e : e?.message ?? j.message;
    if (m) return String(m).slice(0, 400);
  } catch {}
  return raw.slice(0, 200) || `The provider answered with status ${status}.`;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return fail("Bad request.", 400);
  const { action, provider, apiKey, baseUrl, model, messages, tools } = body as Record<string, unknown>;

  if (typeof provider !== "string" || !Object.hasOwn(PROVIDERS, provider)) return fail("Unknown provider.", 400);
  if (typeof apiKey !== "string" || !apiKey.trim()) return fail("Add your API key in Settings first.", 400);
  const base = baseFor(provider as ProviderId, baseUrl);
  if (!base) return fail("The custom base URL must be a public https address.", 400);

  const key = apiKey.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };

  try {
    if (action === "models") {
      // OpenRouter's model list is public, so the key has to be checked on its own endpoint
      if (provider === "openrouter") {
        const k = await fetch(`${base}/key`, { headers, redirect: "error", signal: AbortSignal.timeout(20000) });
        if (k.status === 401 || k.status === 403) return fail(errorText(await k.text(), k.status), 401);
      }
      // Anthropic lists models on its native API, which takes the key in its own header
      const h = provider === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : headers;
      // Redirects are refused throughout, so a public address cannot bounce the request somewhere private
      const r = await fetch(`${base}/models`, { headers: h, redirect: "error", signal: AbortSignal.timeout(20000) });
      const raw = await r.text();
      if (!r.ok) return fail(errorText(raw, r.status), r.status);
      const data = JSON.parse(raw);
      const list: unknown[] = Array.isArray(data) ? data : data.data ?? data.models ?? [];
      const models = list
        .map((m) => (typeof m === "string" ? m : String((m as { id?: string; name?: string }).id ?? (m as { name?: string }).name ?? "")))
        .map((id) => id.replace(/^models\//, ""))
        .filter(Boolean)
        .sort();
      return NextResponse.json({ models });
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
