import "server-only";
import type { AppState } from "@/lib/types";

/**
 * The app's database: per-user data, audit log, encrypted secrets and connector tokens.
 * Talks to Supabase's REST API with the secret (service role) key, so it only ever runs on
 * the server, and every function takes the user id the server has already verified.
 */

export class NotConfigured extends Error {
  constructor() {
    super("The server is not connected to Supabase yet. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
}

export function supabaseEnv() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new NotConfigured();
  return { url, key };
}

export const supabaseConfigured = () => Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());

async function rest(path: string, init: RequestInit & { prefer?: string } = {}) {
  const { url, key } = supabaseEnv();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.prefer ? { Prefer: init.prefer } : {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text();
    if (/does not exist|PGRST20[25]|Could not find the (table|function)/i.test(text))
      throw new Error("The database is not set up for accounts yet. Run supabase/migrations/0002_accounts.sql in the Supabase SQL editor.");
    throw new Error(`Supabase answered ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

// ---------- per-user data

export interface StateRow {
  state: AppState;
  version: number;
}

export async function loadState(userId: string): Promise<StateRow | null> {
  const rows = (await (await rest(`user_state?user_id=eq.${userId}&select=state,version`)).json()) as StateRow[];
  return rows[0] ? { state: rows[0].state, version: Number(rows[0].version) } : null;
}

/** Create the user's record if it does not exist yet. Returns false if it already existed. */
export async function createState(userId: string, state: AppState): Promise<boolean> {
  const res = await rest("user_state?on_conflict=user_id", {
    method: "POST",
    prefer: "resolution=ignore-duplicates,return=representation",
    body: JSON.stringify({ user_id: userId, state, version: 1 }),
  });
  return ((await res.json()) as unknown[]).length > 0;
}

/**
 * Save a change atomically. Returns the new version, -1 if someone else changed the data
 * since `expected`, or -2 if this request id was already applied.
 */
export async function commitState(a: {
  userId: string;
  expected: number;
  state: AppState;
  actor: string;
  op: string;
  args: unknown;
  requestId?: string;
  audit: boolean;
}): Promise<number> {
  const res = await rest("rpc/wml_commit", {
    method: "POST",
    body: JSON.stringify({
      p_user: a.userId,
      p_expected: a.expected,
      p_state: a.state,
      p_actor: a.actor,
      p_op: a.op,
      p_args: a.args ?? null,
      p_request_id: a.requestId ?? null,
      p_audit: a.audit,
    }),
  });
  return Number(await res.json());
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  op: string;
  args: unknown;
  before: AppState;
  version: number;
}

export async function lastAudit(userId: string, limit = 1, withBefore = true): Promise<AuditEntry[]> {
  const cols = withBefore ? "id,at,actor,op,args,before,version" : "id,at,actor,op,args,version";
  return (await rest(`audit_log?user_id=eq.${userId}&select=${cols}&order=id.desc&limit=${limit}`)).json();
}

export async function deleteAudit(userId: string, id: number) {
  await rest(`audit_log?user_id=eq.${userId}&id=eq.${Math.trunc(id)}`, { method: "DELETE", prefer: "return=minimal" });
}

// ---------- encrypted secrets (encryption happens in secrets.ts; this only stores the ciphertext)

export async function loadSecretBlob(userId: string): Promise<string | null> {
  const rows = (await (await rest(`user_secrets?user_id=eq.${userId}&select=data`)).json()) as { data: string }[];
  return rows[0]?.data ?? null;
}

export async function saveSecretBlob(userId: string, data: string) {
  await rest("user_secrets?on_conflict=user_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({ user_id: userId, data, updated_at: new Date().toISOString() }),
  });
}

// ---------- claude.ai connector tokens (only the hash is stored)

/** SHA-256 of a token, in hex. */
export async function hashToken(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Tokens are 43 URL-safe characters (32 random bytes). Anything else is refused before touching the database. */
export const validToken = (token: unknown): token is string => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

export async function userForConnector(token: string): Promise<string | null> {
  const rows = (await (await rest(`connector_tokens?token_hash=eq.${await hashToken(token)}&select=user_id`)).json()) as { user_id: string }[];
  return rows[0]?.user_id ?? null;
}

/** Replace the user's connector token (one per user), so any old URL stops working. */
export async function setConnectorToken(userId: string, token: string) {
  await rest(`connector_tokens?user_id=eq.${userId}`, { method: "DELETE", prefer: "return=minimal" });
  await rest("connector_tokens", { method: "POST", prefer: "return=minimal", body: JSON.stringify({ token_hash: await hashToken(token), user_id: userId }) });
}

export async function deleteConnectorToken(userId: string) {
  await rest(`connector_tokens?user_id=eq.${userId}`, { method: "DELETE", prefer: "return=minimal" });
}
