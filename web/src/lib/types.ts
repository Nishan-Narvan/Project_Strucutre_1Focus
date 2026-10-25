export type SourceType = "reddit" | "youtube" | "docs" | "course" | "article" | "book" | "other";
export type TaskKind = "learn" | "practice" | "project" | "review" | "quiz";
export type ProviderId = "anthropic" | "openai" | "openrouter" | "gemini" | "custom";

export interface Resource {
  title: string;
  url: string;
  source_type: SourceType;
  why: string;
  /** URL was seen in live search results during research/verification. */
  verified?: boolean;
}

export interface Task {
  id: string;
  title: string;
  minutes: number;
  kind: TaskKind;
  detail: string;
}

export interface Module {
  id: string;
  title: string;
  level: string;
  objective: string;
  first_principle: string;
  zpd_scaffold: string;
  estimated_hours: number;
  key_concepts: string[];
  checkpoint: string;
  resources: Resource[];
  tasks: Task[];
}

export interface Roadmap {
  title: string;
  summary: string;
  first_principles: { principle: string; explanation: string }[];
  zpd: {
    can_do_alone: string[];
    can_do_with_guidance: string[];
    out_of_reach_now: string[];
    strategy: string;
  };
  diagram_mermaid: string;
  modules: Module[];
  verification: {
    confidence_score: number;
    consensus_notes: string;
    changes_made: string[];
    open_risks: string[];
  };
}

/** One scheduled chunk of a task on a specific day. Long tasks span several sessions. */
export interface Session {
  id: string;
  taskId: string;
  moduleIndex: number;
  date: string; // YYYY-MM-DD
  minutes: number;
  done: boolean;
}

export interface Goal {
  id: string;
  title: string;
  outcome: string;
  currentLevel: string;
  known: string;
  targetLevel: string;
  startDate: string;
  deadline: string;
  hoursPerDay: number;
  days: number[]; // 0 = Sunday
  prefStart: string; // HH:MM
  prefs: string;
  color: string;
  createdAt: string;
  roadmap: Roadmap;
  sessions: Session[];
}

export interface Routine {
  id: string;
  title: string;
  start: string;
  end: string; // may be earlier than start for overnight routines
  days: number[];
  color: string;
}

export interface DayEvent {
  id: string;
  date: string;
  title: string;
  start: string;
  end: string;
}

export interface Settings {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  /** Only the last 4 chars are kept client-side; full keys will live in Supabase Vault. */
  apiKeyLast4: string;
  webResearch: boolean;
}

export interface AppState {
  goals: Goal[];
  routines: Routine[];
  events: DayEvent[];
  settings: Settings;
}
