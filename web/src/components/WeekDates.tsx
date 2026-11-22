"use client";

import { useRef, useState } from "react";
import { Popover } from "@/components/Popover";
import { useStore } from "@/lib/store";
import { addDays, daysBetween, fmtDate, today } from "@/lib/date";
import type { Op } from "@/lib/ops";
import type { Goal } from "@/lib/types";

const short = { day: "numeric", month: "short" } as const;

/** First and last day a phase has sessions on, and its unfinished sessions. */
export function phaseDates(g: Goal, index: number) {
  const mine = g.sessions.filter((s) => s.moduleIndex === index);
  const dates = mine.map((s) => s.date).sort();
  const open = mine.filter((s) => !s.done).sort((a, b) => a.date.localeCompare(b.date));
  return { first: dates[0], last: dates[dates.length - 1], open };
}

/** The week's dates. Click to move all of its unfinished sessions earlier or later. */
export function WeekDates({ goal: g, index, className = "" }: { goal: Goal; index: number; className?: string }) {
  const { apply } = useStore();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLButtonElement>(null);
  const { first, last, open: pending } = phaseDates(g, index);
  const t = today();
  const [start, setStart] = useState(pending[0]?.date ?? t);

  if (!first) return <span className={`text-xs text-faint ${className}`}>Not scheduled</span>;
  const label = first === last ? fmtDate(first, short) : `${fmtDate(first, short)} – ${fmtDate(last, short)}`;
  if (!pending.length) return <span className={`text-xs tabular-nums text-muted ${className}`}>{label}</span>;

  const earliest = pending[0].date;
  const shift = (days: number) => {
    if (!days) return setOpen(false);
    const ops: Op[] = pending.map((s) => ({ type: "move_session", goalId: g.id, sessionId: s.id, date: addDays(s.date, days), start: s.start }));
    const err = apply({ type: "batch", ops });
    if (err) setError(typeof err === "string" ? err : "Could not move this week.");
    else setOpen(false);
  };
  const can = (days: number) => addDays(earliest, days) >= t;
  const step = (days: number, text: string) => (
    <button type="button" disabled={!can(days)} onClick={() => shift(days)} className="rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-panel-2 disabled:opacity-30 disabled:hover:bg-transparent">
      {text}
    </button>
  );

  return (
    <span className={className}>
      <button
        ref={ref}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((x) => !x); setError(""); setStart(earliest); }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Move this week"
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs tabular-nums text-muted transition-colors hover:bg-panel-2 hover:text-ink"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          <rect x="2.5" y="3.5" width="11" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
          <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        {label}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} label="Move this week" width={288}>
          <p className="px-3 pb-1 pt-2 text-xs text-muted">Move the {pending.length} unfinished session{pending.length > 1 ? "s" : ""} of this week</p>
          <div className="grid grid-cols-2">
            {step(-1, "← 1 day earlier")}
            {step(1, "1 day later →")}
            {step(-7, "← 1 week earlier")}
            {step(7, "1 week later →")}
          </div>
          <form className="flex items-end gap-2 border-t border-line p-2" onSubmit={(e) => { e.preventDefault(); shift(daysBetween(earliest, start)); }}>
            <label className="flex-1 text-xs text-muted">
              Start on
              <input type="date" className="input mt-1" value={start} min={t} onChange={(e) => setStart(e.target.value)} />
            </label>
            <button className="btn btn-primary btn-sm">Move</button>
          </form>
          {error && <p className="px-3 pb-2 text-xs text-bad" role="alert">{error}</p>}
      </Popover>
    </span>
  );
}
