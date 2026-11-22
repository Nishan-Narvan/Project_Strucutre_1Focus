"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { KIND_ID } from "@/lib/roadmap";
import type { CustomKind, TaskKind } from "@/lib/types";

/** The five built-in kinds, each with its own colour token. */
const BUILTIN: { id: string; label: string; text: string; bg: string; css: string }[] = [
  { id: "learn", label: "Learn", text: "text-k-learn", bg: "bg-k-learn", css: "var(--k-learn)" },
  { id: "practice", label: "Practice", text: "text-k-practice", bg: "bg-k-practice", css: "var(--k-practice)" },
  { id: "project", label: "Project", text: "text-k-project", bg: "bg-k-project", css: "var(--k-project)" },
  { id: "review", label: "Review", text: "text-k-review", bg: "bg-k-review", css: "var(--k-review)" },
  { id: "quiz", label: "Checkpoint", text: "text-k-quiz", bg: "bg-k-quiz", css: "var(--k-quiz)" },
];

const SWATCHES = ["#8cc8ff", "#ffcf70", "#ff9f7a", "#72dccb", "#f49cc8", "#b5e36b", "#c7a3ff", "#9aa7b8"];

export type KindOption = { id: string; label: string; text?: string; bg?: string; color?: string; css?: string };

/** Built-in kinds followed by the person's own categories. */
export function useKinds(): KindOption[] {
  const { state } = useStore();
  return [...BUILTIN, ...(state.settings.taskKinds ?? []).map((k) => ({ id: k.id, label: k.label, color: k.color, css: k.color }))];
}

/** A kind's colour as a CSS value, for stripes and tints. */
export function useKindColor(kind: string) {
  return useKinds().find((k) => k.id === kind)?.css ?? "var(--muted)";
}

export function KindTag({ kind }: { kind: TaskKind }) {
  const kinds = useKinds();
  const k = kinds.find((x) => x.id === kind) ?? { id: kind, label: kind, color: "#9a9a9a" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${k.text ?? ""}`} style={k.color ? { color: k.color } : undefined}>
      <span className={`h-1.5 w-1.5 rounded-full ${k.bg ?? ""}`} style={k.color ? { background: k.color } : undefined} aria-hidden />
      {k.label}
    </span>
  );
}

/** Pick a category, or make a new one with a name and a colour. */
export function KindSelect({ value, onChange }: { value: TaskKind; onChange: (kind: TaskKind) => void }) {
  const { state, apply } = useStore();
  const kinds = useKinds();
  const [making, setMaking] = useState(false);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(SWATCHES[5]);
  const [error, setError] = useState("");

  if (making) {
    const create = () => {
      const name = label.trim();
      if (!name) return;
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "kind";
      const existing = kinds.find((k) => k.id === id || k.label.toLowerCase() === name.toLowerCase());
      if (existing) {
        onChange(existing.id);
        setMaking(false);
        return;
      }
      if (!KIND_ID.test(id)) return setError("Use letters or numbers in the name.");
      const next: CustomKind[] = [...(state.settings.taskKinds ?? []), { id, label: name.slice(0, 24), color }];
      const err = apply({ type: "save_settings", patch: { taskKinds: next } });
      if (err) return setError(err);
      onChange(id);
      setMaking(false);
      setLabel("");
    };
    return (
      <span className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-line p-1.5">
        <input
          className="input w-36 py-1"
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); create(); }
            if (e.key === "Escape") setMaking(false);
          }}
          placeholder="New category"
          aria-label="New category name"
        />
        <span className="flex gap-1" role="radiogroup" aria-label="Colour">
          {SWATCHES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c}`} onClick={() => setColor(c)} className={`h-4 w-4 rounded-full ${color === c ? "ring-2 ring-ink ring-offset-2 ring-offset-bg" : ""}`} style={{ background: c }} />
          ))}
        </span>
        <button type="button" className="btn btn-primary btn-sm" onClick={create}>Add</button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setMaking(false)}>Cancel</button>
        {error && <span className="w-full text-xs text-bad">{error}</span>}
      </span>
    );
  }

  return (
    <select
      className="input w-auto"
      value={value}
      onChange={(e) => (e.target.value === "__new" ? (setMaking(true), setError("")) : onChange(e.target.value))}
      aria-label="Category"
    >
      {kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
      {!kinds.some((k) => k.id === value) && <option value={value}>{value}</option>}
      <option value="__new">+ New category…</option>
    </select>
  );
}
