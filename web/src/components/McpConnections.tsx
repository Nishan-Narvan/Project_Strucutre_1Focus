"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { uid } from "@/lib/date";
import { listMcpTools } from "@/lib/agent/tools";
import type { McpServer } from "@/lib/types";

const host = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/** Outside services the assistant can use, each one an MCP server reached by URL. */
export function McpConnections() {
  const { state, saveSettings } = useStore();
  const servers = state.settings.mcp ?? [];
  const [f, setF] = useState({ name: "", url: "", token: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const save = (next: McpServer[]) => saveSettings({ mcp: next });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const url = f.url.trim();
    if (!url) return;
    setBusy("new");
    setMsg(null);
    const r = await listMcpTools(url, f.token.trim());
    setBusy(null);
    if ("error" in r) return setMsg({ text: r.error, bad: true });
    const name = f.name.trim() || host(url);
    save([...servers, { id: uid(), name, url, token: f.token.trim(), enabled: true, tools: r.tools }]);
    setF({ name: "", url: "", token: "" });
    setMsg({ text: `Connected ${name}: ${r.tools.length} tool${r.tools.length === 1 ? "" : "s"} available to the assistant.` });
  }

  async function refresh(s: McpServer) {
    setBusy(s.id);
    setMsg(null);
    const r = await listMcpTools(s.url, s.token);
    setBusy(null);
    if ("error" in r) return setMsg({ text: `${s.name}: ${r.error}`, bad: true });
    save(servers.map((x) => (x.id === s.id ? { ...x, tools: r.tools } : x)));
    setMsg({ text: `${s.name}: ${r.tools.length} tool${r.tools.length === 1 ? "" : "s"}.` });
  }

  return (
    <section className="card space-y-5" aria-labelledby="mcp-title">
      <div>
        <h2 id="mcp-title" className="text-base font-medium">Connections</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Let the assistant use outside services such as Google Calendar and Notion, so it can put your sessions on your calendar or save a roadmap to your notes.
          Each connection is an MCP server: paste its URL, and a token if it needs one.
        </p>
      </div>

      {servers.length > 0 && (
        <ul className="divide-y divide-line border-y border-line">
          {servers.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{s.name}</p>
                <p className="truncate text-xs text-muted" title={s.tools.map((t) => t.name).join(", ")}>
                  {host(s.url)}, {s.tools.length} tool{s.tools.length === 1 ? "" : "s"}{s.tools.length ? `: ${s.tools.slice(0, 4).map((t) => t.name).join(", ")}${s.tools.length > 4 ? "…" : ""}` : ""}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" className="accent-[var(--color-accent)]" checked={s.enabled} onChange={(e) => save(servers.map((x) => (x.id === s.id ? { ...x, enabled: e.target.checked } : x)))} />
                On
              </label>
              <button type="button" className="btn" disabled={busy === s.id} onClick={() => refresh(s)}>{busy === s.id ? "Checking…" : "Refresh tools"}</button>
              <button type="button" className="btn" onClick={() => save(servers.filter((x) => x.id !== s.id))}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="mcp-name">Name</label>
          <input id="mcp-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Google Calendar" />
        </div>
        <div>
          <label className="label" htmlFor="mcp-token">Token, if the server needs one</label>
          <input id="mcp-token" type="password" autoComplete="off" className="input font-mono" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} placeholder="optional" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="mcp-url">Server URL</label>
          <input id="mcp-url" className="input font-mono" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…/mcp" />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button className="btn btn-primary" disabled={busy === "new" || !f.url.trim()}>{busy === "new" ? "Connecting…" : "Add connection"}</button>
          {msg && <span className={`text-sm ${msg.bad ? "text-bad" : "text-muted"}`} role="status">{msg.text}</span>}
        </div>
      </form>

      <ul className="list-disc space-y-1.5 pl-4 text-xs text-muted">
        <li>Works with MCP servers reached by an https URL, with an optional token. A bridge such as Zapier MCP gives you one URL and lets you choose which Google Calendar and Notion actions it offers.</li>
        <li>Servers that need an OAuth sign-in in the browser, such as Notion&apos;s own hosted server, are not supported yet.</li>
        <li>A server URL or token lets its holder act on the accounts behind it. It is kept in this browser and treated like your model key.</li>
        <li>The assistant asks you before it uses any tool that changes something.</li>
      </ul>
    </section>
  );
}
