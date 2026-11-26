"use client";

import { useEffect, useState } from "react";

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.)/i.test(url);

export type ConnectorProvider = "gemini" | "claude";

/**
 * Settings section: Connect Where MyLife to Gemini Chat (gemini.google.com / Gemini CLI / Google Workspace)
 * or claude.ai as a remote MCP server.
 */
export function AiConnectors({ initialProvider = "gemini" }: { initialProvider?: ConnectorProvider }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [geminiUrl, setGeminiUrl] = useState<string | null>(null);
  const [claudeUrl, setClaudeUrl] = useState<string | null>(null);
  const [provider, setProvider] = useState<ConnectorProvider>(initialProvider);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/connector")
      .then((r) => r.json())
      .then((d) => {
        const base = d.url ?? null;
        setUrl(base);
        setGeminiUrl(d.geminiUrl ?? (base ? `${base}?client=gemini` : null));
        setClaudeUrl(d.claudeUrl ?? base);
      })
      .catch(() => {
        setUrl(null);
        setGeminiUrl(null);
        setClaudeUrl(null);
      });
  }, []);

  async function call(method: "POST" | "DELETE", done: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/connector", { method }).catch(() => null);
    const d = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) return setMsg({ text: d?.error || "That did not work. Try again.", bad: true });
    const base = d.url ?? null;
    setUrl(base);
    setGeminiUrl(d.geminiUrl ?? (base ? `${base}?client=gemini` : null));
    setClaudeUrl(d.claudeUrl ?? base);
    setMsg({ text: done });
  }

  const activeUrl = provider === "gemini" ? geminiUrl || url : claudeUrl || url;

  return (
    <section className="card space-y-5" aria-labelledby="connectors-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="connectors-title" className="text-base font-medium">Use with Gemini Chat or Claude (MCP)</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Add Where MyLife as a Model Context Protocol (MCP) connector to Google Gemini or Claude. The AI can read your
            goals, roadmaps, study sessions, routines, and notes, and make real-time changes you ask for.
          </p>
        </div>

        {/* Provider switch tabs */}
        <div className="flex self-start rounded-lg border border-line bg-panel-2 p-1" role="tablist" aria-label="AI Connector Provider">
          <button
            type="button"
            role="tab"
            aria-selected={provider === "gemini"}
            onClick={() => setProvider("gemini")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              provider === "gemini" ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            Google Gemini
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={provider === "claude"}
            onClick={() => setProvider("claude")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              provider === "claude" ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            Claude
          </button>
        </div>
      </div>

      {url === undefined ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !url ? (
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => call("POST", "Connector URL generated. Add it to Gemini Chat or Claude.")}
        >
          Turn on and generate connector URL
        </button>
      ) : (
        <>
          <div>
            <div className="flex items-center justify-between">
              <label className="label mb-1" htmlFor="connector-url">
                Your {provider === "gemini" ? "Gemini" : "Claude"} connector URL
              </label>
              <span className="text-[11px] text-faint font-mono">Streamable HTTP MCP</span>
            </div>
            <div className="flex gap-2">
              <input
                id="connector-url"
                readOnly
                className="input font-mono text-xs"
                value={activeUrl ?? ""}
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className="btn shrink-0"
                onClick={async () => {
                  if (activeUrl) {
                    await navigator.clipboard.writeText(activeUrl).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Treat it like a password: anyone with this URL can read and change your goals.
            </p>
          </div>

          {activeUrl && isLocal(activeUrl) && (
            <p className="rounded-lg border border-line px-3 py-2 text-sm text-muted">
              This is a local address ({new URL(activeUrl).host}). External AI services connect from their cloud servers and cannot
              reach your local computer directly. Use the URL from your deployed app or use an HTTPS tunnel (e.g. ngrok / cloudflare) for local testing.
            </p>
          )}

          {provider === "gemini" ? (
            <div className="space-y-3 rounded-xl border border-line/70 bg-panel-2/40 p-3.5 text-sm">
              <div className="font-medium text-ink">How to connect with Google Gemini:</div>

              <div className="space-y-2 text-muted text-xs leading-relaxed">
                <div className="font-semibold text-ink">Option A: In Gemini Web Chat (gemini.google.com)</div>
                <ol className="list-decimal space-y-1 pl-4">
                  <li>Open <strong>gemini.google.com</strong> and go to <strong>Settings</strong> → <strong>Connected Apps</strong> (or Developer Mode).</li>
                  <li>Click <strong>Add Custom App / MCP Server</strong>.</li>
                  <li>Name it <strong>Where MyLife</strong>, paste your connector URL above, and confirm.</li>
                  <li>In your chat, mention <strong>@WhereMyLife</strong> or ask: <em>&quot;Where do I stand with my goals this week?&quot;</em></li>
                </ol>

                <div className="pt-2 font-semibold text-ink">Option B: In Gemini CLI / Terminal</div>
                <p className="pl-1">Register the MCP server with a single command:</p>
                <div className="rounded bg-panel p-2 font-mono text-[11px] text-ink select-all">
                  gemini mcp add where-mylife {activeUrl}
                </div>

                <div className="pt-2 font-semibold text-ink">Try asking Gemini:</div>
                <ul className="list-disc space-y-0.5 pl-4 text-muted">
                  <li><em>&quot;What study sessions and tasks do I have scheduled for today?&quot;</em></li>
                  <li><em>&quot;Where am I with my goals, and am I keeping up with my pace?&quot;</em></li>
                  <li><em>&quot;Create a 4-week roadmap to master TypeScript and add it to my goals.&quot;</em></li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-line/70 bg-panel-2/40 p-3.5 text-sm">
              <div className="font-medium text-ink">How to connect with Claude (claude.ai):</div>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
                <li>In <strong>claude.ai</strong> open <strong>Settings</strong>, then <strong>Connectors</strong>, then <strong>Add custom connector</strong>.</li>
                <li>Name it <strong>Where MyLife</strong>, paste the URL above, leave the advanced settings empty, and add it.</li>
                <li>In a chat, turn the connector on from the tools menu and ask <em>&quot;Where am I with my goals?&quot;</em></li>
              </ol>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => call("POST", "New URL generated; the old one stopped working. Update the connector in your AI app.")}
            >
              Generate new URL
            </button>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              disabled={busy}
              onClick={() => call("DELETE", "Turned off. The URL no longer works.")}
            >
              Turn off
            </button>
          </div>
        </>
      )}

      {msg && <p className={`text-sm ${msg.bad ? "text-bad" : "text-muted"}`} role="status">{msg.text}</p>}
    </section>
  );
}
