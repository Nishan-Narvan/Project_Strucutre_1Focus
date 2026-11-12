"use client";

import { useEffect, useState } from "react";

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.)/i.test(url);

/** Settings section: let claude.ai, on the person's own Claude plan, work with their data as a custom connector. */
export function ClaudeConnector() {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/connector")
      .then((r) => r.json())
      .then((d) => setUrl(d.url ?? null))
      .catch(() => setUrl(null));
  }, []);

  async function call(method: "POST" | "DELETE", done: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/connector", { method }).catch(() => null);
    const d = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) return setMsg({ text: d?.error || "That did not work. Try again.", bad: true });
    setUrl(d.url ?? null);
    setMsg({ text: done });
  }

  return (
    <section className="card space-y-5" aria-labelledby="claude-title">
      <div>
        <h2 id="claude-title" className="text-base font-medium">Use with Claude on your Claude plan</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Add Where MyLife as a custom connector in claude.ai. Claude, on your Pro or Max plan, can then read your goals, progress, patterns and notes,
          and make changes you ask for. Changes apply at once and show here within a few seconds.
        </p>
      </div>

      {url === undefined ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !url ? (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => call("POST", "Connector URL made. Add it in claude.ai.")}>
          Turn on and make my connector URL
        </button>
      ) : (
        <>
          <div>
            <label className="label" htmlFor="claude-url">Your connector URL</label>
            <div className="flex gap-2">
              <input id="claude-url" readOnly className="input font-mono text-xs" value={url} onFocus={(e) => e.target.select()} />
              <button
                type="button"
                className="btn shrink-0"
                onClick={async () => {
                  await navigator.clipboard.writeText(url).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted">Treat it like a password: anyone with this URL can read and change your goals.</p>
          </div>

          {isLocal(url) && (
            <p className="rounded-lg border border-line px-3 py-2 text-sm text-muted">
              This is a local address. claude.ai connects from Anthropic&apos;s servers and cannot reach your computer, so use the URL from the deployed app instead.
            </p>
          )}

          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
            <li>In claude.ai open Settings, then Connectors, then Add custom connector.</li>
            <li>Name it Where MyLife, paste the URL above, leave the advanced settings empty, and add it.</li>
            <li>In a chat, turn the connector on from the tools menu and ask &quot;Where am I with my goals?&quot;</li>
          </ol>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" disabled={busy} onClick={() => call("POST", "New URL made; the old one stopped working. Update the connector in claude.ai.")}>
              Make a new URL
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => call("DELETE", "Turned off. The URL no longer works.")}>
              Turn off
            </button>
          </div>
        </>
      )}

      {msg && <p className={`text-sm ${msg.bad ? "text-bad" : "text-muted"}`} role="status">{msg.text}</p>}
    </section>
  );
}
