"use client";

import { useStore } from "@/lib/store";
import { fmtDuration, today, uid, weekday, WEEK_ORDER, WEEKDAYS } from "@/lib/date";
import { lifeInsight } from "@/lib/insight";
import { PageHeader } from "@/components/ui";
import type { Routine } from "@/lib/types";

export default function RoutinesPage() {
  const { state, upsertRoutine, deleteRoutine } = useStore();
  const update = (r: Routine, patch: Partial<Routine>) => upsertRoutine({ ...r, ...patch });
  const life = lifeInsight(state, today(), 7);

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
            {/* Saved when leaving the field, so typing does not record a change per keystroke */}
            <input key={r.title} className="input max-w-56 flex-1" defaultValue={r.title} onBlur={(e) => e.target.value.trim() && e.target.value !== r.title && update(r, { title: e.target.value.trim() })} aria-label="Title" />
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

      <section className="card mt-8" aria-labelledby="cap-title">
        <h2 id="cap-title" className="text-base font-medium">Your week</h2>
        <p className="mt-1 text-sm text-muted">
          Time outside routines and events, the study already planned, and the realistic room left: headroom under your daily limit, scaled by the {life.rate28 === null ? "completion rate (no data yet)" : `${life.rate28}% of planned work you finished in the last 28 days`}.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1.5 font-normal">Day</th>
                <th className="py-1.5 font-normal">Free</th>
                <th className="py-1.5 font-normal">Study planned</th>
                <th className="py-1.5 font-normal">Headroom</th>
                <th className="py-1.5 font-normal">Realistic</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {life.capacity.map((c) => (
                <tr key={c.date}>
                  <td className="py-2">{WEEKDAYS[weekday(c.date)]} {Number(c.date.slice(8))}</td>
                  <td className="py-2">{fmtDuration(c.free)}</td>
                  <td className="py-2">{fmtDuration(c.committed)}</td>
                  <td className="py-2">{fmtDuration(c.headroom)}</td>
                  <td className="py-2 text-muted">{fmtDuration(c.realistic)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
