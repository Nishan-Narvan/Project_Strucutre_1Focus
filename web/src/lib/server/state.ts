import "server-only";
import { applyOp, AUDITED, OpError, type Op } from "@/lib/ops";
import { commitState, deleteAudit, lastAudit, loadState } from "./supabase";
import type { AppState } from "@/lib/types";

/**
 * Applying changes to a user's server-side data. The op is re-applied to the latest copy on the
 * server, never trusted as a finished state from the caller. If someone else saved in between,
 * it reloads and tries again, so the browser, the assistant and Claude can all write at once.
 */

export type Actor = "web" | "assistant" | "claude";

export class NoState extends Error {
  constructor() {
    super("This account has no data yet. Open Where MyLife and sign in to set it up.");
  }
}
export class Conflict extends Error {
  constructor() {
    super("The data kept changing while this was being saved. Try again.");
  }
}

/** Today's date where the person is, since the server's clock may be in another time zone. */
export function todayIn(timezone?: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** A time sent by the browser is used only if it is close to the server's clock. */
function trustedNow(now?: string) {
  const ms = now ? Date.parse(now) : NaN;
  return Number.isFinite(ms) && Math.abs(ms - Date.now()) < 36 * 3600 * 1000 ? new Date(ms).toISOString() : new Date().toISOString();
}

export async function applyForUser(userId: string, op: Op, actor: Actor, requestId?: string, now?: string): Promise<{ state: AppState; version: number; duplicate?: boolean }> {
  const at = trustedNow(now);
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await loadState(userId);
    if (!row) throw new NoState();
    const next = applyOp(row.state, op, { t: todayIn(row.state.settings?.timezone), now: at });
    const v = await commitState({ userId, expected: row.version, state: next, actor, op: op.type, args: op, requestId, audit: AUDITED(op) });
    if (v === -2) return { ...((await loadState(userId)) ?? row), duplicate: true };
    if (v > 0) return { state: next, version: v };
  }
  throw new Conflict();
}

/**
 * Undo the most recent recorded change. Every change except chat traffic is recorded, so the latest
 * record is always the latest real change; the current conversation is kept, everything else goes
 * back to how it was before that change.
 */
export async function undoLast(userId: string, actor: Actor): Promise<{ state: AppState; version: number; undone: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const [last] = await lastAudit(userId, 1, true);
    if (!last) throw new OpError("There is nothing to undo.");
    const row = await loadState(userId);
    if (!row) throw new NoState();
    const restored: AppState = { ...last.before, chat: row.state.chat, pastChats: row.state.pastChats };
    const v = await commitState({ userId, expected: row.version, state: restored, actor, op: `undo:${last.op}`, args: { undid: last.id }, audit: false });
    if (v === -1) continue;
    if (v < 0) throw new Conflict();
    await deleteAudit(userId, last.id);
    return { state: restored, version: v, undone: last.op };
  }
  throw new Conflict();
}

export { OpError };
