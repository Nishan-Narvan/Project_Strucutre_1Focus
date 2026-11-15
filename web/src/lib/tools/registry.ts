import type { AgentTurn, AppState, DashboardWidget, Goal, Kpi, KpiSource, Material, MaterialKind, Memory, MemoryKind, Routine, TaskKind } from "../types";
import { addDays, daysBetween, fmtDuration, hhmm, uid, weekday, WEEKDAYS } from "../date";
import { layoutDay, progress, taskIndex } from "../schedule";
import { isActive, isEditable, limitsOf } from "../rules";
import { lifeInsight, roadmapTrack, snapshotText } from "../insight";
import { AUTO_KPIS, kpiReport } from "../kpi";
import { cleanPhase, cleanRoadmap, cleanTask, emptyRoadmap, RoadmapError, roadmapForAI, TASK_KINDS, type PhaseInput, type RoadmapInput } from "../roadmap";
import { SAMPLE_NOTES } from "../demo";
import { recall } from "../agent/recall";
import { checkMaterialUrl, detectKind, MATERIAL_LABEL, materialsFor, placeOf, titleFromUrl } from "../materials";
import { buildMemoryFile, workQuality } from "../memoryFile";
import { applyOp, OpError, type Op } from "../ops";
import { Args, DAY_LABEL, ToolInputError } from "./args";

/**
 * Every action an assistant can take on the person's data, defined once and used by both the
 * in-app assistant and the claude.ai connector (MCP). A tool reads the current state and returns
 * a result for the AI, plus the ops (lib/ops.ts) that make its change. The host applies those ops
 * with the same rules as the app's own buttons, after any confirmation the tool's kind requires:
 *   read         never changes anything
 *   memory       the assistant's own notes about the person; applied without asking
 *   write        an ordinary change; asks first unless "auto-apply safe changes" is on
 *   destructive  removes or replaces something, or changes a limit; always asks first
 */

export type ToolKind = "read" | "memory" | "write" | "destructive";

export interface ToolCtx {
  state: AppState;
  /** Today where the person is (YYYY-MM-DD). */
  t: string;
  /** Now, as an ISO timestamp. */
  now: string;
  /** Turns of the current in-app conversation that no longer fit in what the model is sent. */
  olderTurns?: AgentTurn[];
}

export interface ToolOutput {
  /** Data or a message for the AI. */
  result: unknown;
  /** The change, if any. Several ops are saved together, all or nothing. */
  ops?: Op[];
  /** For changes: what will happen, in plain words, shown when asking for approval. */
  summary?: string;
  /** Short line shown to the person in the assistant's activity list. */
  label: string;
  /** This particular call is destructive even if the tool usually is not. */
  destructive?: boolean;
  /** A Notion link whose content the host should read and add to the result (needs network). */
  fetchNotion?: string;
}

type Schema = Record<string, unknown>;

export interface ToolSpec {
  name: string;
  description: string;
  kind: ToolKind;
  params: Record<string, Schema>;
  required?: string[];
  run: (a: Args, ctx: ToolCtx) => ToolOutput;
}

// ---------------------------------------------------------------- schema helpers

const S = (description: string, extra: Schema = {}): Schema => ({ type: "string", description, ...extra });
const N = (description: string, extra: Schema = {}): Schema => ({ type: "number", description, ...extra });
const I = (description: string, extra: Schema = {}): Schema => ({ type: "integer", description, ...extra });
const B = (description: string): Schema => ({ type: "boolean", description });
const E = (description: string, values: readonly string[]): Schema => ({ type: "string", enum: [...values], description });
const DATE_P = (d: string) => S(`${d} (YYYY-MM-DD).`);
const TIME_P = (d: string) => S(`${d} (HH:MM, 24-hour).`);
const DAYS_P = (d: string): Schema => ({ type: "array", items: { type: "string", enum: DAY_LABEL }, description: `${d} For example ["mon","wed","fri"].` });
const GOAL_ID = S("The goal's id (from get_overview). A goal title also works.");

const TASK_SCHEMA: Schema = {
  type: "object",
  properties: {
    id: S("Keep an existing task's id to keep its finished work. Leave out for a new task."),
    title: S("What to do, as a short instruction."),
    minutes: I("How long it takes, 5 to 600."),
    kind: E("Type of work.", TASK_KINDS),
    detail: S("One or two lines on exactly what to do and how to know it is done."),
  },
  required: ["title", "minutes"],
};
const PHASE_SCHEMA: Schema = {
  type: "object",
  properties: {
    id: S("Keep an existing phase's id to update it in place. Leave out for a new phase."),
    title: S("Phase name."),
    objective: S("What the person can do at the end of this phase."),
    checkpoint: S("A concrete test that shows the phase is mastered."),
    level: S("Level, for example Beginner or Intermediate."),
    key_concepts: { type: "array", items: { type: "string" }, description: "Main ideas covered." },
    resources: {
      type: "array",
      items: { type: "object", properties: { title: S("Resource name."), url: S("https link."), type: E("Source type.", ["reddit", "youtube", "docs", "course", "article", "book", "other"]), why: S("Why this resource.") }, required: ["title", "url"] },
      description: "Recommended resources. Only real, working links.",
    },
    tasks: { type: "array", items: TASK_SCHEMA, description: "Tasks in the order they should be done." },
  },
  required: ["title", "tasks"],
};

// ---------------------------------------------------------------- lookups

function findGoal(s: AppState, ref: string | undefined): Goal {
  const q = (ref ?? "").trim().toLowerCase();
  const g = q ? s.goals.find((x) => x.id.toLowerCase() === q) ?? s.goals.find((x) => x.title.toLowerCase() === q) ?? s.goals.find((x) => x.title.toLowerCase().includes(q)) : undefined;
  if (!g) throw new ToolInputError(`No goal matches "${ref ?? ""}". Goals: ${s.goals.map((x) => `${x.title} (${x.id})`).join("; ") || "none yet"}.`);
  return g;
}

function findPhase(g: Goal, ref: string | number | undefined) {
  if (typeof ref === "number" || /^\d+$/.test(String(ref ?? ""))) {
    const i = Number(ref) - 1;
    if (g.roadmap.modules[i]) return { m: g.roadmap.modules[i], i };
  }
  const i = g.roadmap.modules.findIndex((m) => m.id === ref || m.title.toLowerCase() === String(ref ?? "").toLowerCase());
  if (i === -1) throw new ToolInputError(`"${g.title}" has no phase "${ref}". Phases: ${g.roadmap.modules.map((m, j) => `${j + 1}. ${m.title} (${m.id})`).join("; ") || "none yet"}.`);
  return { m: g.roadmap.modules[i], i };
}

function findTask(g: Goal, ref: string | undefined) {
  const idx = taskIndex(g);
  if (ref && idx[ref]) return idx[ref];
  const hit = Object.values(idx).find((x) => x.task.title.toLowerCase() === (ref ?? "").toLowerCase());
  if (!hit) throw new ToolInputError(`"${g.title}" has no task "${ref}". Use get_goal_roadmap to see task ids.`);
  return hit;
}

function findSession(g: Goal, ref: string | undefined) {
  const x = g.sessions.find((s) => s.id === ref);
  if (!x) throw new ToolInputError(`"${g.title}" has no session "${ref}". Use get_upcoming or get_history to see session ids.`);
  return x;
}

const daysText = (days: number[]) => (days.length === 7 ? "every day" : days.map((d) => WEEKDAYS[d]).join(", "));
const COLORS = ["#f5f5f5", "#b8b8b8", "#8a8a8a", "#d4d4d4"];

function goalDetail(s: AppState, g: Goal, t: string) {
  const p = progress(g);
  const track = roadmapTrack(g, t);
  return {
    id: g.id,
    title: g.title,
    status: g.status ?? "active",
    outcome: g.outcome,
    current_level: g.currentLevel,
    target_level: g.targetLevel,
    prior_knowledge: g.known,
    learning_preferences: g.prefs,
    daily_minutes: Math.round(g.hoursPerDay * 60),
    study_days: g.days.map((d) => DAY_LABEL[d]),
    start_time: g.prefStart,
    start_date: g.startDate,
    deadline: g.deadline,
    days_left: daysBetween(t, g.deadline),
    progress_pct: Math.round(p.pct * 100),
    tasks_done: `${track.tasksDone} of ${track.tasksTotal}`,
    phases: g.roadmap.modules.length,
    roadmap_locked: !isEditable(g, limitsOf(s).editWindowDays, t),
    logged_extra_minutes: (g.logs ?? []).reduce((a, l) => a + l.minutes, 0),
  };
}

// ---------------------------------------------------------------- goal builders

function goalFromArgs(a: Args, ctx: ToolCtx, base?: Goal) {
  const minutes = a.num("daily_minutes", { min: 5, max: 1440 });
  return {
    ...(a.has("title") ? { title: a.req("title", 160) } : {}),
    ...(a.has("outcome") ? { outcome: a.str("outcome", { max: 400 }) as string } : {}),
    ...(a.has("current_level") ? { currentLevel: a.str("current_level", { max: 80 }) as string } : {}),
    ...(a.has("target_level") ? { targetLevel: a.str("target_level", { max: 80 }) as string } : {}),
    ...(a.has("prior_knowledge") ? { known: a.str("prior_knowledge", { max: 600 }) as string } : {}),
    ...(a.has("learning_preferences") ? { prefs: a.str("learning_preferences", { max: 600 }) as string } : {}),
    ...(minutes !== undefined ? { hoursPerDay: Math.round((minutes / 60) * 100) / 100 } : {}),
    ...(a.has("study_days") ? { days: a.days("study_days") as number[] } : {}),
    ...(a.has("start_time") ? { prefStart: a.time("start_time") as string } : {}),
    ...(a.has("start_date") ? { startDate: a.date("start_date") as string } : {}),
    ...(a.has("deadline") ? { deadline: a.date("deadline") as string } : {}),
    ...(base ? {} : { startDate: a.date("start_date") ?? ctx.t }),
  };
}

const GOAL_FIELDS: Record<string, Schema> = {
  title: S("Short name of the goal."),
  outcome: S("Why: what done looks like, in the person's words."),
  current_level: S("Where they start, for example Beginner."),
  target_level: S("Where they want to be, for example Job-ready."),
  prior_knowledge: S("What they already know."),
  learning_preferences: S("How they like to learn: videos, books, projects…"),
  daily_minutes: I("Study time per study day, in minutes."),
  study_days: DAYS_P("Days of the week to study."),
  start_time: TIME_P("Usual time to start studying"),
  start_date: DATE_P("First day of the plan; defaults to today"),
  deadline: DATE_P("Target date"),
};

function roadmapOps(g: Goal, input: RoadmapInput, s: AppState): { op: Op; phases: number; tasks: number; losing: number } {
  const L = limitsOf(s);
  const roadmap = cleanRoadmap(input, g.title, L.maxTasksPerModule, g.roadmap.modules.length ? g.roadmap : undefined, s.settings.defaultTaskMinutes ?? 45);
  const keep = new Set(roadmap.modules.flatMap((m) => m.tasks.map((t) => t.id)));
  const losing = new Set(g.sessions.filter((x) => x.done && !keep.has(x.taskId)).map((x) => x.taskId)).size;
  return { op: { type: "set_roadmap", goalId: g.id, roadmap }, phases: roadmap.modules.length, tasks: roadmap.modules.reduce((n, m) => n + m.tasks.length, 0), losing };
}

// ---------------------------------------------------------------- the tools

const T: ToolSpec[] = [];
const tool = (spec: ToolSpec) => T.push(spec);

// ======== reading

tool({
  name: "get_overview",
  kind: "read",
  description:
    "Start here. The whole picture computed from the person's data: every goal with status, progress, pace against the deadline, 28-day completion, missed sessions and recent notes; completion by weekday and time of day; free time and realistic capacity for the next 7 days; routines; KPIs with current value, target and trend; limits and settings; saved memories.",
  params: {},
  run: (_a, ctx) => ({ result: `Today for the person is ${ctx.t}.\n\n${snapshotText(ctx.state, ctx.t)}`, label: "Read the overview" }),
});

tool({
  name: "get_goal",
  kind: "read",
  description: "All editable fields of one goal (title, why, levels, prior knowledge, preferences, daily minutes, study days, start time, dates, status) plus its progress.",
  params: { goal_id: GOAL_ID },
  required: ["goal_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    return { result: goalDetail(ctx.state, g, ctx.t), label: `Read the details of ${g.title}` };
  },
});

tool({
  name: "get_goal_roadmap",
  kind: "read",
  description:
    "One goal's roadmap in the same shape set_roadmap accepts: phases (id, title, objective, checkpoint, level, key concepts, resources) and tasks (id, title, minutes, kind, detail), plus for each task whether it is done and when the rest is scheduled. Read this before reviewing or changing a roadmap.",
  params: { goal_id: GOAL_ID },
  required: ["goal_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const track = roadmapTrack(g, ctx.t);
    const r = roadmapForAI(g.roadmap);
    const mats = (where: { phaseId?: string; taskId?: string }) =>
      (g.materials ?? []).filter((m) => (where.taskId ? m.taskId === where.taskId : m.phaseId === where.phaseId && !m.taskId)).map((m) => ({ id: m.id, title: m.title, url: m.url, kind: m.kind }));
    const phases = r.phases.map((p, i) => ({
      number: i + 1,
      ...p,
      ...(g.roadmap.modules[i].notes ? { details: g.roadmap.modules[i].notes } : {}),
      ...(mats({ phaseId: p.id }).length ? { materials: mats({ phaseId: p.id }) } : {}),
      tasks: p.tasks.map((task) => {
        const open = g.sessions.filter((x) => x.taskId === task.id && !x.done).map((x) => x.date);
        const original = g.roadmap.modules[i].tasks.find((x) => x.id === task.id);
        const tm = mats({ taskId: task.id });
        return { ...task, done: original ? track.isDone(original) : false, ...(open.length ? { scheduled: open[0] === open[open.length - 1] ? open[0] : `${open[0]} to ${open[open.length - 1]}` } : {}), ...(tm.length ? { materials: tm } : {}) };
      }),
    }));
    return {
      result: { goal_id: g.id, goal: g.title, locked: !isEditable(g, limitsOf(ctx.state).editWindowDays, ctx.t), max_tasks_per_phase: limitsOf(ctx.state).maxTasksPerModule, ...r, phases, goal_materials: mats({}) },
      label: `Read the roadmap for ${g.title}`,
    };
  },
});

tool({
  name: "get_history",
  kind: "read",
  description: "Day-by-day record of the past: sessions (with ids) planned and done per goal, skipped sessions with the reason, extra study logged, and the notes written on completion.",
  params: { days: I("How many days back, 1 to 60. Default 14."), goal_id: S("Limit to one goal. Leave out for all goals.") },
  run: (a, ctx) => {
    const days = a.num("days", { min: 1, max: 60, int: true }) ?? 14;
    const goals = a.has("goal_id") ? [findGoal(ctx.state, a.str("goal_id"))] : ctx.state.goals;
    const out = [];
    for (let i = days; i >= 1; i--) {
      const date = addDays(ctx.t, -i);
      const per = goals
        .map((g) => {
          const idx = taskIndex(g);
          const ss = g.sessions.filter((x) => x.date === date);
          const logs = (g.logs ?? []).filter((l) => l.date === date);
          if (!ss.length && !logs.length) return null;
          return {
            goal: g.title,
            sessions: ss.map((x) => ({ id: x.id, task: idx[x.taskId]?.task.title ?? "task", minutes: x.minutes, done: x.done, ...(x.skipped ? { skipped: x.skipped.reason } : {}), ...(x.note ? { note: x.note } : {}) })),
            ...(logs.length ? { extra_study: logs.map((l) => ({ id: l.id, minutes: l.minutes, note: l.note })) } : {}),
          };
        })
        .filter(Boolean);
      if (per.length) out.push({ date, weekday: WEEKDAYS[weekday(date)], goals: per });
    }
    return { result: out.length ? out : { note: "Nothing was scheduled or logged in that period." }, label: `Looked at the last ${days} days` };
  },
});

tool({
  name: "get_upcoming",
  kind: "read",
  description: "The plan ahead, day by day: each session with its id, goal, task, start and end time and whether it is done, plus free and committed time. Use the times as they are for calendar events.",
  params: { days: I("How many days ahead, 1 to 21. Default 7.") },
  run: (a, ctx) => {
    const days = a.num("days", { min: 1, max: 21, int: true }) ?? 7;
    const life = lifeInsight(ctx.state, ctx.t, days);
    return {
      result: life.capacity.map((c) => ({
        date: c.date,
        weekday: WEEKDAYS[weekday(c.date)],
        sessions: layoutDay(ctx.state, c.date).study.map((b) => ({ id: b.session.id, goal_id: b.goal.id, goal: b.goal.title, task: b.task.title, start: hhmm(b.start), end: hhmm(b.end), done: b.session.done })),
        free: fmtDuration(c.free),
        headroom: fmtDuration(c.headroom),
      })),
      label: `Checked the next ${days} days`,
    };
  },
});

tool({
  name: "get_capacity",
  kind: "read",
  description: "Free versus planned time for a date range: per day, time outside routines and events, study already planned, headroom under the daily limit, and a realistic figure scaled by the person's recent completion rate.",
  params: { from: DATE_P("First day; default today"), to: DATE_P("Last day; default 6 days after from") },
  run: (a, ctx) => {
    const from = a.date("from") ?? ctx.t;
    const to = a.date("to") ?? addDays(from, 6);
    const n = daysBetween(from, to) + 1;
    if (n < 1 || n > 62) throw new ToolInputError("The range must be 1 to 62 days, with to on or after from.");
    const life = lifeInsight(ctx.state, from, n);
    const sum = (k: "free" | "committed" | "headroom" | "realistic") => life.capacity.reduce((x, c) => x + c[k], 0);
    return {
      result: {
        completion_rate_28d: life.rate28 === null ? "no data yet" : `${life.rate28}%`,
        totals: { free: fmtDuration(sum("free")), planned_study: fmtDuration(sum("committed")), headroom: fmtDuration(sum("headroom")), realistic: fmtDuration(sum("realistic")) },
        days: life.capacity.map((c) => ({ date: c.date, weekday: WEEKDAYS[weekday(c.date)], free: fmtDuration(c.free), planned_study: fmtDuration(c.committed), headroom: fmtDuration(c.headroom), realistic: fmtDuration(c.realistic) })),
      },
      label: `Checked capacity from ${from} to ${to}`,
    };
  },
});

tool({
  name: "recall",
  kind: "read",
  description: "Search everything from the past: saved memories, earlier conversations with the person, and every note they wrote when finishing a session. Use it when they refer to something said or done before.",
  params: { query: S("A few keywords for what to look for.") },
  required: ["query"],
  run: (a, ctx) => {
    const query = a.req("query", 200);
    const hits = recall(ctx.state, query, { limit: 6, olderTurns: ctx.olderTurns ?? [] });
    return {
      result: hits.length ? hits.map((h) => ({ from: h.kind, date: h.date, text: h.text })) : { note: "Nothing in memory, past conversations or notes matches that." },
      label: hits.length ? `Looked back for "${query}" and found ${hits.length}` : `Looked back for "${query}" and found nothing`,
    };
  },
});

// ======== goals

tool({
  name: "create_goal",
  kind: "write",
  description:
    "Create a new learning goal. Check get_capacity and the limits first. Give daily_minutes, study_days and a deadline that fit the person's free time. Optionally include a full roadmap (same shape as set_roadmap); otherwise add one afterwards with set_roadmap. Sessions are planned automatically around their routines.",
  params: { ...GOAL_FIELDS, roadmap: { type: "object", properties: { summary: S("One paragraph on the approach."), phases: { type: "array", items: PHASE_SCHEMA } }, description: "Optional full roadmap." } },
  required: ["title", "daily_minutes", "study_days", "deadline"],
  run: (a, ctx) => {
    const fields = goalFromArgs(a, ctx);
    const title = a.req("title", 160);
    const goal: Goal = {
      id: uid() + uid(),
      title,
      outcome: "",
      currentLevel: "",
      targetLevel: "",
      known: "",
      prefs: "",
      hoursPerDay: 1,
      days: [1, 2, 3, 4, 5],
      prefStart: "19:00",
      startDate: ctx.t,
      deadline: addDays(ctx.t, 56),
      color: COLORS[ctx.state.goals.length % COLORS.length],
      createdAt: ctx.t,
      roadmap: emptyRoadmap(title),
      sessions: [],
      status: "active",
      ...fields,
    };
    const raw = a.raw("roadmap");
    if (raw && typeof raw === "object") goal.roadmap = cleanRoadmap(raw as RoadmapInput, title, limitsOf(ctx.state).maxTasksPerModule, undefined, ctx.state.settings.defaultTaskMinutes ?? 45);
    const tasks = goal.roadmap.modules.reduce((n, m) => n + m.tasks.length, 0);
    return {
      ops: [{ type: "add_goal", goal }],
      summary: `Create the goal "${title}": ${fmtDuration(goal.hoursPerDay * 60)} on ${daysText(goal.days)} from ${goal.prefStart}, ${goal.startDate} to ${goal.deadline}${tasks ? `, with a roadmap of ${goal.roadmap.modules.length} phases and ${tasks} tasks` : ", no roadmap yet"}.`,
      result: { created: true, goal_id: goal.id, next: tasks ? "Sessions are planned. Read get_upcoming to see them." : "Add a roadmap with set_roadmap so sessions can be planned." },
      label: `Created the goal ${title}`,
    };
  },
});

tool({
  name: "update_goal",
  kind: "write",
  description:
    "Change any field of a goal: title, why, levels, prior knowledge, learning preferences, or its schedule (daily_minutes, study_days, start_time, start_date, deadline). Changing minutes, days or start date re-plans the goal from today and keeps finished work.",
  params: { goal_id: GOAL_ID, ...GOAL_FIELDS },
  required: ["goal_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const patch = goalFromArgs(a, ctx, g);
    const keys = Object.keys(patch);
    if (!keys.length) throw new ToolInputError("Nothing to change: give at least one field.");
    const names: Record<string, string> = { hoursPerDay: "daily time", days: "study days", prefStart: "start time", startDate: "start date", currentLevel: "current level", targetLevel: "target level", known: "prior knowledge", prefs: "learning preferences" };
    return {
      ops: [{ type: "update_goal", goalId: g.id, patch }],
      summary: `Change ${keys.map((k) => names[k] ?? k).join(", ")} of "${g.title}"${"hoursPerDay" in patch || "days" in patch || "startDate" in patch ? ", and re-plan it from today" : ""}.`,
      result: { updated: keys.map((k) => names[k] ?? k) },
      label: `Updated ${g.title}`,
    };
  },
});

tool({
  name: "rename_goal",
  kind: "write",
  description: "Rename a goal. Only the title changes; its roadmap, schedule and progress stay as they are.",
  params: { goal_id: GOAL_ID, title: S("The new name.") },
  required: ["goal_id", "title"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const title = a.req("title", 160);
    return { ops: [{ type: "update_goal", goalId: g.id, patch: { title } }], summary: `Rename "${g.title}" to "${title}".`, result: { renamed: true }, label: `Renamed ${g.title} to ${title}` };
  },
});

for (const [name, status, verb, about] of [
  ["pause_goal", "paused", "Pause", "Pause a goal: its unfinished sessions are taken off the plan and it stops counting toward the limits. Finished work is kept. Resume it later."],
  ["resume_goal", "active", "Resume", "Resume a paused or archived goal: its remaining work is planned again from today. It must fit the active-goal and daily-hours limits."],
  ["archive_goal", "archived", "Archive", "Archive a goal you are done with or giving up on: it leaves the main list and the plan, but its history is kept. It can be resumed later."],
] as const) {
  tool({
    name,
    kind: status === "archived" ? "destructive" : "write",
    description: about,
    params: { goal_id: GOAL_ID },
    required: ["goal_id"],
    run: (a, ctx) => {
      const g = findGoal(ctx.state, a.req("goal_id"));
      return { ops: [{ type: "set_goal_status", goalId: g.id, status, at: ctx.now }], summary: `${verb} "${g.title}".`, result: { status }, label: `${verb}d ${g.title}`.replace("Pauseded", "Paused") };
    },
  });
}

tool({
  name: "delete_goal",
  kind: "destructive",
  description: "Delete a goal for good, with its roadmap, sessions, notes and KPIs. Prefer archive_goal unless the person clearly wants it gone.",
  params: { goal_id: GOAL_ID },
  required: ["goal_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const done = g.sessions.filter((x) => x.done).length;
    return { ops: [{ type: "delete_goal", goalId: g.id }], summary: `Delete "${g.title}" for good, including ${done} finished session${done === 1 ? "" : "s"} and their notes.`, result: { deleted: true }, label: `Deleted ${g.title}` };
  },
});

// ======== roadmap

tool({
  name: "set_roadmap",
  kind: "write",
  description:
    "Write or replace a goal's whole roadmap: phases in order, each with title, objective, checkpoint, resources and tasks (title, minutes, kind, detail). Use it to generate a roadmap from the goal's description, or to apply a reviewed and improved version. To keep finished work, keep the ids of existing phases and tasks (read them with get_goal_roadmap). The goal is re-planned from today. Design from first principles, start at the person's current level, and keep total minutes realistic for the time to the deadline.",
  params: {
    goal_id: GOAL_ID,
    summary: S("One paragraph on the approach and why it is ordered this way."),
    first_principles: { type: "array", items: { type: "string" }, description: "The core ideas everything builds on." },
    phases: { type: "array", items: PHASE_SCHEMA, description: "All phases in order." },
  },
  required: ["goal_id", "phases"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const r = roadmapOps(g, { summary: a.raw("summary"), first_principles: a.raw("first_principles"), phases: a.raw("phases") }, ctx.state);
    const replacing = g.roadmap.modules.length > 0;
    return {
      ops: [r.op],
      destructive: replacing,
      summary: `${replacing ? "Replace" : "Write"} the roadmap of "${g.title}" with ${r.phases} phases and ${r.tasks} tasks${r.losing ? `. ${r.losing} task${r.losing === 1 ? "" : "s"} with finished work would be removed` : ""}, and re-plan it from today.`,
      result: { phases: r.phases, tasks: r.tasks, finished_tasks_removed: r.losing },
      label: `${replacing ? "Replaced" : "Wrote"} the roadmap for ${g.title}`,
    };
  },
});

tool({
  name: "create_phase",
  kind: "write",
  description: "Add a phase to a goal's roadmap, with its tasks, at a position (default: the end).",
  params: { goal_id: GOAL_ID, position: I("1-based position; default last."), ...(PHASE_SCHEMA.properties as Record<string, Schema>) },
  required: ["goal_id", "title"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const L = limitsOf(ctx.state);
    const pos = a.num("position", { min: 1, max: g.roadmap.modules.length + 1, int: true });
    const phase = cleanPhase({ title: a.raw("title"), objective: a.raw("objective"), checkpoint: a.raw("checkpoint"), level: a.raw("level"), key_concepts: a.raw("key_concepts"), resources: a.raw("resources"), tasks: a.raw("tasks") ?? [] } as PhaseInput, pos ? pos - 1 : g.roadmap.modules.length, L.maxTasksPerModule, undefined, ctx.state.settings.defaultTaskMinutes ?? 45);
    return { ops: [{ type: "add_phase", goalId: g.id, phase, index: pos ? pos - 1 : undefined }], summary: `Add phase "${phase.title}" with ${phase.tasks.length} tasks to "${g.title}".`, result: { phase_id: phase.id }, label: `Added phase ${phase.title} to ${g.title}` };
  },
});

tool({
  name: "update_phase",
  kind: "write",
  description: "Change or elaborate a phase: title, objective, checkpoint, level, key concepts, details (a longer explanation of what the phase covers and how), approach (how to tackle it) and built_on (the idea it rests on). Tasks are changed with the task tools.",
  params: { goal_id: GOAL_ID, phase_id: S("Phase id or number."), title: S("New title."), objective: S("New objective."), checkpoint: S("New checkpoint."), level: S("New level."), key_concepts: { type: "array", items: { type: "string" }, description: "New key concepts." }, details: S("Longer explanation of the phase (replaces the old one)."), approach: S("How to tackle this phase."), built_on: S("The first principle or idea this phase rests on.") },
  required: ["goal_id", "phase_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const { m } = findPhase(g, a.req("phase_id"));
    const patch = {
      ...(a.has("title") ? { title: a.req("title", 160) } : {}),
      ...(a.has("objective") ? { objective: a.str("objective", { max: 600 }) as string } : {}),
      ...(a.has("checkpoint") ? { checkpoint: a.str("checkpoint", { max: 400 }) as string } : {}),
      ...(a.has("level") ? { level: a.str("level", { max: 80 }) as string } : {}),
      ...(a.has("key_concepts") ? { key_concepts: (a.list<string>("key_concepts", { max: 12 }) ?? []).map(String) } : {}),
      ...(a.has("details") ? { notes: a.str("details", { max: 4000 }) as string } : {}),
      ...(a.has("approach") ? { zpd_scaffold: a.str("approach", { max: 600 }) as string } : {}),
      ...(a.has("built_on") ? { first_principle: a.str("built_on", { max: 300 }) as string } : {}),
    };
    if (!Object.keys(patch).length) throw new ToolInputError("Nothing to change: give at least one field.");
    return { ops: [{ type: "update_phase", goalId: g.id, phaseId: m.id, patch }], summary: `Change ${Object.keys(patch).join(", ").replace("key_concepts", "key concepts")} of phase "${m.title}".`, result: { updated: true }, label: `Updated phase ${m.title}` };
  },
});

tool({
  name: "delete_phase",
  kind: "destructive",
  description: "Remove a phase and its tasks from a roadmap. Finished work on those tasks no longer counts. Only possible while the roadmap is not locked.",
  params: { goal_id: GOAL_ID, phase_id: S("Phase id or number.") },
  required: ["goal_id", "phase_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const { m } = findPhase(g, a.req("phase_id"));
    return { ops: [{ type: "delete_phase", goalId: g.id, phaseId: m.id }], summary: `Remove phase "${m.title}" and its ${m.tasks.length} tasks from "${g.title}".`, result: { deleted: true }, label: `Removed phase ${m.title}` };
  },
});

tool({
  name: "reorder_phases",
  kind: "write",
  description: "Put a goal's phases in a new order. Give every phase id once, in the new order. The goal is re-planned.",
  params: { goal_id: GOAL_ID, order: { type: "array", items: { type: "string" }, description: "All phase ids in the new order." } },
  required: ["goal_id", "order"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const order = (a.list<string>("order", { required: true }) ?? []).map((x) => findPhase(g, x).m.id);
    return { ops: [{ type: "reorder_phases", goalId: g.id, order }], summary: `Reorder the phases of "${g.title}".`, result: { reordered: true }, label: `Reordered the phases of ${g.title}` };
  },
});

tool({
  name: "add_task",
  kind: "write",
  description: "Add one task to a phase of a goal's roadmap, at a position (default: the end of the phase). The goal is re-planned from today.",
  params: { goal_id: GOAL_ID, phase: S("Phase id or number (1 = first)."), title: S("What to do."), minutes: I("Length in minutes, 5 to 600."), kind: E("Type of work.", TASK_KINDS), detail: S("One line on what to do."), position: I("1-based position in the phase; default last.") },
  required: ["goal_id", "phase", "title", "minutes"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const { m, i } = findPhase(g, a.req("phase"));
    const task = cleanTask({ title: a.req("title"), minutes: a.num("minutes", { required: true }), kind: a.str("kind"), detail: a.str("detail") }, "Task", ctx.state.settings.defaultTaskMinutes ?? 45);
    const pos = a.num("position", { min: 1, max: m.tasks.length + 1, int: true });
    return {
      ops: [{ type: "add_task", goalId: g.id, moduleIndex: i, task, index: pos ? pos - 1 : undefined }],
      summary: `Add "${task.title}" (${fmtDuration(task.minutes)}, ${task.kind}) to phase ${i + 1} of "${g.title}", and re-plan it from today.`,
      result: { task_id: task.id },
      label: `Added "${task.title}" to ${g.title}`,
    };
  },
});

tool({
  name: "update_task",
  kind: "write",
  description: "Change a task's title, detail, minutes or kind. Changing minutes re-plans the goal.",
  params: { goal_id: GOAL_ID, task_id: S("Task id (from get_goal_roadmap)."), title: S("New title."), detail: S("New detail."), minutes: I("New length, 5 to 600."), kind: E("New kind.", TASK_KINDS) },
  required: ["goal_id", "task_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const { task } = findTask(g, a.req("task_id"));
    const patch = {
      ...(a.has("title") ? { title: a.req("title", 160) } : {}),
      ...(a.has("detail") ? { detail: a.str("detail", { max: 600 }) as string } : {}),
      ...(a.has("minutes") ? { minutes: a.num("minutes", { min: 5, max: 600, int: true }) as number } : {}),
      ...(a.has("kind") ? { kind: a.oneOf("kind", TASK_KINDS) as TaskKind } : {}),
    };
    if (!Object.keys(patch).length) throw new ToolInputError("Nothing to change: give at least one field.");
    return { ops: [{ type: "update_task", goalId: g.id, taskId: task.id, patch }], summary: `Change ${Object.keys(patch).join(", ")} of task "${task.title}".`, result: { updated: true }, label: `Updated task ${task.title}` };
  },
});

tool({
  name: "delete_task",
  kind: "destructive",
  description: "Remove a task from a roadmap, with its sessions. Only possible while the roadmap is not locked.",
  params: { goal_id: GOAL_ID, task_id: S("Task id.") },
  required: ["goal_id", "task_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const { task } = findTask(g, a.req("task_id"));
    return { ops: [{ type: "remove_task", goalId: g.id, taskId: task.id }], summary: `Remove task "${task.title}" from "${g.title}".`, result: { deleted: true }, label: `Removed task ${task.title}` };
  },
});

tool({
  name: "move_task",
  kind: "write",
  description: "Move a task to another phase, or to another position in the same phase. The goal is re-planned.",
  params: { goal_id: GOAL_ID, task_id: S("Task id."), to_phase: S("Destination phase id or number."), position: I("1-based position in that phase; default last.") },
  required: ["goal_id", "task_id", "to_phase"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const { task } = findTask(g, a.req("task_id"));
    const { m, i } = findPhase(g, a.req("to_phase"));
    const pos = a.num("position", { min: 1, max: m.tasks.length + 1, int: true });
    return { ops: [{ type: "move_task", goalId: g.id, taskId: task.id, toPhaseId: m.id, index: pos ? pos - 1 : undefined }], summary: `Move "${task.title}" to phase ${i + 1}${pos ? `, position ${pos}` : ""}.`, result: { moved: true }, label: `Moved task ${task.title}` };
  },
});

tool({
  name: "reorder_tasks",
  kind: "write",
  description: "Put the tasks of one phase in a new order. Give every task id of that phase once, in the new order.",
  params: { goal_id: GOAL_ID, phase_id: S("Phase id or number."), order: { type: "array", items: { type: "string" }, description: "All task ids of the phase in the new order." } },
  required: ["goal_id", "phase_id", "order"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const { m } = findPhase(g, a.req("phase_id"));
    const order = (a.list<string>("order", { required: true }) ?? []).map(String);
    const ids = m.tasks.map((t) => t.id);
    if (order.length !== ids.length || !ids.every((id) => order.includes(id))) throw new ToolInputError(`Give every task id of phase "${m.title}" exactly once: ${ids.join(", ")}.`);
    return { ops: [{ type: "reorder_tasks", goalId: g.id, phaseId: m.id, order }], summary: `Reorder the tasks of phase "${m.title}".`, result: { reordered: true }, label: `Reordered tasks in ${m.title}` };
  },
});

tool({
  name: "bulk_update_roadmap",
  kind: "write",
  description:
    "Apply many roadmap changes to one goal in a single step, all or nothing. Each change is an object with an action (add_task, update_task, delete_task, move_task, create_phase, update_phase, delete_phase, reorder_phases, reorder_tasks) and the same fields that tool takes (without goal_id). Use it for a review that touches several tasks at once.",
  params: { goal_id: GOAL_ID, changes: { type: "array", items: { type: "object", properties: { action: E("Which change.", ["add_task", "update_task", "delete_task", "move_task", "create_phase", "update_phase", "delete_phase", "reorder_phases", "reorder_tasks"]) }, required: ["action"] }, description: "The changes, applied in order." } },
  required: ["goal_id", "changes"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const changes = a.list<Record<string, unknown>>("changes", { required: true, max: 80 }) ?? [];
    if (!changes.length) throw new ToolInputError('"changes" is empty.');
    const ops: Op[] = [];
    const lines: string[] = [];
    let destructive = false;
    changes.forEach((c, i) => {
      const spec = BY_NAME[String(c.action)];
      if (!spec || !["add_task", "update_task", "delete_task", "move_task", "create_phase", "update_phase", "delete_phase", "reorder_phases", "reorder_tasks"].includes(spec.name)) throw new ToolInputError(`Change ${i + 1}: unknown action "${String(c.action)}".`);
      try {
        const out = spec.run(new Args({ ...c, goal_id: g.id }), ctx);
        ops.push(...(out.ops ?? []));
        if (out.summary) lines.push(out.summary);
        if (spec.kind === "destructive") destructive = true;
      } catch (e) {
        throw new ToolInputError(`Change ${i + 1} (${spec.name}): ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    return { ops: [{ type: "batch", ops }], destructive, summary: `${changes.length} changes to "${g.title}":\n- ${lines.join("\n- ")}`, result: { applied: changes.length }, label: `Made ${changes.length} roadmap changes to ${g.title}` };
  },
});

// ======== progress

tool({
  name: "complete_session",
  kind: "write",
  description: "Mark one planned session done, with an optional note on what was learned or where they got stuck.",
  params: { goal_id: GOAL_ID, session_id: S("Session id (from get_upcoming or get_history)."), note: S("What they learned, links, blockers.") },
  required: ["goal_id", "session_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const x = findSession(g, a.req("session_id"));
    const task = taskIndex(g)[x.taskId]?.task.title ?? "a task";
    return { ops: [{ type: "complete_session", goalId: g.id, sessionId: x.id, note: a.str("note", { max: 2000 }) ?? "", at: ctx.now }], summary: `Mark the ${x.date} session of "${task}" done.`, result: { done: true }, label: `Marked a session of ${task} done` };
  },
});

tool({
  name: "mark_task_done",
  kind: "write",
  description: "Mark a whole task done: every remaining session of it, with one optional note.",
  params: { goal_id: GOAL_ID, task_id: S("Task id."), note: S("Optional note.") },
  required: ["goal_id", "task_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const { task } = findTask(g, a.req("task_id"));
    return { ops: [{ type: "complete_task", goalId: g.id, taskId: task.id, note: a.str("note", { max: 2000 }) ?? "", at: ctx.now }], summary: `Mark "${task.title}" done.`, result: { done: true }, label: `Marked ${task.title} done` };
  },
});

tool({
  name: "mark_task_undone",
  kind: "write",
  description: "Undo completion of a task: all its sessions become unfinished again and their notes are cleared.",
  params: { goal_id: GOAL_ID, task_id: S("Task id.") },
  required: ["goal_id", "task_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const { task } = findTask(g, a.req("task_id"));
    return { ops: [{ type: "reopen_task", goalId: g.id, taskId: task.id }], summary: `Mark "${task.title}" not done again (its session notes are cleared).`, result: { reopened: true }, label: `Reopened ${task.title}` };
  },
});

tool({
  name: "log_study_time",
  kind: "write",
  description: "Record study done outside the plan (an unplanned session). It counts toward time KPIs and history, not toward roadmap progress.",
  params: { goal_id: GOAL_ID, minutes: I("How long, 1 to 960."), date: DATE_P("When; default today"), note: S("What was done.") },
  required: ["goal_id", "minutes"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const minutes = a.num("minutes", { required: true, min: 1, max: 960, int: true }) as number;
    const date = a.date("date") ?? ctx.t;
    return { ops: [{ type: "log_study", goalId: g.id, log: { id: uid() + uid(), date, minutes, note: a.str("note", { max: 1000 }), at: ctx.now } }], summary: `Log ${fmtDuration(minutes)} of extra study on "${g.title}" for ${date}.`, result: { logged: true }, label: `Logged ${fmtDuration(minutes)} on ${g.title}` };
  },
});

for (const [name, kind, about] of [
  ["add_note", "write", "Add a note to a session (what was learned, links, blockers). Replaces any existing note."],
  ["edit_note", "write", "Change the note on a session, for example to correct it or add a link. The session itself is unchanged."],
] as const) {
  tool({
    name,
    kind,
    description: about,
    params: { goal_id: GOAL_ID, session_id: S("Session id."), note: S("The note text.") },
    required: ["goal_id", "session_id", "note"],
    run: (a, ctx) => {
      const g = findGoal(ctx.state, a.req("goal_id"));
      const x = findSession(g, a.req("session_id"));
      return { ops: [{ type: "set_session_note", goalId: g.id, sessionId: x.id, note: a.req("note", 2000) }], summary: `${x.note ? "Replace" : "Add"} the note on the ${x.date} session.`, result: { saved: true }, label: `Saved a note on a ${g.title} session` };
    },
  });
}

tool({
  name: "delete_note",
  kind: "destructive",
  description: "Remove the note from a session. The session stays done or not done as it was.",
  params: { goal_id: GOAL_ID, session_id: S("Session id.") },
  required: ["goal_id", "session_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const x = findSession(g, a.req("session_id"));
    if (!x.note) throw new ToolInputError("That session has no note.");
    return { ops: [{ type: "set_session_note", goalId: g.id, sessionId: x.id, note: "" }], summary: `Delete the note "${x.note.slice(0, 80)}" from the ${x.date} session.`, result: { deleted: true }, label: `Deleted a note on ${g.title}` };
  },
});

tool({
  name: "skip_session",
  kind: "write",
  description: "Skip a planned session on purpose, with a reason. It is not counted as missed and does not break a streak; the work stays unfinished until the goal is re-planned.",
  params: { goal_id: GOAL_ID, session_id: S("Session id."), reason: S("Why, for example sick or travelling.") },
  required: ["goal_id", "session_id", "reason"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const x = findSession(g, a.req("session_id"));
    return { ops: [{ type: "skip_session", goalId: g.id, sessionId: x.id, reason: a.req("reason", 300), at: ctx.now }], summary: `Skip the ${x.date} session of "${g.title}".`, result: { skipped: true }, label: `Skipped a ${g.title} session` };
  },
});

tool({
  name: "reschedule_goal",
  kind: "write",
  description: "Re-plan one goal from today: finished work is kept and everything unfinished, including missed and skipped sessions, is laid out again from today.",
  params: { goal_id: GOAL_ID },
  required: ["goal_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    return { ops: [{ type: "reschedule_goal", goalId: g.id }], summary: `Re-plan "${g.title}" from today. Finished work stays; the rest is laid out again.`, result: { done: true, note: "Read get_upcoming to see the new plan." }, label: `Re-planned ${g.title} from today` };
  },
});

tool({
  name: "reschedule_session",
  kind: "write",
  description: "Move one unfinished session to another date, optionally at a set start time. Other sessions stay where they are.",
  params: { goal_id: GOAL_ID, session_id: S("Session id."), date: DATE_P("New date"), start_time: TIME_P("Optional fixed start time") },
  required: ["goal_id", "session_id", "date"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const x = findSession(g, a.req("session_id"));
    const date = a.date("date", { required: true }) as string;
    const start = a.time("start_time");
    return { ops: [{ type: "move_session", goalId: g.id, sessionId: x.id, date, start }], summary: `Move the ${x.date} session of "${g.title}" to ${date}${start ? ` at ${start}` : ""}.`, result: { moved: true }, label: `Moved a ${g.title} session to ${date}` };
  },
});

// ======== KPIs

const KPI_SOURCES = ["manual", "streak", "completion", "minutes_week", "tasks_week", "pace"] as const;

tool({
  name: "get_kpis",
  kind: "read",
  description: "All KPIs (or one goal's) with current value, target, whether it is on target, 7- and 28-day averages, trend and the last 28 days of values.",
  params: { goal_id: S("Only this goal's KPIs. Leave out for all.") },
  run: (a, ctx) => {
    const only = a.has("goal_id") ? findGoal(ctx.state, a.str("goal_id")).id : undefined;
    const ks = (ctx.state.kpis ?? []).filter((k) => !only || k.goalId === only);
    return {
      result: ks.length
        ? ks.map((k) => {
            const r = kpiReport(ctx.state, k, ctx.t);
            return { id: k.id, name: k.name, goal_id: k.goalId ?? null, unit: k.unit, source: k.source, frequency: k.frequency, target: k.target, direction: k.direction, current: r.current, as_of: r.asOf, on_target: r.onTarget, avg_7d: r.avg7, avg_28d: r.avg28, trend: r.trend, last_28_days: r.series };
          })
        : { note: "No KPIs yet. Create one with create_kpi.", built_in_sources: Object.fromEntries(Object.entries(AUTO_KPIS).map(([k, v]) => [k, v.about])) },
      label: "Read the KPIs",
    };
  },
});

tool({
  name: "create_kpi",
  kind: "write",
  description:
    "Track a number against a target. source=manual for things the person logs (weight, mock-interview score, pages read); or a built-in source computed from the app: streak (days), completion (% of planned minutes done, last 7 days), minutes_week (study minutes, last 7 days), tasks_week (tasks finished, last 7 days), pace (days ahead + or behind -). Built-ins need no name, unit or target unless you want different ones.",
  params: {
    name: S("Name, for example Mock interview score."),
    goal_id: S("The goal it belongs to. Leave out for an overall KPI."),
    source: E("Where values come from.", KPI_SOURCES),
    unit: S("Unit, for example %, min, kg."),
    target: N("The target value."),
    direction: E("Is higher better (up) or lower (down)?", ["up", "down"]),
    frequency: E("How often it is measured.", ["daily", "weekly"]),
  },
  required: ["source"],
  run: (a, ctx) => {
    const source = a.oneOf("source", KPI_SOURCES, { required: true }) as KpiSource;
    const auto = source === "manual" ? null : AUTO_KPIS[source];
    const goalId = a.has("goal_id") ? findGoal(ctx.state, a.str("goal_id")).id : undefined;
    const name = a.str("name", { max: 80 }) ?? auto?.name;
    if (!name) throw new ToolInputError('"name" is required for a manual KPI.');
    const target = a.num("target") ?? auto?.target;
    if (target === undefined) throw new ToolInputError('"target" is required for a manual KPI.');
    const kpi: Kpi = {
      id: uid() + uid(),
      goalId,
      name,
      unit: a.str("unit", { max: 20 }) ?? auto?.unit ?? "",
      target,
      direction: a.oneOf("direction", ["up", "down"] as const) ?? auto?.direction ?? "up",
      frequency: a.oneOf("frequency", ["daily", "weekly"] as const) ?? auto?.frequency ?? "weekly",
      source,
      values: [],
      createdAt: ctx.t,
    };
    const goal = goalId ? ctx.state.goals.find((g) => g.id === goalId)?.title : "overall";
    return { ops: [{ type: "add_kpi", kpi }], summary: `Track "${name}" (${goal}): target ${kpi.direction === "up" ? "at least" : "at most"} ${target} ${kpi.unit}, ${source === "manual" ? "logged by hand" : "computed by the app"}.`, result: { kpi_id: kpi.id }, label: `Started tracking ${name}` };
  },
});

function findKpi(s: AppState, ref: string) {
  const k = (s.kpis ?? []).find((x) => x.id === ref) ?? (s.kpis ?? []).find((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (!k) throw new ToolInputError(`No KPI matches "${ref}". KPIs: ${(s.kpis ?? []).map((x) => `${x.name} (${x.id})`).join("; ") || "none yet"}.`);
  return k;
}

tool({
  name: "update_kpi",
  kind: "write",
  description: "Change a KPI's name, unit, target, direction, frequency or goal.",
  params: { kpi_id: S("KPI id or name."), name: S("New name."), unit: S("New unit."), target: N("New target."), direction: E("Higher or lower is better.", ["up", "down"]), frequency: E("How often.", ["daily", "weekly"]), goal_id: S("Move it to another goal.") },
  required: ["kpi_id"],
  run: (a, ctx) => {
    const k = findKpi(ctx.state, a.req("kpi_id"));
    const patch = {
      ...(a.has("name") ? { name: a.req("name", 80) } : {}),
      ...(a.has("unit") ? { unit: a.str("unit", { max: 20 }) as string } : {}),
      ...(a.has("target") ? { target: a.num("target") as number } : {}),
      ...(a.has("direction") ? { direction: a.oneOf("direction", ["up", "down"] as const) as "up" | "down" } : {}),
      ...(a.has("frequency") ? { frequency: a.oneOf("frequency", ["daily", "weekly"] as const) as "daily" | "weekly" } : {}),
      ...(a.has("goal_id") ? { goalId: findGoal(ctx.state, a.str("goal_id")).id } : {}),
    };
    if (!Object.keys(patch).length) throw new ToolInputError("Nothing to change: give at least one field.");
    return { ops: [{ type: "update_kpi", kpiId: k.id, patch }], summary: `Change ${Object.keys(patch).join(", ")} of KPI "${k.name}".`, result: { updated: true }, label: `Updated KPI ${k.name}` };
  },
});

tool({
  name: "delete_kpi",
  kind: "destructive",
  description: "Stop tracking a KPI and delete its logged values.",
  params: { kpi_id: S("KPI id or name.") },
  required: ["kpi_id"],
  run: (a, ctx) => {
    const k = findKpi(ctx.state, a.req("kpi_id"));
    return { ops: [{ type: "delete_kpi", kpiId: k.id }], summary: `Delete KPI "${k.name}" and its ${k.values.length} logged values.`, result: { deleted: true }, label: `Deleted KPI ${k.name}` };
  },
});

tool({
  name: "log_kpi_value",
  kind: "write",
  description: "Record a value for a manual KPI on a date (default today). Logging the same date again replaces that day's value.",
  params: { kpi_id: S("KPI id or name."), value: N("The value."), date: DATE_P("Date; default today"), note: S("Optional context.") },
  required: ["kpi_id", "value"],
  run: (a, ctx) => {
    const k = findKpi(ctx.state, a.req("kpi_id"));
    const value = a.num("value", { required: true }) as number;
    const date = a.date("date") ?? ctx.t;
    return { ops: [{ type: "log_kpi_value", kpiId: k.id, value: { id: uid() + uid(), date, value, note: a.str("note", { max: 300 }) } }], summary: `Log ${value} ${k.unit} for "${k.name}" on ${date}.`, result: { logged: true }, label: `Logged ${value} ${k.unit} for ${k.name}` };
  },
});

// ======== routines and events

const ROUTINE_FIELDS = { title: S("Name, for example Sleep, Work, Gym."), start_time: TIME_P("Start"), end_time: TIME_P("End (may be earlier than start for overnight, like sleep)"), days: DAYS_P("Days it happens."), color: S("Optional colour as #rrggbb.") };

function routineFrom(a: Args, base?: Routine): Routine {
  const color = a.str("color");
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new ToolInputError('"color" must look like #5c5c5c.');
  return {
    id: base?.id ?? uid() + uid(),
    title: a.str("title", { max: 80 }) ?? base?.title ?? "",
    start: a.time("start_time") ?? base?.start ?? "",
    end: a.time("end_time") ?? base?.end ?? "",
    days: a.days("days") ?? base?.days ?? [],
    color: color ?? base?.color ?? "#5c5c5c",
  };
}

function findRoutine(s: AppState, ref: string) {
  const r = s.routines.find((x) => x.id === ref) ?? s.routines.find((x) => x.title.toLowerCase() === ref.toLowerCase());
  if (!r) throw new ToolInputError(`No routine matches "${ref}". Routines: ${s.routines.map((x) => `${x.title} (${x.id})`).join("; ") || "none"}.`);
  return r;
}

tool({
  name: "create_routine",
  kind: "write",
  description: "Add a recurring block of the person's life (sleep, work, gym, meals) that study is planned around.",
  params: ROUTINE_FIELDS,
  required: ["title", "start_time", "end_time", "days"],
  run: (a) => {
    const r = routineFrom(a);
    return { ops: [{ type: "upsert_routine", routine: r }], summary: `Add routine "${r.title}" ${r.start}-${r.end} on ${daysText(r.days)}.`, result: { routine_id: r.id }, label: `Added routine ${r.title}` };
  },
});

tool({
  name: "update_routine",
  kind: "write",
  description: "Change a routine's name, times, days or colour.",
  params: { routine_id: S("Routine id or name."), ...ROUTINE_FIELDS },
  required: ["routine_id"],
  run: (a, ctx) => {
    const base = findRoutine(ctx.state, a.req("routine_id"));
    const r = routineFrom(a, base);
    return { ops: [{ type: "upsert_routine", routine: r }], summary: `Change routine "${base.title}" to ${r.title} ${r.start}-${r.end} on ${daysText(r.days)}.`, result: { updated: true }, label: `Updated routine ${r.title}` };
  },
});

tool({
  name: "delete_routine",
  kind: "destructive",
  description: "Remove a recurring routine. Study can then be planned in the time it used to block.",
  params: { routine_id: S("Routine id or name.") },
  required: ["routine_id"],
  run: (a, ctx) => {
    const r = findRoutine(ctx.state, a.req("routine_id"));
    return { ops: [{ type: "delete_routine", id: r.id }], summary: `Remove routine "${r.title}".`, result: { deleted: true }, label: `Removed routine ${r.title}` };
  },
});

function findEvent(s: AppState, ref: string) {
  const e = s.events.find((x) => x.id === ref);
  if (!e) throw new ToolInputError(`No event with id "${ref}". Events: ${s.events.map((x) => `${x.date} ${x.title} (${x.id})`).join("; ") || "none"}.`);
  return e;
}

tool({
  name: "create_event",
  kind: "write",
  description: "Add a one-off busy block on a date (a dentist visit, a trip), so no study is placed then.",
  params: { title: S("What it is."), date: DATE_P("Date"), start_time: TIME_P("Start"), end_time: TIME_P("End") },
  required: ["title", "date", "start_time", "end_time"],
  run: (a) => {
    const e = { id: uid() + uid(), title: a.req("title", 120), date: a.date("date", { required: true }) as string, start: a.time("start_time", { required: true }) as string, end: a.time("end_time", { required: true }) as string };
    return { ops: [{ type: "add_event", event: e }], summary: `Add "${e.title}" on ${e.date}, ${e.start}-${e.end}.`, result: { event_id: e.id }, label: `Added event ${e.title}` };
  },
});

tool({
  name: "update_event",
  kind: "write",
  description: "Change a one-off event's title, date or times.",
  params: { event_id: S("Event id (from get_overview)."), title: S("New title."), date: DATE_P("New date"), start_time: TIME_P("New start"), end_time: TIME_P("New end") },
  required: ["event_id"],
  run: (a, ctx) => {
    const base = findEvent(ctx.state, a.req("event_id"));
    const e = { ...base, title: a.str("title", { max: 120 }) ?? base.title, date: a.date("date") ?? base.date, start: a.time("start_time") ?? base.start, end: a.time("end_time") ?? base.end };
    return { ops: [{ type: "update_event", event: e }], summary: `Change "${base.title}" to ${e.title} on ${e.date}, ${e.start}-${e.end}.`, result: { updated: true }, label: `Updated event ${e.title}` };
  },
});

tool({
  name: "delete_event",
  kind: "destructive",
  description: "Remove a one-off event. Study can then be planned in that time again.",
  params: { event_id: S("Event id.") },
  required: ["event_id"],
  run: (a, ctx) => {
    const e = findEvent(ctx.state, a.req("event_id"));
    return { ops: [{ type: "delete_event", id: e.id }], summary: `Remove "${e.title}" on ${e.date}.`, result: { deleted: true }, label: `Removed event ${e.title}` };
  },
});

// ======== settings

const WIDGETS: DashboardWidget[] = ["summary", "kpis", "goals", "paused"];

tool({
  name: "get_settings",
  kind: "read",
  description: "The app's settings: limits in force, whether assistants may auto-apply safe changes, week start, default task length, dashboard sections, theme and model.",
  params: {},
  run: (_a, ctx) => {
    const st = ctx.state.settings;
    return {
      result: {
        limits: limitsOf(ctx.state),
        auto_apply_safe_changes: Boolean(st.autoApplySafe),
        week_start: st.weekStart ?? "mon",
        default_task_minutes: st.defaultTaskMinutes ?? 45,
        dashboard: st.dashboard ?? ["summary", "kpis", "goals", "paused"],
        theme: st.appearance?.theme ?? "dark",
        model: st.keySaved ? `${st.provider} / ${st.model}` : "not connected",
      },
      label: "Read the settings",
    };
  },
});

tool({
  name: "update_settings",
  kind: "write",
  description:
    "Change settings: limits (max_active_goals, max_daily_hours, max_tasks_per_phase, edit_window_days; 0 days = roadmaps never lock), auto_apply_safe_changes, week_start, default_task_minutes, dashboard (which sections the Goals page shows, in order), theme. Changing a limit always needs confirmation: limits exist to keep the person focused.",
  params: {
    max_active_goals: I("Most goals active at once."),
    max_daily_hours: N("Most study hours per day across goals."),
    max_tasks_per_phase: I("Most tasks in one phase."),
    edit_window_days: I("Days after creation during which tasks and phases can be removed; 0 = never lock."),
    auto_apply_safe_changes: B("Let assistants make ordinary changes without asking each time. Deletions always ask."),
    week_start: E("First day of the week.", ["mon", "sun"]),
    default_task_minutes: I("Default length of new tasks, 5 to 600."),
    dashboard: { type: "array", items: { type: "string", enum: WIDGETS }, description: "Goals page sections in order; leave one out to hide it." },
    theme: E("Colour theme.", ["dark", "light", "system"]),
  },
  run: (a, ctx) => {
    const limits = {
      ...(a.has("max_active_goals") ? { maxActiveGoals: a.num("max_active_goals", { min: 1, max: 20, int: true }) } : {}),
      ...(a.has("max_daily_hours") ? { maxDailyHours: a.num("max_daily_hours", { min: 0.5, max: 24 }) } : {}),
      ...(a.has("max_tasks_per_phase") ? { maxTasksPerModule: a.num("max_tasks_per_phase", { min: 1, max: 50, int: true }) } : {}),
      ...(a.has("edit_window_days") ? { editWindowDays: a.num("edit_window_days", { min: 0, max: 365, int: true }) } : {}),
    };
    const dashboard = a.has("dashboard") ? (a.list<string>("dashboard") ?? []).map((w) => {
      if (!WIDGETS.includes(w as DashboardWidget)) throw new ToolInputError(`"dashboard": "${w}" is not a section. Use ${WIDGETS.join(", ")}.`);
      return w as DashboardWidget;
    }) : undefined;
    const theme = a.oneOf("theme", ["dark", "light", "system"] as const);
    const patch = {
      ...(Object.keys(limits).length ? { limits: limits as Record<string, number> } : {}),
      ...(a.bool("auto_apply_safe_changes") !== undefined ? { autoApplySafe: a.bool("auto_apply_safe_changes") } : {}),
      ...(a.has("week_start") ? { weekStart: a.oneOf("week_start", ["mon", "sun"] as const) } : {}),
      ...(a.has("default_task_minutes") ? { defaultTaskMinutes: a.num("default_task_minutes", { min: 5, max: 600, int: true }) } : {}),
      ...(dashboard ? { dashboard } : {}),
      ...(theme ? { appearance: { ...{ theme: "dark", background: "none", backgroundOpacity: 35, glass: false, panelOpacity: 60, blur: 18 }, ...ctx.state.settings.appearance, theme } } : {}),
    } as const;
    if (!Object.keys(patch).length) throw new ToolInputError("Nothing to change: give at least one setting.");
    const L = limitsOf(ctx.state);
    const changes = [
      ...Object.entries(limits).map(([k, v]) => `${k} ${L[k as keyof typeof L]} -> ${v}`),
      ...Object.keys(patch).filter((k) => k !== "limits").map((k) => k),
    ];
    return {
      ops: [{ type: "save_settings", patch: patch as never }],
      destructive: Object.keys(limits).length > 0 || "autoApplySafe" in patch,
      summary: `Change settings: ${changes.join(", ")}.`,
      result: { updated: changes },
      label: "Updated settings",
    };
  },
});

// ======== memories

const MEMORY_KINDS: MemoryKind[] = ["preference", "pattern", "lesson", "fact", "commitment"];

tool({
  name: "list_memories",
  kind: "read",
  description: "Everything saved about the person, with ids, kinds and dates.",
  params: {},
  run: (_a, ctx) => ({ result: ctx.state.memories.length ? ctx.state.memories.map((m) => ({ id: m.id, kind: m.kind, text: m.text, saved: m.createdAt, by: m.source })) : { note: "No memories yet." }, label: "Read the memories" }),
});

tool({
  name: "save_memory",
  kind: "memory",
  description: "Remember one durable thing about the person for future conversations: a preference, a constraint, a commitment they made, or a pattern or lesson the data supports. One short sentence. Do not save one-off remarks or things already in memory.",
  params: { kind: E("What sort of thing.", MEMORY_KINDS), text: S("One short sentence about the person, in third person.") },
  required: ["kind", "text"],
  run: (a, ctx) => {
    const text = a.req("text", 240);
    const exists = ctx.state.memories.some((m) => m.text.toLowerCase() === text.toLowerCase());
    if (exists) return { result: { saved: false, reason: "Already in memory." }, label: "Already knew that" };
    const memory: Memory = { id: uid() + uid(), kind: a.oneOf("kind", MEMORY_KINDS) ?? "fact", text, source: "agent", createdAt: ctx.t };
    return { ops: [{ type: "add_memory", memory }], summary: `Remember: ${text}`, result: { saved: true, memory_id: memory.id }, label: `Remembered: ${text}` };
  },
});

tool({
  name: "update_memory",
  kind: "memory",
  description: "Correct or refine a saved memory, keeping its id. Use list_memories to find it.",
  params: { memory_id: S("Memory id (from list_memories)."), text: S("The corrected sentence."), kind: E("New kind.", MEMORY_KINDS) },
  required: ["memory_id", "text"],
  run: (a, ctx) => {
    const id = a.req("memory_id");
    const m = ctx.state.memories.find((x) => x.id === id);
    if (!m) throw new ToolInputError(`No memory with id "${id}". Use list_memories.`);
    const text = a.req("text", 240);
    return { ops: [{ type: "update_memory", id, text, kind: a.oneOf("kind", MEMORY_KINDS) }], summary: `Change memory "${m.text}" to "${text}".`, result: { updated: true }, label: `Updated a memory: ${text}` };
  },
});

tool({
  name: "delete_memory",
  kind: "destructive",
  description: "Delete a saved memory that turned out wrong or out of date.",
  params: { memory_id: S("Memory id.") },
  required: ["memory_id"],
  run: (a, ctx) => {
    const id = a.req("memory_id");
    const m = ctx.state.memories.find((x) => x.id === id);
    if (!m) throw new ToolInputError(`No memory with id "${id}". Use list_memories.`);
    return { ops: [{ type: "delete_memory", id }], summary: `Forget: ${m.text}`, result: { deleted: true }, label: `Forgot: ${m.text}` };
  },
});

// ======== materials

const MATERIAL_KINDS: MaterialKind[] = ["notion", "drive", "folder", "doc", "sheet", "slides", "pdf", "video", "repo", "local", "link"];

function findMaterial(g: Goal, ref: string) {
  const m = (g.materials ?? []).find((x) => x.id === ref) ?? (g.materials ?? []).find((x) => x.title.toLowerCase() === ref.toLowerCase());
  if (!m) throw new ToolInputError(`"${g.title}" has no material "${ref}". Use list_materials.`);
  return m;
}

/** Where a material goes: a phase and/or task reference, checked against the roadmap. */
function placeFrom(a: Args, g: Goal): Pick<Material, "phaseId" | "taskId"> {
  if (a.has("task_id")) {
    const w = findTask(g, a.str("task_id"));
    return { taskId: w.task.id, phaseId: w.module.id };
  }
  if (a.has("phase")) return { phaseId: findPhase(g, a.str("phase")).m.id };
  return {};
}

tool({
  name: "list_materials",
  kind: "read",
  description:
    "Materials linked to a goal: Notion pages, Google Drive folders and files, docs, sheets, PDFs, videos, code repos, and paths to files on the person's computer, each with what it is for (the goal, a phase or a task). Open web links with your own tools (a Notion or Google Drive connector, or web fetch). Local paths are files on the person's PC: use a file-system tool if you have one, otherwise name the file so they can open it.",
  params: { goal_id: GOAL_ID, phase: S("Only this phase (id or number) and its tasks."), task_id: S("Only this task.") },
  required: ["goal_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const where = a.has("task_id") ? { taskId: findTask(g, a.str("task_id")).task.id } : a.has("phase") ? { phaseId: findPhase(g, a.str("phase")).m.id } : {};
    const list = materialsFor(g, where);
    return {
      result: list.length ? list.map((m) => ({ id: m.id, title: m.title, url: m.url, kind: MATERIAL_LABEL[m.kind], for: placeOf(g, m), added: m.addedAt.slice(0, 10), ...(m.note ? { note: m.note } : {}) })) : { note: "No materials linked here yet. add_material links one." },
      label: `Listed ${list.length} material${list.length === 1 ? "" : "s"} for ${g.title}`,
    };
  },
});

tool({
  name: "read_material",
  kind: "read",
  description:
    "Read a linked material. Notion pages and databases are read in full through the person's Notion connection: text, headings, lists, to-dos, tables and database rows, with images as links. For other links (Drive, docs, PDFs, videos) this returns the link to open with your own tools; for files on the person's computer it returns the path.",
  params: { goal_id: GOAL_ID, material_id: S("Material id or title (from list_materials).") },
  required: ["goal_id", "material_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const m = findMaterial(g, a.req("material_id"));
    const info = { title: m.title, kind: MATERIAL_LABEL[m.kind], url: m.url, for: placeOf(g, m), ...(m.note ? { note: m.note } : {}) };
    if (m.kind === "notion") return { result: info, fetchNotion: m.url, label: `Read "${m.title}" from Notion` };
    return {
      result: { ...info, how_to_read: m.kind === "local" || m.kind === "pdf" && !/^https?:/i.test(m.url) ? "A file on the person's computer: use a file-system tool if you have one, otherwise ask them to open it." : "Open the link with your own tools (Google Drive connector, web fetch)." },
      label: `Looked up "${m.title}"`,
    };
  },
});

tool({
  name: "add_material",
  kind: "write",
  description:
    "Link a material to a goal, or to one of its phases or tasks: a Notion page, a Google Drive file or folder, a doc, a PDF, a video, a repo, any web page, or a path to a file on the person's computer. Only the link is stored; the type and a title are worked out from it if not given.",
  params: { goal_id: GOAL_ID, url: S("The link (https://…) or a file path (C:/Notes/x.pdf, /Users/me/x.md)."), title: S("Name to show; defaults to one taken from the link."), phase: S("Attach to this phase (id or number)."), task_id: S("Attach to this task."), kind: E("Type; detected from the link if left out.", MATERIAL_KINDS), note: S("What it is for.") },
  required: ["goal_id", "url"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const url = a.req("url", 2000);
    const bad = checkMaterialUrl(url);
    if (bad) throw new ToolInputError(bad);
    const material: Material = { id: uid() + uid(), url, title: a.str("title", { max: 200 }) ?? titleFromUrl(url), kind: a.oneOf("kind", MATERIAL_KINDS) ?? detectKind(url), note: a.str("note", { max: 500 }), addedAt: ctx.now, ...placeFrom(a, g) };
    return { ops: [{ type: "add_material", goalId: g.id, material }], summary: `Link ${MATERIAL_LABEL[material.kind]} "${material.title}" to ${placeOf(g, material)} of "${g.title}".`, result: { material_id: material.id }, label: `Linked "${material.title}" to ${g.title}` };
  },
});

tool({
  name: "update_material",
  kind: "write",
  description: "Change a material's title, link, note or where it is attached (goal, phase or task).",
  params: { goal_id: GOAL_ID, material_id: S("Material id or title."), title: S("New title."), url: S("New link or path."), note: S("New note."), phase: S("Move it to this phase."), task_id: S("Move it to this task."), whole_goal: B("Detach it from its phase or task.") },
  required: ["goal_id", "material_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const m = findMaterial(g, a.req("material_id"));
    if (a.has("url")) {
      const bad = checkMaterialUrl(a.req("url"));
      if (bad) throw new ToolInputError(bad);
    }
    const place = a.bool("whole_goal") ? { phaseId: undefined, taskId: undefined } : a.has("phase") || a.has("task_id") ? { taskId: undefined, ...placeFrom(a, g) } : {};
    const patch = { ...(a.has("title") ? { title: a.req("title", 200) } : {}), ...(a.has("url") ? { url: a.req("url", 2000) } : {}), ...(a.has("note") ? { note: a.str("note", { max: 500 }) } : {}), ...place };
    if (!Object.keys(patch).length) throw new ToolInputError("Nothing to change: give at least one field.");
    return { ops: [{ type: "update_material", goalId: g.id, materialId: m.id, patch }], summary: `Change material "${m.title}".`, result: { updated: true }, label: `Updated material ${m.title}` };
  },
});

tool({
  name: "remove_material",
  kind: "destructive",
  description: "Unlink a material from a goal. Only the link is removed; the file or page itself is untouched.",
  params: { goal_id: GOAL_ID, material_id: S("Material id or title.") },
  required: ["goal_id", "material_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const m = findMaterial(g, a.req("material_id"));
    return { ops: [{ type: "remove_material", goalId: g.id, materialId: m.id }], summary: `Unlink "${m.title}" from "${g.title}".`, result: { removed: true }, label: `Unlinked ${m.title}` };
  },
});

// ======== history and memory

tool({
  name: "get_goal_history",
  kind: "read",
  description:
    "The story of one goal since it was created: a dated timeline of every change (created, roadmap written or replaced, phases and tasks added or removed, materials added, schedule changes, pauses), plus the quality of the work: sessions done on time, delays, missed and skipped sessions, how often notes were written, tasks done, extra study, and minutes per week since the start.",
  params: { goal_id: GOAL_ID },
  required: ["goal_id"],
  run: (a, ctx) => {
    const g = findGoal(ctx.state, a.req("goal_id"));
    const q = workQuality(g, ctx.t);
    const events = g.history ?? [];
    const firstRoadmap = events.find((e) => e.kind === "roadmap_written" || (e.kind === "goal_created" && /with a roadmap/.test(e.text)));
    return {
      result: {
        goal: g.title,
        created: g.createdAt,
        roadmap_first_written: firstRoadmap ? firstRoadmap.at.slice(0, 10) : g.roadmap.modules.length ? `${g.createdAt} (with the goal)` : "no roadmap yet",
        materials_linked: (g.materials ?? []).length,
        materials_added: (g.materials ?? []).map((m) => `${m.addedAt.slice(0, 10)} ${m.title}`),
        quality: { sessions_done: `${q.sessionsDone} of ${q.sessionsDue} due (${q.completionRate}%)`, done_on_planned_day: `${q.onTimeRate}%`, average_delay_days: q.averageDelayDays, missed: q.missed, skipped: q.skipped, sessions_with_notes: `${q.notesRate}%`, tasks_done: `${q.tasksDone} of ${q.tasksTotal}`, extra_study: fmtDuration(q.extraMinutes) },
        minutes_per_week_since_start: q.weeks,
        timeline: [...(events[0]?.kind === "goal_created" ? [] : [{ at: g.createdAt, text: "Goal created." }]), ...events.map((e) => ({ at: e.at.slice(0, 16).replace("T", " "), text: e.text }))],
      },
      label: `Read the history of ${g.title}`,
    };
  },
});

tool({
  name: "get_memory_file",
  kind: "read",
  description:
    "Everything about one goal (or all goals) as one Markdown document another model can read and carry on from: the person and their constraints, the goal, where it stands, quality of work, the roadmap with done and remaining tasks and notes, materials, the daily log since creation, the change history, KPIs and the raw data as JSON.",
  params: { goal_id: S("One goal; leave out for all goals."), include_json: B("Add the raw data as JSON at the end (default true).") },
  run: (a, ctx) => {
    const goalId = a.has("goal_id") ? findGoal(ctx.state, a.str("goal_id")).id : undefined;
    const text = buildMemoryFile(ctx.state, ctx.t, { goalId, generatedAt: ctx.now.slice(0, 16), includeJson: a.bool("include_json") ?? true });
    return { result: text, label: `Wrote the memory file${goalId ? "" : " for all goals"}` };
  },
});

// ======== data hygiene

tool({
  name: "export_data",
  kind: "read",
  description: "Everything in the account as JSON: goals with roadmaps and sessions, routines, events, KPIs, memories and settings (no keys or tokens). For a backup or to move the data elsewhere.",
  params: {},
  run: (_a, ctx) => {
    // The live conversation is left out; everything else, without keys, is included
    const rest = { ...ctx.state, chat: undefined };
    return { result: JSON.stringify({ exported_at: ctx.now, format: "where-mylife/1", ...rest }), label: "Exported all data" };
  },
});

const DEMO_TITLES = ["Crack DSA for coding interviews", "Conversational Spanish", "Machine learning foundations"];

tool({
  name: "clear_demo_data",
  kind: "destructive",
  description:
    "Remove the sample data the app starts with: the seeded session notes (the same few sentences repeated across goals) and, if remove_demo_goals is true, the three sample goals. Call without confirming first to see exactly what would be removed.",
  params: { remove_demo_goals: B("Also delete the three sample goals.") },
  run: (a, ctx) => {
    const sample = new Set(SAMPLE_NOTES.filter(Boolean));
    const notes = ctx.state.goals.reduce((n, g) => n + g.sessions.filter((x) => x.note && sample.has(x.note)).length, 0);
    const demoGoals = a.bool("remove_demo_goals") ? ctx.state.goals.filter((g) => DEMO_TITLES.includes(g.title)) : [];
    if (!notes && !demoGoals.length) return { result: { note: "No sample data found." }, label: "Looked for sample data and found none" };
    const ops: Op[] = [{ type: "clear_demo_notes" }, ...demoGoals.map((g): Op => ({ type: "delete_goal", goalId: g.id }))];
    return {
      ops: [{ type: "batch", ops }],
      summary: `Remove ${notes} seeded sample note${notes === 1 ? "" : "s"}${demoGoals.length ? ` and the sample goals ${demoGoals.map((g) => `"${g.title}"`).join(", ")}` : ""}.`,
      result: { sample_notes_removed: notes, goals_removed: demoGoals.map((g) => g.title) },
      label: `Cleared ${notes} sample notes${demoGoals.length ? ` and ${demoGoals.length} sample goals` : ""}`,
    };
  },
});

// ---------------------------------------------------------------- registry

export const TOOLS: ToolSpec[] = T;
export const BY_NAME: Record<string, ToolSpec> = Object.fromEntries(T.map((t) => [t.name, t]));

/** JSON Schema for a tool's input, as MCP and OpenAI-style function calling expect. */
export function inputSchema(spec: ToolSpec, extra: Record<string, Schema> = {}): { type: "object"; properties: Record<string, Schema>; required?: string[] } {
  return { type: "object", properties: { ...spec.params, ...extra }, ...(spec.required?.length ? { required: spec.required } : {}) };
}

/** Run a tool. Input mistakes come back as an error result, never as a thrown exception. */
export function runSpec(spec: ToolSpec, args: Record<string, unknown>, ctx: ToolCtx): ToolOutput & { error?: string } {
  try {
    return spec.run(new Args(args ?? {}), ctx);
  } catch (e) {
    if (e instanceof ToolInputError) return { result: { error: e.message }, error: e.message, label: `Could not ${spec.name.replace(/_/g, " ")}: ${e.message}` };
    if (e instanceof RoadmapError) return { result: { error: e.message }, error: e.message, label: `Could not ${spec.name.replace(/_/g, " ")}: ${e.message}` };
    throw e;
  }
}

/** Does this call need the person's approval? */
export function needsApproval(spec: ToolSpec, out: ToolOutput, autoApplySafe: boolean) {
  if (!out.ops?.length) return false;
  if (spec.kind === "memory") return false;
  if (spec.kind === "destructive" || out.destructive) return true;
  return !autoApplySafe;
}

/** Ops of a call, as one op: several are saved together, all or nothing. */
export const asOne = (ops: Op[]): Op => (ops.length === 1 ? ops[0] : { type: "batch", ops });

/**
 * Try a call's change on a copy of the data first, so a change the rules refuse is reported at once
 * instead of being offered for confirmation. Returns the reason, or null when it would apply.
 */
export function dryRun(state: AppState, ops: Op[], t: string): string | null {
  try {
    applyOp(state, asOne(ops), { t });
    return null;
  } catch (e) {
    if (e instanceof OpError) return e.message;
    throw e;
  }
}

export const isRoutineDayLabel = (d: number) => DAY_LABEL[d];
export { isActive };
