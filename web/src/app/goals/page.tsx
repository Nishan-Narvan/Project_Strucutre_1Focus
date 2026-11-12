"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { NewGoalDialog } from "@/components/NewGoalDialog";
import { daysBetween, fmtDate, fmtDuration, today, weekday, WEEKDAYS } from "@/lib/date";
import { lastSessionDate, overdue, progress, streak } from "@/lib/schedule";
import { roadmapTrack, type DayState } from "@/lib/insight";
import { committedHours, RULES } from "@/lib/rules";
import { PageHeader } from "@/components/ui";
import type { Goal } from "@/lib/types";

const pctText = (ratio: number) => `${Math.round(ratio * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const dayText = (days: number[]) => {
  if (days.length === 7) return "every day";
  if (days.length === 5 && !days.includes(0) && !days.includes(6)) return "on weekdays";
  return `a day, ${plural(days.length, "day")} a week`;
};

export default function GoalsPage() {
  const { state } = useStore();
  const [adding, setAdding] = useState(false);
  const t = today();
  const goals = state.goals;

  return (
    <>
      <PageHeader
        title="Goals"
        sub={`${goals.length} of ${RULES.maxActiveGoals} goals active, ${fmtDuration(committedHours(goals) * 60)} of your ${RULES.maxDailyHours} h day committed.`}
      >
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label="Start a new goal"
          title="Start a new goal"
          className="grid h-12 w-12 place-items-center rounded-full bg-ink text-black transition hover:bg-white"
        >
          <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
            <path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </PageHeader>
      {adding && <NewGoalDialog onClose={() => setAdding(false)} />}

      {goals.length === 0 ? (
        <div className="card">
          <p className="text-ink">You have no goals yet.</p>
          <p className="mt-1 text-sm text-muted">Describe what you want to learn and Where MyLife builds the roadmap and the daily plan.</p>
          <button type="button" className="btn btn-primary mt-4" onClick={() => setAdding(true)}>Start a new goal</button>
        </div>
      ) : (
        <ul className="space-y-4">
          {goals.map((g) => (
            <li key={g.id}>
              <GoalCard goal={g} t={t} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function GoalCard({ goal: g, t }: { goal: Goal; t: string }) {
  const p = progress(g);
  const track = roadmapTrack(g, t);
  const mod = g.roadmap.modules[p.currentModule];
  const st = streak(g, t);
  const missed = overdue(g, t).length;
  const daysLeft = daysBetween(t, g.deadline);
  const daysLate = daysBetween(g.deadline, lastSessionDate(g));
  const due = fmtDate(g.deadline, { month: "short", day: "numeric" });

  const weekStatus =
    track.weekTotal === 0 ? { text: "No roadmap tasks due this week", bad: false }
    : track.weekDone >= track.weekTotal ? { text: "This week's tasks are done", bad: false }
    : track.missedDays > 0 ? { text: `${plural(track.missedDays, "missed day")}, likely to miss`, bad: true }
    : { text: "On track to hit it", bad: false };

  const goalStatus =
    p.pct >= 1 ? { text: "Reached", bad: false }
    : daysLate > 0 ? { text: `Plan runs ${plural(daysLate, "day")} past ${due}`, bad: true }
    : missed > 0 ? { text: `${plural(missed, "missed session")} to make up`, bad: true }
    : { text: `On track for ${due}`, bad: false };

  return (
    <Link
      href={`/goals/${g.id}`}
      className="grid grid-cols-[88px_1fr] items-center gap-x-5 gap-y-5 rounded-[14px] border border-line bg-panel p-5 transition hover:border-faint md:grid-cols-[148px_1fr] md:gap-x-10 md:p-7"
    >
      <Rings goal={p.pct} week={track.weekTotal ? track.weekDone / track.weekTotal : 0} className="md:row-span-2" />

      <div className="min-w-0">
        <h2 className="font-serif text-2xl leading-tight tracking-tight md:text-3xl">{g.title}</h2>
        {mod && (
          <p className="mt-1.5 text-sm">
            <span className="text-muted">Now on phase {p.currentModule + 1} of {g.roadmap.modules.length}, </span>
            <span className="crystal-text">{mod.title}</span>
          </p>
        )}
      </div>

      <dl className="col-span-2 grid gap-5 border-t border-line pt-5 sm:grid-cols-3 md:col-span-1">
        <Fact label="Habit" value={`${fmtDuration(g.hoursPerDay * 60)} ${dayText(g.days)}`} status={st > 0 ? `${st}-day streak` : "No streak yet"}>
          Starts at {g.prefStart}
        </Fact>
        <Fact label="This week" dot="crystal" value={`${track.weekDone} of ${plural(track.weekTotal, "roadmap task")}`} status={weekStatus.text} bad={weekStatus.bad}>
          <WeekTrack days={track.days} />
          {track.next && <span className="mt-2 block truncate">Next: {track.next.title}</span>}
        </Fact>
        <Fact label="Long goal" dot="ink" value={g.outcome || g.targetLevel} status={goalStatus.text} bad={goalStatus.bad}>
          {track.tasksDone} of {plural(track.tasksTotal, "task")} done, {daysLeft >= 0 ? `${plural(daysLeft, "day")} left` : `${plural(-daysLeft, "day")} over`}
        </Fact>
      </dl>
    </Link>
  );
}

/** One labelled reading. The dot ties the label to its ring. */
function Fact({ label, dot, value, status, bad, children }: { label: string; dot?: "crystal" | "ink"; value: string; status: string; bad?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-2 text-sm text-muted">
        {dot && <span className={`h-2 w-2 rounded-full ${dot === "crystal" ? "crystal-dot" : "bg-ink"}`} />}
        {label}
      </dt>
      <dd className="mt-1.5 font-medium text-ink">{value}</dd>
      <dd className="mt-0.5 text-sm text-muted">{children}</dd>
      <dd className={`mt-0.5 text-sm ${bad ? "text-bad" : "text-muted"}`}>{status}</dd>
    </div>
  );
}

const DAY_STYLE: Record<DayState, string> = {
  done: "bg-ink",
  missed: "bg-bad",
  today: "crystal-ring",
  planned: "border border-faint",
  rest: "bg-panel-2",
};
const DAY_WORD: Record<DayState, string> = { done: "done", missed: "missed", today: "today, still to do", planned: "planned", rest: "rest day" };

/** Monday to Sunday, one bar per day: done, missed, today, planned or rest. */
function WeekTrack({ days }: { days: { date: string; state: DayState }[] }) {
  const t = today();
  return (
    <span className="mt-1.5 flex max-w-[260px] gap-1.5" role="img" aria-label={days.map((d) => `${WEEKDAYS[weekday(d.date)]} ${DAY_WORD[d.state]}`).join(", ")}>
      {days.map((d) => (
        <span key={d.date} className="flex-1 text-center" title={`${fmtDate(d.date)}: ${DAY_WORD[d.state]}`}>
          <span className={`block h-1.5 rounded-full ${d.date === t && d.state === "done" ? "crystal-dot" : DAY_STYLE[d.state]}`} />
          <span className={`mt-1 block text-[11px] leading-none ${d.date === t ? "text-ink" : "text-faint"}`}>{WEEKDAYS[weekday(d.date)][0]}</span>
        </span>
      ))}
    </span>
  );
}

/** Outer ring: the whole goal. Inner ring: this week, lit crystal because it is the current stretch. */
function Rings({ goal, week, className = "" }: { goal: number; week: number; className?: string }) {
  const arc = (r: number, ratio: number, stroke: string, glow?: boolean) => {
    const c = 2 * Math.PI * r;
    const shown = Math.min(1, Math.max(0, ratio));
    return (
      <>
        <circle cx="80" cy="80" r={r} stroke="#161616" strokeWidth="9" fill="none" />
        {shown > 0 && (
          <circle
            cx="80"
            cy="80"
            r={r}
            stroke={stroke}
            strokeWidth="9"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c * shown} ${c}`}
            className="ring-draw"
            style={glow ? { filter: "drop-shadow(0 0 5px rgba(191,233,255,0.7))" } : undefined}
          />
        )}
      </>
    );
  };
  return (
    <svg viewBox="0 0 160 160" className={`w-full ${className}`} role="img" aria-label={`${pctText(goal)} of the goal done, ${pctText(week)} of this week's roadmap tasks done`}>
      <g transform="rotate(-90 80 80)">
        {arc(70, goal, "#f4f4f4")}
        {arc(54, week, "#bfe9ff", true)}
      </g>
      <text x="80" y="80" textAnchor="middle" dominantBaseline="central" className="fill-ink font-serif" fontSize="32">
        {pctText(goal)}
      </text>
    </svg>
  );
}
