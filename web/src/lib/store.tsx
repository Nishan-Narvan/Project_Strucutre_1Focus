"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createDemoState } from "./demo";
import { today, uid } from "./date";
import { buildSessions } from "./schedule";
import { isEditable, RULES } from "./rules";
import type { AppState, DayEvent, Goal, Routine, Settings, Task } from "./types";

// P0: demo state lives in localStorage. P1 swaps these actions for Supabase calls.
const KEY = "pathwise.demo.v2";

interface Store {
  state: AppState;
  ready: boolean;
  /** Mark one session complete with the learner's note. */
  completeSession: (goalId: string, sessionId: string, note: string) => void;
  /** Mark every remaining session of a task complete with one note. */
  completeTask: (goalId: string, taskId: string, note: string) => void;
  reopenSession: (goalId: string, sessionId: string) => void;
  reopenTask: (goalId: string, taskId: string) => void;
  reschedule: (goalId: string) => void;
  /** Always allowed (up to the per-module limit). */
  addTask: (goalId: string, moduleIndex: number, task: Omit<Task, "id">) => boolean;
  /** Only allowed inside the edit window. */
  removeTask: (goalId: string, taskId: string) => boolean;
  addGoal: (goal: Goal) => void;
  deleteGoal: (goalId: string) => void;
  upsertRoutine: (r: Routine) => void;
  deleteRoutine: (id: string) => void;
  addEvent: (e: Omit<DayEvent, "id">) => void;
  deleteEvent: (id: string) => void;
  saveSettings: (s: Partial<Settings>) => void;
  resetDemo: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => ({ goals: [], routines: [], events: [], settings: createDemoState().settings }));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let loaded: AppState | null = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) loaded = JSON.parse(raw);
    } catch {}
    setState(loaded ?? createDemoState());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }, [state, ready]);

  const mapGoal = useCallback(
    (goalId: string, fn: (g: Goal) => Goal) => setState((s) => ({ ...s, goals: s.goals.map((g) => (g.id === goalId ? fn(g) : g)) })),
    [],
  );

  const store = useMemo<Store>(() => {
    const find = (id: string) => state.goals.find((g) => g.id === id);
    return {
      state,
      ready,
      completeSession: (goalId, sessionId, note) =>
        mapGoal(goalId, (g) => ({
          ...g,
          sessions: g.sessions.map((x) => (x.id === sessionId ? { ...x, done: true, doneAt: new Date().toISOString(), note: note.trim() || undefined } : x)),
        })),
      completeTask: (goalId, taskId, note) => {
        const at = new Date().toISOString();
        mapGoal(goalId, (g) => ({
          ...g,
          sessions: g.sessions.map((x) => (x.taskId === taskId && !x.done ? { ...x, done: true, doneAt: at, note: note.trim() || undefined } : x)),
        }));
      },
      reopenSession: (goalId, sessionId) =>
        mapGoal(goalId, (g) => ({ ...g, sessions: g.sessions.map((x) => (x.id === sessionId ? { ...x, done: false, doneAt: undefined, note: undefined } : x)) })),
      reopenTask: (goalId, taskId) =>
        mapGoal(goalId, (g) => ({ ...g, sessions: g.sessions.map((x) => (x.taskId === taskId ? { ...x, done: false, doneAt: undefined, note: undefined } : x)) })),
      reschedule: (goalId) => mapGoal(goalId, (g) => ({ ...g, sessions: buildSessions(g, today()) })),
      addTask: (goalId, moduleIndex, task) => {
        const g = find(goalId);
        if (!g || g.roadmap.modules[moduleIndex].tasks.length >= RULES.maxTasksPerModule) return false;
        mapGoal(goalId, (g) => {
          const modules = g.roadmap.modules.map((m, i) => (i === moduleIndex ? { ...m, tasks: [...m.tasks, { ...task, id: `${m.id}x${uid()}` }] } : m));
          const next = { ...g, roadmap: { ...g.roadmap, modules } };
          return { ...next, sessions: buildSessions(next, today()) };
        });
        return true;
      },
      removeTask: (goalId, taskId) => {
        const g = find(goalId);
        if (!g || !isEditable(g)) return false;
        mapGoal(goalId, (g) => {
          const modules = g.roadmap.modules.map((m) => ({ ...m, tasks: m.tasks.filter((t) => t.id !== taskId) }));
          const next = { ...g, roadmap: { ...g.roadmap, modules }, sessions: g.sessions.filter((s) => s.taskId !== taskId) };
          return { ...next, sessions: buildSessions(next, today()) };
        });
        return true;
      },
      addGoal: (goal) => setState((s) => ({ ...s, goals: [...s.goals, goal] })),
      deleteGoal: (goalId) => setState((s) => ({ ...s, goals: s.goals.filter((g) => g.id !== goalId) })),
      upsertRoutine: (r) =>
        setState((s) => ({
          ...s,
          routines: s.routines.some((x) => x.id === r.id) ? s.routines.map((x) => (x.id === r.id ? r : x)) : [...s.routines, r],
        })),
      deleteRoutine: (id) => setState((s) => ({ ...s, routines: s.routines.filter((x) => x.id !== id) })),
      addEvent: (e) => setState((s) => ({ ...s, events: [...s.events, { ...e, id: uid() }] })),
      deleteEvent: (id) => setState((s) => ({ ...s, events: s.events.filter((x) => x.id !== id) })),
      saveSettings: (patch) => setState((s) => ({ ...s, settings: { ...s.settings, ...patch } })),
      resetDemo: () => setState(createDemoState()),
    };
  }, [state, ready, mapGoal]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
