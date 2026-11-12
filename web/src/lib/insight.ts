import type { AppState, Goal, Task } from "./types";
import { addDays, daysBetween, fmtDuration, hhmm, weekday, WEEKDAYS } from "./date";
import { fixedBlocks, lastSessionDate, layoutDay, overdue, progress, streak, taskIndex } from "./schedule";
import { isActive, isEditable, limitsOf } from "./rules";
import { kpiLines } from "./kpi";

/**
 * Everything the app can work out about the person from their own data.
 * These numbers are computed here, by code. The agent reads them and reasons;
 * it never does the arithmetic itself.
 */

export type DayState = "done" | "missed" | "today" | "planned" | "rest";

const pct = (done: number, planned: number) => (planned ? Math.round((done / planned) * 100) : null);

/**
 * The goal read off its roadmap: tasks finished overall, the tasks that finish in the
 * week around `t` (Monday to Sunday, or Sunday to Saturday), and how each day of that week went.
 */
export function roadmapTrack(g: Goal, t: string, weekStart: "mon" | "sun" = "mon") {
  const start = addDays(t, weekStart === "sun" ? -weekday(t) : -((weekday(t) + 6) % 7));
  const end = addDays(start, 6);
  const doneMin: Record<string, number> = {};
  const lastDate: Record<string, string> = {};
  for (const s of g.sessions) {
    if (s.done) doneMin[s.taskId] = (doneMin[s.taskId] || 0) + s.minutes;
    if (!lastDate[s.taskId] || s.date > lastDate[s.taskId]) lastDate[s.taskId] = s.date;
  }
  const tasks = g.roadmap.modules.flatMap((m) => m.tasks);
  const isDone = (task: Task) => (doneMin[task.id] || 0) >= task.minutes;
  const dueThisWeek = tasks.filter((task) => lastDate[task.id] >= start && lastDate[task.id] <= end);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    // Skipped sessions are excused: a day with only skipped work counts as a rest day
    const sessions = g.sessions.filter((s) => s.date === date && !s.skipped);
    const state: DayState = !sessions.length ? "rest" : sessions.every((s) => s.done) ? "done" : date < t ? "missed" : date === t ? "today" : "planned";
    return { date, state };
  });
  return {
    tasksTotal: tasks.length,
    tasksDone: tasks.filter(isDone).length,
    weekTotal: dueThisWeek.length,
    weekDone: dueThisWeek.filter(isDone).length,
    missedDays: days.filter((d) => d.state === "missed").length,
    days,
    isDone,
    next: tasks.find((task) => !isDone(task)),
  };
}

const partOfDay = (hour: number) => (hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "night");

/** How one goal is really going: progress, pace, recent completion and what was written about it. */
export function goalInsight(g: Goal, t: string) {
  const p = progress(g);
  const track = roadmapTrack(g, t);
  const idx = taskIndex(g);
  const since = addDays(t, -28);
  let planned28 = 0, done28 = 0, behindMin = 0, pastSessions = 0;
  const byWeekday = Array.from({ length: 7 }, () => ({ planned: 0, done: 0 }));
  const doneByPart: Record<string, number> = {};
  for (const s of g.sessions) {
    if (s.date < t) {
      pastSessions++;
      const w = byWeekday[weekday(s.date)];
      w.planned += s.minutes;
      if (s.done) w.done += s.minutes;
      else behindMin += s.minutes;
      if (s.date >= since) {
        planned28 += s.minutes;
        if (s.done) done28 += s.minutes;
      }
    }
    if (s.done && s.doneAt) {
      const part = partOfDay(new Date(s.doneAt).getHours());
      doneByPart[part] = (doneByPart[part] || 0) + s.minutes;
    }
  }
  let studyDaysLeft = 0;
  for (let d = t; d <= g.deadline; d = addDays(d, 1)) if (g.days.includes(weekday(d))) studyDaysLeft++;
  const remainingMin = p.total - p.done;
  const finish = lastSessionDate(g);
  const notes = g.sessions
    .filter((s) => s.done && s.note)
    .sort((a, b) => (b.doneAt ?? b.date).localeCompare(a.doneAt ?? a.date))
    .slice(0, 6)
    .map((s) => ({ date: s.date, task: idx[s.taskId]?.task.title ?? "", note: s.note as string }));
  const mod = g.roadmap.modules[p.currentModule];
  return {
    goal: g,
    pct: Math.round(p.pct * 100),
    track,
    phase: p.currentModule + 1,
    phases: g.roadmap.modules.length,
    phaseTitle: mod?.title ?? "",
    checkpoint: mod?.checkpoint ?? "",
    daysLeft: daysBetween(t, g.deadline),
    planned28,
    done28,
    rate28: pct(done28, planned28),
    pastSessions,
    behindMin,
    missedSessions: overdue(g, t).length,
    streak: streak(g, t),
    remainingMin,
    studyDaysLeft,
    neededPerDay: studyDaysLeft ? Math.ceil(remainingMin / studyDaysLeft) : null,
    finish,
    daysLate: daysBetween(g.deadline, finish),
    byWeekday,
    doneByPart,
    notes,
  };
}

/** Minutes taken by routines and one-off events on a date, with overlaps counted once. */
function busyMinutes(state: AppState, date: string) {
  let busy = 0, cur = 0;
  for (const b of fixedBlocks(state, date)) {
    const start = Math.max(b.start, cur);
    if (b.end > start) busy += b.end - start;
    cur = Math.max(cur, b.end);
  }
  return busy;
}

/** The person as a whole: completion across goals, when work gets done, and room for more over the coming `days`. */
export function lifeInsight(state: AppState, t: string, days = 7) {
  // Patterns and capacity come from goals being worked on; paused and archived ones are listed separately
  const goals = state.goals.filter(isActive).map((g) => goalInsight(g, t));
  const planned28 = goals.reduce((a, g) => a + g.planned28, 0);
  const done28 = goals.reduce((a, g) => a + g.done28, 0);
  const rate28 = pct(done28, planned28);
  const byWeekday = Array.from({ length: 7 }, (_, d) => ({
    planned: goals.reduce((a, g) => a + g.byWeekday[d].planned, 0),
    done: goals.reduce((a, g) => a + g.byWeekday[d].done, 0),
  }));
  const doneByPart: Record<string, number> = {};
  for (const g of goals) for (const [k, v] of Object.entries(g.doneByPart)) doneByPart[k] = (doneByPart[k] || 0) + v;

  const cap = limitsOf(state).maxDailyHours * 60;
  const capacity = Array.from({ length: days }, (_, i) => {
    const date = addDays(t, i);
    const free = 1440 - busyMinutes(state, date);
    // The same placement the Today timeline shows, so times given to the agent match the screen
    const blocks = layoutDay(state, date).study.map((b) => ({
      goal: b.goal.title,
      task: b.parts > 1 ? `${b.task.title} (part ${b.part} of ${b.parts})` : b.task.title,
      start: hhmm(b.start),
      end: hhmm(b.end),
      length: fmtDuration(b.end - b.start),
      done: b.session.done,
      ...(b.conflict ? { conflict: "does not fit in free time" } : {}),
    }));
    const committed = state.goals.reduce((a, g) => a + g.sessions.filter((s) => s.date === date).reduce((x, s) => x + s.minutes, 0), 0);
    const headroom = Math.max(0, Math.min(free - committed, cap - committed));
    return { date, free, committed, headroom, realistic: Math.round(headroom * ((rate28 ?? 100) / 100)), blocks };
  });

  return {
    goals,
    planned28,
    done28,
    rate28,
    pastSessions: goals.reduce((a, g) => a + g.pastSessions, 0),
    byWeekday,
    doneByPart,
    capacity,
    committedPerDay: state.goals.reduce((a, g) => a + g.hoursPerDay * 60, 0),
  };
}

const rateText = (done: number, planned: number) => (planned ? `${pct(done, planned)}% (${fmtDuration(done)} of ${fmtDuration(planned)})` : "no data yet");
const dayNames = (days: number[]) => (days.length === 7 ? "every day" : [...days].sort().map((d) => WEEKDAYS[d]).join(", "));

/** The picture handed to the agent before every answer, as compact plain text. */
export function snapshotText(state: AppState, t: string) {
  const life = lifeInsight(state, t);
  const L: string[] = [];
  L.push(`TODAY: ${t} (${WEEKDAYS[weekday(t)]})`);
  const lim = limitsOf(state);
  L.push(`APP LIMITS: at most ${lim.maxActiveGoals} active goals; at most ${lim.maxDailyHours}h of study a day across active goals; at most ${lim.maxTasksPerModule} tasks a phase; tasks and phases can be removed during the first ${lim.editWindowDays || "unlimited"} days of a goal${lim.editWindowDays ? "" : " (never locks)"}.`);
  L.push(`SETTINGS: assistants ${state.settings.autoApplySafe ? "may make ordinary changes without asking" : "ask before every change"}; deletions always need confirmation. Week starts ${state.settings.weekStart === "sun" ? "Sunday" : "Monday"}.`);
  L.push("");
  L.push("OVERALL");
  L.push(`- Active goals: ${state.goals.filter(isActive).length} of ${lim.maxActiveGoals}`);
  L.push(`- Study committed: ${fmtDuration(life.committedPerDay)} a day in total`);
  L.push(`- Completion, last 28 days: ${rateText(life.done28, life.planned28)} of planned minutes, from ${life.pastSessions} past sessions`);
  const wk = life.byWeekday.map((w, d) => (w.planned ? `${WEEKDAYS[d]} ${pct(w.done, w.planned)}%` : null)).filter(Boolean);
  if (wk.length) L.push(`- Completion by weekday (all past sessions): ${wk.join(", ")}`);
  const partTotal = Object.values(life.doneByPart).reduce((a, b) => a + b, 0);
  if (partTotal)
    L.push(`- When work actually gets ticked off: ${Object.entries(life.doneByPart).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round((v / partTotal) * 100)}%`).join(", ")}`);
  L.push("");
  L.push("CAPACITY, next 7 days (free = not in a routine such as sleep or work, and not in an event; realistic = headroom scaled by the 28-day completion rate)");
  for (const c of life.capacity)
    L.push(`- ${WEEKDAYS[weekday(c.date)]} ${c.date}: free ${fmtDuration(c.free)}, study planned ${fmtDuration(c.committed)}, headroom ${fmtDuration(c.headroom)}, realistic ${fmtDuration(c.realistic)}`);
  L.push("");
  L.push("ROUTINES");
  for (const r of state.routines) L.push(`- [routine_id=${r.id}] ${r.title}: ${r.start} to ${r.end}, ${dayNames(r.days)}`);
  if (!state.routines.length) L.push("- none set");
  const upcoming = state.events.filter((e) => e.date >= t).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  if (upcoming.length) {
    L.push("");
    L.push("ONE-OFF EVENTS ahead");
    for (const e of upcoming.slice(0, 20)) L.push(`- [event_id=${e.id}] ${e.date} ${e.start}-${e.end}: ${e.title}`);
  }
  L.push("");
  L.push("GOALS");
  if (!life.goals.length) L.push("- none yet");
  for (const i of life.goals) {
    const g = i.goal;
    L.push(`[goal_id=${g.id}] "${g.title}"${isEditable(g, lim.editWindowDays, t) ? "" : " (roadmap locked: tasks can be added, not removed)"}${g.roadmap.modules.length ? "" : " (NO ROADMAP YET: write one with set_roadmap)"}`);
    L.push(`- Wants: ${g.outcome || g.targetLevel}. Level: from "${g.currentLevel}" to "${g.targetLevel}". Already knew: ${g.known || "not stated"}.`);
    L.push(`- Plan: ${fmtDuration(g.hoursPerDay * 60)} a day, ${dayNames(g.days)}, from ${g.prefStart}. Started ${g.startDate}, deadline ${g.deadline} (${i.daysLeft} days left).`);
    L.push(`- Progress: ${i.pct}% of minutes; ${i.track.tasksDone} of ${i.track.tasksTotal} tasks; on phase ${i.phase} of ${i.phases}, "${i.phaseTitle}". Phase checkpoint: ${i.checkpoint.replace(/\.+$/, "") || "none"}.`);
    L.push(`- Last 28 days: ${rateText(i.done28, i.planned28)}. Streak: ${i.streak} days. Missed sessions not made up: ${i.missedSessions} (${fmtDuration(i.behindMin)}).`);
    L.push(
      `- Pace: ${fmtDuration(i.remainingMin)} left over ${i.studyDaysLeft} study days, so ${i.neededPerDay === null ? "no study days left" : `${fmtDuration(i.neededPerDay)} a day is needed`} against ${fmtDuration(g.hoursPerDay * 60)} planned. ` +
        `Current plan ends ${i.finish} (${i.daysLate > 0 ? `${i.daysLate} days after` : `${-i.daysLate} days before`} the deadline).`,
    );
    L.push(`- This week: ${i.track.weekDone} of ${i.track.weekTotal} roadmap tasks done, ${i.track.missedDays} missed days. Next task: ${i.track.next?.title ?? "none, roadmap complete"}.`);
    if (g.prefs) L.push(`- Learning preferences: ${g.prefs}`);
    for (const n of i.notes) L.push(`- Note ${n.date} on "${n.task}": ${n.note}`);
  }
  const inactive = state.goals.filter((g) => !isActive(g));
  if (inactive.length) {
    L.push("");
    L.push("PAUSED AND ARCHIVED GOALS (no planned sessions; resume_goal brings one back)");
    for (const g of inactive) L.push(`- [goal_id=${g.id}] "${g.title}": ${g.status}${g.statusAt ? ` since ${g.statusAt.slice(0, 10)}` : ""}, ${Math.round(progress(g).pct * 100)}% done.`);
  }
  L.push("");
  L.push("KPIS");
  const kl = kpiLines(state, t);
  L.push(...(kl.length ? kl : ["- none yet (create_kpi adds one)"]));
  L.push("");
  L.push("MEMORIES (saved in earlier conversations)");
  if (!state.memories.length) L.push("- none yet");
  for (const m of state.memories) L.push(`- [memory_id=${m.id}] (${m.kind}, saved ${m.createdAt}${m.source === "user" ? ", written by the user" : ""}) ${m.text}`);
  return L.join("\n");
}
