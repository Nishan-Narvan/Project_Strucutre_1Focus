// @reviewed 2026-10-25
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createDemoState } from "./demo";
import { today, uid } from "./date";
import { buildSessions } from "./schedule";
import type { AppState, DayEvent, Goal, Routine, Settings } from "./types";

// P0: demo state lives in localStorage. P1 swaps these actions for Supabase calls.
const KEY = "pathwise.demo.v1";

interface Store {
  state: AppState;
  ready: boolean;
  toggleSession: (goalId: string, sessionId: string) => void;
  setTaskDone: (goalId: string, taskId: string, done: boolean) => void;
  reschedule: (goalId: string) => void;
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

  const store = useMemo<Store>(
    () => ({
      state,
      ready,
      toggleSession: (goalId, sessionId) =>
        mapGoal(goalId, (g) => ({ ...g, sessions: g.sessions.map((x) => (x.id === sessionId ? { ...x, done: !x.done } : x)) })),
      setTaskDone: (goalId, taskId, done) =>
        mapGoal(goalId, (g) => ({ ...g, sessions: g.sessions.map((x) => (x.taskId === taskId ? { ...x, done } : x)) })),
      reschedule: (goalId) => mapGoal(goalId, (g) => ({ ...g, sessions: buildSessions(g, today()) })),
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
    }),
    [state, ready, mapGoal],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
