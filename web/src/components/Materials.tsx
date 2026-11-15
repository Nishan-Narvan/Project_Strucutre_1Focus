"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { uid } from "@/lib/date";
import { checkMaterialUrl, detectKind, isLocalPath, MATERIAL_LABEL, materialsFor, placeOf, titleFromUrl } from "@/lib/materials";
import type { Goal, Material } from "@/lib/types";

/** One material: opens web links in a new tab; local paths are shown with a copy button. */
function Item({ goal: g, m, showPlace }: { goal: Goal; m: Material; showPlace: boolean }) {
  const { apply } = useStore();
  const [copied, setCopied] = useState(false);
  const local = isLocalPath(m.url);
  return (
    <li className="flex items-start gap-3 py-2.5 text-sm">
      <span className="mt-0.5 shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{MATERIAL_LABEL[m.kind]}</span>
      <div className="min-w-0 flex-1">
        {local ? (
          <span className="break-all text-ink">{m.title}</span>
        ) : (
          <a href={m.url} target="_blank" rel="noreferrer" className="break-all text-ink underline decoration-faint underline-offset-2 hover:decoration-ink">{m.title}</a>
        )}
        <p className="truncate text-xs text-faint" title={m.url}>
          {local ? m.url : new URL(m.url).hostname}
          {showPlace && <> · for {placeOf(g, m)}</>}
          {m.note && <> · {m.note}</>}
        </p>
      </div>
      {local && (
        <button
          type="button"
          className="shrink-0 text-xs text-muted hover:text-ink"
          onClick={async () => {
            await navigator.clipboard.writeText(m.url).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "Copied" : "Copy path"}
        </button>
      )}
      <button type="button" className="shrink-0 text-xs text-faint hover:text-bad" onClick={() => apply({ type: "remove_material", goalId: g.id, materialId: m.id })} aria-label={`Unlink ${m.title}`}>
        Unlink
      </button>
    </li>
  );
}

/**
 * Materials for a goal, or for one phase (with its tasks). Paste any link or file path:
 * Notion, Google Drive files and folders, docs, PDFs, videos, repos, or a file on this computer.
 */
export function MaterialsPanel({ goal: g, phaseId }: { goal: Goal; phaseId?: string }) {
  const { apply } = useStore();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [place, setPlace] = useState(phaseId ? `p:${phaseId}` : "");
  const [msg, setMsg] = useState("");
  const list = materialsFor(g, phaseId ? { phaseId } : {});
  const phases = phaseId ? g.roadmap.modules.filter((m) => m.id === phaseId) : g.roadmap.modules;

  function add(e: React.FormEvent) {
    e.preventDefault();
    const bad = checkMaterialUrl(url);
    if (bad) return setMsg(bad);
    const [kind, ref] = place.split(":");
    const owner = kind === "t" ? g.roadmap.modules.find((m) => m.tasks.some((t) => t.id === ref)) : undefined;
    const material: Material = {
      id: uid() + uid(),
      url: url.trim(),
      title: title.trim() || titleFromUrl(url),
      kind: detectKind(url),
      addedAt: new Date().toISOString(),
      ...(kind === "p" ? { phaseId: ref } : kind === "t" ? { taskId: ref, phaseId: owner?.id } : {}),
    };
    const error = apply({ type: "add_material", goalId: g.id, material });
    if (error) return setMsg(error);
    setUrl("");
    setTitle("");
    setMsg("");
  }

  return (
    <section className="card" aria-label="Materials">
      <h2 className="text-base font-medium">Materials</h2>
      <p className="mt-1 text-sm text-muted">
        What already exists for this {phaseId ? "phase" : "goal"}: Notion pages, Drive folders, docs, PDFs, videos, or files on your computer. The assistant and Claude can see these and open the ones they have access to.
      </p>
      {list.length > 0 && <ul className="mt-3 divide-y divide-line border-y border-line">{list.map((m) => <Item key={m.id} goal={g} m={m} showPlace={!phaseId} />)}</ul>}
      <form onSubmit={add} className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a link or a file path: https://notion.so/…, drive.google.com/…, D:/Notes/trees.pdf" aria-label="Link or file path" />
        <button className="btn btn-primary" disabled={!url.trim()}>Add</button>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={url.trim() ? `Name (default: ${titleFromUrl(url)})` : "Name (optional)"} aria-label="Name" />
        <select className="input w-auto" value={place} onChange={(e) => setPlace(e.target.value)} aria-label="What it is for">
          {!phaseId && <option value="">Whole goal</option>}
          {phases.map((m) => (
            <optgroup key={m.id} label={`Phase ${g.roadmap.modules.indexOf(m) + 1}: ${m.title}`}>
              <option value={`p:${m.id}`}>This phase</option>
              {m.tasks.map((t) => <option key={t.id} value={`t:${t.id}`}>Task: {t.title}</option>)}
            </optgroup>
          ))}
        </select>
      </form>
      {url.trim() && !msg && <p className="mt-2 text-xs text-muted">Recognised as: {MATERIAL_LABEL[detectKind(url)]}</p>}
      {msg && <p className="mt-2 text-sm text-bad" role="alert">{msg}</p>}
    </section>
  );
}

/** A compact line of materials under one task. */
export function TaskMaterials({ goal: g, taskId }: { goal: Goal; taskId: string }) {
  const list = (g.materials ?? []).filter((m) => m.taskId === taskId);
  if (!list.length) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
      {list.map((m) =>
        isLocalPath(m.url) ? (
          <span key={m.id} className="text-muted" title={m.url}>{MATERIAL_LABEL[m.kind]}: {m.title}</span>
        ) : (
          <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="text-muted underline decoration-faint underline-offset-2 hover:text-ink">{MATERIAL_LABEL[m.kind]}: {m.title}</a>
        ),
      )}
    </p>
  );
}
