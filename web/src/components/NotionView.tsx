"use client";

/* eslint-disable @next/next/no-img-element -- Notion images are short-lived signed links, shown as they are */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { NBlock, NDatabase, NotionDoc, Span } from "@/lib/server/notion";
import type { Goal } from "@/lib/types";

/** Text with Notion's bold, italic, code, strikethrough and links. */
function Rich({ s }: { s: Span[] }) {
  return (
    <>
      {s.map((x, i) => {
        let el: React.ReactNode = x.text;
        if (x.code) el = <code className="rounded bg-panel-2 px-1 py-0.5 text-[0.9em]">{el}</code>;
        if (x.bold) el = <strong className="font-semibold">{el}</strong>;
        if (x.italic) el = <em>{el}</em>;
        if (x.strike) el = <s>{el}</s>;
        if (x.href) el = <a href={x.href} target="_blank" rel="noreferrer" className="underline decoration-faint underline-offset-2 hover:decoration-ink">{el}</a>;
        return <span key={i}>{el}</span>;
      })}
    </>
  );
}

function Table({ db }: { db: NDatabase }) {
  return (
    <div className="my-3">
      <p className="mb-1.5 text-sm font-medium">{db.title}</p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="bg-panel-2 text-left text-xs text-muted">
            <tr>{db.columns.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {db.rows.map((r) => (
              <tr key={r.id}>
                {db.columns.map((c, i) => (
                  <td key={c} className="px-3 py-2 align-top">
                    {i === 0 && r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">{r.cells[c] || "Untitled"}</a> : r.cells[c]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {db.more && <p className="mt-1 text-xs text-muted">Showing the first {db.rows.length} rows; the rest are in Notion.</p>}
    </div>
  );
}

function Blocks({ blocks, open }: { blocks: NBlock[]; open: (id: string) => void }) {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // Consecutive list items become one list
    if (b.type === "bullet" || b.type === "number") {
      const run: NBlock[] = [];
      while (i < blocks.length && blocks[i].type === b.type) run.push(blocks[i++]);
      i--;
      const Tag = b.type === "bullet" ? "ul" : "ol";
      out.push(
        <Tag key={i} className={`my-2 space-y-1 pl-5 ${b.type === "bullet" ? "list-disc" : "list-decimal"}`}>
          {run.map((x, j) => x.type === b.type && <li key={j}><Rich s={x.text} />{x.children && <Blocks blocks={x.children} open={open} />}</li>)}
        </Tag>,
      );
      continue;
    }
    out.push(<One key={i} b={b} open={open} />);
  }
  return <>{out}</>;
}

function One({ b, open }: { b: NBlock; open: (id: string) => void }) {
  switch (b.type) {
    case "heading": {
      const cls = b.level === 1 ? "mt-5 text-2xl font-serif" : b.level === 2 ? "mt-4 text-xl font-serif" : "mt-3 text-base font-medium";
      return (
        <>
          <p className={cls}><Rich s={b.text} /></p>
          {b.children && <Blocks blocks={b.children} open={open} />}
        </>
      );
    }
    case "paragraph":
      return b.text.length || b.children ? <div className="my-1.5 leading-relaxed"><Rich s={b.text} />{b.children && <div className="pl-4"><Blocks blocks={b.children} open={open} /></div>}</div> : <div className="h-3" />;
    case "quote":
      return <blockquote className="my-2 border-l-2 border-ink pl-3 text-ink/85"><Rich s={b.text} />{b.children && <Blocks blocks={b.children} open={open} />}</blockquote>;
    case "callout":
      return <div className="my-2 flex gap-2 rounded-lg bg-panel-2 px-3 py-2.5"><span>{b.icon ?? "💡"}</span><div className="min-w-0"><Rich s={b.text} />{b.children && <Blocks blocks={b.children} open={open} />}</div></div>;
    case "todo":
      return (
        <div className="my-1 flex gap-2">
          <span aria-hidden className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] ${b.checked ? "border-ink bg-ink text-on-ink" : "border-faint"}`}>{b.checked ? "✓" : ""}</span>
          <div className={b.checked ? "text-muted line-through" : ""}><Rich s={b.text} />{b.children && <Blocks blocks={b.children} open={open} />}</div>
        </div>
      );
    case "toggle":
      return <details className="my-1.5"><summary className="cursor-pointer"><Rich s={b.text} /></summary><div className="pl-5">{b.children && <Blocks blocks={b.children} open={open} />}</div></details>;
    case "code":
      return <pre className="my-2 overflow-x-auto rounded-lg bg-panel-2 p-3 text-[13px]"><code>{b.text}</code></pre>;
    case "image":
      return b.url ? (
        <figure className="my-3">
          <img src={b.url} alt={b.caption.map((x) => x.text).join("") || "Image from Notion"} className="max-h-[480px] rounded-lg border border-line" loading="lazy" />
          {b.caption.length > 0 && <figcaption className="mt-1 text-xs text-muted"><Rich s={b.caption} /></figcaption>}
        </figure>
      ) : null;
    case "link":
      return <p className="my-1.5"><a href={b.url} target="_blank" rel="noreferrer" className="underline decoration-faint underline-offset-2 hover:decoration-ink">{b.label}</a></p>;
    case "divider":
      return <hr className="my-4 border-line" />;
    case "table":
      return (
        <div className="my-3 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {b.rows.map((r, i) => (
                <tr key={i} className={i === 0 && b.header ? "bg-panel-2 font-medium" : ""}>
                  {r.map((c, j) => <td key={j} className="px-3 py-2 align-top"><Rich s={c} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "columns":
      return <div className="my-2 grid gap-4 md:grid-flow-col md:auto-cols-fr">{b.columns.map((c, i) => <div key={i} className="min-w-0"><Blocks blocks={c} open={open} /></div>)}</div>;
    case "child_page":
      return <button type="button" className="my-1 block text-left underline decoration-faint underline-offset-2 hover:decoration-ink" onClick={() => open(b.id)}>📄 {b.title}</button>;
    case "database":
      return <Table db={b.db} />;
    default:
      return null;
  }
}

/** One Notion page or database, read live through the person's Notion connection. */
export function NotionView({ url, title }: { url: string; title: string }) {
  const [trail, setTrail] = useState<string[]>([url]);
  const [doc, setDoc] = useState<NotionDoc | null>(null);
  const [error, setError] = useState<{ text: string; setup?: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const current = trail[trail.length - 1];

  const load = useCallback(async (link: string, fresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/notion?url=${encodeURIComponent(link)}${fresh ? "&fresh=1" : ""}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError({ text: data.error || "Could not read Notion.", setup: data.needsSetup });
      else setDoc(data.doc);
    } catch {
      setError({ text: "Could not reach the app's server." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(current);
  }, [current, load]);

  return (
    <details open className="card p-0">
      <summary className="flex cursor-pointer items-center gap-3 p-4">
        <span className="min-w-0 flex-1 truncate text-base font-medium">{doc?.icon ? `${doc.icon} ` : ""}{doc?.title ?? title}</span>
        <span className="shrink-0 text-xs text-muted">Notion</span>
      </summary>
      <div className="border-t border-line px-4 pb-4">
        <div className="flex flex-wrap items-center gap-3 pt-3 text-xs text-muted">
          {trail.length > 1 && <button type="button" className="hover:text-ink" onClick={() => setTrail((t) => t.slice(0, -1))}>← Back</button>}
          <button type="button" className="hover:text-ink" onClick={() => load(current, true)} disabled={loading}>{loading ? "Loading…" : "Refresh from Notion"}</button>
          {doc?.url && <a href={doc.url} target="_blank" rel="noreferrer" className="hover:text-ink">Open in Notion</a>}
        </div>
        {error ? (
          <p className="mt-3 text-sm text-bad">
            {error.text} {error.setup && <Link href="/settings" className="text-ink underline">Connect Notion</Link>}
          </p>
        ) : !doc ? (
          <p className="mt-3 text-sm text-muted">Reading from Notion…</p>
        ) : doc.kind === "database" ? (
          <Table db={doc.db} />
        ) : (
          <div className="mt-2 text-[15px]">
            {doc.cover && <img src={doc.cover} alt="" className="mb-3 h-32 w-full rounded-lg object-cover" />}
            {doc.properties.length > 0 && (
              <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {doc.properties.map((p) => (
                  <div key={p.name} className="contents">
                    <dt className="text-muted">{p.name}</dt>
                    <dd>{p.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <Blocks blocks={doc.blocks} open={(id) => setTrail((t) => [...t, id])} />
            {doc.truncated && <p className="mt-3 text-xs text-muted">This page is long; the rest is in Notion.</p>}
          </div>
        )}
      </div>
    </details>
  );
}

/** Notion pages linked to a goal (whole goal) or to one phase, shown in full. */
export function NotionNotes({ goal: g, phaseId }: { goal: Goal; phaseId?: string }) {
  const pages = (g.materials ?? []).filter((m) => m.kind === "notion" && (phaseId ? m.phaseId === phaseId && !m.taskId : !m.phaseId && !m.taskId));
  if (!pages.length) return null;
  return (
    <section aria-label="Notes from Notion" className="space-y-3">
      <h2 className="text-base font-medium">Notes from Notion</h2>
      {pages.map((m) => <NotionView key={m.id} url={m.url} title={m.title} />)}
    </section>
  );
}

/** Settings: connect Notion with one integration secret. */
export function NotionSettings() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/notion?status=1").then((r) => r.json()).then((d) => setConnected(Boolean(d.connected))).catch(() => setConnected(false));
  }, []);

  return (
    <section className="card space-y-4" aria-labelledby="notion-title">
      <div>
        <h2 id="notion-title" className="text-base font-medium">Notion</h2>
        <p className="mt-1 text-sm text-muted">Show your Notion notes, tables and images right inside a goal or phase, always up to date. The assistant and Claude can read them too.</p>
      </div>
      {connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">Connected.</span>
          <button type="button" className="btn" onClick={async () => { await fetch("/api/notion", { method: "DELETE" }); setConnected(false); setMsg({ text: "Notion disconnected." }); }}>Disconnect</button>
        </div>
      ) : (
        <>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
            <li>Open <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer" className="text-ink underline">notion.so/profile/integrations</a>, create a new internal integration, and copy its secret.</li>
            <li>Paste the secret below.</li>
            <li>In Notion, on each page or database you want here: ••• → Connections → add your integration. Sub-pages are included.</li>
          </ol>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMsg(null);
              const res = await fetch("/api/notion", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
              const d = await res.json().catch(() => ({}));
              setBusy(false);
              if (!res.ok) return setMsg({ text: d.error || "That did not work.", bad: true });
              setConnected(true);
              setToken("");
              setMsg({ text: `Connected as ${d.name}. Saved encrypted. Now link Notion pages to your goals under Materials.` });
            }}
          >
            <input type="password" autoComplete="off" className="input font-mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ntn_…" aria-label="Notion integration secret" />
            <button className="btn btn-primary shrink-0" disabled={busy || !token.trim()}>{busy ? "Checking…" : "Connect"}</button>
          </form>
        </>
      )}
      {msg && <p className={`text-sm ${msg.bad ? "text-bad" : "text-muted"}`} role="status">{msg.text}</p>}
    </section>
  );
}
