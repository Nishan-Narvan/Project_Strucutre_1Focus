"use client";

import Link from "next/link";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { fmtDuration, today, WEEK_ORDER, WEEKDAYS, ymd } from "@/lib/date";
import { PageHeader } from "@/components/ui";

export default function CalendarPage() {
  const { state } = useStore();
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const t = today();

  const first = new Date(cursor.y, cursor.m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first grid
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((lead + daysInMonth) / 7) * 7 }, (_, i) => {
    const day = i - lead + 1;
    return day >= 1 && day <= daysInMonth ? ymd(new Date(cursor.y, cursor.m, day)) : null;
  });

  // date -> per-goal totals
  const byDate: Record<string, { goalId: string; color: string; title: string; minutes: number; done: boolean }[]> = {};
  for (const g of state.goals) {
    const agg: Record<string, { minutes: number; done: boolean }> = {};
    for (const s of g.sessions) {
      const a = (agg[s.date] ??= { minutes: 0, done: true });
      a.minutes += s.minutes;
      a.done &&= s.done;
    }
    for (const [d, a] of Object.entries(agg)) (byDate[d] ??= []).push({ goalId: g.id, color: g.color, title: g.title, ...a });
  }

  const shift = (n: number) => setCursor(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));

  return (
    <>
      <PageHeader title="Calendar" sub={first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}>
        <button className="btn" onClick={() => shift(-1)}>‹ Prev</button>
        <button className="btn" onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })}>Today</button>
        <button className="btn" onClick={() => shift(1)}>Next ›</button>
      </PageHeader>

      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        {state.goals.map((g) => (
          <span key={g.id} className="flex items-center gap-1.5 text-muted">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} /> {g.title}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line">
          {WEEK_ORDER.map((d) => (
            <div key={d} className="bg-panel px-2 py-1.5 text-center text-xs font-medium text-muted">{WEEKDAYS[d]}</div>
          ))}
          {cells.map((d, i) =>
            d ? (
              <Link
                key={d}
                href={`/day/${d}`}
                className={`min-h-28 bg-panel p-1.5 transition hover:bg-panel-2 ${d < t ? "opacity-75" : ""}`}
              >
                <div className={`mb-1 inline-grid h-6 w-6 place-items-center rounded-full text-xs ${d === t ? "bg-accent font-semibold text-[#1a1410]" : "text-muted"}`}>
                  {Number(d.slice(8))}
                </div>
                <div className="space-y-0.5">
                  {(byDate[d] ?? []).map((x) => (
                    <div
                      key={x.goalId}
                      className={`truncate rounded px-1.5 py-0.5 text-[10px] ${x.done ? "line-through opacity-60" : ""} ${!x.done && d < t ? "ring-1 ring-bad" : ""}`}
                      style={{ background: `${x.color}26`, color: x.color }}
                      title={`${x.title} · ${fmtDuration(x.minutes)}`}
                    >
                      {fmtDuration(x.minutes)} · {x.title}
                    </div>
                  ))}
                  {state.events.filter((e) => e.date === d).map((e) => (
                    <div key={e.id} className="truncate rounded bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">{e.start} {e.title}</div>
                  ))}
                </div>
              </Link>
            ) : (
              <div key={"x" + i} className="min-h-28 bg-bg/60" />
            ),
          )}
        </div>
      </div>
    </>
  );
}
