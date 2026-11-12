import { createHmac } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { asOne, dryRun, inputSchema, needsApproval, runSpec, TOOLS, BY_NAME, type ToolSpec } from "@/lib/tools/registry";
import { OpError } from "@/lib/ops";
import { lastAudit, loadState, NotConfigured, userForConnector, validToken } from "@/lib/server/supabase";
import { applyForUser, todayIn, undoLast } from "@/lib/server/state";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Where MyLife as a remote MCP server, for claude.ai's "Add custom connector".
 * The secret token in the URL identifies the account; only its hash is stored.
 *
 * Every tool comes from the shared registry (lib/tools/registry.ts), the same one the in-app
 * assistant uses. Changes apply straight to the account through the same rules as the app's own
 * buttons, are recorded in the audit log as "claude", and show in the app within seconds.
 *
 * Approval happens in the chat: a change that needs it returns a plain-language preview and a
 * confirm_token instead of being applied. Calling again with the same arguments plus that token
 * applies it. The token is an HMAC of the account, tool and arguments over a 15-minute window,
 * so it cannot be reused for a different change.
 */

const INSTRUCTIONS = `Where MyLife is the person's own learning-goal tracker: goals, roadmaps of phases and tasks, daily study sessions planned around routines, KPIs, and notes written when sessions are finished. You can run the whole app from here.
Start with get_overview: figures computed by the app from their real data (progress, pace, completion by weekday and time of day, capacity, KPIs, limits, memories). Use get_goal, get_goal_roadmap, get_capacity, get_kpis and the others for detail before changing anything.
Honesty: never invent figures, tasks, dates or patterns. Back each judgement with a number from the data, and say when there is too little data to call something a pattern (under about 8 past sessions). Do not flatter; if they are behind, say so plainly.
Roadmaps: when asked to create one, write it yourself with set_roadmap (or create_goal's roadmap field): first principles, start at their current level, realistic total minutes for the time to the deadline, concrete tasks and checkpoints, only real resource links. When reviewing one, read it with get_goal_roadmap, critique it plainly, and apply changes (set_roadmap or bulk_update_roadmap) only when the person agrees.
Changes: only make them when the person asks. Some changes come back with "Not done yet" and a confirm_token: show the person what will happen, and only after they agree, call the same tool again with the same arguments plus confirm_token. Never confirm on your own. Changes that pass apply immediately and appear in the app. undo_last_change reverses the most recent change; get_recent_changes lists what changed.`;

const CONFIRM_P = { type: "string", description: "Leave out on the first call. If the reply says the change needs confirming, ask the person, and once they agree call again with the same arguments plus this token." };
const REQUEST_P = { type: "string", description: "Optional id that makes a retry safe: the same request_id is never applied twice." };

const toMcp = (spec: ToolSpec) => ({
  name: spec.name,
  description: spec.description,
  inputSchema: inputSchema(spec, spec.kind === "read" ? {} : { confirm_token: CONFIRM_P, request_id: REQUEST_P }),
  annotations: { readOnlyHint: spec.kind === "read", destructiveHint: spec.kind === "destructive", idempotentHint: spec.kind === "read" },
});

const EXTRA = [
  {
    name: "undo_last_change",
    description: "Reverse the most recent change to the person's data, whoever made it (the app, its assistant or you). Use it when a change was a mistake.",
    inputSchema: { type: "object" as const, properties: { confirm_token: CONFIRM_P } },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: "get_recent_changes",
    description: "The most recent changes to the person's data: when, who made them (web = the person in the app, assistant = the in-app assistant, claude = you) and what they were. undo_last_change reverses the newest one.",
    inputSchema: { type: "object" as const, properties: { limit: { type: "integer", description: "How many, 1 to 30. Default 10." } } },
    annotations: { readOnlyHint: true },
  },
];

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

/** Stable text for a set of arguments, so the same change always gets the same token. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .filter((k) => k !== "confirm_token" && k !== "request_id")
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

const WINDOW_MS = 15 * 60 * 1000;
function confirmToken(userId: string, name: string, args: unknown, slot = Math.floor(Date.now() / WINDOW_MS)) {
  const key = process.env.WML_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "where-mylife";
  return createHmac("sha256", key).update(`${userId}|${name}|${canonical(args)}|${slot}`).digest("base64url").slice(0, 12);
}
/** A token from this 15-minute window or the previous one is accepted. */
function confirmed(userId: string, name: string, args: Record<string, unknown>) {
  const given = String(args.confirm_token ?? "");
  if (!given) return false;
  const slot = Math.floor(Date.now() / WINDOW_MS);
  return given === confirmToken(userId, name, args, slot) || given === confirmToken(userId, name, args, slot - 1);
}

function preview(userId: string, name: string, args: Record<string, unknown>, summary: string, destructive: boolean) {
  return text(
    `Not done yet: this change needs the person's confirmation.\n\nIt will: ${summary}\n${destructive ? "This removes or replaces something; undo_last_change can still reverse it right after.\n" : ""}\nAsk the person. Only if they agree, call ${name} again with the same arguments plus confirm_token: "${confirmToken(userId, name, args)}".`,
  );
}

function buildServer(userId: string) {
  const server = new Server({ name: "where-mylife", version: "0.3.0" }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS.map(toMcp), ...EXTRA] }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (name === "get_recent_changes") {
        const n = Math.min(30, Math.max(1, Math.round(Number(args.limit) || 10)));
        const rows = await lastAudit(userId, n, false);
        return text(rows.length ? rows.map((r) => `- ${r.at.slice(0, 16).replace("T", " ")} UTC, by ${r.actor}: ${r.op.replace(/_/g, " ")}`).join("\n") : "No changes recorded yet.");
      }
      if (name === "undo_last_change") {
        const [last] = await lastAudit(userId, 1, false);
        if (!last) return text("There is nothing to undo.");
        if (!confirmed(userId, name, args)) return preview(userId, name, args, `reverse the most recent change: ${last.op.replace(/_/g, " ")} by ${last.actor} at ${last.at.slice(0, 16).replace("T", " ")} UTC.`, true);
        const r = await undoLast(userId, "claude");
        return text(`Undone: ${r.undone.replace(/_/g, " ")}. The app shows it within a few seconds.`);
      }

      const spec = BY_NAME[name];
      if (!spec) return text(`Unknown tool "${name}".`, true);
      const row = await loadState(userId);
      if (!row) return text("This account has no data yet. Open Where MyLife and sign in to set it up.", true);
      const t = todayIn(row.state.settings?.timezone);
      const out = runSpec(spec, args, { state: row.state, t, now: new Date().toISOString() });
      const body = typeof out.result === "string" ? out.result : JSON.stringify(out.result, null, 1);
      if (out.error) return text(out.error, true);
      if (!out.ops?.length) return text(body);
      const refusal = dryRun(row.state, out.ops, t);
      if (refusal) return text(`Refused: ${refusal}`, true);

      if (needsApproval(spec, out, Boolean(row.state.settings.autoApplySafe)) && !confirmed(userId, name, args))
        return preview(userId, name, args, out.summary ?? out.label, spec.kind === "destructive" || Boolean(out.destructive));

      const requestId = typeof args.request_id === "string" ? `claude:${args.request_id.slice(0, 60)}` : undefined;
      const saved = await applyForUser(userId, asOne(out.ops), "claude", requestId);
      return text(`${saved.duplicate ? "Already applied earlier (same request_id); nothing changed." : "Done."} ${out.summary ?? ""}\n\n${body}\n\nThe app shows the change within a few seconds.`);
    } catch (e) {
      if (e instanceof OpError) return text(`Refused: ${e.message}`, true);
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
