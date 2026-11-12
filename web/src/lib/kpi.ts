import type { AppState, Goal, Kpi, KpiSource } from "./types";
import { addDays, daysBetween } from "./date";
import { progress, streak } from "./schedule";
import { isActive } from "./rules";

/**
 * KPIs: numbers the person tracks against a target. "manual" ones are logged by hand; the
 * built-in ones are computed from the app's own data, for any date, so they have a history too.
 */

export const AUTO_KPIS: Record<Exclude<KpiSource, "manual">, { name: string; unit: string; direction: "up" | "down"; target: number; frequency: "daily" | "weekly"; about: string }> = {
  streak: { name: "Study streak", unit: "days", direction: "up", target: 7, frequency: "daily", about: "consecutive scheduled days fully done" },
  completion: { name: "Completion", unit: "%", direction: "up", target: 80, frequency: "weekly", about: "share of planned minutes done over the last 7 days" },
  minutes_week: { name: "Study time this week", unit: "min", direction: "up", target: 420, frequency: "weekly", about: "minutes studied over the last 7 days, planned and logged" },
  tasks_week: { name: "Tasks finished this week", unit: "tasks", direction: "up", target: 5, frequency: "weekly", about: "roadmap tasks completed over the last 7 days" },
  pace: { name: "Pace", unit: "days", direction: "up", target: 0, frequency: "daily", about: "days ahead (+) or behind (-) the plan" },
};

const goalsFor = (s: AppState, k: Pick<Kpi, "goalId">) => (k.goalId ? s.goals.filter((g) => g.id === k.goalId) : s.goals.filter(isActive));
const doneDate = (iso?: string, fallback?: string) => (iso ? iso.slice(0, 10) : fallback ?? "");

/** Value of a built-in KPI as of the end of `day`. */
export function autoValue(source: Exclude<KpiSource, "manual">, goals: Goal[], day: string): number | null {
  if (!goals.length) return null;
  const from = addDays(day, -6);
  switch (source) {
    case "streak":
      return Math.max(...goals.map((g) => streak(g, day)));
    case "completion": {
      let planned = 0, done = 0;
      for (const g of goals)
        for (const x of g.sessions)
          if (x.date >= from && x.date <= day && !x.skipped) {
            planned += x.minutes;
            if (x.done) done += x.minutes;
          }
      return planned ? Math.round((done / planned) * 100) : null;
    }
    case "minutes_week": {
      let m = 0;
      for (const g of goals) {
        for (const x of g.sessions) if (x.done && doneDate(x.doneAt, x.date) >= from && doneDate(x.doneAt, x.date) <= day) m += x.minutes;
        for (const l of g.logs ?? []) if (l.date >= from && l.date <= day) m += l.minutes;
      }
      return m;
    }
    case "tasks_week": {
      let n = 0;
      for (const g of goals) {
        const lastDone: Record<string, string> = {};
        const open = new Set<string>();
        for (const x of g.sessions) {
          if (!x.done) open.add(x.taskId);
          else {
            const d = doneDate(x.doneAt, x.date);
            if (!lastDone[x.taskId] || d > lastDone[x.taskId]) lastDone[x.taskId] = d;
          }
        }
        for (const [taskId, d] of Object.entries(lastDone)) if (!open.has(taskId) && d >= from && d <= day) n++;
      }
      return n;
    }
    case "pace": {
      // Planned minutes due up to and including `day`, against minutes done by then, in days of study
      let sum = 0, count = 0;
      for (const g of goals) {
        const perDay = g.hoursPerDay * 60;
        if (!perDay || !g.sessions.length) continue;
        let due = 0, done = 0;
        for (const x of g.sessions) {
          if (x.date <= day && !x.skipped) due += x.minutes;
          if (x.done && doneDate(x.doneAt, x.date) <= day) done += x.minutes;
        }
        sum += (done - due) / perDay;
        count++;
      }
      return count ? Math.round((sum / count) * 10) / 10 : null;
    }
  }
}

export interface KpiReport {
  kpi: Kpi;
  current: number | null;
  /** Date the current value is from. */
  asOf: string | null;
  onTarget: boolean | null;
  avg7: number | null;
  avg28: number | null;
  trend: "improving" | "worsening" | "steady" | "not enough data";
  /** Last 28 days (daily values; for manual KPIs only the days with a value). */
  series: { date: string; value: number }[];
}

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

export function kpiReport(s: AppState, k: Kpi, t: string): KpiReport {
  let series: { date: string; value: number }[];
  if (k.source === "manual") {
    series = k.values.filter((v) => v.date >= addDays(t, -27) && v.date <= t).map((v) => ({ date: v.date, value: v.value }));
  } else {
    const goals = goalsFor(s, k);
    series = [];
    for (let i = 27; i >= 0; i--) {
      const d = addDays(t, -i);
      const v = autoValue(k.source, goals, d);
      if (v !== null) series.push({ date: d, value: v });
    }
  }
  const last = k.source === "manual" ? [...k.values].sort((a, b) => a.date.localeCompare(b.date)).at(-1) : series.at(-1);
  const current = last ? last.value : null;
  const recent = series.filter((p) => p.date > addDays(t, -7)).map((p) => p.value);
  const older = series.filter((p) => p.date <= addDays(t, -7) && p.date > addDays(t, -14)).map((p) => p.value);
  const a = mean(recent), b = mean(older);
  let trend: KpiReport["trend"] = "not enough data";
  if (a !== null && b !== null) {
    const delta = a - b;
    const tolerance = Math.max(Math.abs(b) * 0.05, 0.5);
    trend = Math.abs(delta) <= tolerance ? "steady" : (delta > 0) === (k.direction === "up") ? "improving" : "worsening";
  }
  return {
    kpi: k,
    current,
    asOf: last?.date ?? null,
    onTarget: current === null ? null : k.direction === "up" ? current >= k.target : current <= k.target,
    avg7: a,
    avg28: mean(series.map((p) => p.value)),
    trend,
    series,
  };
}

/** One line per KPI, for the AI snapshot. */
export function kpiLines(s: AppState, t: string): string[] {
  return (s.kpis ?? []).map((k) => {
    const r = kpiReport(s, k, t);
    const goal = k.goalId ? s.goals.find((g) => g.id === k.goalId)?.title ?? "a deleted goal" : "overall";
    const cur = r.current === null ? "no data yet" : `${r.current} ${k.unit}${r.asOf && r.asOf !== t ? ` (as of ${r.asOf}, ${daysBetween(r.asOf, t)} days ago)` : ""}`;
    return `- [kpi_id=${k.id}] ${k.name} (${goal}, ${k.source === "manual" ? "logged by hand" : "computed by the app"}, ${k.frequency}): now ${cur}; target ${k.direction === "up" ? "at least" : "at most"} ${k.target} ${k.unit}${r.onTarget === null ? "" : r.onTarget ? ", on target" : ", off target"}; 7-day avg ${r.avg7 ?? "n/a"}, 28-day avg ${r.avg28 ?? "n/a"}; trend ${r.trend}.`;
  });
}

/** Overall roadmap progress for a goal, as a percentage. Used by the goal KPI summary. */
export const goalPct = (g: Goal) => Math.round(progress(g).pct * 100);
