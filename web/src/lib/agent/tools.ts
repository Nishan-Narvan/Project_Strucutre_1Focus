import type { AgentTurn, AppState, Goal, McpServer, McpTool, MemoryKind, Settings, Task, TaskKind } from "../types";
import { addDays, fmtDuration, weekday, WEEKDAYS } from "../date";
import { taskIndex } from "../schedule";
import { RULES } from "../rules";
import { lifeInsight, roadmapTrack } from "../insight";
import { recall } from "./recall";

/**
 * What the agent can do beyond reading the snapshot:
 *   - look deeper into the person's data
 *   - remember things
 *   - change the plan (asks the person first)
 *   - use connected outside services over MCP (asks first unless the tool only reads)
 */

const KINDS: MemoryKind[] = ["preference", "pattern", "lesson", "fact", "commitment"];
const TASK_KINDS: TaskKind[] = ["learn", "practice", "project", "review", "quiz"];
const MAX_MCP_TOOLS = 60;

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});

export const LOCAL_TOOLS: ToolDef[] = [
  fn(
    "get_goal_roadmap",
    "The full roadmap of one goal: every phase with its objective and checkpoint, every task with its length, whether it is done and when the rest is scheduled.",
    { goal_id: { type: "string", description: "The goal_id from the snapshot." } },
    ["goal_id"],
  ),
  fn("get_history", "Day-by-day record of the past: minutes planned and done per goal, with the notes the person wrote on completion.", {
    days: { type: "integer", description: "How many days back, 1 to 60. Default 14." },
    goal_id: { type: "string", description: "Limit to one goal. Leave out for all goals." },
  }),
  fn("get_upcoming", "The plan ahead: the sessions scheduled on each coming day with their start and end times, plus free and committed time.", {
    days: { type: "integer", description: "How many days ahead, 1 to 21. Default 7." },
  }),
  fn(
    "save_memory",
    "Remember one durable thing about the person for future conversations: a preference, a constraint, a commitment they made, or a pattern or lesson the data supports. One short sentence. Do not save one-off remarks or things already in memory.",
    { kind: { type: "string", enum: KINDS }, text: { type: "string", description: "One short sentence, written about the person in third person." } },
    ["kind", "text"],
  ),
  fn("delete_memory", "Delete a saved memory that turned out wrong or out of date.", { memory_id: { type: "string" } }, ["memory_id"]),
  fn(
    "recall",
    "Search everything from the past: saved memories, earlier conversations with the person, and every note they wrote when finishing a session. Use it when they refer to something said or done before, or when history would change your answer.",
    { query: { type: "string", description: "A few keywords for what to look for." } },
    ["query"],
  ),
  fn(
    "reschedule_goal",
    "Re-plan one goal from today: finished work is kept and everything unfinished, including missed sessions, is laid out again from today. The person is asked to approve first.",
    { goal_id: { type: "string" } },
    ["goal_id"],
  ),
  fn(
    "add_task",
    `Add one task to a phase of a goal's roadmap and re-plan the goal from today. At most ${RULES.maxTasksPerModule} tasks per phase. The person is asked to approve first.`,
    {
      goal_id: { type: "string" },
      phase: { type: "integer", description: "Phase number, starting at 1." },
      title: { type: "string" },
      minutes: { type: "integer", description: "Length in minutes, 10 to 240." },
      kind: { type: "string", enum: TASK_KINDS },
      detail: { type: "string", description: "One line on what to do." },
    },
    ["goal_id", "phase", "title", "minutes", "kind"],
  ),
];

export const LOCAL_WRITES = new Set(["reschedule_goal", "add_task"]);

interface McpRef {
  server: McpServer;
  tool: McpTool;
}

const SCHEMA_KEEP = new Set(["type", "description", "properties", "required", "items", "enum", "nullable", "minimum", "maximum", "minItems", "maxItems"]);

/**
 * Reduce a tool's JSON Schema to the plain subset every provider accepts.
 * Outside services describe their tools with the full standard, but Gemini and others
 * reject requests that carry keywords such as anyOf, $ref, default or additionalProperties.
 */
export function plainSchema(input: unknown, depth = 0): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || depth > 8) return { type: "string" };
  let s = input as Record<string, unknown>;
  // A choice between shapes becomes its first real option
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const options = s[key];
    if (Array.isArray(options)) {
      const pick = options.find((o) => o && typeof o === "object" && (o as { type?: unknown }).type !== "null");
      if (pick) s = { ...(pick as Record<string, unknown>), ...(s.description ? { description: s.description } : {}) };
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (!SCHEMA_KEEP.has(k)) continue;
    if (k === "type") out.type = Array.isArray(v) ? (v.find((t) => t !== "null") ?? "string") : v;
    else if (k === "properties" && v && typeof v === "object") out.properties = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([name, sub]) => [name, plainSchema(sub, depth + 1)]));
    else if (k === "items") out.items = plainSchema(Array.isArray(v) ? v[0] : v, depth + 1);
    else if (k === "enum" && Array.isArray(v)) out.enum = v.filter((x) => x !== null).map(String);
    else if (k === "description") out.description = String(v).slice(0, 400);
    else out[k] = v;
  }
  if (s.const !== undefined && s.const !== null) out.enum = [String(s.const)];
  if (!out.type) out.type = out.properties ? "object" : out.items ? "array" : "string";
  if (out.enum) out.type = "string";
  if (out.type === "array" && !out.items) out.items = { type: "string" };
  if (out.type === "object") {
    const props = (out.properties ?? {}) as Record<string, unknown>;
    out.properties = props;
    if (Array.isArray(out.required)) out.required = out.required.filter((r) => typeof r === "string" && r in props);
    if (Array.isArray(out.required) && !out.required.length) delete out.required;
  } else {
    delete out.required;
  }
  return out;
}

/** The tool list for one question: the built-in tools plus those of every enabled connection. */
export function buildTools(settings: Settings): { defs: ToolDef[]; mcp: Record<string, McpRef> } {
  const defs = [...LOCAL_TOOLS];
  const mcp: Record<string, McpRef> = {};
  (settings.mcp ?? []).filter((s) => s.enabled).forEach((server, si) => {
    for (const tool of server.tools) {
      if (Object.keys(mcp).length >= MAX_MCP_TOOLS) return;
      // Function names must be short and plain, and must not collide across servers
      const name = `x${si + 1}_${tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 64);
      if (mcp[name]) continue;
      mcp[name] = { server, tool };
      const schema = plainSchema(tool.inputSchema);
      defs.push({
        type: "function",
        function: {
          name,
          description: `[${server.name}] ${tool.description || tool.name}`.slice(0, 700),
          parameters: schema.type === "object" ? { ...schema, properties: schema.properties ?? {} } : { type: "object", properties: {} },
        },
      });
    }
  });
  return { defs, mcp };
}

export interface ToolContext {
  state: AppState;
  t: string;
  mcp: Record<string, McpRef>;
  /** Turns of this conversation that no longer fit in what the model is sent. */
  olderTurns: AgentTurn[];
  addMemory: (kind: MemoryKind, text: string) => boolean;
  deleteMemory: (id: string) => void;
  reschedule: (goalId: string) => void;
  addTask: (goalId: string, moduleIndex: number, task: Omit<Task, "id">) => boolean;
}

const int = (v: unknown, def: number, max: number, min = 1) => Math.min(max, Math.max(min, Math.round(Number(v)) || def));

/** Models sometimes pass the title where the id belongs; accept both. */
function findGoal(state: AppState, ref: unknown): Goal | undefined {
  const q = String(ref ?? "").trim().toLowerCase();
  if (!q) return undefined;
  return state.goals.find((g) => g.id.toLowerCase() === q) ?? state.goals.find((g) => g.title.toLowerCase().includes(q) || q.includes(g.title.toLowerCase()));
}

const brief = (args: Record<string, unknown>) =>
  Object.entries(args)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n")
    .slice(0, 600);

/**
 * If this call changes something, say what it will do in the person's words so they can approve it.
 * Returns null for calls that only read or only touch the agent's own memory.
 */
export function approvalFor(name: string, args: Record<string, unknown>, ctx: ToolContext): { title: string; detail: string } | null {
  if (LOCAL_WRITES.has(name)) {
    const g = findGoal(ctx.state, args.goal_id);
    if (!g) return null; // the call will fail on its own with a clear error
    if (name === "reschedule_goal") return { title: `Re-plan "${g.title}" from today`, detail: "Finished work stays. Everything unfinished, including missed sessions, is laid out again starting today." };
    return {
      title: `Add a task to "${g.title}"`,
      detail: `Phase ${int(args.phase, 1, 99)}: ${String(args.title ?? "")} (${fmtDuration(int(args.minutes, 30, 240, 10))}, ${String(args.kind ?? "practice")}). The goal is re-planned from today.`,
    };
  }
  const ref = ctx.mcp[name];
  if (ref && !ref.tool.readOnly) return { title: `Use ${ref.server.name}: ${ref.tool.name}`, detail: brief(args) || "No details given." };
  return null;
}

/** Run one tool call. Returns the data for the model and a short line for the person. */
export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<{ result: unknown; label: string }> {
  const { state, t } = ctx;

  if (name === "get_goal_roadmap") {
    const g = findGoal(state, args.goal_id);
    if (!g) return { result: { error: "No goal with that id. Use a goal_id from the snapshot." }, label: "Looked for a goal that does not exist" };
    const track = roadmapTrack(g, t);
    return {
      label: `Read the roadmap for ${g.title}`,
      result: {
        title: g.title,
        phases: g.roadmap.modules.map((m, i) => ({
          phase: i + 1,
          title: m.title,
          level: m.level,
          objective: m.objective,
          checkpoint: m.checkpoint,
          tasks: m.tasks.map((task) => {
            const dates = g.sessions.filter((s) => s.taskId === task.id && !s.done).map((s) => s.date);
            return { title: task.title, kind: task.kind, length: fmtDuration(task.minutes), done: track.isDone(task), ...(dates.length ? { scheduled: dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}` } : {}) };
          }),
        })),
      },
    };
  }

  if (name === "get_history") {
    const days = int(args.days, 14, 60);
    const only = args.goal_id ? findGoal(state, args.goal_id) : undefined;
    const goals = only ? [only] : state.goals;
    const out = [];
    for (let i = days; i >= 1; i--) {
      const date = addDays(t, -i);
      const perGoal = goals
        .map((g) => {
          const idx = taskIndex(g);
          const ss = g.sessions.filter((s) => s.date === date);
          if (!ss.length) return null;
          const notes = ss.filter((s) => s.note).map((s) => `${idx[s.taskId]?.task.title ?? "task"}: ${s.note}`);
          return {
            goal: g.title,
            planned: fmtDuration(ss.reduce((a, s) => a + s.minutes, 0)),
            done: fmtDuration(ss.filter((s) => s.done).reduce((a, s) => a + s.minutes, 0)),
            tasks: [...new Set(ss.map((s) => idx[s.taskId]?.task.title ?? "task"))],
            ...(notes.length ? { notes } : {}),
          };
        })
        .filter(Boolean);
      if (perGoal.length) out.push({ date, weekday: WEEKDAYS[weekday(date)], goals: perGoal });
    }
    return { label: `Looked at the last ${days} days${only ? ` of ${only.title}` : ""}`, result: out.length ? out : { note: "No sessions were scheduled in that period." } };
  }

  if (name === "get_upcoming") {
    const days = int(args.days, 7, 21);
    const life = lifeInsight(state, t, days);
    const out = life.capacity.map((c) => ({
      date: c.date,
      weekday: WEEKDAYS[weekday(c.date)],
      sessions: c.blocks,
      free: fmtDuration(c.free),
      headroom: fmtDuration(c.headroom),
    }));
    return { label: `Checked the next ${days} days`, result: out };
  }

  if (name === "save_memory") {
    const text = String(args.text ?? "").trim().slice(0, 240);
    const kind = KINDS.includes(args.kind as MemoryKind) ? (args.kind as MemoryKind) : "fact";
    if (!text) return { result: { error: "Empty memory." }, label: "Tried to save an empty memory" };
    const saved = ctx.addMemory(kind, text);
    return { label: saved ? `Remembered: ${text}` : "Already knew that", result: saved ? { saved: true } : { saved: false, reason: "Already in memory." } };
  }

  if (name === "delete_memory") {
    const id = String(args.memory_id ?? "");
    const hit = state.memories.find((m) => m.id === id);
    if (!hit) return { result: { error: "No memory with that id." }, label: "Looked for a memory that does not exist" };
    ctx.deleteMemory(id);
    return { label: `Forgot: ${hit.text}`, result: { deleted: true } };
  }

  if (name === "recall") {
    const query = String(args.query ?? "").trim();
    const hits = recall(state, query, { limit: 6, olderTurns: ctx.olderTurns });
    return {
      label: hits.length ? `Looked back for "${query}" and found ${hits.length} match${hits.length === 1 ? "" : "es"}` : `Looked back for "${query}" and found nothing`,
      result: hits.length ? hits.map((h) => ({ from: h.kind, date: h.date, text: h.text })) : { note: "Nothing in memory, past conversations or notes matches that." },
    };
  }

  if (name === "reschedule_goal") {
    const g = findGoal(state, args.goal_id);
    if (!g) return { result: { error: "No goal with that id." }, label: "Looked for a goal that does not exist" };
    ctx.reschedule(g.id);
    return { label: `Re-planned ${g.title} from today`, result: { done: true, note: "Call get_upcoming to see the new plan." } };
  }

  if (name === "add_task") {
    const g = findGoal(state, args.goal_id);
    if (!g) return { result: { error: "No goal with that id." }, label: "Looked for a goal that does not exist" };
    const phase = int(args.phase, 1, 99);
    const title = String(args.title ?? "").trim().slice(0, 120);
    if (!g.roadmap.modules[phase - 1]) return { result: { error: `That goal has ${g.roadmap.modules.length} phases.` }, label: "Tried to add a task to a phase that does not exist" };
    if (!title) return { result: { error: "The task needs a title." }, label: "Tried to add a task with no title" };
    const ok = ctx.addTask(g.id, phase - 1, {
      title,
      minutes: int(args.minutes, 30, 240, 10),
      kind: TASK_KINDS.includes(args.kind as TaskKind) ? (args.kind as TaskKind) : "practice",
      detail: String(args.detail ?? "").slice(0, 300),
    });
    return ok
      ? { label: `Added "${title}" to phase ${phase} of ${g.title}`, result: { added: true } }
      : { label: "Could not add the task: that phase is full", result: { error: `That phase already has ${RULES.maxTasksPerModule} tasks, the limit.` } };
  }

  const ref = ctx.mcp[name];
  if (ref) {
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "call", url: ref.server.url, serverId: ref.server.id, name: ref.tool.name, arguments: args }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { label: `${ref.server.name} failed: ${ref.tool.name}`, result: { error: data.error || `Request failed with status ${res.status}.` } };
      return { label: `${data.isError ? "Tried" : "Used"} ${ref.server.name}: ${ref.tool.name}`, result: data.isError ? { error: data.text } : data.text };
    } catch {
      return { label: `Could not reach ${ref.server.name}`, result: { error: "Could not reach the app's server." } };
    }
  }

  return { result: { error: `Unknown tool ${name}.` }, label: `Tried an unknown tool (${name})` };
}

/** Connect to an MCP server and read its tool list. */
/** With `token`, tests a new connection; with `serverId`, uses the token saved for that connection. */
export async function listMcpTools(url: string, token: string, serverId?: string): Promise<{ tools: McpTool[] } | { error: string }> {
  try {
    const res = await fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "tools", url, ...(token ? { token } : {}), ...(serverId ? { serverId } : {}) }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || `Request failed with status ${res.status}.` };
    return { tools: data.tools ?? [] };
  } catch {
    return { error: "Could not reach the app's server. Check your connection." };
  }
}
