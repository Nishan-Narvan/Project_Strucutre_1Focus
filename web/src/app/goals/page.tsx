"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { daysBetween, fmtDate, fmtDuration, today } from "@/lib/date";
import { lastSessionDate, overdue, progress, streak } from "@/lib/schedule";
import { committedHours, isEditable, RULES } from "@/lib/rules";
import { ModuleBar, PageHeader } from "@/components/ui";

export default function GoalsPage() {
  const { state } = useStore();
  const t = today();
  const goals = state.goals;
  const atLimit = goals.length >= RULES.maxActiveGoals;
  const hours = committedHours(goals);
  const overall = goals.length ? goals.reduce((a, g) => a + progress(g).pct, 0) / goals.length : 0;

  return (
    <>
      <PageHeader
        title="Goals"
        sub={`${goals.length} of ${RULES.maxActiveGoals} active goals, ${fmtDuration(hours * 60)} of your ${RULES.maxDailyHours} h daily limit committed.`}
      >
        {atLimit ? (
          <span className="text-sm text-muted">Finish or delete a goal to start another.</span>
        ) : (
          <Link href="/goals/new" className="btn btn-primary">Start a new goal</Link>
        )}
      </PageHeader>

      {goals.length === 0 ? (
        <div className="card">
          <p className="text-ink">You have no goals yet.</p>
          <p className="mt-1 text-sm text-muted">Describe what you want to learn and Pathwise builds the roadmap and the daily plan.</p>
          <Link href="/goals/new" className="btn btn-primary mt-4">Start a new goal</Link>
        </div>
      ) : (
        <>
          <p className="mb-6 text-sm text-muted">
            Across all goals you are <span className="text-ink">{Math.round(overall * 100)}%</span> of the way there.
          </p>
          <ul className="divide-y divide-line rounded-[10px] border border-line bg-panel">
            {goals.map((g) => {
              const p = progress(g);
              const mod = g.roadmap.modules[p.currentModule];
              const missed = overdue(g, t).length;
              const st = streak(g, t);
              const late = lastSessionDate(g) > g.deadline;
              return (
                <li key={g.id}>
                  <Link href={`/goals/${g.id}`} className="grid gap-4 p-5 transition hover:bg-panel-2 md:grid-cols-[1fr_96px] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-3">
                        <h2 className="text-lg font-medium">{g.title}</h2>
                        <span className="text-sm text-muted">
                          {g.currentLevel} to {g.targetLevel}, due {fmtDate(g.deadline)} ({daysBetween(t, g.deadline)} days)
                        </span>
                      </div>
                      <div className="mt-3">
                        <ModuleBar goal={g} />
                      </div>
                      <div className="mt-3 grid gap-1 text-sm sm:grid-cols-3">
                        <span>
                          <span className="text-muted">Now: </span>
                          <span className="crystal-text">Phase {p.currentModule + 1}, {mod?.title}</span>
                        </span>
                        <span className="text-muted">
                          Habit: {fmtDuration(g.hoursPerDay * 60)} from {g.prefStart}, {st > 0 ? `${st}-day streak` : "no streak yet"}
                        </span>
                        <span className={missed || late ? "text-bad" : "text-muted"}>
                          {missed ? `${missed} missed session${missed > 1 ? "s" : ""}` : late ? "Running past the deadline" : "On track"}
                          {isEditable(g) ? "" : ", roadmap locked"}
                        </span>
                      </div>
                    </div>
                    <div className="font-serif text-5xl leading-none md:text-right">{Math.round(p.pct * 100)}%</div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
