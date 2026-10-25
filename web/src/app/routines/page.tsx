"use client";

import { useStore } from "@/lib/store";
import { uid, WEEK_ORDER, WEEKDAYS } from "@/lib/date";
import { PageHeader } from "@/components/ui";
import type { Routine } from "@/lib/types";

export default function RoutinesPage() {
  const { state, upsertRoutine, deleteRoutine } = useStore();
  const update = (r: Routine, patch: Partial<Routine>) => upsertRoutine({ ...r, ...patch });

  return (
    <>
      <PageHeader title="Routines" sub="Recurring daily activities. Study sessions are scheduled around these.">
        <button
          className="btn btn-primary"
          onClick={() => upsertRoutine({ id: uid(), title: "New activity", start: "12:00", end: "13:00", days: [1, 2, 3, 4, 5], color: "#c99bd8" })}
        >
          + Add routine
        </button>
      </PageHeader>

      <div className="space-y-3">
        {state.routines.map((r) => (
          <div key={r.id} className="card flex flex-wrap items-center gap-3">
            <input type="color" value={r.color} onChange={(e) => update(r, { color: e.target.value })} className="h-8 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent" aria-label="Colour" />
            <input className="input max-w-56 flex-1" value={r.title} onChange={(e) => update(r, { title: e.target.value })} aria-label="Title" />
            <div className="flex items-center gap-1.5">
              <input type="time" className="input w-28" value={r.start} onChange={(e) => update(r, { start: e.target.value })} aria-label="Start" />
              <span className="text-muted">–</span>
              <input type="time" className="input w-28" value={r.end} onChange={(e) => update(r, { end: e.target.value })} aria-label="End" />
            </div>
            <div className="flex gap-1">
              {WEEK_ORDER.map((d) => {
                const on = r.days.includes(d);
                return (
                  <button
                    key={d}
                    onClick={() => update(r, { days: on ? r.days.filter((x) => x !== d) : [...r.days, d] })}
                    className={`rounded-md border px-1.5 py-1 text-[11px] ${on ? "border-accent bg-accent/15 text-accent" : "border-line text-muted"}`}
                  >
                    {WEEKDAYS[d].slice(0, 2)}
                  </button>
                );
              })}
            </div>
            {r.end <= r.start && <span className="chip">overnight</span>}
            <button className="ml-auto text-sm text-muted hover:text-bad" onClick={() => deleteRoutine(r.id)} aria-label={`Delete ${r.title}`}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
