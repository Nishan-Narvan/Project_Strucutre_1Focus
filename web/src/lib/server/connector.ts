import "server-only";
import type { Actor } from "./state";

/**
 * Detect which external AI client is connecting:
 * - Google Gemini (via ?client=gemini, x-client: gemini, or user-agent)
 * - Anthropic Claude (via ?client=claude, x-client: claude, or user-agent)
 * - fallback to "claude" for backward compatibility
 */
export function detectActor(req: Request): Actor {
  try {
    const url = new URL(req.url);
    const client = url.searchParams.get("client")?.toLowerCase();
    if (client === "gemini" || client === "google") return "gemini";
    if (client === "claude") return "claude";
    const headerClient = req.headers.get("x-client")?.toLowerCase();
    if (headerClient === "gemini" || headerClient === "google") return "gemini";
    if (headerClient === "claude") return "claude";
    const ua = req.headers.get("user-agent") || "";
    if (/gemini|google/i.test(ua)) return "gemini";
    if (/claude|anthropic/i.test(ua)) return "claude";
  } catch {
    // ignore
  }
  return "claude";
}
