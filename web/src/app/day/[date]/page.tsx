"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { addDays, fmtDate, fmtDuration, hhmm, today } from "@/lib/date";
import { layoutDay } from "@/lib/schedule";
import { Timeline } from "@/components/Timeline";
import { Check, KindTag, PageHeader } from "@/components/ui";

export default function DayPage() {
  const { date } = useParams<{ date: string }>();
  const { state, toggleSession, addEvent, deleteEvent } = useStore();
  const [ev, setEv] = useState({ title: "", start: "12:00", end: "13:00" });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return <div className="card text-muted">Invalid date.</div>;

  const { study, fixed } = layoutDay(state, date);
  // one row per session even when it was split across gaps
  const sessions = study.filter((b, i) => study.findIndex((x) => x.session.id === b.session.id) === i);
  const total = sessions.reduce((a, b) => a + b.session.minutes, 0);
  const done = sessions.filter((b) => b.session.done).reduce((a, b) => a + b.session.minutes, 0);
  const free = 1440 - [...fixed, ...study].reduce((a, b) => a + (b.end - b.start), 0);

  return (
    <>
      <PageHeader title={fmtDate(date, { weekday: "long", month: "long", day: "numeric" })} sub={date === today() ? "Today" : undefined}>
        <Link className="btn" href={`/day/${addDays(date, -1)}`}>‹</Link>
        <Link className="btn" href={`/day/${today()}`}>Today</Link>
        <Link className="btn" href={`/day/${addDays(date, 1)}`}>›</Link>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Timeline date={date} />

        <aside className="space-y-4">
          <div className="card grid grid-cols-3 text-center">
            <div><div className="font-serif text-2xl">{fmtDuration(total)}</div><div className="text-xs text-muted">study</div></div>
            <div><div className="font-serif text-2xl text-ok">{fmtDuration(done)}</div><div className="text-xs text-muted">done</div></div>
            <div><div className="font-serif text-2xl text-muted">{fmtDuration(Math.max(0, free))}</div><div className="text-xs text-muted">free</div></div>
          </div>

          <div className="card">
            <div className="label">Daily goals</div>
            {sessions.length === 0 && <p className="text-sm text-muted">No study sessions scheduled.</p>}
            <ul className="space-y-3">
              {sessions.map((b) => (
                <li key={b.session.id} className="flex gap-2.5">
                  <Check checked={b.session.done} onChange={() => toggleSession(b.goal.id, b.session.id)} color={b.goal.color} label={b.task.title} />
                  <div className="min-w-0 text-sm">
                    <div className={b.session.done ? "text-muted line-through" : ""}>
                      {b.task.title} {b.parts > 1 && <span className="text-xs text-muted">({b.part}/{b.parts})</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <span>{hhmm(b.start)} · {fmtDuration(b.session.minutes)}</span>
                      <KindTag kind={b.task.kind} />
                      <Link href={`/goals/${b.goal.id}`} style={{ color: b.goal.color }} className="hover:underline">{b.goal.title}</Link>
                    </div>
                    {b.task.detail && <p className="mt-0.5 text-xs text-muted/80">{b.task.detail}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <div className="label">One-off events</div>
            <ul className="mb-3 space-y-1.5">
              {state.events.filter((e) => e.date === date).map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-sm">
                  <span className="text-warn">{e.start}–{e.end}</span> {e.title}
                  <button className="ml-auto text-xs text-muted hover:text-bad" onClick={() => deleteEvent(e.id)} aria-label={`Remove ${e.title}`}>✕</button>
                </li>
              ))}
            </ul>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!ev.title.trim()) return;
                addEvent({ date, ...ev, title: ev.title.trim() });
                setEv({ ...ev, title: "" });
              }}
            >
              <input className="input" placeholder="e.g. Doctor appointment" value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} />
              <div className="flex gap-2">
                <input type="time" className="input" value={ev.start} onChange={(e) => setEv({ ...ev, start: e.target.value })} aria-label="Start" />
                <input type="time" className="input" value={ev.end} onChange={(e) => setEv({ ...ev, end: e.target.value })} aria-label="End" />
                <button className="btn shrink-0">Add</button>
              </div>
              <p className="text-xs text-muted">Study blocks move around events automatically.</p>
            </form>
          </div>
        </aside>
      </div>
    </>
  );
}
