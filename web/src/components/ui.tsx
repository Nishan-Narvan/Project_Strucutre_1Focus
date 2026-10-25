// @reviewed 2026-10-25
"use client";

import { useState } from "react";
import type { Goal, SourceType, TaskKind } from "@/lib/types";
import { progress } from "@/lib/schedule";

/** Goal progress bar segmented by module: width ∝ module size, fill ∝ module completion. */
export function ModuleBar({ goal, height = "h-2.5" }: { goal: Goal; height?: string }) {
  const p = progress(goal);
  return (
    <div className={`flex w-full gap-0.5 ${height}`}>
      {goal.roadmap.modules.map((m, i) => (
        <div
          key={m.id}
          title={`${i + 1}. ${m.title} — ${Math.round(p.modules[i].ratio * 100)}%`}
          className="relative overflow-hidden rounded-sm bg-line"
          style={{ flex: p.modules[i].total || 1 }}
        >
          <div className="absolute inset-y-0 left-0" style={{ width: `${p.modules[i].ratio * 100}%`, background: goal.color }} />
        </div>
      ))}
    </div>
  );
}

const SOURCE_STYLE: Record<SourceType, { label: string; color: string }> = {
  reddit: { label: "Reddit", color: "#ff6a33" },
  youtube: { label: "YouTube", color: "#ff4e4e" },
  docs: { label: "Docs", color: "#6a9bcc" },
  course: { label: "Course", color: "#7fb685" },
  article: { label: "Article", color: "#c99bd8" },
  book: { label: "Book", color: "#e3b341" },
  other: { label: "Web", color: "#9a9087" },
};

export function SourceBadge({ type }: { type: SourceType }) {
  const s = SOURCE_STYLE[type] ?? SOURCE_STYLE.other;
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: s.color, background: `${s.color}1f` }}>
      {s.label}
    </span>
  );
}

const KIND_STYLE: Record<TaskKind, string> = {
  learn: "text-[#6a9bcc]",
  practice: "text-[#7fb685]",
  project: "text-accent",
  review: "text-[#c99bd8]",
  quiz: "text-warn",
};

export function KindTag({ kind }: { kind: TaskKind }) {
  return <span className={`text-[10px] font-semibold uppercase tracking-wide ${KIND_STYLE[kind]}`}>{kind}</span>;
}

export function Check({ checked, onChange, color = "var(--color-accent)", label }: { checked: boolean; onChange: () => void; color?: string; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className="grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition"
      style={{ borderColor: color, background: checked ? color : "transparent" }}
    >
      {checked && (
        <svg viewBox="0 0 16 16" className="h-3 w-3 text-[#1a1410]">
          <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

/** Two-step destructive button (no confirm() dialogs). */
export function ConfirmButton({ onConfirm, children, confirmText = "Click again to confirm" }: { onConfirm: () => void; children: React.ReactNode; confirmText?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      className={`btn ${armed ? "border-bad text-bad" : ""}`}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      onBlur={() => setArmed(false)}
    >
      {armed ? confirmText : children}
    </button>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-serif text-3xl">{title}</h1>
        {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
