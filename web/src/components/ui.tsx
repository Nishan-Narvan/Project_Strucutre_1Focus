"use client";

import { useEffect, useRef, useState } from "react";
import type { Goal, SourceType, TaskKind } from "@/lib/types";
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

const KIND_LABEL: Record<TaskKind, string> = { learn: "Learn", practice: "Practice", project: "Project", review: "Review", quiz: "Checkpoint" };

export function KindTag({ kind }: { kind: TaskKind }) {
  return <span className="text-xs text-muted">{KIND_LABEL[kind]}</span>;
}

/** Round completion control. Unchecked opens the note dialog; checked reopens. */
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
        className={`grid ${size} shrink-0 place-items-center rounded-full border transition ${
          done ? "border-ink bg-ink text-black" : current ? "crystal-ring border-crystal" : "border-faint hover:border-muted"
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={onCancel}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="complete-title"
        className="w-full max-w-md rounded-[14px] border border-line bg-panel p-6 shadow-2xl shadow-black"
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
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary">Mark complete</button>
        </div>
      </form>
    </div>
  );
}

/** Two-step destructive button (no confirm() dialogs). */
export function ConfirmButton({ onConfirm, children, confirmText = "Click again to confirm" }: { onConfirm: () => void; children: React.ReactNode; confirmText?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" className={`btn ${armed ? "border-bad text-bad" : ""}`} onClick={() => (armed ? onConfirm() : setArmed(true))} onBlur={() => setArmed(false)}>
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
