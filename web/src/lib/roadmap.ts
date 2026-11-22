import type { BuiltinKind, Module, Resource, Roadmap, SourceType, Task } from "./types";
import { uid } from "./date";

/**
 * Roadmaps written by an AI (the in-app assistant, Claude, ChatGPT) arrive in a simple shape:
 * phases with tasks. This turns that into the app's full roadmap structure, fills safe defaults,
 * keeps the ids of tasks and phases that already exist (so finished work stays counted), and
 * explains exactly what is wrong when the input cannot be used.
 */

export const TASK_KINDS: BuiltinKind[] = ["learn", "practice", "project", "review", "quiz"];
/** Ids of categories the person makes: lowercase letters, digits and dashes. */
export const KIND_ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
const SOURCES: SourceType[] = ["reddit", "youtube", "docs", "course", "article", "book", "other"];
export const MAX_PHASES = 20;
export const MAX_TASKS_TOTAL = 200;

export class RoadmapError extends Error {}

export interface TaskInput {
  id?: string;
  title?: unknown;
  minutes?: unknown;
  kind?: unknown;
  detail?: unknown;
}
export interface PhaseInput {
  id?: string;
  title?: unknown;
  objective?: unknown;
  checkpoint?: unknown;
  level?: unknown;
  first_principle?: unknown;
  scaffold?: unknown;
  key_concepts?: unknown;
  resources?: unknown;
  tasks?: unknown;
}
export interface RoadmapInput {
  title?: unknown;
  summary?: unknown;
  first_principles?: unknown;
  phases?: unknown;
}

const str = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown, max = 12) => (Array.isArray(v) ? v.map((x) => str(x, 200)).filter(Boolean).slice(0, max) : []);

export function cleanTask(input: TaskInput, where: string, defaultMinutes = 45): Task {
  const title = str(input.title, 160);
  if (!title) throw new RoadmapError(`${where}: every task needs a title.`);
  const minutes = Math.round(Number(input.minutes ?? defaultMinutes));
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 600) throw new RoadmapError(`${where} "${title}": minutes must be between 5 and 600.`);
  const kind = typeof input.kind === "string" && KIND_ID.test(input.kind) ? input.kind : "practice";
  return { id: typeof input.id === "string" && input.id ? input.id : uid() + uid(), title, minutes, kind, detail: str(input.detail, 600) };
}

function cleanResources(v: unknown): Resource[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((r) => {
      const x = (r ?? {}) as Record<string, unknown>;
      const url = str(x.url, 500);
      if (!/^https?:\/\//i.test(url)) return null;
      const type = str(x.source_type ?? x.type, 20) as SourceType;
      return { title: str(x.title, 200) || url, url, source_type: SOURCES.includes(type) ? type : "other", why: str(x.why, 300) } as Resource;
    })
    .filter((r): r is Resource => r !== null)
    .slice(0, 12);
}

export function cleanPhase(input: PhaseInput, index: number, maxTasks: number, existing?: Module, defaultMinutes = 45): Module {
  const where = `Phase ${index + 1}`;
  const title = str(input.title, 160) || existing?.title || "";
  if (!title) throw new RoadmapError(`${where}: every phase needs a title.`);
  const rawTasks = input.tasks === undefined && existing ? existing.tasks : input.tasks;
  if (!Array.isArray(rawTasks)) throw new RoadmapError(`${where} "${title}": tasks must be a list.`);
  if (maxTasks && rawTasks.length > maxTasks) throw new RoadmapError(`${where} "${title}" has ${rawTasks.length} tasks; the limit is ${maxTasks} a phase. Split it into two phases.`);
  const tasks = rawTasks.map((t, i) => cleanTask((t ?? {}) as TaskInput, `${where}, task ${i + 1}`, defaultMinutes));
  return {
    id: (typeof input.id === "string" && input.id) || existing?.id || `p${uid()}`,
    title,
    level: str(input.level, 80) || existing?.level || "",
    objective: str(input.objective, 600) || existing?.objective || "",
    first_principle: str(input.first_principle, 300) || existing?.first_principle || "",
    zpd_scaffold: str(input.scaffold, 400) || existing?.zpd_scaffold || "",
    estimated_hours: Math.round((tasks.reduce((a, t) => a + t.minutes, 0) / 60) * 10) / 10,
    key_concepts: input.key_concepts !== undefined ? list(input.key_concepts) : existing?.key_concepts ?? [],
    checkpoint: str(input.checkpoint, 400) || existing?.checkpoint || "",
    resources: input.resources !== undefined ? cleanResources(input.resources) : existing?.resources ?? [],
    tasks,
  };
}

/** A whole roadmap from AI input. `previous` lets matching ids keep their existing details. */
export function cleanRoadmap(input: RoadmapInput, goalTitle: string, maxTasks: number, previous?: Roadmap, defaultMinutes = 45): Roadmap {
  if (!Array.isArray(input.phases) || input.phases.length === 0) throw new RoadmapError("A roadmap needs at least one phase, each with tasks.");
  if (input.phases.length > MAX_PHASES) throw new RoadmapError(`A roadmap can have at most ${MAX_PHASES} phases.`);
  const modules = input.phases.map((p, i) => {
    const pi = (p ?? {}) as PhaseInput;
    return cleanPhase(pi, i, maxTasks, previous?.modules.find((m) => m.id === pi.id), defaultMinutes);
  });
  const total = modules.reduce((a, m) => a + m.tasks.length, 0);
  if (total > MAX_TASKS_TOTAL) throw new RoadmapError(`That roadmap has ${total} tasks; the limit is ${MAX_TASKS_TOTAL}.`);
  const ids = modules.flatMap((m) => m.tasks.map((t) => t.id));
  if (new Set(ids).size !== ids.length) throw new RoadmapError("Two tasks share the same id. Leave ids out for new tasks.");
  const fp = Array.isArray(input.first_principles)
    ? input.first_principles
        .map((x) => (typeof x === "string" ? { principle: str(x, 200), explanation: "" } : { principle: str((x as Record<string, unknown>)?.principle, 200), explanation: str((x as Record<string, unknown>)?.explanation, 400) }))
        .filter((x) => x.principle)
    : previous?.first_principles ?? [];
  return {
    title: str(input.title, 160) || previous?.title || goalTitle,
    summary: str(input.summary, 1200) || previous?.summary || "",
    first_principles: fp,
    zpd: previous?.zpd ?? { can_do_alone: [], can_do_with_guidance: [], out_of_reach_now: [], strategy: "" },
    diagram_mermaid: previous?.diagram_mermaid ?? "",
    modules,
    verification: previous?.verification ?? { confidence_score: 0, consensus_notes: "", changes_made: [], open_risks: [] },
  };
}

export const emptyRoadmap = (title: string): Roadmap => ({
  title,
  summary: "",
  first_principles: [],
  zpd: { can_do_alone: [], can_do_with_guidance: [], out_of_reach_now: [], strategy: "" },
  diagram_mermaid: "",
  modules: [],
  verification: { confidence_score: 0, consensus_notes: "", changes_made: [], open_risks: [] },
});

/** The roadmap in the simple shape AIs write, for reading and editing. */
export function roadmapForAI(r: Roadmap) {
  return {
    title: r.title,
    summary: r.summary,
    first_principles: r.first_principles,
    phases: r.modules.map((m) => ({
      id: m.id,
      title: m.title,
      level: m.level,
      objective: m.objective,
      checkpoint: m.checkpoint,
      key_concepts: m.key_concepts,
      resources: m.resources.map((x) => ({ title: x.title, url: x.url, type: x.source_type, why: x.why })),
      tasks: m.tasks.map((t) => ({ id: t.id, title: t.title, minutes: t.minutes, kind: t.kind, detail: t.detail })),
    })),
  };
}
