import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { LOCAL_TOOLS, runTool, type ToolContext } from "@/lib/agent/tools";
import { snapshotText } from "@/lib/insight";
import { RULES } from "@/lib/rules";
import { hashToken, loadSnapshot, NotConfigured, queueAction, validToken, type ConnectorAction } from "@/lib/server/supabase";
import type { MemoryKind } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Where MyLife as a remote MCP server, for claude.ai's "Add custom connector".
 * The secret token in the URL picks the person's data; only its hash is stored.
 * Reads come from the copy the app syncs to Supabase. Changes are queued and the app
 * applies them through its own rules the next time it is open.
 */

const INSTRUCTIONS = `Where MyLife is the person's own learning-goal tracker: goals, roadmaps of phases and tasks, daily study sessions planned around routines, and notes written when sessions are finished.
Start with get_overview: it gives figures computed by the app from their real data (progress, pace, completion rates by weekday and time of day, capacity for the coming week, saved memories). Use the other tools for detail.
Never invent figures, tasks, dates or patterns. Back each judgement with a number from the data, and say when there is too little data to call something a pattern (under about 8 past sessions). If the data does not show something, say so. Do not flatter; if they are behind, say so plainly.
Changes (reschedule_goal, add_task, save_memory, delete_memory) are queued and applied the next time the app is open in their browser. Only make them when the person asks. Limits: at most ${RULES.maxActiveGoals} active goals, ${RULES.maxDailyHours}h of study a day, ${RULES.maxTasksPerModule} tasks a phase.`;

const READ_ONLY = new Set(["get_overview", "get_goal_roadmap", "get_history", "get_upcoming", "recall"]);

const TOOLS = [
  {
    name: "get_overview",
    description:
      "Start here. The whole picture computed from the person's data: every goal with progress, pace against the deadline, 28-day completion, missed sessions and recent notes; completion by weekday and time of day; free time and realistic capacity for the next 7 days; routines; saved memories.",
    inputSchema: { type: "object" as const, properties: {} },
    annotations: { title: "Overview of goals and progress", readOnlyHint: true },
  },
  ...LOCAL_TOOLS.map((t) => ({
    name: t.function.name,
    description: READ_ONLY.has(t.function.name) ? t.function.description : `${t.function.description} Queued; it takes effect the next time the app is open.`,
    inputSchema: t.function.parameters as { type: "object"; properties?: Record<string, unknown> },
    annotations: { readOnlyHint: READ_ONLY.has(t.function.name), destructiveHint: t.function.name === "delete_memory" },
  })),
];

/** Today's date where the person is, since the server's clock may be in another time zone. */
function todayIn(timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

function buildServer(hash: string) {
  const server = new Server({ name: "where-mylife", version: "0.1.0" }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    let snap;
    try {
      snap = await loadSnapshot(hash);
    } catch (e) {
      return text(e instanceof Error ? e.message : "Could not read the data.", true);
    }
    if (!snap) return text("No data has reached the server yet. Open Where MyLife in the browser with the Claude connector turned on in Settings, then try again.", true);

    const t = todayIn(snap.timezone);
    const synced = `Data last synced from the app at ${snap.updated_at} (UTC). Today for the person is ${t}.`;
    if (name === "get_overview") return text(`${synced}\n\n${snapshotText(snap.state, t)}`);

    const queued: ConnectorAction[] = [];
    const ctx: ToolContext = {
      state: snap.state,
      t,
      mcp: {},
      olderTurns: [],
      addMemory: (kind: MemoryKind, memory: string) => {
        if ((snap.state.memories ?? []).some((m) => m.text.toLowerCase() === memory.trim().toLowerCase())) return false;
        queued.push({ type: "save_memory", kind, text: memory });
        return true;
      },
      deleteMemory: (id) => void queued.push({ type: "delete_memory", memory_id: id }),
      reschedule: (goalId) => void queued.push({ type: "reschedule_goal", goal_id: goalId }),
      addTask: (goalId, moduleIndex, task) => {
        const g = snap.state.goals.find((x) => x.id === goalId);
        if (!g || g.roadmap.modules[moduleIndex].tasks.length >= RULES.maxTasksPerModule) return false;
        queued.push({ type: "add_task", goal_id: goalId, phase: moduleIndex + 1, title: task.title, minutes: task.minutes, kind: task.kind, detail: task.detail });
        return true;
      },
    };

    const { result } = await runTool(name, args, ctx);
    try {
      for (const a of queued) await queueAction(hash, a);
    } catch (e) {
      return text(`Could not queue the change: ${e instanceof Error ? e.message : "unknown error"}`, true);
    }
    const body = typeof result === "string" ? result : JSON.stringify(result, null, 1);
    const isError = typeof result === "object" && result !== null && "error" in result;
    return text(queued.length ? `${body}\n\nQueued. It takes effect the next time Where MyLife is open in the browser (within about a minute if it is open now).` : body, isError);
  });

  return server;
}

async function handle(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Unknown or malformed tokens look exactly like a missing page
  if (!validToken(token)) return new Response("Not found", { status: 404 });
  try {
    const hash = await hashToken(token);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await buildServer(hash).connect(transport);
    return await transport.handleRequest(req);
  } catch (e) {
    const status = e instanceof NotConfigured ? 503 : 500;
    return Response.json({ jsonrpc: "2.0", error: { code: -32603, message: e instanceof Error ? e.message : "Server error" }, id: null }, { status });
  }
}

export { handle as GET, handle as POST, handle as DELETE };
