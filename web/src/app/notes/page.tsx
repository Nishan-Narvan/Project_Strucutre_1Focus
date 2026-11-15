"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui";
import { NotionView } from "@/components/NotionView";
import type { NotionHit } from "@/lib/server/notion";

/** Read Notion inside the app: every page and database shared with the integration, searchable. */
export default function NotesPage() {
  return (
    <Suspense>
      <Notes />
    </Suspense>
  );
}

function Notes() {
  const { state } = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("p");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<NotionHit[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/notion?status=1").then((r) => r.json()).then((d) => setConnected(Boolean(d.connected))).catch(() => setConnected(false));
  }, []);

  // Search as the person types, after a short pause; an empty search lists the newest edits
  useEffect(() => {
    if (!connected) return;
    let live = true;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/notion?search=${encodeURIComponent(query.trim())}`).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      if (!live) return;
      if (!res?.ok) return setError(d.error || "Could not search Notion.");
      setError("");
      setHits(d.hits ?? []);
    }, query ? 300 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [connected, query]);

  // Pages already linked to goals come first, with the goal they belong to
  const linked = useMemo(
    () =>
      state.goals.flatMap((g) =>
        (g.materials ?? []).filter((m) => m.kind === "notion").map((m) => ({ url: m.url, title: m.title, goal: g.title })),
      ),
    [state.goals],
  );

  const show = (link: string) => router.push(`/notes?p=${encodeURIComponent(link)}`, { scroll: false });
  const titleFor = (link: string) => hits?.find((h) => h.id === link)?.title ?? linked.find((l) => l.url === link)?.title ?? "Notion";

  if (connected === false)
    return (
      <>
        <PageHeader title="Notes" />
        <div className="card max-w-xl space-y-3">
          <p>Read your Notion pages and databases here, as tables, galleries and boards.</p>
          <p className="text-sm text-muted">Connect Notion once with an integration secret, then share the pages you want with that integration.</p>
          <Link href="/settings" className="btn btn-primary">Connect Notion in Settings</Link>
        </div>
      </>
    );

  return (
    <>
      <PageHeader title="Notes" sub="Your Notion pages and databases, read right here. Always the latest from Notion." />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr] lg:items-start">
        {/* Sub-panel: what there is to read */}
        <nav aria-label="Notion pages" className={`card space-y-4 p-3 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto ${selected ? "hidden lg:block" : ""}`}>
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Notion" aria-label="Search Notion" />
          {linked.length > 0 && !query && (
            <div>
              <p className="mb-1 px-2 text-xs text-faint">Linked to your goals</p>
              <ul>
                {linked.map((l) => (
                  <li key={`${l.goal}-${l.url}`}>
                    <Item active={selected === l.url} onClick={() => show(l.url)} title={l.title} sub={l.goal} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="mb-1 px-2 text-xs text-faint">{query ? "Results" : "Recently edited"}</p>
            {error ? (
              <p className="px-2 text-sm text-bad">{error}</p>
            ) : !hits ? (
              <p className="px-2 text-sm text-muted">Loading…</p>
            ) : !hits.length ? (
              <p className="px-2 text-sm text-muted">{query ? "Nothing found." : "Nothing shared yet. In Notion, open a page → ••• → Connections → add your integration."}</p>
            ) : (
              <ul>
                {hits.map((h) => (
                  <li key={h.id}>
                    <Item active={selected === h.id} onClick={() => show(h.id)} title={`${h.icon ? `${h.icon} ` : ""}${h.title}`} sub={h.kind === "database" ? "Database" : h.edited ? `Edited ${h.edited.slice(0, 10)}` : undefined} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </nav>

        {/* Reading pane */}
        <section className={`card min-w-0 md:p-8 ${selected ? "" : "hidden lg:block"}`} aria-label="Reader">
          {selected ? (
            <>
              <button type="button" className="btn btn-quiet btn-sm -ml-2.5 mb-1 lg:hidden" onClick={() => router.push("/notes")}>← All notes</button>
              <NotionView key={selected} url={selected} title={titleFor(selected)} reader />
            </>
          ) : (
            <p className="py-16 text-center text-muted">Pick a page or database on the left to read it here.</p>
          )}
        </section>
      </div>
    </>
  );
}

function Item({ title, sub, active, onClick }: { title: string; sub?: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} className={`block w-full rounded-[10px] px-2 py-1.5 text-left transition-colors ${active ? "bg-panel-2" : "hover:bg-panel-2/60"}`}>
      <span className={`block truncate text-sm ${active ? "font-medium text-ink" : "text-ink/90"}`}>{title}</span>
      {sub && <span className="block truncate text-xs text-faint">{sub}</span>}
    </button>
  );
}
