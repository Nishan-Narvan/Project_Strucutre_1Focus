"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { connectorUrl, isLocalOrigin, newConnectorToken } from "@/lib/connector";

/** Settings section: let claude.ai, on the person's own Claude plan, read this data as a custom connector. */
export function ClaudeConnector() {
  const { state, saveSettings } = useStore();
  const c = state.settings.connector;
  const [origin, setOrigin] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/sync?check=1")
      .then((r) => r.json())
      .then((d) => setConfigured(Boolean(d.configured)))
      .catch(() => setConfigured(false));
  }, []);

  const url = c && origin ? connectorUrl(origin, c.token) : "";
  const local = origin ? isLocalOrigin(origin) : false;

  /** Removes the server copy for a token. Used when turning off and when replacing the URL. */
  async function forget(token: string) {
    const res = await fetch("/api/sync", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    return Boolean(res?.ok);
  }

  async function turnOff() {
    if (!c) return;
    setBusy(true);
    const ok = await forget(c.token);
    setBusy(false);
    saveSettings({ connector: undefined });
    setMsg(ok ? { text: "Turned off. The copy on the server was deleted, so the old URL no longer works." } : { text: "Turned off here, but the server copy could not be deleted. It is no longer updated.", bad: true });
  }

  async function replace() {
    if (!c) return;
    setBusy(true);
    await forget(c.token);
    setBusy(false);
    saveSettings({ connector: { token: newConnectorToken() } });
    setMsg({ text: "New URL made and the old one stopped working. Update the connector in claude.ai with the new URL." });
  }

  return (
    <section className="card space-y-5" aria-labelledby="claude-title">
      <div>
        <h2 id="claude-title" className="text-base font-medium">Use with Claude on your Claude plan</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Add Where MyLife as a custom connector in claude.ai. Then Claude, on your Pro or Max plan, can read your goals, progress, patterns and notes,
          and queue changes such as re-planning a goal. The assistant in this app keeps using your API key.
        </p>
      </div>

      {configured === false && (
        <p className="rounded-lg border border-bad/40 px-3 py-2 text-sm text-bad">
          The server is not connected to Supabase yet, so nothing can be synced. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see web/.env.example), run supabase/migrations/0001_claude_connector.sql once, then reload.
        </p>
      )}

      {!c ? (
        <button type="button" className="btn btn-primary" disabled={!configured} onClick={() => { saveSettings({ connector: { token: newConnectorToken() } }); setMsg(null); }}>
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
            <p className="mt-1.5 text-xs text-muted">
              Treat it like a password: anyone with this URL can read your goals and queue changes.{" "}
              {c.error ? <span className="text-bad">Last sync failed: {c.error}</span> : c.lastSync ? `Last synced ${new Date(c.lastSync).toLocaleString()}.` : "Syncing…"}
            </p>
          </div>

          {local && (
            <p className="rounded-lg border border-line px-3 py-2 text-sm text-muted">
              This is a local address. claude.ai connects from Anthropic&apos;s servers and cannot reach your computer, so use the URL from the deployed app (your Vercel address) instead.
            </p>
          )}

          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
            <li>In claude.ai open Settings, then Connectors, then Add custom connector.</li>
            <li>Name it Where MyLife, paste the URL above, leave the advanced settings empty, and add it.</li>
            <li>In a chat, turn the connector on from the tools menu and ask &quot;Where am I with my goals?&quot;</li>
            <li>Changes Claude makes are applied when this app is next open in your browser.</li>
          </ol>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" disabled={busy} onClick={replace}>Make a new URL</button>
            <button type="button" className="btn" disabled={busy} onClick={turnOff}>Turn off and delete server copy</button>
          </div>
        </>
      )}

      {msg && <p className={`text-sm ${msg.bad ? "text-bad" : "text-muted"}`} role="status">{msg.text}</p>}
    </section>
  );
}
