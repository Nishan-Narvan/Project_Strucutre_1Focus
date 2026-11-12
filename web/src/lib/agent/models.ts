import type { Settings } from "../types";
import { rankModels } from "../providers";

/** Talking to the model provider through the app's relay, and choosing a model that really works. */

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  [extra: string]: unknown;
}
export interface Msg {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  [extra: string]: unknown;
}
export type CallResult = { ok: true; message: Msg } | { ok: false; status: number; error: string; retryAfter?: number };

type Access = Pick<Settings, "provider" | "apiKey" | "baseUrl">;

const post = async (body: unknown, signal?: AbortSignal) => fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

/** One request to one model. Never throws, except when the caller aborts it. */
export async function chatOnce(access: Access, model: string, messages: Msg[], tools: unknown[] | null, signal?: AbortSignal): Promise<CallResult> {
  let res: Response;
  try {
    res = await post({ action: "chat", provider: access.provider, apiKey: access.apiKey, baseUrl: access.baseUrl, model, messages, ...(tools?.length ? { tools } : {}) }, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    return { ok: false, status: 0, error: "Could not reach the app's server. Check your connection." };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data.error || `Request failed with status ${res.status}.`, retryAfter: data.retryAfter };
  return { ok: true, message: data.message };
}

/** A provider error in words the person can act on. */
export const explain = (status: number, error: string) =>
  status === 401 || status === 403 || /api.?key|unauthori[sz]ed/i.test(error) ? `The provider rejected the API key. Check it in Settings. (${error})`
  : status === 429 ? `The provider's limit for this key was reached. Wait a little and ask again. (${error})`
  : status === 404 ? `The provider does not offer this model to your key. (${error})`
  : status >= 500 ? `The provider is having trouble right now, on every model tried. Try again in a minute. (${error})`
  : error;

export async function listModels(access: Access): Promise<{ models: string[] } | { error: string }> {
  try {
    const res = await post({ action: "models", ...access });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: explain(res.status, data.error || `Request failed with status ${res.status}.`) };
    return { models: data.models ?? [] };
  } catch {
    return { error: "Could not reach the app's server. Check your connection." };
  }
}

const PROBE: Msg[] = [{ role: "user", content: "Reply with the single word: ok" }];
const MAX_PROBES = 6;

/**
 * Find a model that actually answers. A provider's list includes models that are retired,
 * closed to new accounts or out of free quota, so each candidate gets one tiny real request
 * and the first that replies wins. The rest of the ranking is kept as fallbacks.
 */
export async function connectModel(
  access: Access,
  current: string,
  onProgress: (text: string) => void,
): Promise<{ model: string; fallbacks: string[]; models: string[] } | { error: string }> {
  onProgress("Checking the key");
  const listed = await listModels(access);
  if ("error" in listed) return listed;
  let ranked = rankModels(access.provider, listed.models);
  // A model the person chose on purpose is tried first
  if (current && listed.models.includes(current)) ranked = [current, ...ranked.filter((m) => m !== current)];
  if (!ranked.length) return { error: "The key works, but this provider listed no chat models for it." };

  const failed: string[] = [];
  let last = "";
  for (const model of ranked.slice(0, MAX_PROBES)) {
    onProgress(`Testing ${model}`);
    const r = await chatOnce(access, model, PROBE, null);
    if (r.ok) return { model, fallbacks: ranked.filter((m) => m !== model && !failed.includes(m)).slice(0, 4), models: listed.models };
    if (r.status === 401 || r.status === 403) return { error: explain(r.status, r.error) };
    failed.push(model);
    last = `${model}: ${r.error}`;
  }
  return { error: `The key works, but none of the ${failed.length} models tried gave an answer. Last one, ${last}` };
}
