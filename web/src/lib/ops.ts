import type { AgentTurn, AppState, DayEvent, Goal, Memory, Routine, Settings, Task } from "./types";
import { buildSessions } from "./schedule";
import { isEditable, RULES } from "./rules";
import { createDemoState } from "./demo";

/**
 * Every change to a person's data, as a plain object, applied by one pure function.
 * The browser, the in-app assistant and Claude (through MCP) all go through `applyOp`,
 * so limits, validation and re-planning are identical everywhere. The server re-applies
 * each op to its own latest copy, so a browser can never push data the rules forbid.
 *
 * Ids and timestamps travel inside the op, so applying it twice gives the same result.
 */
export type Op =
  | { type: "complete_session"; goalId: string; sessionId: string; note: string; at: string }
  | { type: "complete_task"; goalId: string; taskId: string; note: string; at: string }
  | { type: "reopen_session"; goalId: string; sessionId: string }
  | { type: "reopen_task"; goalId: string; taskId: string }
  | { type: "reschedule_goal"; goalId: string }
  | { type: "add_task"; goalId: string; moduleIndex: number; task: Task }
  | { type: "remove_task"; goalId: string; taskId: string }
  | { type: "add_goal"; goal: Goal }
  | { type: "delete_goal"; goalId: string }
  | { type: "upsert_routine"; routine: Routine }
  | { type: "delete_routine"; id: string }
  | { type: "add_event"; event: DayEvent }
  | { type: "delete_event"; id: string }
  | { type: "save_settings"; patch: Partial<Settings> }
  | { type: "add_memory"; memory: Memory }
  | { type: "delete_memory"; id: string }
  | { type: "save_chat"; turns: AgentTurn[] }
  | { type: "new_chat"; id: string; endedAt: string }
  | { type: "reset_demo" };

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

function goalOf(s: AppState, goalId: string): Goal {
  const g = s.goals.find((x) => x.id === goalId);
  if (!g) throw new OpError(`There is no goal with id "${goalId}".`);
  return g;
}

const withGoal = (s: AppState, goalId: string, fn: (g: Goal) => Goal): AppState => {
  goalOf(s, goalId);
  return { ...s, goals: s.goals.map((g) => (g.id === goalId ? fn(g) : g)) };
};

/** Settings that must never be stored in the shared data: they live encrypted, server-side. */
export function stripSecrets(settings: Settings): Settings {
  return { ...settings, apiKey: "", mcp: (settings.mcp ?? []).map((m) => ({ ...m, token: "" })), connector: undefined };
}

const clean = (text: string) => text.trim() || undefined;

export function applyOp(s: AppState, op: Op, ctx: OpContext): AppState {
  switch (op.type) {
    case "complete_session":
      return withGoal(s, op.goalId, (g) => {
        if (!g.sessions.some((x) => x.id === op.sessionId)) throw new OpError("That session does not exist.");
        return { ...g, sessions: g.sessions.map((x) => (x.id === op.sessionId ? { ...x, done: true, doneAt: op.at, note: clean(op.note) } : x)) };
      });

    case "complete_task":
      return withGoal(s, op.goalId, (g) => ({
        ...g,
        sessions: g.sessions.map((x) => (x.taskId === op.taskId && !x.done ? { ...x, done: true, doneAt: op.at, note: clean(op.note) } : x)),
      }));

    case "reopen_session":
      return withGoal(s, op.goalId, (g) => ({ ...g, sessions: g.sessions.map((x) => (x.id === op.sessionId ? { ...x, done: false, doneAt: undefined, note: undefined } : x)) }));

    case "reopen_task":
      return withGoal(s, op.goalId, (g) => ({ ...g, sessions: g.sessions.map((x) => (x.taskId === op.taskId ? { ...x, done: false, doneAt: undefined, note: undefined } : x)) }));

    case "reschedule_goal":
      return withGoal(s, op.goalId, (g) => ({ ...g, sessions: buildSessions(g, ctx.t) }));

    case "add_task":
      return withGoal(s, op.goalId, (g) => {
        const m = g.roadmap.modules[op.moduleIndex];
        if (!m) throw new OpError(`That goal has ${g.roadmap.modules.length} phases; there is no phase ${op.moduleIndex + 1}.`);
        if (m.tasks.some((t) => t.id === op.task.id)) return g; // already added: a retry
        if (m.tasks.length >= RULES.maxTasksPerModule) throw new OpError(`Phase ${op.moduleIndex + 1} already has ${RULES.maxTasksPerModule} tasks, the limit.`);
        if (!op.task.title.trim()) throw new OpError("A task needs a title.");
        const modules = g.roadmap.modules.map((x, i) => (i === op.moduleIndex ? { ...x, tasks: [...x.tasks, op.task] } : x));
        const next = { ...g, roadmap: { ...g.roadmap, modules } };
        return { ...next, sessions: buildSessions(next, ctx.t) };
      });

    case "remove_task":
      return withGoal(s, op.goalId, (g) => {
        if (!isEditable(g)) throw new OpError(`This roadmap is locked: tasks can only be removed in the first ${RULES.editWindowDays} days.`);
        const modules = g.roadmap.modules.map((m) => ({ ...m, tasks: m.tasks.filter((t) => t.id !== op.taskId) }));
        const next = { ...g, roadmap: { ...g.roadmap, modules }, sessions: g.sessions.filter((x) => x.taskId !== op.taskId) };
        return { ...next, sessions: buildSessions(next, ctx.t) };
      });

    case "add_goal": {
      if (s.goals.some((g) => g.id === op.goal.id)) return s; // a retry
      if (s.goals.length >= RULES.maxActiveGoals) throw new OpError(`You already have ${RULES.maxActiveGoals} goals, the limit. Finish or delete one first.`);
      const hours = s.goals.reduce((a, g) => a + g.hoursPerDay, 0) + op.goal.hoursPerDay;
      if (hours > RULES.maxDailyHours) throw new OpError(`That would be ${hours} h of study a day across all goals, over the ${RULES.maxDailyHours} h limit.`);
      return { ...s, goals: [...s.goals, op.goal] };
    }

    case "delete_goal":
      goalOf(s, op.goalId);
      return { ...s, goals: s.goals.filter((g) => g.id !== op.goalId) };

    case "upsert_routine": {
      const r = op.routine;
      if (!/^\d{2}:\d{2}$/.test(r.start) || !/^\d{2}:\d{2}$/.test(r.end)) throw new OpError("Routine times must be HH:MM.");
      return { ...s, routines: s.routines.some((x) => x.id === r.id) ? s.routines.map((x) => (x.id === r.id ? r : x)) : [...s.routines, r] };
    }

    case "delete_routine":
      return { ...s, routines: s.routines.filter((x) => x.id !== op.id) };

    case "add_event":
      if (s.events.some((e) => e.id === op.event.id)) return s;
      return { ...s, events: [...s.events, op.event] };

    case "delete_event":
      return { ...s, events: s.events.filter((x) => x.id !== op.id) };

    case "save_settings":
      return { ...s, settings: stripSecrets({ ...s.settings, ...op.patch }) };

    case "add_memory": {
      const text = op.memory.text.trim();
      if (!text) throw new OpError("A memory needs some text.");
      if (s.memories.some((m) => m.id === op.memory.id || m.text.toLowerCase() === text.toLowerCase())) return s;
      return { ...s, memories: [...s.memories, { ...op.memory, text }].slice(-MAX_MEMORIES) };
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

    case "reset_demo":
      // The person's own settings are not demo data, so a reset keeps them
      return { ...createDemoState(), settings: s.settings };

    default: {
      const never: never = op;
      throw new OpError(`Unknown change: ${JSON.stringify(never)}`);
    }
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
    settings: stripSecrets({ ...fresh.settings, ...(s.settings ?? {}) }),
  };
}

export const emptyState = (): AppState => ({ ...normalizeState({}), settings: createDemoState().settings });
