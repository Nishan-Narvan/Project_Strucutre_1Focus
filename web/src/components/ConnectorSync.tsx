"use client";

import { useEffect, useMemo, useRef } from "react";
import { useStore } from "@/lib/store";
import { browserTimezone, syncPayload } from "@/lib/connector";
import type { MemoryKind, TaskKind } from "@/lib/types";

const PUSH_DELAY = 3000;
const PULL_EVERY = 60000;
const KINDS: TaskKind[] = ["learn", "practice", "project", "review", "quiz"];
const MEMORY_KINDS: MemoryKind[] = ["preference", "pattern", "lesson", "fact", "commitment"];

interface Queued {
  id: number;
  action: Record<string, unknown> & { type: string };
}

/**
 * Keeps the server-side copy that claude.ai reads up to date, and applies changes
 * asked for in claude.ai. Renders nothing. Only runs while the connector is on.
 */
export function ConnectorSync() {
  const { state, saveSettings, reschedule, addTask, addMemory, deleteMemory } = useStore();
  const token = state.settings.connector?.token;
  const payload = useMemo(() => JSON.stringify(syncPayload(state)), [state]);
  const lastSent = useRef("");
  const live = useRef({ state, saveSettings, reschedule, addTask, addMemory, deleteMemory });
  live.current = { state, saveSettings, reschedule, addTask, addMemory, deleteMemory };

  const note = (patch: { lastSync?: string; error?: string }) => {
    const c = live.current.state.settings.connector;
    if (!c) return;
    if (c.lastSync === (patch.lastSync ?? c.lastSync) && c.error === patch.error) return;
    live.current.saveSettings({ connector: { ...c, ...patch } });
  };

  // Push: a few seconds after the data changes. The connector status itself is not part of the payload, so saving it cannot loop.
  useEffect(() => {
    if (!token || payload === lastSent.current) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ state: JSON.parse(payload), timezone: browserTimezone() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return note({ error: data.error || `Sync failed with status ${res.status}.` });
        lastSent.current = payload;
        note({ lastSync: data.at, error: undefined });
      } catch {
        note({ error: "Could not reach the app's server to sync." });
      }
    }, PUSH_DELAY);
    return () => clearTimeout(timer);
  }, [token, payload]);

  // Pull: changes asked for in claude.ai, applied through the same actions the app's own buttons use
  useEffect(() => {
    if (!token) return;
    let busy = false;
    async function pull() {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const res = await fetch("/api/sync", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const { actions } = (await res.json()) as { actions: Queued[] };
        if (!actions?.length) return;
        const a = live.current;
        for (const { action: x } of actions) {
          const goal = a.state.goals.find((g) => g.id === x.goal_id);
          if (x.type === "reschedule_goal" && goal) a.reschedule(goal.id);
          if (x.type === "add_task" && goal) {
            const mi = Math.max(0, Number(x.phase) - 1);
            if (goal.roadmap.modules[mi])
              a.addTask(goal.id, mi, {
                title: String(x.title).slice(0, 120),
                minutes: Math.min(240, Math.max(10, Number(x.minutes) || 30)),
                kind: KINDS.includes(x.kind as TaskKind) ? (x.kind as TaskKind) : "practice",
                detail: String(x.detail ?? "").slice(0, 300),
              });
          }
          if (x.type === "save_memory") a.addMemory(MEMORY_KINDS.includes(x.kind as MemoryKind) ? (x.kind as MemoryKind) : "fact", String(x.text).slice(0, 240));
          if (x.type === "delete_memory") a.deleteMemory(String(x.memory_id));
        }
        // Acknowledged even when skipped (a goal deleted since), so nothing is applied twice
        await fetch("/api/sync", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ack: actions.map((q) => q.id) }) });
      } catch {
        // Offline or server down: the queue waits on the server for the next pull
      } finally {
        busy = false;
      }
    }
    pull();
    const timer = setInterval(pull, PULL_EVERY);
    window.addEventListener("focus", pull);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", pull);
    };
  }, [token]);

  return null;
}
