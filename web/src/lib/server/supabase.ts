import "server-only";
import type { AppState } from "@/lib/types";

/**
 * The server-side copy of the app's data, kept in Supabase for the claude.ai connector.
 * Talks to Supabase's REST API with the service role key, so it must only ever run on the server.
 */

export class NotConfigured extends Error {
  constructor() {
    super("The server is not connected to Supabase yet. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
}

function env() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new NotConfigured();
  return { url, key };
}

export const supabaseConfigured = () => Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());

async function rest(path: string, init: RequestInit & { prefer?: string } = {}) {
  const { url, key } = env();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text();
    // A missing table means the setup SQL has not been run
    if (/relation .* does not exist|PGRST205|Could not find the table/i.test(text)) throw new Error("The Supabase tables are missing. Run supabase/migrations/0001_claude_connector.sql in the Supabase SQL editor.");
    throw new Error(`Supabase answered ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

/** SHA-256 of the connector token, in hex. Only the hash is ever stored. */
export async function hashToken(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Tokens are 43 URL-safe characters (32 random bytes). Anything else is refused before touching the database. */
export const validToken = (token: unknown): token is string => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

export interface Snapshot {
  state: AppState;
  timezone: string;
  updated_at: string;
}

export async function saveSnapshot(hash: string, state: AppState, timezone: string) {
  await rest("connector_snapshots?on_conflict=token_hash", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({ token_hash: hash, state, timezone, updated_at: new Date().toISOString() }),
  });
}

export async function loadSnapshot(hash: string): Promise<Snapshot | null> {
  const res = await rest(`connector_snapshots?token_hash=eq.${hash}&select=state,timezone,updated_at`);
  const rows = (await res.json()) as Snapshot[];
  return rows[0] ?? null;
}

/** Removes the copy and, through the foreign key, any queued actions. */
export async function deleteSnapshot(hash: string) {
  await rest(`connector_snapshots?token_hash=eq.${hash}`, { method: "DELETE", prefer: "return=minimal" });
}

export interface QueuedAction {
  id: number;
  action: ConnectorAction;
  created_at: string;
}

/** A change asked for from claude.ai. The app applies it through the same rules as its own buttons. */
export type ConnectorAction =
  | { type: "reschedule_goal"; goal_id: string }
  | { type: "add_task"; goal_id: string; phase: number; title: string; minutes: number; kind: string; detail: string }
  | { type: "save_memory"; kind: string; text: string }
  | { type: "delete_memory"; memory_id: string };

export async function queueAction(hash: string, action: ConnectorAction) {
  await rest("connector_actions", { method: "POST", prefer: "return=minimal", body: JSON.stringify({ token_hash: hash, action }) });
}

export async function listActions(hash: string): Promise<QueuedAction[]> {
  const res = await rest(`connector_actions?token_hash=eq.${hash}&select=id,action,created_at&order=id.asc&limit=100`);
  return res.json();
}

export async function ackActions(hash: string, ids: number[]) {
  if (!ids.length) return;
  await rest(`connector_actions?token_hash=eq.${hash}&id=in.(${ids.map((n) => Math.trunc(n)).join(",")})`, { method: "DELETE", prefer: "return=minimal" });
}
