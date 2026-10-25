// @reviewed 2026-10-25
import { addDays, toMin, weekday } from "./date";
import type { AppState, DayEvent, Goal, Module, Routine, Session, Task } from "./types";
import { uid } from "./date";

/** Available study days and minutes between start and deadline (inclusive). */
export function budget(f: Pick<Goal, "startDate" | "deadline" | "days" | "hoursPerDay">) {
  let days = 0;
  if (f.days.length && f.startDate <= f.deadline) {
    for (let d = f.startDate; d <= f.deadline; d = addDays(d, 1)) if (f.days.includes(weekday(d))) days++;
  }
  return { days, minutes: Math.round(days * f.hoursPerDay * 60) };
}

export function taskIndex(g: Goal) {
  const map: Record<string, { task: Task; module: Module; moduleIndex: number }> = {};
  g.roadmap.modules.forEach((m, mi) => m.tasks.forEach((t) => (map[t.id] = { task: t, module: m, moduleIndex: mi })));
  return map;
}

/**
 * Fill available days in prerequisite order up to the daily cap, splitting long tasks across days.
 * Completed sessions are kept where they are; everything unfinished is re-laid from `from`.
 */
export function buildSessions(g: Goal, from: string): Session[] {
  const cap = Math.max(15, Math.round(g.hoursPerDay * 60));
  if (!g.days.length) return g.sessions.filter((s) => s.done);

  const kept = g.sessions.filter((s) => s.done);
  const doneBy: Record<string, number> = {};
  const usedOn: Record<string, number> = {};
  for (const s of kept) {
    doneBy[s.taskId] = (doneBy[s.taskId] || 0) + s.minutes;
    usedOn[s.date] = (usedOn[s.date] || 0) + s.minutes;
  }

  const queue = g.roadmap.modules.flatMap((m, mi) =>
    m.tasks.map((t) => ({ id: t.id, mi, left: Math.max(0, t.minutes - (doneBy[t.id] || 0)) })),
  ).filter((t) => t.left > 0);

  const available = (d: string) => g.days.includes(weekday(d));
  const nextDay = (d: string) => {
    do d = addDays(d, 1);
    while (!available(d));
    return d;
  };

  const fresh: Session[] = [];
  let day = available(from) ? from : nextDay(from);
  let used = usedOn[day] || 0;
  for (const t of queue) {
    while (t.left > 0) {
      const room = cap - used;
      if (room < Math.min(15, t.left)) {
        day = nextDay(day);
        used = usedOn[day] || 0;
        continue;
      }
      const m = Math.min(room, t.left);
      fresh.push({ id: uid(), taskId: t.id, moduleIndex: t.mi, date: day, minutes: m, done: false });
      used += m;
      t.left -= m;
    }
  }
  return [...kept, ...fresh].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function progress(g: Goal) {
  const doneBy: Record<string, number> = {};
  for (const s of g.sessions) if (s.done) doneBy[s.taskId] = (doneBy[s.taskId] || 0) + s.minutes;
  let total = 0, done = 0;
  const modules = g.roadmap.modules.map((m) => {
    let mt = 0, md = 0;
    for (const t of m.tasks) {
      mt += t.minutes;
      md += Math.min(t.minutes, doneBy[t.id] || 0);
    }
    total += mt;
    done += md;
    return { total: mt, done: md, ratio: mt ? md / mt : 0 };
  });
  const current = modules.findIndex((m) => m.ratio < 1);
  return { pct: total ? done / total : 0, total, done, modules, currentModule: current === -1 ? modules.length - 1 : current };
}

export const overdue = (g: Goal, onDate: string) => g.sessions.filter((s) => !s.done && s.date < onDate);

export const lastSessionDate = (g: Goal) => g.sessions.reduce((max, s) => (s.date > max ? s.date : max), g.startDate);

export const taskSessions = (g: Goal, taskId: string) => g.sessions.filter((s) => s.taskId === taskId);

// ---------- 24h day layout ----------

export interface FixedBlock {
  kind: "routine" | "event";
  id: string;
  title: string;
  color: string;
  start: number;
  end: number;
  source: Routine | DayEvent;
}

export interface StudyBlock {
  kind: "study";
  goal: Goal;
  session: Session;
  task: Task;
  module: Module;
  part: number;
  parts: number;
  start: number;
  end: number;
  conflict?: boolean;
}

export function fixedBlocks(state: AppState, date: string): FixedBlock[] {
  const out: FixedBlock[] = [];
  const d = weekday(date), prev = weekday(addDays(date, -1));
  for (const r of state.routines) {
    const s = toMin(r.start), e = toMin(r.end);
    if (r.days.includes(d)) out.push({ kind: "routine", id: r.id, title: r.title, color: r.color, start: s, end: e > s ? e : 1440, source: r });
    // tail of an overnight routine that started yesterday
    if (e <= s && e > 0 && r.days.includes(prev)) out.push({ kind: "routine", id: r.id + "-tail", title: r.title, color: r.color, start: 0, end: e, source: r });
  }
  for (const ev of state.events.filter((e) => e.date === date)) {
    const s = toMin(ev.start);
    out.push({ kind: "event", id: ev.id, title: ev.title, color: "#e3b341", start: s, end: Math.max(toMin(ev.end), s + 15), source: ev });
  }
  return out.sort((a, b) => a.start - b.start);
}

function freeGaps(occupied: { start: number; end: number }[]) {
  const iv = [...occupied].sort((a, b) => a.start - b.start);
  const gaps: [number, number][] = [];
  let cur = 0;
  for (const { start, end } of iv) {
    if (start > cur) gaps.push([cur, start]);
    cur = Math.max(cur, end);
  }
  if (cur < 1440) gaps.push([cur, 1440]);
  return gaps;
}

/** Place each goal's sessions for the day into free time, starting at the goal's preferred time. */
export function layoutDay(state: AppState, date: string) {
  const fixed = fixedBlocks(state, date);
  const occupied = fixed.map((b) => ({ start: b.start, end: b.end }));
  const study: StudyBlock[] = [];

  for (const g of state.goals) {
    const pref = toMin(g.prefStart || "19:00");
    const idx = taskIndex(g);
    for (const s of g.sessions.filter((x) => x.date === date)) {
      const info = idx[s.taskId];
      if (!info) continue;
      const all = taskSessions(g, s.taskId);
      const base = { kind: "study" as const, goal: g, session: s, task: info.task, module: info.module, part: all.indexOf(s) + 1, parts: all.length };

      const gaps = freeGaps(occupied);
      const ordered: [number, number][] = [
        ...gaps.filter(([, b]) => b > pref).map(([a, b]): [number, number] => [Math.max(a, pref), b]),
        ...gaps.filter(([a]) => a < pref).map(([a, b]): [number, number] => [a, Math.min(b, pref)]),
      ];
      let left = s.minutes;
      for (const [a, b] of ordered) {
        if (left <= 0) break;
        const len = b - a;
        if (len < Math.min(15, left)) continue;
        const m = Math.min(len, left);
        study.push({ ...base, start: a, end: a + m });
        occupied.push({ start: a, end: a + m });
        left -= m;
      }
      if (left > 0) study.push({ ...base, start: pref, end: Math.min(1440, pref + left), conflict: true });
    }
  }
  return { fixed, study: study.sort((a, b) => a.start - b.start) };
}
