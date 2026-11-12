import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { LOCAL_TOOLS, runTool, type ToolContext } from "@/lib/agent/tools";
import { snapshotText } from "@/lib/insight";
import { RULES } from "@/lib/rules";
import { uid } from "@/lib/date";
import { applyOp, OpError, type Op } from "@/lib/ops";
import { loadState, NotConfigured, userForConnector, validToken } from "@/lib/server/supabase";
import { applyForUser, todayIn, undoLast } from "@/lib/server/state";
import type { AppState } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Where MyLife as a remote MCP server, for claude.ai's "Add custom connector".
 * The secret token in the URL identifies the account; only its hash is stored.
 * Reads and writes go straight to the account's data: changes apply at once, through
 * the same rules as the app's own buttons, and are recorded in the audit log as "claude".
 */

const INSTRUCTIONS = `Where MyLife is the person's own learning-goal tracker: goals, roadmaps of phases and tasks, daily study sessions planned around routines, and notes written when sessions are finished.
Start with get_overview: it gives figures computed by the app from their real data (progress, pace, completion rates by weekday and time of day, capacity for the coming week, saved memories). Use the other tools for detail.
Never invent figures, tasks, dates or patterns. Back each judgement with a number from the data, and say when there is too little data to call something a pattern (under about 8 past sessions). If the data does not show something, say so. Do not flatter; if they are behind, say so plainly.
Changes apply immediately and show in the app. Only make them when the person asks. undo_last_change reverses the most recent change. Limits: at most ${RULES.maxActiveGoals} active goals, ${RULES.maxDailyHours}h of study a day, ${RULES.maxTasksPerModule} tasks a phase.`;

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
    description: READ_ONLY.has(t.function.name) ? t.function.description : `${t.function.description.replace(/ The person is asked to approve first\./, "")} Applies immediately.`,
    inputSchema: t.function.parameters as { type: "object"; properties?: Record<string, unknown> },
    annotations: { readOnlyHint: READ_ONLY.has(t.function.name), destructiveHint: t.function.name === "delete_memory" },
  })),
  {
    name: "undo_last_change",
    description: "Reverse the most recent change to the person's data, whoever made it (the app, its assistant or you). Use it when a change was a mistake.",
    inputSchema: { type: "object" as const, properties: {} },
    annotations: { title: "Undo the last change", readOnlyHint: false, destructiveHint: true },
  },
];

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

function buildServer(userId: string) {
  const server = new Server({ name: "where-mylife", version: "0.2.0" }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (name === "undo_last_change") {
        const r = await undoLast(userId, "claude");
        return text(`Undone: ${r.undone.replace(/_/g, " ")}. The app shows the change within a few seconds.`);
      }
      const row = await loadState(userId);
      if (!row) return text("This account has no data yet. Open Where MyLife and sign in to set it up.", true);
      const t = todayIn(row.state.settings?.timezone);
      if (name === "get_overview") return text(`Today for the person is ${t}.\n\n${snapshotText(row.state, t)}`);

      // Tools record the changes they want; each is checked against a local copy first so the tool can
      // report problems, then saved to the account with the same rules as everywhere else.
      let local: AppState = row.state;
      const ops: Op[] = [];
      const record = (op: Op) => {
        try {
          local = applyOp(local, op, { t });
          ops.push(op);
          return true;
        } catch (e) {
          if (e instanceof OpError) return false;
          throw e;
        }
      };
      const ctx: ToolContext = {
        state: row.state,
        t,
        mcp: {},
        olderTurns: [],
        addMemory: (kind, memory) => record({ type: "add_memory", memory: { id: uid(), kind, text: memory, source: "agent", createdAt: t } }) && !row.state.memories.some((m) => m.text.toLowerCase() === memory.trim().toLowerCase()),
        deleteMemory: (id) => void record({ type: "delete_memory", id }),
        reschedule: (goalId) => void record({ type: "reschedule_goal", goalId }),
        addTask: (goalId, moduleIndex, task) => {
          const m = row.state.goals.find((g) => g.id === goalId)?.roadmap.modules[moduleIndex];
          return record({ type: "add_task", goalId, moduleIndex, task: { ...task, id: `${m?.id ?? "m"}x${uid()}` } });
        },
      };

      const { result } = await runTool(name, args, ctx);
      for (const op of ops) await applyForUser(userId, op, "claude");
      const body = typeof result === "string" ? result : JSON.stringify(result, null, 1);
      const isError = typeof result === "object" && result !== null && "error" in result;
      return text(ops.length ? `${body}\n\nSaved. The app shows the change within a few seconds.` : body, isError);
    } catch (e) {
      return text(e instanceof Error ? e.message : "Something went wrong.", true);
    }
  });

  return server;
}

async function handle(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Unknown or malformed tokens look exactly like a missing page
  if (!validToken(token)) return new Response("Not found", { status: 404 });
  try {
    const userId = await userForConnector(token);
    if (!userId) return new Response("Not found", { status: 404 });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await buildServer(userId).connect(transport);
    return await transport.handleRequest(req);
  } catch (e) {
    const status = e instanceof NotConfigured ? 503 : 500;
    return Response.json({ jsonrpc: "2.0", error: { code: -32603, message: e instanceof Error ? e.message : "Server error" }, id: null }, { status });
  }
}

export { handle as GET, handle as POST, handle as DELETE };
