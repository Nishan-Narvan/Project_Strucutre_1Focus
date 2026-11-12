"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { today, uid } from "./date";
import { applyOp, emptyState, OpError, type Op } from "./ops";
import type { AgentTurn, AppState, DayEvent, Goal, MemoryKind, Memory, Routine, Settings, Task } from "./types";

/**
 * The person's data, held on the server for their account and mirrored here.
 *
 * Each action becomes an op (see lib/ops.ts). It is applied here straight away so the screen
 * responds instantly, then sent to the server, which re-applies it to its own latest copy with
 * the same rules. While ops are on their way, the screen shows the server's last answer with the
 * waiting ops replayed on top. Changes made elsewhere (Claude, another device) are picked up by
 * a light poll every few seconds and whenever the window regains focus.
 */

/** Where the browser kept everything before accounts. Read once, for importing. */
export const LEGACY_KEY = "pathwise.demo.v2";
const POLL_MS = 5000;
const RETRY_MS = 3000;

export type Status = "loading" | "unconfigured" | "signedOut" | "setup" | "ready" | "error";
export type Actor = "web" | "assistant";

interface Actions {
  /** Save any change (see lib/ops.ts). Returns the reason when the rules refuse it, or null when saved. */
  apply: (op: Op) => string | null;
  /** Mark one session complete with the learner's note. */
  completeSession: (goalId: string, sessionId: string, note: string) => void;
  /** Mark every remaining session of a task complete with one note. */
  completeTask: (goalId: string, taskId: string, note: string) => void;
  reopenSession: (goalId: string, sessionId: string) => void;
  reopenTask: (goalId: string, taskId: string) => void;
  reschedule: (goalId: string) => void;
  /** Allowed up to the per-phase limit. Returns false when the rules refuse it. */
  addTask: (goalId: string, moduleIndex: number, task: Omit<Task, "id">) => boolean;
  /** Only allowed inside the edit window. */
  removeTask: (goalId: string, taskId: string) => boolean;
  addGoal: (goal: Goal) => boolean;
  deleteGoal: (goalId: string) => void;
  upsertRoutine: (r: Routine) => void;
  deleteRoutine: (id: string) => void;
  addEvent: (e: Omit<DayEvent, "id">) => void;
  deleteEvent: (id: string) => void;
  saveSettings: (s: Partial<Settings>) => void;
  /** Returns false when the same memory is already saved. */
  addMemory: (kind: MemoryKind, text: string, source?: Memory["source"]) => boolean;
  deleteMemory: (id: string) => void;
  /** Replace the conversation with the assistant. */
  saveChat: (turns: AgentTurn[]) => void;
  /** Start a fresh conversation. The old one is filed away where the assistant can still look things up. */
  newChat: () => void;
  resetDemo: () => void;
}

interface Store extends Actions {
  state: AppState;
  /** True once the account's data is loaded. */
  ready: boolean;
  status: Status;
  user: { id: string; email: string } | null;
  /** Problem to show the person (a refused change, a lost connection). */
  notice: string | null;
  dismissNotice: () => void;
  /** Changes still on their way to the server. */
  saving: boolean;
  /** The same actions, recorded in the change history as made by the in-app assistant. */
  assistant: Actions;
  /** Reverse the most recent change, whoever made it. */
  undo: () => Promise<string>;
  /** Create the account's data the first time: import this browser's data, start from the demo, or start empty. */
  setup: (mode: "import" | "demo" | "empty") => Promise<void>;
  /** Data saved in this browser before accounts, if any. */
  legacy: AppState | null;
}

interface Pending {
  op: Op;
  requestId: string;
  actor: Actor;
}

const Ctx = createContext<Store | null>(null);

const browserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

function readLegacy(): AppState | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    const s = raw ? (JSON.parse(raw) as AppState) : null;
    return s && Array.isArray(s.goals) ? s : null;
  } catch {
    return null;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<Store["user"]>(null);
  const [view, setView] = useState<AppState>(emptyState);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [legacy, setLegacy] = useState<AppState | null>(null);

  // The server's last answer, the ops not yet confirmed, and what the screen shows (kept in refs so
  // several actions in a row, as the assistant does, each see the result of the one before)
  const confirmed = useRef<{ state: AppState; version: number }>({ state: emptyState(), version: 0 });
  const pending = useRef<Pending[]>([]);
  const local = useRef<AppState>(view);
  const sending = useRef(false);

  const recompute = useCallback(() => {
    let s = confirmed.current.state;
    const t = today();
    // Replay waiting ops on the newest server copy; one that no longer applies is dropped
    pending.current = pending.current.filter((p) => {
      try {
        s = applyOp(s, p.op, { t });
        return true;
      } catch {
        return false;
      }
    });
    local.current = s;
    setView(s);
    setSaving(pending.current.length > 0);
  }, []);

  const accept = useCallback(
    (data: { state: AppState; version: number }) => {
      if (data.version < confirmed.current.version) return;
      confirmed.current = { state: data.state, version: data.version };
      recompute();
    },
    [recompute],
  );

  /** Send waiting ops one at a time, in order. */
  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while (pending.current.length) {
        const p = pending.current[0];
        let res: Response;
        try {
          const body = JSON.stringify(p);
          // keepalive lets a change finish sending even if the page is closing (browsers allow it for small requests)
          res = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < 60000 });
        } catch {
          // Offline: try again shortly. The request id stops a retry from applying twice.
          setNotice("Can't reach the server. Your change is waiting and will be saved when the connection is back.");
          await new Promise((r) => setTimeout(r, RETRY_MS));
          continue;
        }
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setStatus("signedOut");
          return;
        }
        pending.current = pending.current.filter((x) => x !== p);
        if (res.ok) {
          setNotice((n) => (n?.startsWith("Can't reach") ? null : n));
          accept(data);
        } else {
          setNotice(data.error || "A change could not be saved.");
          recompute();
        }
      }
    } finally {
      sending.current = false;
    }
  }, [accept, recompute]);

  /**
   * Apply an op here at once and queue it for the server.
   * Returns null when saved, "" when it changed nothing (a duplicate), or the reason the rules refused it.
   */
  const attempt = useCallback(
    (op: Op, actor: Actor): string | null => {
      let next: AppState;
      try {
        next = applyOp(local.current, op, { t: today() });
      } catch (e) {
        if (e instanceof OpError) {
          if (actor === "web") setNotice(e.message);
          return e.message;
        }
        throw e;
      }
      if (next === local.current) return ""; // nothing changed (a duplicate)
      pending.current.push({ op, requestId: uid() + uid(), actor });
      local.current = next;
      setView(next);
      setSaving(true);
      void flush();
      return null;
    },
    [flush],
  );
  /** Same, as a yes/no: did it change anything? */
  const dispatch = useCallback((op: Op, actor: Actor) => attempt(op, actor) === null, [attempt]);

  const load = useCallback(
    async (since?: number) => {
      let res: Response;
      try {
        res = await fetch(`/api/state${since ? `?since=${since}` : ""}`, { cache: "no-store" });
      } catch {
        if (!since) setStatus("error");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return setStatus("signedOut");
      if (res.status === 503 && data.configured === false) return setStatus("unconfigured");
      if (!res.ok) {
        if (!since) {
          setNotice(data.error || "Could not load your data.");
          setStatus("error");
        }
        return;
      }
      if (data.user) setUser(data.user);
      if (data.needsSetup) {
        setLegacy(readLegacy());
        return setStatus("setup");
      }
      if (data.unchanged) return;
      accept(data);
      setStatus("ready");
    },
    [accept],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Pick up changes made elsewhere: every few seconds while visible, and on returning to the tab
  useEffect(() => {
    if (status !== "ready") return;
    const tick = () => {
      if (document.visibilityState === "visible" && !pending.current.length) void load(confirmed.current.version);
    };
    const timer = setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [status, load]);

  // Let the server know the person's time zone, so "today" is right for changes made from Claude
  useEffect(() => {
    if (status !== "ready") return;
    const tz = browserTimezone();
    if (confirmed.current.state.settings.timezone !== tz)
      void fetch("/api/state", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timezone: tz }) }).then(() => load(confirmed.current.version));
  }, [status, load]);

  const store = useMemo<Store>(() => {
    const make = (actor: Actor): Actions => ({
      apply: (op) => {
        const r = attempt(op, actor);
        return r === "" ? null : r;
      },
      completeSession: (goalId, sessionId, note) => void dispatch({ type: "complete_session", goalId, sessionId, note, at: new Date().toISOString() }, actor),
      completeTask: (goalId, taskId, note) => void dispatch({ type: "complete_task", goalId, taskId, note, at: new Date().toISOString() }, actor),
      reopenSession: (goalId, sessionId) => void dispatch({ type: "reopen_session", goalId, sessionId }, actor),
      reopenTask: (goalId, taskId) => void dispatch({ type: "reopen_task", goalId, taskId }, actor),
      reschedule: (goalId) => void dispatch({ type: "reschedule_goal", goalId }, actor),
      addTask: (goalId, moduleIndex, task) => {
        const m = local.current.goals.find((g) => g.id === goalId)?.roadmap.modules[moduleIndex];
        return dispatch({ type: "add_task", goalId, moduleIndex, task: { ...task, id: `${m?.id ?? "m"}x${uid()}` } }, actor);
      },
      removeTask: (goalId, taskId) => dispatch({ type: "remove_task", goalId, taskId }, actor),
      addGoal: (goal) => dispatch({ type: "add_goal", goal }, actor),
      deleteGoal: (goalId) => void dispatch({ type: "delete_goal", goalId }, actor),
      upsertRoutine: (routine) => void dispatch({ type: "upsert_routine", routine }, actor),
      deleteRoutine: (id) => void dispatch({ type: "delete_routine", id }, actor),
      addEvent: (e) => void dispatch({ type: "add_event", event: { ...e, id: uid() } }, actor),
      deleteEvent: (id) => void dispatch({ type: "delete_event", id }, actor),
      saveSettings: (patch) => void dispatch({ type: "save_settings", patch }, actor),
      addMemory: (kind, text, source = "agent") => dispatch({ type: "add_memory", memory: { id: uid(), kind, text, source, createdAt: today() } }, actor),
      deleteMemory: (id) => void dispatch({ type: "delete_memory", id }, actor),
      saveChat: (turns) => void dispatch({ type: "save_chat", turns }, actor),
      newChat: () => void dispatch({ type: "new_chat", id: uid(), endedAt: today() }, actor),
      resetDemo: () => void dispatch({ type: "reset_demo" }, actor),
    });

    return {
      ...make("web"),
      assistant: make("assistant"),
      state: view,
      ready: status === "ready",
      status,
      user,
      notice,
      dismissNotice: () => setNotice(null),
      saving,
      legacy,
      undo: async () => {
        await flush();
        const res = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ undo: true }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not undo.");
        accept(data);
        return String(data.undone ?? "");
      },
      setup: async (mode) => {
        const res = await fetch("/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, timezone: browserTimezone(), ...(mode === "import" ? { state: readLegacy() } : {}) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not set up your data.");
        // The browser copy (and any key in it) is now safely on the server
        if (mode === "import") {
          try {
            localStorage.removeItem(LEGACY_KEY);
          } catch {}
        }
        accept(data);
        setStatus("ready");
      },
    };
  }, [view, status, user, notice, saving, legacy, attempt, dispatch, flush, accept]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
