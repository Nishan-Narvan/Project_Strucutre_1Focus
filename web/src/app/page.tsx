// @reviewed 2026-10-25
"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { daysBetween, fmtDate, fmtDuration, hhmm, today } from "@/lib/date";
import { lastSessionDate, layoutDay, overdue, progress } from "@/lib/schedule";
import { Check, ModuleBar, PageHeader } from "@/components/ui";
import type { Goal } from "@/lib/types";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  const { state, toggleSession } = useStore();
  const t = today();
  const { study } = layoutDay(state, t);
  const todayMin = study.reduce((a, b) => a + (b.end - b.start), 0);
  const doneMin = study.filter((b) => b.session.done).reduce((a, b) => a + (b.end - b.start), 0);

  return (
    <>
      <PageHeader title={greeting()} sub={fmtDate(t, { weekday: "long", month: "long", day: "numeric" })}>
        <Link href="/goals/new" className="btn btn-primary">
          + New goal
        </Link>
      </PageHeader>

      {!state.settings.apiKeyLast4 && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <span>You’re exploring with demo data. Add a Claude (or other provider) API key to generate real roadmaps.</span>
          <Link href="/settings" className="btn ml-auto">
            Add API key
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Your goals</h2>
          {state.goals.length === 0 ? (
            <div className="card text-center text-muted">
              No goals yet.{" "}
              <Link href="/goals/new" className="text-accent hover:underline">
                Create your first one
              </Link>
              .
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {state.goals.map((g) => (
                <GoalCard key={g.id} goal={g} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Today</h2>
            <Link href={`/day/${t}`} className="text-xs text-accent hover:underline">
              Open timeline →
            </Link>
          </div>
          <div className="card">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="font-serif text-2xl">{fmtDuration(todayMin)}</span>
              <span className="text-xs text-muted">{fmtDuration(doneMin)} done</span>
            </div>
            {study.length === 0 && <p className="text-sm text-muted">Nothing scheduled today.</p>}
            <ul className="space-y-2.5">
              {study.map((b, i) => (
                <li key={b.session.id + i} className="flex items-start gap-2.5">
                  <Check checked={b.session.done} onChange={() => toggleSession(b.goal.id, b.session.id)} color={b.goal.color} label={b.task.title} />
                  <div className="min-w-0 text-sm">
                    <div className={b.session.done ? "text-muted line-through" : ""}>{b.task.title}</div>
                    <div className="text-xs text-muted">
                      {hhmm(b.start)}–{hhmm(b.end)} · <span style={{ color: b.goal.color }}>{b.goal.title}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}

function GoalCard({ goal: g }: { goal: Goal }) {
  const t = today();
  const p = progress(g);
  const behind = overdue(g, t);
  const daysLeft = daysBetween(t, g.deadline);
  const finishes = lastSessionDate(g);
  const mod = g.roadmap.modules[p.currentModule];
  const todays = g.sessions.filter((s) => s.date === t);

  return (
    <Link href={`/goals/${g.id}`} className="card group block transition hover:border-muted">
      <div className="mb-1 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
        <h3 className="truncate font-medium group-hover:underline">{g.title}</h3>
        <span className="ml-auto font-serif text-xl">{Math.round(p.pct * 100)}%</span>
      </div>
      <p className="mb-3 text-xs text-muted">
        {g.currentLevel} → {g.targetLevel} · {daysLeft >= 0 ? `${daysLeft} days left` : "deadline passed"}
      </p>
      <ModuleBar goal={g} />
      <p className="mt-3 truncate text-sm">
        <span className="text-muted">Module {p.currentModule + 1}/{g.roadmap.modules.length}:</span> {mod?.title}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="chip">Today: {todays.length ? fmtDuration(todays.reduce((a, s) => a + s.minutes, 0)) : "rest day"}</span>
        {behind.length > 0 ? (
          <span className="chip border-bad/50 text-bad">{behind.length} missed · reschedule</span>
        ) : (
          <span className="chip border-ok/40 text-ok">On track</span>
        )}
        {finishes > g.deadline && <span className="chip border-warn/50 text-warn">Overruns deadline</span>}
      </div>
    </Link>
  );
}
