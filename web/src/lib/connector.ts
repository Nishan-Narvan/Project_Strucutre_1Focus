import type { AppState } from "./types";

/** Browser side of the claude.ai connector: the secret token and what gets sent to the server. */

/** 32 random bytes as URL-safe base64: 43 characters, impossible to guess. */
export function newConnectorToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const connectorUrl = (origin: string, token: string) => `${origin}/api/connector/${token}/mcp`;

/** The data as it may leave the browser: no model key, no connection tokens, no connector secret. */
export function syncPayload(state: AppState): AppState {
  return {
    ...state,
    settings: {
      ...state.settings,
      apiKey: "",
      mcp: (state.settings.mcp ?? []).map((m) => ({ ...m, token: "" })),
      connector: undefined,
    },
  };
}

export const browserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** claude.ai reaches connectors from Anthropic's servers, so a local address can never work. */
export const isLocalOrigin = (origin: string) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.)/i.test(origin);
