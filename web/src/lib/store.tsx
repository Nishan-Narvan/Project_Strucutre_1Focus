"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createDemoState } from "./demo";
import { today, uid } from "./date";
import { buildSessions } from "./schedule";
import { isEditable, RULES } from "./rules";
import type { AgentTurn, AppState, DayEvent, Goal, Memory, MemoryKind, Routine, Settings, Task } from "./types";

// P0: demo state lives in localStorage. P1 swaps these actions for Supabase calls.
const KEY = "pathwise.demo.v2";
const MAX_CHAT_TURNS = 80;
const MAX_PAST_CHATS = 40;

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
  /** Returns false when the same memory is already saved. */
  addMemory: (kind: MemoryKind, text: string, source?: Memory["source"]) => boolean;
  deleteMemory: (id: string) => void;
  /** Replace the conversation with the agent. */
  saveChat: (turns: AgentTurn[]) => void;
  /** Start a fresh conversation. The old one is filed away where the agent can still look things up. */
  newChat: () => void;
  resetDemo: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => ({ goals: [], routines: [], events: [], settings: createDemoState().settings, memories: [], chat: [], pastChats: [] }));
  const [ready, setReady] = useState(false);
  // Lets an action report on the latest state without waiting for a re-render
  const live = useRef(state);
  live.current = state;

  useEffect(() => {
    let loaded: AppState | null = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) loaded = JSON.parse(raw);
    } catch {}
    const fresh = createDemoState();
    // Older saved states predate the agent: fill in what they lack
    setState(loaded ? { ...fresh, ...loaded, settings: { ...fresh.settings, ...loaded.settings }, memories: loaded.memories ?? [], chat: loaded.chat ?? [] } : fresh);
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
      addMemory: (kind, text, source = "agent") => {
        const clean = text.trim();
        if (!clean || live.current.memories.some((m) => m.text.toLowerCase() === clean.toLowerCase())) return false;
        const next = { ...live.current, memories: [...live.current.memories, { id: uid(), kind, text: clean, source, createdAt: today() }] };
        live.current = next;
        setState((s) => ({ ...s, memories: next.memories }));
        return true;
      },
      deleteMemory: (id) => {
        live.current = { ...live.current, memories: live.current.memories.filter((m) => m.id !== id) };
        setState((s) => ({ ...s, memories: s.memories.filter((m) => m.id !== id) }));
      },
      // Only the recent conversation is kept, so browser storage cannot fill up
      saveChat: (turns) => setState((s) => ({ ...s, chat: turns.slice(-MAX_CHAT_TURNS) })),
      newChat: () =>
        setState((s) => {
          const turns = s.chat.filter((c) => !c.error && c.text).map((c) => ({ role: c.role, text: c.text.slice(0, 1500) }));
          if (turns.length < 2) return { ...s, chat: [] };
          return { ...s, chat: [], pastChats: [...s.pastChats, { id: uid(), endedAt: today(), turns }].slice(-MAX_PAST_CHATS) };
        }),
      // The model settings and key are the person's own, not demo data, so a reset keeps them
      resetDemo: () => setState((s) => ({ ...createDemoState(), settings: s.settings })),
    };
  }, [state, ready, mapGoal]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
