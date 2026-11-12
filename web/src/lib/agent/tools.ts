import type { AgentTurn, AppState, McpServer, McpTool, Settings } from "../types";
import type { Op } from "../ops";
import { asOne, BY_NAME, dryRun, inputSchema, needsApproval, runSpec, TOOLS } from "../tools/registry";

/**
 * The in-app assistant's tools: every tool of the shared registry (lib/tools/registry.ts, the same
 * ones Claude gets through the connector), plus the tools of outside services the person connected
 * over MCP. Changes ask the person first, except memory notes and, when the person allows it in
 * Settings, ordinary non-destructive changes. Deletions always ask.
 */

const MAX_MCP_TOOLS = 60;
/** Left out in the app: the overview is already in the assistant's prompt, and an export is for Claude or a download. */
const NOT_IN_APP = new Set(["get_overview", "export_data"]);

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

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

/** The tool list for one question: the app's own tools plus those of every enabled outside connection. */
export function buildTools(settings: Settings): { defs: ToolDef[]; mcp: Record<string, McpRef> } {
  const defs: ToolDef[] = TOOLS.filter((t) => !NOT_IN_APP.has(t.name)).map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: plainSchema(inputSchema(t)) },
  }));
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
  /** Save a change through the store, as the assistant. Returns an error message, or null when saved. */
  apply: (op: Op) => string | null;
}

export interface Approval {
  title: string;
  detail: string;
}

export type ToolStep =
  | { kind: "done"; result: unknown; label: string }
  /** A change that needs the person's approval first. `commit` saves it. */
  | { kind: "ask"; approval: Approval; commit: () => { result: unknown; label: string } | Promise<{ result: unknown; label: string }> };

const brief = (args: Record<string, unknown>) =>
  Object.entries(args)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n")
    .slice(0, 600);

/** Run one tool call. Changes that need approval come back as "ask", with a commit to call on Allow. */
export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolStep> {
  const spec = BY_NAME[name];
  if (spec && !NOT_IN_APP.has(name)) {
    const out = runSpec(spec, args, { state: ctx.state, t: ctx.t, now: new Date().toISOString(), olderTurns: ctx.olderTurns });
    if (out.error || !out.ops?.length) return { kind: "done", result: out.result, label: out.label };
    // Never ask the person to approve a change the rules would refuse
    const refusal = dryRun(ctx.state, out.ops, ctx.t);
    if (refusal) return { kind: "done", result: { error: refusal }, label: `Could not ${name.replace(/_/g, " ")}: ${refusal}` };
    const commit = () => {
      const error = ctx.apply(asOne(out.ops as Op[]));
      return error ? { result: { error }, label: `Could not ${name.replace(/_/g, " ")}: ${error}` } : { result: out.result, label: out.label };
    };
    if (!needsApproval(spec, out, Boolean(ctx.state.settings.autoApplySafe))) return { kind: "done", ...commit() };
    const [title, ...rest] = (out.summary ?? out.label).split("\n");
    return { kind: "ask", approval: { title, detail: rest.join("\n") }, commit };
  }

  const ref = ctx.mcp[name];
  if (ref) {
    const call = async () => {
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
    };
    if (ref.tool.readOnly) return { kind: "done", ...(await call()) };
    return { kind: "ask", approval: { title: `Use ${ref.server.name}: ${ref.tool.name}`, detail: brief(args) || "No details given." }, commit: call };
  }

  return { kind: "done", result: { error: `Unknown tool ${name}.` }, label: `Tried an unknown tool (${name})` };
}

/** Connect to an MCP server and read its tool list. With `token`, tests a new connection; with `serverId`, uses the token saved for that connection. */
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
