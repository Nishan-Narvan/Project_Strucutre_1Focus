"use client";

import Link from "next/link";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { fmtDuration, today, uid } from "@/lib/date";
import { progress, taskSessions } from "@/lib/schedule";
import { splitPhaseTitle } from "@/lib/phaseTitle";
import type { Goal } from "@/lib/types";
import { WeekDates } from "@/components/WeekDates";

/** A phase title laid out by its parts: track names in ink, their topics muted beneath. */
export function PhaseTitle({ title, size = "row" }: { title: string; size?: "row" | "hero" }) {
  const { tracks } = splitPhaseTitle(title);
  if (size === "hero") {
    const long = tracks.length === 1 && !tracks[0].name && tracks[0].topics.length > 48;
    return (
      <span className="block space-y-3">
        {tracks.map((t, i) =>
          t.name ? (
            <span key={i} className="block">
              <span className="block font-serif text-2xl leading-tight tracking-tight md:text-[28px]">{t.name}</span>
              <span className="mt-0.5 block text-base leading-snug text-ink/70">{t.topics}</span>
            </span>
          ) : (
            <span key={i} className={`block font-serif leading-tight tracking-tight ${long ? "text-xl md:text-2xl" : "text-2xl md:text-[28px]"}`}>{t.topics}</span>
          ),
        )}
      </span>
    );
  }
  return (
    <span className="block space-y-0.5">
      {tracks.map((t, i) => (
        <span key={i} className="block leading-snug">
          {t.name ? (
            <>
              <span className="text-[15px] font-medium text-ink">{t.name}</span>
              <span className="text-sm text-muted"> — {t.topics}</span>
            </>
          ) : (
            <span className="text-[15px] text-ink">{t.topics}</span>
          )}
        </span>
      ))}
    </span>
  );
}

/** The weeks as a plain list: dates, hours and progress on each, with open, edit and move up or down. */
export function PhaseList({ goal: g }: { goal: Goal }) {
  const { apply } = useStore();
  const p = progress(g);
  const [at, setAt] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const n = g.roadmap.modules.length;
  const t = today();

  const insert = (index: number) => {
    if (!title.trim()) return;
    const phase = { id: `p${uid()}`, title: title.trim(), level: "", objective: "", first_principle: "", zpd_scaffold: "", estimated_hours: 0, key_concepts: [], checkpoint: "", resources: [], tasks: [] };
    const err = apply({ type: "add_phase", goalId: g.id, phase, index });
    setError(err ?? "");
    if (!err) {
      setAt(null);
      setTitle("");
    }
  };
  const move = (i: number, d: number) => {
    const ids = g.roadmap.modules.map((x) => x.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    setError(apply({ type: "reorder_phases", goalId: g.id, order: ids }) ?? "");
  };

  const slot = (index: number) =>
    at === index ? (
      <li key={`slot-${index}`} className="px-4 py-3">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); insert(index); }}>
          <input className="input min-w-48 flex-1" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`New week ${index + 1}, e.g. Wk ${index + 1} · Topic: what it covers`} aria-label="New week name" />
          <button className="btn btn-primary">Insert</button>
          <button type="button" className="btn btn-quiet" onClick={() => setAt(null)}>Cancel</button>
        </form>
      </li>
    ) : index === n ? (
      <li key={`slot-${index}`} className="px-4 py-3">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setTitle(""); setAt(index); }}>+ Add a week</button>
      </li>
    ) : (
      <li key={`slot-${index}`} className="group relative h-0">
        <button
          type="button"
          className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line bg-bg px-2.5 py-0.5 text-xs text-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
          onClick={() => { setTitle(""); setAt(index); }}
        >
          + Insert week
        </button>
      </li>
    );

  return (
    <section className="card mt-6 p-0" aria-label="Weeks">
      <header className="flex items-baseline justify-between gap-3 px-4 pb-3 pt-4">
        <h2 className="text-base font-medium">Weeks</h2>
        <span className="text-xs text-muted">
          <span className="text-done">{p.modules.filter((m) => m.ratio >= 1).length} done</span> of {n} · {fmtDuration(p.done)} of {fmtDuration(p.total)}
        </span>
      </header>
      {error && <p className="px-4 pb-2 text-sm text-bad" role="alert">{error}</p>}
      <ol className="divide-y divide-line border-t border-line">
        {g.roadmap.modules.flatMap((m, i) => {
          const mp = p.modules[i];
          const done = mp.ratio >= 1;
          const current = i === p.currentModule && !done;
          const { label } = splitPhaseTitle(m.title);
          const taskDone = m.tasks.filter((x) => isTaskDone(g, x.id)).length;
          const missed = g.sessions.filter((s) => s.moduleIndex === i && !s.done && !s.skipped && s.date < t).length;
          const href = `/goals/${g.id}/phase/${i + 1}`;
          return [
            ...(i > 0 ? [slot(i)] : []),
            <li key={m.id} className={`flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-panel-2/50 ${current ? "bg-crystal/[0.04]" : ""}`}>
              <Marker index={i} done={done} current={current} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Link href={href} className={`text-[13px] font-medium hover:underline ${done ? "text-done" : current ? "crystal-text" : "text-muted"}`}>
                    {label ?? `Week ${i + 1}`}
                  </Link>
                  <WeekDates goal={g} index={i} className="-ml-1" />
                  {current && <span className="text-xs crystal-text">now</span>}
                  {missed > 0 && <span className="text-xs text-late">{missed} missed</span>}
                </div>
                <Link href={href} className="mt-0.5 block hover:opacity-90"><PhaseTitle title={m.title} /></Link>
                <div className="mt-2 flex max-w-md items-center gap-3">
                  <div className="h-1.5 w-32 flex-none overflow-hidden rounded-full bg-panel-2 sm:w-56">
                    <div className={`h-full rounded-full ${done ? "bg-done" : current ? "bg-crystal" : "bg-ink/70"}`} style={{ width: `${Math.round(mp.ratio * 100)}%` }} />
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    <span className="text-ink">{fmtDuration(mp.done)}</span> / {fmtDuration(mp.total)}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    <span className={taskDone === m.tasks.length && m.tasks.length > 0 ? "text-done" : "text-ink"}>{taskDone}</span>/{m.tasks.length} tasks
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Link href={href} className="btn btn-sm">Open</Link>
                <Link href={`${href}#edit`} className="btn btn-quiet btn-sm hidden sm:inline-flex">Edit</Link>
                <div className="flex flex-col">
                  <Arrow dir="up" disabled={i === 0} label={`Move ${label ?? `week ${i + 1}`} up`} onClick={() => move(i, -1)} />
                  <Arrow dir="down" disabled={i === n - 1} label={`Move ${label ?? `week ${i + 1}`} down`} onClick={() => move(i, 1)} />
                </div>
              </div>
            </li>,
          ];
        })}
        {slot(n)}
      </ol>
    </section>
  );
}

/** A small up or down arrow button, used to reorder weeks and tasks. */
export function Arrow({ dir, disabled, label, onClick }: { dir: "up" | "down"; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-5 w-7 place-items-center rounded text-muted transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-20 disabled:hover:bg-transparent"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <path d={dir === "up" ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

const isTaskDone = (g: Goal, taskId: string) => {
  const s = taskSessions(g, taskId);
  return s.length > 0 && s.every((x) => x.done);
};

function Marker({ index, done, current }: { index: number; done: boolean; current: boolean }) {
  return (
    <span
      className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs ${
        done ? "border-done bg-done text-on-ink" : current ? "crystal-ring border-crystal text-crystal" : "border-line text-muted"
      }`}
      aria-hidden
    >
      {done ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5">
          <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        index + 1
      )}
    </span>
  );
}
