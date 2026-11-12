import { NextResponse } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { fail, publicHttpsUrl } from "@/lib/server/net";
import { currentUser } from "@/lib/server/auth";
import { loadSecrets, type Secrets } from "@/lib/server/secrets";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * MCP client for the signed-in user. Connects to a remote MCP server they added, does one thing, disconnects.
 *   { action: "tools", url, token? | serverId? }                  -> { tools: [{ name, description, inputSchema, readOnly }] }
 *   { action: "call", url, token? | serverId?, name, arguments }  -> { text, isError }
 * With serverId, the token saved (encrypted) for that connection is used. Tokens are never logged.
 */

const MAX_RESULT = 12000;

/**
 * Connect with the current transport (Streamable HTTP) and fall back to the older SSE
 * transport, which some servers still use. Redirects are refused, so a public address
 * cannot bounce the request somewhere private.
 */
async function withClient<T>(url: URL, token: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const requestInit: RequestInit = { redirect: "error", ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) };
  let client = new Client({ name: "where-mylife", version: "0.1.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit }), { timeout: 20000 });
  } catch (first) {
    // A refused key or a timeout will not improve over SSE; anything else may be an SSE-only server
    if (/unauthori[sz]ed|401|403|forbidden|timed? ?out/i.test(String(first))) throw first;
    await client.close().catch(() => {});
    client = new Client({ name: "where-mylife", version: "0.1.0" });
    try {
      await client.connect(new SSEClientTransport(url, { requestInit }), { timeout: 20000 });
    } catch (second) {
      throw new Error(`${String(first).replace(/^Error:\s*/, "")}. The older SSE transport failed too: ${String(second).replace(/^Error:\s*/, "")}`);
    }
  }
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/** Flatten an MCP tool result into text the model can read. */
function resultText(result: { content?: unknown; structuredContent?: unknown }): string {
  const parts: string[] = [];
  if (Array.isArray(result.content))
    for (const c of result.content as { type?: string; text?: string }[]) parts.push(c.type === "text" && typeof c.text === "string" ? c.text : `[${c.type ?? "content"} omitted]`);
  if (!parts.length && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  const text = parts.join("\n").trim() || "Done. The tool returned nothing.";
  return text.length > MAX_RESULT ? `${text.slice(0, MAX_RESULT)}\n[cut: the result was longer than ${MAX_RESULT} characters]` : text;
}

function reason(e: unknown): { error: string; status: number } {
  const m = e instanceof Error ? e.message : String(e);
  if (/unauthori[sz]ed|401|403|forbidden/i.test(m))
    return { error: "The server refused the connection. The token is wrong, or this server needs an OAuth sign-in, which this app cannot do yet.", status: 401 };
  if (/timed? ?out|timeout/i.test(m)) return { error: "The server took too long to answer.", status: 504 };
  if (/<!doctype|<html|404|not found/i.test(m)) return { error: "That address did not answer as an MCP server. Check the URL.", status: 502 };
  return { error: `Could not talk to the MCP server. ${m.slice(0, 200)}`, status: 502 };
}

export async function POST(req: Request) {
  const user = await currentUser().catch(() => null);
  if (!user) return fail("You are signed out. Sign in again.", 401);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return fail("Bad request.", 400);
  const { action, url, token, name, serverId } = body as Record<string, unknown>;
  const args = (body as { arguments?: unknown }).arguments;

  const target = publicHttpsUrl(url);
  if (!target) return fail("The server URL must be a public https address.", 400);
  // An explicit token is only sent while testing a new connection; otherwise use the saved one
  let key = typeof token === "string" ? token.trim() : "";
  if (!key && typeof serverId === "string") key = (await loadSecrets(user.id).catch(() => ({}) as Secrets)).mcp?.[serverId] ?? "";

  try {
    if (action === "tools") {
      const tools = await withClient(target, key, async (c) => {
        const out = [];
        let cursor: string | undefined;
        // Servers may hand out their tool list in pages
        for (let page = 0; page < 5; page++) {
          const r = await c.listTools(cursor ? { cursor } : undefined, { timeout: 20000 });
          out.push(...r.tools);
          cursor = r.nextCursor;
          if (!cursor) break;
        }
        return out;
      });
      return NextResponse.json({
        tools: tools.map((t) => ({
          name: t.name,
          description: (t.description ?? "").slice(0, 600),
          inputSchema: t.inputSchema ?? { type: "object", properties: {} },
          readOnly: t.annotations?.readOnlyHint === true,
        })),
      });
    }

    if (action === "call") {
      if (typeof name !== "string" || !name) return fail("No tool named.", 400);
      const result = await withClient(target, key, (c) =>
        c.callTool({ name, arguments: args && typeof args === "object" ? (args as Record<string, unknown>) : {} }, undefined, { timeout: 45000 }),
      );
      return NextResponse.json({ text: resultText(result as { content?: unknown; structuredContent?: unknown }), isError: result.isError === true });
    }

    return fail("Unknown action.", 400);
  } catch (e) {
    const r = reason(e);
    return fail(r.error, r.status);
  }
}
