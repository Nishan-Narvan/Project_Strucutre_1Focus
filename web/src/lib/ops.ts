import type { AgentTurn, AppState, DayEvent, Goal, GoalStatus, Kpi, KpiValue, Memory, Module, Roadmap, Routine, Settings, StudyLog, Task } from "./types";
import { buildSessions, taskIndex } from "./schedule";
import { isActive, isEditable, limitsOf } from "./rules";
import { createDemoState, SAMPLE_NOTES } from "./demo";
import { cleanPhase, cleanTask, RoadmapError } from "./roadmap";

/**
 * Every change to a person's data, as a plain object, applied by one pure function.
 * The browser, the in-app assistant and Claude (through MCP) all go through `applyOp`,
 * so limits, validation and re-planning are identical everywhere. The server re-applies
 * each op to its own latest copy, so a browser can never push data the rules forbid.
 *
 * Ids and timestamps travel inside the op, so applying it twice gives the same result.
 */

/** Goal fields a person (or an assistant) may edit. */
export type GoalPatch = Partial<Pick<Goal, "title" | "outcome" | "currentLevel" | "targetLevel" | "known" | "prefs" | "hoursPerDay" | "days" | "prefStart" | "startDate" | "deadline" | "color">>;
export type PhasePatch = Partial<Pick<Module, "title" | "objective" | "checkpoint" | "level" | "key_concepts" | "first_principle" | "zpd_scaffold">>;
export type TaskPatch = Partial<Pick<Task, "title" | "detail" | "minutes" | "kind">>;
export type KpiPatch = Partial<Pick<Kpi, "name" | "unit" | "target" | "direction" | "frequency" | "goalId">>;

export type Op =
  // progress
  | { type: "complete_session"; goalId: string; sessionId: string; note: string; at: string }
  | { type: "complete_task"; goalId: string; taskId: string; note: string; at: string }
  | { type: "reopen_session"; goalId: string; sessionId: string }
  | { type: "reopen_task"; goalId: string; taskId: string }
  | { type: "set_session_note"; goalId: string; sessionId: string; note: string }
  | { type: "skip_session"; goalId: string; sessionId: string; reason: string; at: string }
  | { type: "unskip_session"; goalId: string; sessionId: string }
  | { type: "move_session"; goalId: string; sessionId: string; date: string; start?: string }
  | { type: "log_study"; goalId: string; log: StudyLog }
  | { type: "delete_study_log"; goalId: string; logId: string }
  | { type: "reschedule_goal"; goalId: string }
  // goals
  | { type: "add_goal"; goal: Goal }
  | { type: "update_goal"; goalId: string; patch: GoalPatch }
  | { type: "set_goal_status"; goalId: string; status: GoalStatus; at: string }
  | { type: "delete_goal"; goalId: string }
  // roadmap
  | { type: "set_roadmap"; goalId: string; roadmap: Roadmap }
  | { type: "add_phase"; goalId: string; phase: Module; index?: number }
  | { type: "update_phase"; goalId: string; phaseId: string; patch: PhasePatch }
  | { type: "delete_phase"; goalId: string; phaseId: string }
  | { type: "reorder_phases"; goalId: string; order: string[] }
  | { type: "add_task"; goalId: string; moduleIndex: number; task: Task; index?: number }
  | { type: "update_task"; goalId: string; taskId: string; patch: TaskPatch }
  | { type: "remove_task"; goalId: string; taskId: string }
  | { type: "move_task"; goalId: string; taskId: string; toPhaseId: string; index?: number }
  | { type: "reorder_tasks"; goalId: string; phaseId: string; order: string[] }
  // KPIs
  | { type: "add_kpi"; kpi: Kpi }
  | { type: "update_kpi"; kpiId: string; patch: KpiPatch }
  | { type: "delete_kpi"; kpiId: string }
  | { type: "log_kpi_value"; kpiId: string; value: KpiValue }
  | { type: "delete_kpi_value"; kpiId: string; valueId: string }
  // routines and events
  | { type: "upsert_routine"; routine: Routine }
  | { type: "delete_routine"; id: string }
  | { type: "add_event"; event: DayEvent }
  | { type: "update_event"; event: DayEvent }
  | { type: "delete_event"; id: string }
  // settings, memory, chat, data
  | { type: "save_settings"; patch: Partial<Settings> }
  | { type: "add_memory"; memory: Memory }
  | { type: "update_memory"; id: string; text: string; kind?: Memory["kind"] }
  | { type: "delete_memory"; id: string }
  | { type: "save_chat"; turns: AgentTurn[] }
  | { type: "new_chat"; id: string; endedAt: string }
  | { type: "clear_demo_notes" }
  | { type: "reset_demo" }
  // several changes saved together, all or nothing
  | { type: "batch"; ops: Op[] };

export type OpType = Op["type"];

/** Ops whose before-state is kept in the audit log for undo. Chat traffic is not worth undoing. */
export const AUDITED = (op: Op) => op.type !== "save_chat" && op.type !== "new_chat";

/** A change the rules refuse. The message is shown to the person or returned to the AI as is. */
export class OpError extends Error {}

export interface OpContext {
  /** Today's date where the person is (YYYY-MM-DD). */
  t: string;
}

const MAX_CHAT_TURNS = 80;
const MAX_PAST_CHATS = 40;
const MAX_MEMORIES = 200;
const MAX_KPIS = 40;
const MAX_KPI_VALUES = 730;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function goalOf(s: AppState, goalId: string): Goal {
  const g = s.goals.find((x) => x.id === goalId);
  if (!g) throw new OpError(`There is no goal with id "${goalId}".`);
  return g;
}

const withGoal = (s: AppState, goalId: string, fn: (g: Goal) => Goal): AppState => {
  goalOf(s, goalId);
  return { ...s, goals: s.goals.map((g) => (g.id === goalId ? fn(g) : g)) };
};

/**
 * Lay out a goal's unfinished work again from today (or its start date), keeping finished work.
 * Paused and archived goals keep only what was finished.
 */
export function replan(g: Goal, t: string): Goal {
  const idx = taskIndex(g);
  // Finished sessions of tasks that no longer exist are dropped; the rest point at their task's current phase
  const keep = (x: Goal["sessions"][number]) => (idx[x.taskId] ? { ...x, moduleIndex: idx[x.taskId].moduleIndex } : null);
  const kept = { ...g, sessions: g.sessions.filter((x) => x.done).map(keep).filter((x): x is NonNullable<typeof x> => x !== null) };
  if (!isActive(g)) return kept;
  const from = g.startDate > t ? g.startDate : t;
  return { ...g, sessions: buildSessions(kept, from) };
}

/** Settings that must never be stored in the shared data: they live encrypted, server-side. */
export function stripSecrets(settings: Settings): Settings {
  return { ...settings, apiKey: "", mcp: (settings.mcp ?? []).map((m) => ({ ...m, token: "" })), connector: undefined };
}

const clean = (text: string) => text.trim() || undefined;

function sessionOf(g: Goal, sessionId: string) {
  const x = g.sessions.find((s) => s.id === sessionId);
  if (!x) throw new OpError("That session does not exist. It may have been re-planned; read the plan again.");
  return x;
}

function phaseIndex(g: Goal, phaseId: string) {
  const i = g.roadmap.modules.findIndex((m) => m.id === phaseId);
  if (i === -1) throw new OpError(`That goal has no phase with id "${phaseId}".`);
  return i;
}

function locked(s: AppState, g: Goal, ctx: OpContext, what: string) {
  const days = limitsOf(s).editWindowDays;
  if (!isEditable(g, days, ctx.t)) throw new OpError(`This roadmap is locked: ${what} only in the first ${days} days after a goal is created. The edit window can be changed in Settings.`);
}

/** Active goals and daily hours stay within the limits. */
function checkLoad(s: AppState) {
  const L = limitsOf(s);
  const active = s.goals.filter(isActive);
  if (active.length > L.maxActiveGoals) throw new OpError(`That would make ${active.length} active goals; the limit is ${L.maxActiveGoals}. Pause, archive or finish one first.`);
  const hours = Math.round(active.reduce((a, g) => a + g.hoursPerDay, 0) * 100) / 100;
  if (hours > L.maxDailyHours) throw new OpError(`That would be ${hours} h of study a day across active goals, over the ${L.maxDailyHours} h limit.`);
}

function checkGoal(g: Goal) {
  if (!g.title.trim()) throw new OpError("A goal needs a title.");
  if (!DATE.test(g.startDate) || !DATE.test(g.deadline)) throw new OpError("Dates must be YYYY-MM-DD.");
  if (g.deadline <= g.startDate) throw new OpError("The deadline must be after the start date.");
  if (!(g.hoursPerDay > 0) || g.hoursPerDay > 24) throw new OpError("Daily study time must be more than 0 and at most 24 h.");
  if (!g.days.length || g.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new OpError("Choose at least one study day.");
  if (!TIME.test(g.prefStart)) throw new OpError("The start time must be HH:MM.");
}

const withRoadmap = (g: Goal, modules: Module[]): Goal => ({ ...g, roadmap: { ...g.roadmap, modules } });

function checkKpi(k: Pick<Kpi, "name" | "unit" | "target">) {
  if (!k.name.trim()) throw new OpError("A KPI needs a name.");
  if (!Number.isFinite(k.target)) throw new OpError("A KPI needs a numeric target.");
}

export function applyOp(s: AppState, op: Op, ctx: OpContext): AppState {
  const L = limitsOf(s);
  try {
    switch (op.type) {
      // ---------------- progress
      case "complete_session":
        return withGoal(s, op.goalId, (g) => {
          sessionOf(g, op.sessionId);
          return { ...g, sessions: g.sessions.map((x) => (x.id === op.sessionId ? { ...x, done: true, doneAt: op.at, note: clean(op.note), skipped: undefined } : x)) };
        });

      case "complete_task":
        return withGoal(s, op.goalId, (g) => {
          if (!taskIndex(g)[op.taskId]) throw new OpError("That task does not exist.");
          return { ...g, sessions: g.sessions.map((x) => (x.taskId === op.taskId && !x.done ? { ...x, done: true, doneAt: op.at, note: clean(op.note), skipped: undefined } : x)) };
        });

      case "reopen_session":
        return withGoal(s, op.goalId, (g) => ({ ...g, sessions: g.sessions.map((x) => (x.id === op.sessionId ? { ...x, done: false, doneAt: undefined, note: undefined } : x)) }));

      case "reopen_task":
        return withGoal(s, op.goalId, (g) => ({ ...g, sessions: g.sessions.map((x) => (x.taskId === op.taskId ? { ...x, done: false, doneAt: undefined, note: undefined } : x)) }));

      case "set_session_note":
        return withGoal(s, op.goalId, (g) => {
          sessionOf(g, op.sessionId);
          return { ...g, sessions: g.sessions.map((x) => (x.id === op.sessionId ? { ...x, note: clean(op.note.slice(0, 2000)) } : x)) };
        });

      case "skip_session":
        return withGoal(s, op.goalId, (g) => {
          if (sessionOf(g, op.sessionId).done) throw new OpError("That session is already done; reopen it first if you want to skip it.");
          return { ...g, sessions: g.sessions.map((x) => (x.id === op.sessionId ? { ...x, skipped: { reason: op.reason.trim().slice(0, 300) || "skipped", at: op.at } } : x)) };
        });

      case "unskip_session":
        return withGoal(s, op.goalId, (g) => ({ ...g, sessions: g.sessions.map((x) => (x.id === op.sessionId ? { ...x, skipped: undefined } : x)) }));

      case "move_session":
        return withGoal(s, op.goalId, (g) => {
          if (sessionOf(g, op.sessionId).done) throw new OpError("A finished session cannot be moved.");
          if (!DATE.test(op.date)) throw new OpError("The new date must be YYYY-MM-DD.");
          if (op.start && !TIME.test(op.start)) throw new OpError("The new time must be HH:MM.");
          return { ...g, sessions: g.sessions.map((x) => (x.id === op.sessionId ? { ...x, date: op.date, start: op.start || undefined, skipped: undefined } : x)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) };
        });

      case "log_study":
        return withGoal(s, op.goalId, (g) => {
          if ((g.logs ?? []).some((l) => l.id === op.log.id)) return g;
          if (!DATE.test(op.log.date)) throw new OpError("The date must be YYYY-MM-DD.");
          if (op.log.date > ctx.t) throw new OpError("Study can only be logged for today or earlier.");
          if (!(op.log.minutes > 0) || op.log.minutes > 960) throw new OpError("Logged time must be between 1 and 960 minutes.");
          return { ...g, logs: [...(g.logs ?? []), { ...op.log, note: clean(op.log.note ?? "") }] };
        });

      case "delete_study_log":
        return withGoal(s, op.goalId, (g) => ({ ...g, logs: (g.logs ?? []).filter((l) => l.id !== op.logId) }));

      case "reschedule_goal":
        return withGoal(s, op.goalId, (g) => replan(g, ctx.t));

      // ---------------- goals
      case "add_goal": {
        if (s.goals.some((g) => g.id === op.goal.id)) return s; // a retry
        const goal = { ...op.goal, status: op.goal.status ?? "active" };
        checkGoal(goal);
        const next = { ...s, goals: [...s.goals, goal.sessions.length ? goal : replan(goal, ctx.t)] };
        checkLoad(next);
        return next;
      }

      case "update_goal": {
        const before = goalOf(s, op.goalId);
        const p = op.patch;
        const g: Goal = { ...before, ...p, title: p.title !== undefined ? p.title.trim().slice(0, 160) : before.title };
        checkGoal(g);
        const schedule = ["hoursPerDay", "days", "startDate"].some((k) => k in p && JSON.stringify(p[k as keyof GoalPatch]) !== JSON.stringify(before[k as keyof Goal]));
        const next = { ...s, goals: s.goals.map((x) => (x.id === g.id ? (schedule ? replan(g, ctx.t) : g) : x)) };
        if (isActive(g)) checkLoad(next);
        return next;
      }

      case "set_goal_status": {
        const before = goalOf(s, op.goalId);
        if ((before.status ?? "active") === op.status) return s;
        const g = replan({ ...before, status: op.status, statusAt: op.at }, ctx.t);
        const next = { ...s, goals: s.goals.map((x) => (x.id === g.id ? g : x)) };
        if (op.status === "active") checkLoad(next);
        return next;
      }

      case "delete_goal":
        goalOf(s, op.goalId);
        return { ...s, goals: s.goals.filter((g) => g.id !== op.goalId), kpis: (s.kpis ?? []).filter((k) => k.goalId !== op.goalId) };

      // ---------------- roadmap
      case "set_roadmap":
        return withGoal(s, op.goalId, (g) => {
          const keptIds = new Set(op.roadmap.modules.flatMap((m) => m.tasks.map((t) => t.id)));
          const losing = g.sessions.some((x) => x.done && !keptIds.has(x.taskId));
          if (losing) locked(s, g, ctx, "tasks with finished work can be removed");
          for (const m of op.roadmap.modules) if (m.tasks.length > L.maxTasksPerModule) throw new OpError(`Phase "${m.title}" has ${m.tasks.length} tasks; the limit is ${L.maxTasksPerModule}.`);
          return replan({ ...g, roadmap: op.roadmap }, ctx.t);
        });

      case "add_phase":
        return withGoal(s, op.goalId, (g) => {
          if (g.roadmap.modules.some((m) => m.id === op.phase.id)) return g;
          if (op.phase.tasks.length > L.maxTasksPerModule) throw new OpError(`A phase can have at most ${L.maxTasksPerModule} tasks.`);
          const modules = [...g.roadmap.modules];
          modules.splice(op.index ?? modules.length, 0, op.phase);
          return replan(withRoadmap(g, modules), ctx.t);
        });

      case "update_phase":
        return withGoal(s, op.goalId, (g) => {
          const i = phaseIndex(g, op.phaseId);
          const m = { ...g.roadmap.modules[i], ...op.patch };
          if (!m.title.trim()) throw new OpError("A phase needs a title.");
          return withRoadmap(g, g.roadmap.modules.map((x, j) => (j === i ? m : x)));
        });

      case "delete_phase":
        return withGoal(s, op.goalId, (g) => {
          const i = phaseIndex(g, op.phaseId);
          locked(s, g, ctx, "phases can be removed");
          return replan(withRoadmap(g, g.roadmap.modules.filter((_, j) => j !== i)), ctx.t);
        });

      case "reorder_phases":
        return withGoal(s, op.goalId, (g) => {
          const ids = g.roadmap.modules.map((m) => m.id);
          if (op.order.length !== ids.length || !ids.every((id) => op.order.includes(id))) throw new OpError(`Give every phase id exactly once: ${ids.join(", ")}.`);
          return replan(withRoadmap(g, op.order.map((id) => g.roadmap.modules.find((m) => m.id === id) as Module)), ctx.t);
        });

      case "add_task":
        return withGoal(s, op.goalId, (g) => {
          const m = g.roadmap.modules[op.moduleIndex];
          if (!m) throw new OpError(`That goal has ${g.roadmap.modules.length} phases; there is no phase ${op.moduleIndex + 1}.`);
          if (m.tasks.some((t) => t.id === op.task.id)) return g; // already added: a retry
          if (m.tasks.length >= L.maxTasksPerModule) throw new OpError(`Phase ${op.moduleIndex + 1} already has ${L.maxTasksPerModule} tasks, the limit.`);
          const task = cleanTask(op.task, "Task");
          const tasks = [...m.tasks];
          tasks.splice(op.index ?? tasks.length, 0, task);
          return replan(withRoadmap(g, g.roadmap.modules.map((x, i) => (i === op.moduleIndex ? { ...x, tasks } : x))), ctx.t);
        });

      case "update_task":
        return withGoal(s, op.goalId, (g) => {
          const where = taskIndex(g)[op.taskId];
          if (!where) throw new OpError("That task does not exist.");
          const task = cleanTask({ ...where.task, ...op.patch }, "Task");
          const modules = g.roadmap.modules.map((m, i) => (i === where.moduleIndex ? { ...m, tasks: m.tasks.map((t) => (t.id === op.taskId ? task : t)) } : m));
          const next = withRoadmap(g, modules);
          return task.minutes !== where.task.minutes ? replan(next, ctx.t) : next;
        });

      case "remove_task":
        return withGoal(s, op.goalId, (g) => {
          if (!taskIndex(g)[op.taskId]) throw new OpError("That task does not exist.");
          locked(s, g, ctx, "tasks can be removed");
          const modules = g.roadmap.modules.map((m) => ({ ...m, tasks: m.tasks.filter((t) => t.id !== op.taskId) }));
          return replan({ ...withRoadmap(g, modules), sessions: g.sessions.filter((x) => x.taskId !== op.taskId) }, ctx.t);
        });

      case "move_task":
        return withGoal(s, op.goalId, (g) => {
          const where = taskIndex(g)[op.taskId];
          if (!where) throw new OpError("That task does not exist.");
          const to = phaseIndex(g, op.toPhaseId);
          if (to !== where.moduleIndex && g.roadmap.modules[to].tasks.length >= L.maxTasksPerModule) throw new OpError(`That phase already has ${L.maxTasksPerModule} tasks, the limit.`);
          const modules = g.roadmap.modules.map((m) => ({ ...m, tasks: m.tasks.filter((t) => t.id !== op.taskId) }));
          const tasks = [...modules[to].tasks];
          tasks.splice(Math.min(op.index ?? tasks.length, tasks.length), 0, where.task);
          modules[to] = { ...modules[to], tasks };
          return replan(withRoadmap(g, modules), ctx.t);
        });

      case "reorder_tasks":
        return withGoal(s, op.goalId, (g) => {
          const i = phaseIndex(g, op.phaseId);
          const m = g.roadmap.modules[i];
          const ids = m.tasks.map((t) => t.id);
          if (op.order.length !== ids.length || !ids.every((id) => op.order.includes(id))) throw new OpError(`Give every task id of that phase exactly once: ${ids.join(", ")}.`);
          const tasks = op.order.map((id) => m.tasks.find((t) => t.id === id) as Task);
          return replan(withRoadmap(g, g.roadmap.modules.map((x, j) => (j === i ? { ...x, tasks } : x))), ctx.t);
        });

      // ---------------- KPIs
      case "add_kpi": {
        const kpis = s.kpis ?? [];
        if (kpis.some((k) => k.id === op.kpi.id)) return s;
        if (kpis.length >= MAX_KPIS) throw new OpError(`You can track at most ${MAX_KPIS} KPIs.`);
        if (op.kpi.goalId) goalOf(s, op.kpi.goalId);
        checkKpi(op.kpi);
        return { ...s, kpis: [...kpis, { ...op.kpi, name: op.kpi.name.trim().slice(0, 80), unit: op.kpi.unit.trim().slice(0, 20) }] };
      }

      case "update_kpi": {
        const k = (s.kpis ?? []).find((x) => x.id === op.kpiId);
        if (!k) throw new OpError(`There is no KPI with id "${op.kpiId}".`);
        const next = { ...k, ...op.patch };
        if (next.goalId) goalOf(s, next.goalId);
        checkKpi(next);
        return { ...s, kpis: (s.kpis ?? []).map((x) => (x.id === k.id ? next : x)) };
      }

      case "delete_kpi":
        return { ...s, kpis: (s.kpis ?? []).filter((k) => k.id !== op.kpiId) };

      case "log_kpi_value": {
        const k = (s.kpis ?? []).find((x) => x.id === op.kpiId);
        if (!k) throw new OpError(`There is no KPI with id "${op.kpiId}".`);
        if (k.source !== "manual") throw new OpError(`"${k.name}" is measured automatically from your data; it cannot be logged by hand.`);
        if (k.values.some((v) => v.id === op.value.id)) return s;
        if (!DATE.test(op.value.date)) throw new OpError("The date must be YYYY-MM-DD.");
        if (!Number.isFinite(op.value.value)) throw new OpError("The value must be a number.");
        // One value per day (daily) or per date given: logging the same date again replaces it
        const values = [...k.values.filter((v) => v.date !== op.value.date), { ...op.value, note: clean(op.value.note ?? "") }].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_KPI_VALUES);
        return { ...s, kpis: (s.kpis ?? []).map((x) => (x.id === k.id ? { ...x, values } : x)) };
      }

      case "delete_kpi_value":
        return { ...s, kpis: (s.kpis ?? []).map((k) => (k.id === op.kpiId ? { ...k, values: k.values.filter((v) => v.id !== op.valueId) } : k)) };

      // ---------------- routines and events
      case "upsert_routine": {
        const r = op.routine;
        if (!r.title.trim()) throw new OpError("A routine needs a name.");
        if (!TIME.test(r.start) || !TIME.test(r.end)) throw new OpError("Routine times must be HH:MM.");
        if (!r.days.length) throw new OpError("A routine needs at least one day.");
        return { ...s, routines: s.routines.some((x) => x.id === r.id) ? s.routines.map((x) => (x.id === r.id ? r : x)) : [...s.routines, r] };
      }

      case "delete_routine":
        return { ...s, routines: s.routines.filter((x) => x.id !== op.id) };

      case "add_event":
      case "update_event": {
        const e = op.event;
        if (op.type === "add_event" && s.events.some((x) => x.id === e.id)) return s;
        if (op.type === "update_event" && !s.events.some((x) => x.id === e.id)) throw new OpError(`There is no event with id "${e.id}".`);
        if (!e.title.trim()) throw new OpError("An event needs a title.");
        if (!DATE.test(e.date)) throw new OpError("The event date must be YYYY-MM-DD.");
        if (!TIME.test(e.start) || !TIME.test(e.end)) throw new OpError("Event times must be HH:MM.");
        return { ...s, events: op.type === "add_event" ? [...s.events, e] : s.events.map((x) => (x.id === e.id ? e : x)) };
      }

      case "delete_event":
        return { ...s, events: s.events.filter((x) => x.id !== op.id) };

      // ---------------- settings, memory, chat, data
      case "save_settings": {
        const p = op.patch;
        if (p.limits) {
          const l = { ...s.settings.limits, ...p.limits };
          for (const [k, v] of Object.entries(l)) if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) throw new OpError(`Limit ${k} must be a number of 0 or more.`);
          if (l.maxActiveGoals !== undefined && l.maxActiveGoals < 1) throw new OpError("At least one active goal must be allowed.");
          if (l.maxTasksPerModule !== undefined && l.maxTasksPerModule < 1) throw new OpError("At least one task per phase must be allowed.");
          if (l.maxDailyHours !== undefined && (l.maxDailyHours <= 0 || l.maxDailyHours > 24)) throw new OpError("Daily hours must be more than 0 and at most 24.");
        }
        if (p.defaultTaskMinutes !== undefined && (p.defaultTaskMinutes < 5 || p.defaultTaskMinutes > 600)) throw new OpError("Default task length must be between 5 and 600 minutes.");
        return { ...s, settings: stripSecrets({ ...s.settings, ...p, ...(p.limits ? { limits: { ...s.settings.limits, ...p.limits } } : {}) }) };
      }

      case "add_memory": {
        const text = op.memory.text.trim();
        if (!text) throw new OpError("A memory needs some text.");
        if (s.memories.some((m) => m.id === op.memory.id || m.text.toLowerCase() === text.toLowerCase())) return s;
        return { ...s, memories: [...s.memories, { ...op.memory, text }].slice(-MAX_MEMORIES) };
      }

      case "update_memory": {
        if (!s.memories.some((m) => m.id === op.id)) throw new OpError(`There is no memory with id "${op.id}".`);
        const text = op.text.trim();
        if (!text) throw new OpError("A memory needs some text.");
        return { ...s, memories: s.memories.map((m) => (m.id === op.id ? { ...m, text: text.slice(0, 240), ...(op.kind ? { kind: op.kind } : {}) } : m)) };
      }

      case "delete_memory":
        return { ...s, memories: s.memories.filter((m) => m.id !== op.id) };

      case "save_chat":
        return { ...s, chat: op.turns.slice(-MAX_CHAT_TURNS) };

      case "new_chat": {
        const turns = s.chat.filter((c) => !c.error && c.text).map((c) => ({ role: c.role, text: c.text.slice(0, 1500) }));
        if (turns.length < 2) return { ...s, chat: [] };
        if (s.pastChats.some((p) => p.id === op.id)) return { ...s, chat: [] };
        return { ...s, chat: [], pastChats: [...s.pastChats, { id: op.id, endedAt: op.endedAt, turns }].slice(-MAX_PAST_CHATS) };
      }

      case "clear_demo_notes": {
        const sample = new Set(SAMPLE_NOTES.filter(Boolean));
        return { ...s, goals: s.goals.map((g) => ({ ...g, sessions: g.sessions.map((x) => (x.note && sample.has(x.note) ? { ...x, note: undefined } : x)) })) };
      }

      case "reset_demo":
        // The person's own settings are not demo data, so a reset keeps them
        return { ...normalizeState(createDemoState()), settings: s.settings };

      case "batch":
        return op.ops.reduce((acc, o, i) => {
          try {
            return applyOp(acc, o, ctx);
          } catch (e) {
            if (e instanceof OpError && op.ops.length > 1) throw new OpError(`Change ${i + 1} of ${op.ops.length} (${o.type.replace(/_/g, " ")}): ${e.message} Nothing was saved.`);
            throw e;
          }
        }, s);

      default: {
        const never: never = op;
        throw new OpError(`Unknown change: ${JSON.stringify(never)}`);
      }
    }
  } catch (e) {
    if (e instanceof RoadmapError) throw new OpError(e.message);
    throw e;
  }
}

/** Fill in whatever an older saved state lacks, and drop secrets. Used on load and on import. */
export function normalizeState(raw: Partial<AppState> | null | undefined): AppState {
  const fresh = createDemoState();
  const s = raw ?? {};
  return {
    goals: Array.isArray(s.goals) ? s.goals : [],
    routines: Array.isArray(s.routines) ? s.routines : [],
    events: Array.isArray(s.events) ? s.events : [],
    memories: Array.isArray(s.memories) ? s.memories : [],
    chat: Array.isArray(s.chat) ? s.chat : [],
    pastChats: Array.isArray(s.pastChats) ? s.pastChats : [],
    kpis: Array.isArray(s.kpis) ? s.kpis : [],
    settings: stripSecrets({ ...fresh.settings, ...(s.settings ?? {}) }),
  };
}

export const emptyState = (): AppState => ({ ...normalizeState({}), settings: createDemoState().settings });

/** Re-export so tools can build phases with the same validation. */
export { cleanPhase };
