import type { AppState, Goal } from "./types";
import { addDays, daysBetween, fmtDuration, weekday, WEEKDAYS } from "./date";
import { progress, taskIndex } from "./schedule";
import { isActive, limitsOf } from "./rules";
import { goalInsight } from "./insight";
import { kpiReport } from "./kpi";
import { MATERIAL_LABEL, placeOf } from "./materials";

/**
 * The memory file: everything about one goal (or all of them) as one Markdown document that any
 * model can read and continue from. A view of the database, generated on demand, never edited:
 * the app stays the place where things change.
 *
 * Sections, always in this order: how to read it, the person and their constraints, the goal,
 * where it stands, quality of work, roadmap (done / remaining, with notes and materials),
 * materials, daily log since creation, change history, KPIs, raw JSON.
 */

export const MEMORY_FORMAT = "wml-memory/1";

const doneDay = (iso: string | undefined, fallback: string) => (iso ? iso.slice(0, 10) : fallback);
const days = (d: number[]) => (d.length === 7 ? "every day" : d.map((x) => WEEKDAYS[x]).join(", "));
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** How well the work is going, from the sessions themselves. */
export function workQuality(g: Goal, t: string) {
  const past = g.sessions.filter((s) => s.date < t || s.done);
  const done = past.filter((s) => s.done);
  const onTime = done.filter((s) => doneDay(s.doneAt, s.date) <= s.date).length;
  const delays = done.map((s) => Math.max(0, daysBetween(s.date, doneDay(s.doneAt, s.date))));
  const missed = g.sessions.filter((s) => !s.done && !s.skipped && s.date < t).length;
  const skipped = g.sessions.filter((s) => s.skipped).length;
  const withNotes = done.filter((s) => s.note).length;
  const idx = taskIndex(g);
  const tasksDone = Object.keys(idx).filter((id) => {
    const ss = g.sessions.filter((s) => s.taskId === id);
    return ss.length > 0 && ss.every((s) => s.done);
  }).length;
  // Minutes per week since the start, planned and logged together
  const weeks: { week: string; minutes: number }[] = [];
  for (let w = g.startDate; w <= t; w = addDays(w, 7)) {
    const end = addDays(w, 6);
    const m =
      g.sessions.filter((s) => s.done && doneDay(s.doneAt, s.date) >= w && doneDay(s.doneAt, s.date) <= end).reduce((a, s) => a + s.minutes, 0) +
      (g.logs ?? []).filter((l) => l.date >= w && l.date <= end).reduce((a, l) => a + l.minutes, 0);
    weeks.push({ week: w, minutes: m });
  }
  return {
    sessionsDone: done.length,
    sessionsDue: past.length,
    completionRate: pct(done.length, past.length),
    onTimeRate: pct(onTime, done.length),
    averageDelayDays: delays.length ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10 : 0,
    missed,
    skipped,
    notesRate: pct(withNotes, done.length),
    tasksDone,
    tasksTotal: Object.keys(idx).length,
    extraMinutes: (g.logs ?? []).reduce((a, l) => a + l.minutes, 0),
    weeks,
  };
}

function goalSection(s: AppState, g: Goal, t: string): string[] {
  const L: string[] = [];
  const i = goalInsight(g, t);
  const q = workQuality(g, t);
  const idx = taskIndex(g);
  const p = progress(g);
  const mats = g.materials ?? [];

  L.push(`## Goal: ${g.title}`, "");
  L.push(`- Id: ${g.id}`);
  L.push(`- Status: ${g.status ?? "active"}${g.statusAt ? ` (since ${g.statusAt.slice(0, 10)})` : ""}`);
  L.push(`- Why / done looks like: ${g.outcome || "not stated"}`);
  L.push(`- Level: from "${g.currentLevel || "?"}" to "${g.targetLevel || "?"}"`);
  L.push(`- Already knew at the start: ${g.known || "not stated"}`);
  L.push(`- Learning preferences: ${g.prefs || "not stated"}`);
  L.push(`- Schedule: ${fmtDuration(g.hoursPerDay * 60)} a day, ${days(g.days)}, from ${g.prefStart}`);
  L.push(`- Created ${g.createdAt}; plan from ${g.startDate} to deadline ${g.deadline} (${i.daysLeft >= 0 ? `${i.daysLeft} days left` : `${-i.daysLeft} days past`})`);
  L.push("");

  L.push("### Where it stands now", "");
  L.push(`- Progress: ${i.pct}% of planned minutes; ${q.tasksDone} of ${q.tasksTotal} tasks done`);
  if (g.roadmap.modules.length) L.push(`- Current phase: ${i.phase} of ${i.phases}, "${i.phaseTitle}"${i.checkpoint ? `; checkpoint: ${i.checkpoint}` : ""}`);
  L.push(`- Next task: ${i.track.next?.title ?? (g.roadmap.modules.length ? "none, roadmap complete" : "no roadmap yet")}`);
  L.push(`- Pace: ${fmtDuration(i.remainingMin)} left over ${i.studyDaysLeft} study days; ${i.neededPerDay === null ? "no study days left" : `${fmtDuration(i.neededPerDay)} a day needed`} against ${fmtDuration(g.hoursPerDay * 60)} planned`);
  L.push(`- Projected finish: ${i.finish} (${i.daysLate > 0 ? `${i.daysLate} days after` : `${-i.daysLate} days before`} the deadline)`);
  L.push(`- Streak: ${i.streak} days; missed sessions not made up: ${i.missedSessions} (${fmtDuration(i.behindMin)})`);
  L.push("");

  L.push("### Quality of work", "");
  L.push(`- Sessions done: ${q.sessionsDone} of ${q.sessionsDue} due (${q.completionRate}%); ${q.missed} missed, ${q.skipped} skipped on purpose`);
  L.push(`- Done on the planned day: ${q.onTimeRate}%; average delay when late: ${q.averageDelayDays} days`);
  L.push(`- Finished sessions with a written note: ${q.notesRate}%`);
  L.push(`- Extra study outside the plan: ${fmtDuration(q.extraMinutes)}`);
  if (q.weeks.length) L.push(`- Minutes studied per week from ${g.startDate}: ${q.weeks.map((w) => w.minutes).join(", ")}`);
  L.push("");

  L.push("### Roadmap", "");
  if (g.roadmap.summary) L.push(g.roadmap.summary, "");
  if (!g.roadmap.modules.length) L.push("No roadmap yet.", "");
  g.roadmap.modules.forEach((m, n) => {
    const r = p.modules[n];
    L.push(`#### Phase ${n + 1}: ${m.title} (${r.ratio >= 1 ? "done" : r.done > 0 ? "in progress" : "not started"}, ${pct(r.done, r.total)}%)`);
    if (m.objective) L.push(`Objective: ${m.objective}`);
    if (m.checkpoint) L.push(`Checkpoint: ${m.checkpoint}`);
    if (m.notes) L.push(`Details: ${m.notes}`);
    if (m.key_concepts.length) L.push(`Key concepts: ${m.key_concepts.join(", ")}`);
    for (const task of m.tasks) {
      const ss = g.sessions.filter((x) => x.taskId === task.id);
      const isDone = ss.length > 0 && ss.every((x) => x.done);
      const when = isDone ? `done ${ss.map((x) => doneDay(x.doneAt, x.date)).sort().pop()}` : ss.filter((x) => !x.done).length ? `planned ${ss.filter((x) => !x.done).map((x) => x.date)[0]}` : "not scheduled";
      L.push(`- [${isDone ? "x" : " "}] ${task.title} (${task.kind}, ${fmtDuration(task.minutes)}; ${when})${task.detail ? `: ${task.detail}` : ""}`);
      for (const x of ss) if (x.note) L.push(`  - Note ${doneDay(x.doneAt, x.date)}: ${x.note}`);
      for (const mt of mats.filter((x) => x.taskId === task.id)) L.push(`  - Material: ${mt.title} <${mt.url}>`);
    }
    for (const mt of mats.filter((x) => x.phaseId === m.id && !x.taskId)) L.push(`- Material for this phase: ${mt.title} <${mt.url}>`);
    for (const res of m.resources) L.push(`- Resource: ${res.title} <${res.url}>${res.why ? `: ${res.why}` : ""}`);
    L.push("");
  });

  L.push("### Materials", "");
  if (!mats.length) L.push("None linked yet.");
  for (const m of mats) L.push(`- ${MATERIAL_LABEL[m.kind]}: ${m.title} <${m.url}> (for ${placeOf(g, m)}; added ${m.addedAt.slice(0, 10)})${m.note ? `: ${m.note}` : ""}`);
  L.push("");

  L.push("### Daily log since the start", "");
  const byDate = new Map<string, string[]>();
  const add = (d: string, line: string) => byDate.set(d, [...(byDate.get(d) ?? []), line]);
  for (const x of g.sessions) {
    if (x.date > t && !x.done) continue;
    const name = idx[x.taskId]?.task.title ?? "task";
    const state = x.done ? `done${doneDay(x.doneAt, x.date) !== x.date ? ` on ${doneDay(x.doneAt, x.date)}` : ""}` : x.skipped ? `skipped (${x.skipped.reason})` : x.date < t ? "missed" : "planned today";
    add(x.date, `${name} ${fmtDuration(x.minutes)}: ${state}${x.note ? `; note: ${x.note}` : ""}`);
  }
  for (const l of g.logs ?? []) add(l.date, `extra study ${fmtDuration(l.minutes)}${l.note ? `: ${l.note}` : ""}`);
  const dates = [...byDate.keys()].sort();
  if (!dates.length) L.push("Nothing logged yet.");
  for (const d of dates) L.push(`- ${d} ${WEEKDAYS[weekday(d)]}: ${byDate.get(d)!.join(" | ")}`);
  L.push("");

  L.push("### Change history", "");
  const h = g.history ?? [];
  if (!h.length || h[0].kind !== "goal_created") L.push(`- ${g.createdAt}: Goal created.`);
  for (const e of h) L.push(`- ${e.at.slice(0, 16).replace("T", " ")}: ${e.text}`);
  L.push("");

  const kpis = (s.kpis ?? []).filter((k) => k.goalId === g.id);
  if (kpis.length) {
    L.push("### KPIs for this goal", "");
    for (const k of kpis) {
      const r = kpiReport(s, k, t);
      L.push(`- ${k.name}: now ${r.current ?? "no data"} ${k.unit}, target ${k.direction === "up" ? ">=" : "<="} ${k.target}, trend ${r.trend}${k.source === "manual" && k.values.length ? `; values: ${k.values.map((v) => `${v.date} ${v.value}`).join(", ")}` : ""}`);
    }
    L.push("");
  }
  return L;
}

/** The whole memory file: one goal when goalId is given, otherwise every goal. */
export function buildMemoryFile(s: AppState, t: string, opts: { goalId?: string; generatedAt?: string; includeJson?: boolean } = {}): string {
  const goals = opts.goalId ? s.goals.filter((g) => g.id === opts.goalId) : s.goals;
  const lim = limitsOf(s);
  const L: string[] = [];
  L.push(`# Where MyLife memory: ${opts.goalId ? goals[0]?.title ?? "goal" : "all goals"}`, "");
  L.push(`format: ${MEMORY_FORMAT} · generated ${opts.generatedAt ?? `${t}T00:00`} · today for the person: ${t}${s.settings.timezone ? ` (${s.settings.timezone})` : ""}`, "");
  L.push("## How to read this file", "");
  L.push("This is the complete, factual record of the person's learning goal(s) from Where MyLife: who they are and what limits their time, each goal's roadmap (done and remaining), every day's work since the goal was created, every change to the plan, the materials they have, and their KPIs. Treat it as your memory of them and continue coaching from where it ends. Use only these facts; if something is not here, say you don't know. The raw JSON at the end is the same data, exact.", "");

  L.push("## The person", "");
  L.push(`- Study limits: at most ${lim.maxActiveGoals} active goals and ${lim.maxDailyHours} h of study a day; no limit on tasks a phase`);
  L.push(`- Active goals now: ${s.goals.filter(isActive).length}${s.goals.some((g) => !isActive(g)) ? `; paused or archived: ${s.goals.filter((g) => !isActive(g)).map((g) => g.title).join(", ")}` : ""}`);
  L.push(`- Routines (study is planned around these): ${s.routines.map((r) => `${r.title} ${r.start}-${r.end} ${days(r.days)}`).join("; ") || "none"}`);
  const ahead = s.events.filter((e) => e.date >= t).slice(0, 15);
  if (ahead.length) L.push(`- Upcoming one-off events: ${ahead.map((e) => `${e.date} ${e.start}-${e.end} ${e.title}`).join("; ")}`);
  if (s.memories.length) {
    L.push("- What is known about them:");
    for (const m of s.memories) L.push(`  - (${m.kind}) ${m.text}`);
  }
  const overall = (s.kpis ?? []).filter((k) => !k.goalId);
  if (overall.length) L.push(`- Overall KPIs: ${overall.map((k) => { const r = kpiReport(s, k, t); return `${k.name} ${r.current ?? "n/a"} ${k.unit} (target ${k.target}, ${r.trend})`; }).join("; ")}`);
  L.push("");

  for (const g of goals) L.push(...goalSection(s, g, t));

  if (opts.includeJson !== false) {
    const data = { format: MEMORY_FORMAT, today: t, settings: { limits: lim, timezone: s.settings.timezone, weekStart: s.settings.weekStart ?? "mon" }, routines: s.routines, events: s.events, memories: s.memories, kpis: (s.kpis ?? []).filter((k) => !opts.goalId || k.goalId === opts.goalId || !k.goalId), goals };
    L.push("## Raw data (JSON)", "", "```json", JSON.stringify(data), "```", "");
  }
  return L.join("\n");
}

/** Rough size in model tokens (about 4 characters each), shown before copying. */
export const approxTokens = (text: string) => Math.round(text.length / 4);
