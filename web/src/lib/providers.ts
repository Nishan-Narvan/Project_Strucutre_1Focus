import type { ProviderId, Settings } from "./types";

/**
 * Model providers the assistant can talk to. All of them are called through their
 * OpenAI-compatible chat endpoint, so one code path serves every provider.
 * No model ids are hardcoded: the list is read from the provider and each candidate
 * is tested with a real request before it is used (see lib/agent/models.ts).
 */
export const PROVIDERS: Record<ProviderId, { label: string; base: string; keyUrl: string; keyHint: string; prefer: RegExp; avoid: RegExp | null; note: string }> = {
  groq: {
    label: "Groq",
    base: "https://api.groq.com/openai/v1",
    keyUrl: "https://console.groq.com/keys",
    keyHint: "gsk_…",
    prefer: /llama|gpt-oss|qwen|kimi/i,
    avoid: /compound|allam/i,
    note: "Has a free tier. Very fast.",
  },
  gemini: {
    label: "Google Gemini",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyUrl: "https://aistudio.google.com/apikey",
    keyHint: "AIza…",
    prefer: /gemini.*flash/i,
    // Pro models are not on the free tier; Gemma cannot use tools
    avoid: /pro|gemma/i,
    note: "Has a free tier, with daily limits per model.",
  },
  openrouter: {
    label: "OpenRouter",
    base: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
    keyHint: "sk-or-…",
    prefer: /:free/i,
    avoid: null,
    note: "One key for many models, some of them free.",
  },
  openai: {
    label: "OpenAI",
    base: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "sk-…",
    prefer: /^gpt-.*mini/i,
    avoid: /instruct|codex|^o\d|davinci|babbage/i,
    note: "Paid.",
  },
  anthropic: {
    label: "Anthropic (Claude)",
    base: "https://api.anthropic.com/v1",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "sk-ant-…",
    prefer: /haiku/i,
    avoid: null,
    note: "Paid.",
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    base: "",
    keyUrl: "",
    keyHint: "key",
    prefer: /./,
    avoid: null,
    note: "Any https endpoint that speaks the OpenAI chat format.",
  },
};

export const PROVIDER_ORDER: ProviderId[] = ["groq", "gemini", "openrouter", "openai", "anthropic", "custom"];

/** True once a provider, key and model are set, so the assistant can be called. */
export const agentReady = (s: Settings) => Boolean(s.keySaved && s.keyProvider === s.provider && s.model && (s.provider !== "custom" || s.baseUrl));

/** Models that are listed next to chat models but cannot hold a conversation. */
const NOT_CHAT =
  /embed|imagen|image|veo|tts|audio|speech|whisper|transcri|rerank|moderat|guard|aqa|live|realtime|robotics|computer-use|dall-e|sora|lyria|native|search-preview|learnlm|ocr|omni-mod|babbage|davinci|distil|orpheus|playai|nano-banana/i;

/**
 * Order a provider's model list from most to least suitable for the assistant.
 * Only an ordering: the caller still tests each one, because a listed model can be
 * retired, closed to new accounts or out of free quota.
 */
export function rankModels(provider: ProviderId, models: string[]): string[] {
  const P = PROVIDERS[provider];
  const score = (id: string) => {
    let s = 0;
    if (P.prefer.test(id)) s += 100;
    if (P.avoid?.test(id)) s -= 150;
    // Newer generations first: "gemini-3.8-flash" outranks "gemini-2.5-flash"
    const version = id.match(/(\d+(?:\.\d+)?)/);
    if (version) s += Math.min(20, parseFloat(version[1])) * 4;
    if (/latest/i.test(id)) s += 30;
    if (/preview|exp|beta|-\d{4}$|\d{2}-\d{2}/i.test(id)) s -= 25;
    if (/lite|mini|nano|8b|instant|small/i.test(id)) s -= 8;
    return s;
  };
  return models
    .filter((id) => !NOT_CHAT.test(id))
    .map((id) => ({ id, s: score(id) }))
    .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
    .map((x) => x.id);
}
