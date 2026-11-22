"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Goal, SourceType } from "@/lib/types";
import { progress } from "@/lib/schedule";

/** Goal progress segmented by module: width ∝ module size, fill ∝ completion; the current module glows. */
export function ModuleBar({ goal, height = "h-2" }: { goal: Goal; height?: string }) {
  const p = progress(goal);
  return (
    <div className={`flex w-full gap-[3px] ${height}`}>
      {goal.roadmap.modules.map((m, i) => {
        const current = i === p.currentModule && p.modules[i].ratio < 1;
        return (
          <div
            key={m.id}
            title={`${i + 1}. ${m.title}: ${Math.round(p.modules[i].ratio * 100)}%`}
            className={`relative overflow-hidden rounded-full bg-line ${current ? "crystal-ring" : ""}`}
            style={{ flex: p.modules[i].total || 1 }}
          >
            <div className={`absolute inset-y-0 left-0 ${current ? "crystal-dot" : "bg-ink"}`} style={{ width: `${p.modules[i].ratio * 100}%` }} />
          </div>
        );
      })}
    </div>
  );
}

const SOURCE_LABEL: Record<SourceType, string> = {
  reddit: "Reddit",
  youtube: "YouTube",
  docs: "Docs",
  course: "Course",
  article: "Article",
  book: "Book",
  other: "Web",
};

export function SourceBadge({ type }: { type: SourceType }) {
  return <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{SOURCE_LABEL[type] ?? "Web"}</span>;
}

export function CompleteButton({
  done,
  title,
  current,
  onComplete,
  onReopen,
  size = "h-5 w-5",
}: {
  done: boolean;
  title: string;
  current?: boolean;
  onComplete: (note: string) => void;
  onReopen: () => void;
  size?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Reopen ${title}` : `Complete ${title}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (done) onReopen();
          else setOpen(true);
        }}
        className={`grid ${size} shrink-0 place-items-center rounded-full border-2 transition ${
          done ? "border-done bg-done text-on-ink" : current ? "crystal-ring border-crystal" : "border-muted hover:border-done hover:bg-done/15"
        }`}
      >
        {done && (
          <svg viewBox="0 0 16 16" className="h-3 w-3">
            <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      {open && (
        <CompleteDialog
          title={title}
          onCancel={() => setOpen(false)}
          onSave={(note) => {
            setOpen(false);
            onComplete(note);
          }}
        />
      )}
    </>
  );
}

function CompleteDialog({ title, onCancel, onSave }: { title: string; onCancel: () => void; onSave: (note: string) => void }) {
  const [note, setNote] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCancel]);

  return (
    <OnTop>
    <div className="fixed inset-0 z-50 grid place-items-center bg-scrim p-4" onClick={onCancel}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="complete-title"
        className="w-full max-w-md rounded-[14px] border border-line bg-panel p-6 shadow-2xl shadow-black/30"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(note);
        }}
      >
        <h2 id="complete-title" className="font-serif text-2xl leading-tight">
          {title}
        </h2>
        <label htmlFor="note" className="label mt-5">
          What did you learn or make?
        </label>
        <textarea
          id="note"
          ref={ref}
          rows={4}
          className="input resize-none"
          placeholder="A takeaway, a link to your code, or what to revisit"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(note);
          }}
        />
        <p className="mt-2 text-xs text-muted">Saved with today&apos;s date on this task. Optional, but it makes reviews much easier.</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary">Mark complete</button>
        </div>
      </form>
    </div>
    </OnTop>
  );
}

/** Two-step destructive button (no confirm() dialogs). */
export function ConfirmButton({ onConfirm, children, confirmText = "Click again to confirm" }: { onConfirm: () => void; children: React.ReactNode; confirmText?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" className={`btn btn-danger ${armed ? "bg-bad/10" : ""}`} onClick={() => (armed ? onConfirm() : setArmed(true))} onBlur={() => setArmed(false)}>
      {armed ? confirmText : children}
    </button>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-serif text-4xl leading-none tracking-tight">{title}</h1>
        {sub && <div className="mt-2 text-sm text-muted">{sub}</div>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

/** Formats an ISO completion time as "Mon 21 Oct, 20:13". */
export const fmtDoneAt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Deleting or archiving: asks for a second click. */
  danger?: boolean;
  /** Not possible right now: left out of the menu. */
  disabled?: boolean;
}

/** A "⋯" button that opens a short list of less frequent actions. */
export function Menu({ items, label = "More actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setArmed(null);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const shown = items.filter((i) => !i.disabled);
  if (!shown.length) return null;
  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn btn-quiet btn-icon" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden><circle cx="4" cy="10" r="1.6" /><circle cx="10" cy="10" r="1.6" /><circle cx="16" cy="10" r="1.6" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 min-w-48 rounded-xl border border-line bg-bg p-1 shadow-xl shadow-black/30">
          {shown.map((i) => (
            <button
              key={i.label}
              type="button"
              role="menuitem"
              className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-panel-2 ${i.danger ? "text-bad" : "text-ink"}`}
              onClick={() => {
                if (i.danger && armed !== i.label) return setArmed(i.label);
                setOpen(false);
                setArmed(null);
                i.onSelect();
              }}
            >
              {i.danger && armed === i.label ? `Click again to ${i.label.toLowerCase()}` : i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renders pop-ups at the top of the page, so a panel or card around them can never clip or cover them.
 */
export function OnTop({ children }: { children: React.ReactNode }) {
  // Nothing on the server and in the first client pass, so hydration matches
  const client = useSyncExternalStore(noSubscribe, () => true, () => false);
  return client ? createPortal(children, document.body) : null;
}
const noSubscribe = () => () => {};
