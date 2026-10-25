"use client";

import Link from "next/link";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { addDays, fmtDate, fmtDuration, hhmm, today, weekday, WEEKDAYS } from "@/lib/date";
import { layoutDay, progress, streak } from "@/lib/schedule";
import { Timeline, nextBlock, useNowMinutes } from "@/components/Timeline";
import { CompleteButton } from "@/components/ui";
import type { AppState } from "@/lib/types";

const dayMinutes = (state: AppState, date: string) =>
  state.goals.reduce((a, g) => a + g.sessions.filter((s) => s.date === date).reduce((x, s) => x + s.minutes, 0), 0);
const dayLeft = (state: AppState, date: string) =>
  state.goals.reduce((a, g) => a + g.sessions.filter((s) => s.date === date && !s.done).reduce((x, s) => x + s.minutes, 0), 0);

export function DayView({ initialDate }: { initialDate: string }) {
  const { state, completeSession, reopenSession, addEvent, deleteEvent } = useStore();
  const t = today();
  const [date, setDate] = useState(initialDate);
  const [ev, setEv] = useState({ title: "", start: "12:00", end: "13:00" });
  const now = useNowMinutes();
  const { study } = layoutDay(state, date);
  const sessions = study.filter((b, i) => study.findIndex((x) => x.session.id === b.session.id) === i);
  const next = nextBlock(study, date, now);
  const left = dayLeft(state, date);
  const planned = dayMinutes(state, date);
  const isToday = date === t;

  const monday = addDays(date, -((weekday(date) + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const maxWeek = Math.max(60, ...week.map((d) => dayMinutes(state, d)));

  return (
    <>
      <header className="mb-8 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="text-sm text-muted">{isToday ? "Today" : "Planned for"}, {fmtDate(date, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="mt-1 font-serif text-5xl leading-[1.05] tracking-tight md:text-6xl">
            {planned === 0 ? "A free day" : left === 0 ? "All done" : `${fmtDuration(left)} of work ${isToday ? "left" : "planned"}`}
          </h1>
          <p className="mt-3 max-w-xl text-[15px] text-ink/80">
            {next ? (
              <>
                Next at {hhmm(next.start)}: <span className="crystal-text">{next.task.title}</span>, for {next.goal.title}.
              </>
            ) : planned > 0 ? (
              `${fmtDuration(planned)} completed across ${new Set(sessions.map((s) => s.goal.id)).size} goals.`
            ) : (
              "Nothing scheduled. Routines still run as usual."
            )}
          </p>
        </div>

        <nav aria-label="This week" className="flex items-end gap-1.5">
          {week.map((d) => {
            const m = dayMinutes(state, d);
            const sel = d === date;
            return (
              <button
                key={d}
                onClick={() => setDate(d)}
                aria-pressed={sel}
                className={`flex w-11 flex-col items-center gap-1.5 rounded-lg px-1 py-2 transition ${sel ? "bg-panel-2" : "hover:bg-panel"}`}
              >
                <div className="flex h-14 w-2.5 items-end overflow-hidden rounded-full bg-line">
                  <div className={`w-full rounded-full ${d === t ? "crystal-dot" : "bg-ink/80"}`} style={{ height: `${(m / maxWeek) * 100}%` }} />
                </div>
                <span className={`text-[11px] ${d === t ? "crystal-text" : sel ? "text-ink" : "text-muted"}`}>{WEEKDAYS[weekday(d)].slice(0, 2)}</span>
                <span className="text-[11px] text-faint">{m ? `${Math.round((m / 60) * 10) / 10}h` : "–"}</span>
              </button>
            );
          })}
        </nav>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section aria-label="Timeline">
          <Timeline date={date} />
          <div className="mt-2 flex justify-between text-xs text-muted">
            <span>Study blocks fill the free time around your routines.</span>
            <span className="flex gap-3">
              <button className="hover:text-ink" onClick={() => setDate(addDays(date, -7))}>Previous week</button>
              {date !== t && <button className="hover:text-ink" onClick={() => setDate(t)}>Back to today</button>}
              <button className="hover:text-ink" onClick={() => setDate(addDays(date, 7))}>Next week</button>
            </span>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="card">
            <h2 className="mb-4 text-base font-medium">Tasks for the day</h2>
            {sessions.length === 0 && <p className="text-sm text-muted">No study sessions on this day.</p>}
            <ul className="space-y-4">
              {sessions.map((b) => {
                const cur = next?.session.id === b.session.id;
                return (
                  <li key={b.session.id} className="flex gap-3">
                    <CompleteButton
                      done={b.session.done}
                      current={cur}
                      title={b.task.title}
                      onComplete={(n) => completeSession(b.goal.id, b.session.id, n)}
                      onReopen={() => reopenSession(b.goal.id, b.session.id)}
                    />
                    <div className="min-w-0 text-sm">
                      <div className={b.session.done ? "text-muted line-through" : cur ? "crystal-text" : ""}>{b.task.title}</div>
                      <div className="text-xs text-muted">
                        {hhmm(b.start)}, {fmtDuration(b.session.minutes)} for{" "}
                        <Link href={`/goals/${b.goal.id}`} className="hover:text-ink hover:underline">{b.goal.title}</Link>
                      </div>
                      {b.session.note && <p className="mt-1 border-l border-faint pl-2 text-xs italic text-ink/70">{b.session.note}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-base font-medium">Daily habits</h2>
              <Link href="/goals" className="text-xs text-muted hover:text-ink">All goals</Link>
            </div>
            <ul className="space-y-4">
              {state.goals.map((g) => {
                const p = progress(g);
                const todays = g.sessions.filter((s) => s.date === t);
                const doneToday = todays.length > 0 && todays.every((s) => s.done);
                const st = streak(g, t);
                return (
                  <li key={g.id}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <Link href={`/goals/${g.id}`} className="truncate hover:underline">{g.title}</Link>
                      <span className={`shrink-0 text-xs ${doneToday ? "text-ink" : todays.length ? "text-muted" : "text-faint"}`}>
                        {doneToday ? "Done today" : todays.length ? `${g.prefStart} today` : "Rest day"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {fmtDuration(g.hoursPerDay * 60)} from {g.prefStart}, working through module {p.currentModule + 1}: {g.roadmap.modules[p.currentModule]?.title}
                    </p>
                    <p className="mt-1 text-xs text-faint">{st > 0 ? `${st}-day streak` : "Streak starts with your next session"}</p>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card">
            <h2 className="mb-3 text-base font-medium">One-off events</h2>
            <ul className="mb-3 space-y-1.5">
              {state.events.filter((e) => e.date === date).map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-sm">
                  <span className="text-muted">{e.start}–{e.end}</span> {e.title}
                  <button className="ml-auto text-xs text-muted hover:text-bad" onClick={() => deleteEvent(e.id)} aria-label={`Remove ${e.title}`}>Remove</button>
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
              <input className="input" placeholder="Doctor, dinner, a call…" value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} aria-label="Event title" />
              <div className="flex gap-2">
                <input type="time" className="input" value={ev.start} onChange={(e) => setEv({ ...ev, start: e.target.value })} aria-label="Start" />
                <input type="time" className="input" value={ev.end} onChange={(e) => setEv({ ...ev, end: e.target.value })} aria-label="End" />
                <button className="btn shrink-0">Add</button>
              </div>
            </form>
          </section>
        </aside>
      </div>
    </>
  );
}
