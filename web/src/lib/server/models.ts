import "server-only";
import { rankModels } from "@/lib/providers";
import type { ProviderId } from "@/lib/types";

/** Listing a provider's models and finding the best one that really answers. Server only: holds the key. */

export type Failure = { error: string; status: number };

/** Pull a readable message out of whatever error shape the provider returned. */
export function errorText(raw: string, status: number): string {
  try {
    const j = JSON.parse(raw);
    const e = Array.isArray(j) ? j[0]?.error : j.error;
    const m = typeof e === "string" ? e : e?.message ?? j.message;
    if (m) return String(m).slice(0, 400);
  } catch {}
  return raw.slice(0, 200) || `The provider answered with status ${status}.`;
}

const authHeaders = (key: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${key}` });

export async function listModels(provider: ProviderId, base: string, key: string): Promise<{ models: string[] } | Failure> {
  // OpenRouter's model list is public, so the key has to be checked on its own endpoint
  if (provider === "openrouter") {
    const k = await fetch(`${base}/key`, { headers: authHeaders(key), redirect: "error", signal: AbortSignal.timeout(15000) });
    if (k.status === 401 || k.status === 403) return { error: errorText(await k.text(), k.status), status: 401 };
  }
  // Anthropic lists models on its native API, which takes the key in its own header
  const h = provider === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : authHeaders(key);
  // Redirects are refused throughout, so a public address cannot bounce the request somewhere private
  const r = await fetch(`${base}/models`, { headers: h, redirect: "error", signal: AbortSignal.timeout(15000) });
  const raw = await r.text();
  if (!r.ok) return { error: errorText(raw, r.status), status: r.status };
  const data = JSON.parse(raw);
  const list: unknown[] = Array.isArray(data) ? data : data.data ?? data.models ?? [];
  const models = list
    .map((m) => (typeof m === "string" ? m : String((m as { id?: string; name?: string }).id ?? (m as { name?: string }).name ?? "")))
    .map((id) => id.replace(/^models\//, ""))
    .filter(Boolean)
    .sort();
  return { models };
}

export const PROBE_BATCH = 5;
export const PROBE_TOTAL = 10;
export const PROBE_TIMEOUT_MS = 12000;

interface Probe {
  model: string;
  ok: boolean;
  ms: number;
  status: number;
  error?: string;
  cancelled?: boolean;
}

/** One tiny real request. Any 2xx answer counts: the model exists, the key may use it, quota is left. */
async function probe(base: string, key: string, model: string, stop: AbortSignal): Promise<Probe> {
  const t0 = Date.now();
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with the single word: ok" }] }),
      redirect: "error",
      signal: AbortSignal.any([stop, AbortSignal.timeout(PROBE_TIMEOUT_MS)]),
    });
    const raw = await r.text();
    return { model, ok: r.ok, ms: Date.now() - t0, status: r.status, ...(r.ok ? {} : { error: errorText(raw, r.status) }) };
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return { model, ok: false, ms: Date.now() - t0, status: 0, error: timedOut ? `no answer within ${PROBE_TIMEOUT_MS / 1000} seconds` : "request failed", cancelled: stop.aborted };
  }
}

/**
 * Connect in one request: list the models, rank them, and send the top few a tiny real message at
 * the same time. The highest-ranked one that answers wins and the slower, lower-ranked ones are
 * cancelled. Among the fallbacks, models that answered come first; ones that failed are left out.
 */
export async function connectBest(
  provider: ProviderId,
  base: string,
  key: string,
  current = "",
): Promise<{ model: string; ms: number; fallbacks: string[]; models: string[]; tried: number } | Failure> {
  const listed = await listModels(provider, base, key);
  if ("error" in listed) return listed;
  let ranked = rankModels(provider, listed.models);
  // A model the person chose on purpose is tried first
  if (current && listed.models.includes(current)) ranked = [current, ...ranked.filter((m) => m !== current)];
  if (!ranked.length) return { error: "The key works, but this provider listed no chat models for it.", status: 422 };

  const tried: Probe[] = [];
  for (let start = 0; start < Math.min(ranked.length, PROBE_TOTAL); start += PROBE_BATCH) {
    const stop = new AbortController();
    const runs = ranked.slice(start, start + PROBE_BATCH).map((m) => probe(base, key, m, stop.signal));
    // Awaited in rank order while all run at once: the first success is the best model that works
    for (const run of runs) {
      const r = await run;
      tried.push(r);
      if (r.status === 401 || r.status === 403) {
        stop.abort();
        return { error: r.error || "The provider rejected the API key.", status: r.status };
      }
      if (r.ok) {
        // Whatever already finished in this batch tells us which fallbacks work; the rest are cancelled
        stop.abort();
        const settled = await Promise.all(runs);
        const works = new Set(settled.filter((t) => t.ok).map((t) => t.model));
        const failed = new Set([...tried, ...settled].filter((t) => !t.ok && !t.cancelled).map((t) => t.model));
        const fallbacks = ranked
          .filter((m) => m !== r.model && !failed.has(m))
          .sort((x, y) => Number(works.has(y)) - Number(works.has(x)))
          .slice(0, 4);
        return { model: r.model, ms: r.ms, fallbacks, models: listed.models, tried: settled.length + start };
      }
    }
  }
  const last = tried[tried.length - 1];
  return { error: `The key works, but none of the ${tried.length} models tried answered. Last one, ${last.model}: ${last.error}`, status: last.status || 502 };
}
