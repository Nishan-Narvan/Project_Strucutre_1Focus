// @reviewed 2026-10-25
export type SourceType = "reddit" | "youtube" | "docs" | "course" | "article" | "book" | "other";
export type BuiltinKind = "learn" | "practice" | "project" | "review" | "quiz";
/** A built-in kind, or the id of a category the person made (settings.taskKinds). */
export type TaskKind = BuiltinKind | (string & {});
/** A task category the person added, with its own colour. */
export interface CustomKind {
  id: string;
  label: string;
  color: string; // #rrggbb
}
export type ProviderId = "groq" | "gemini" | "openrouter" | "openai" | "anthropic" | "custom";

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
  /** Longer explanation of the phase, written by the person or an assistant. */
  notes?: string;
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
  /** ISO timestamp of when it was marked complete. */
  doneAt?: string;
  /** What the learner wrote on completion: what they learned, links, blockers. */
  note?: string;
  /** Deliberately skipped: not counted as missed. The work itself stays unfinished. */
  skipped?: { reason: string; at: string };
  /** A fixed start time (HH:MM) for this one session, instead of the goal's usual time. */
  start?: string;
}

export interface ContextAttachment {
  id: string;
  name: string;
  type: string; // MIME
  size: number;
  /** Small data-URL preview for images; full files go to Supabase Storage in P1. */
  preview?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  attachments?: ContextAttachment[];
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
  /** Brainstorm transcript + attached context the roadmap was built from. */
  brainstorm?: ChatMessage[];
  /** Missing means active. Paused and archived goals have no planned sessions and do not count toward limits. */
  status?: GoalStatus;
  /** When the status last changed (ISO). */
  statusAt?: string;
  /** Study done outside the plan. Counts toward time KPIs, not roadmap progress. */
  logs?: StudyLog[];
  /** Notion pages, Drive folders, docs, videos, files on the person's computer: what exists for this goal. */
  materials?: Material[];
  /** Permanent timeline of what happened to the goal (created, roadmap written, phases added…). */
  history?: GoalEvent[];
}

export type MaterialKind = "notion" | "drive" | "folder" | "doc" | "sheet" | "slides" | "pdf" | "video" | "repo" | "local" | "link";

export interface Material {
  id: string;
  title: string;
  /** A web link, or a path on the person's computer (for example C:/notes/x.pdf or /Users/me/x.md). */
  url: string;
  kind: MaterialKind;
  /** Attached to one phase, or one task; neither = the goal as a whole. */
  phaseId?: string;
  taskId?: string;
  note?: string;
  addedAt: string; // ISO
}

export interface GoalEvent {
  at: string; // ISO
  /** The kind of change, for example roadmap_written, phase_added, material_added. */
  kind: string;
  /** One plain sentence. */
  text: string;
}

export type GoalStatus = "active" | "paused" | "archived";

export interface StudyLog {
  id: string;
  date: string; // YYYY-MM-DD
  minutes: number;
  note?: string;
  at: string; // ISO, when it was logged
}

/** Built-in measures computed from the app's own data; "manual" ones are logged by the person. */
export type KpiSource = "manual" | "streak" | "completion" | "minutes_week" | "tasks_week" | "pace";

export interface KpiValue {
  id: string;
  date: string; // YYYY-MM-DD
  value: number;
  note?: string;
}

export interface Kpi {
  id: string;
  /** Missing = about the person as a whole, not one goal. */
  goalId?: string;
  name: string;
  unit: string;
  target: number;
  /** Whether a higher or a lower value is better. */
  direction: "up" | "down";
  frequency: "daily" | "weekly";
  source: KpiSource;
  values: KpiValue[];
  createdAt: string;
}

export interface Limits {
  maxActiveGoals: number;
  maxDailyHours: number;
  maxTasksPerModule: number;
  /** Days after creation during which tasks and phases may be removed. 0 = never lock. */
  editWindowDays: number;
}

export type DashboardWidget = "summary" | "kpis" | "goals" | "paused";

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
  /** Kept in this browser only. Sent with each agent request and never stored on the server. */
  apiKey: string;
  /** Other models of this provider to fall back to, best first, when the chosen one fails or runs out of quota. */
  fallbacks: string[];
  webResearch: boolean;
  /** Outside services the agent can use, such as Google Calendar or Notion, reached over MCP. */
  mcp: McpServer[];
  /** Legacy: the connector token now lives server-side. Always stripped from stored data. */
  connector?: { token: string; lastSync?: string; error?: string };
  /** A model key is saved on the server for `keyProvider`. The key itself never comes back to the browser. */
  keySaved?: boolean;
  keyProvider?: ProviderId;
  keyLast4?: string;
  /** IANA time zone, so the server knows what "today" is for the person. */
  timezone?: string;
  appearance?: Appearance;
  /** Overrides of the app's limits; anything missing uses the default. */
  limits?: Partial<Limits>;
  /** Let assistants make ordinary (non-destructive) changes without asking each time. */
  autoApplySafe?: boolean;
  weekStart?: "mon" | "sun";
  /** Default length for new tasks, in minutes. */
  defaultTaskMinutes?: number;
  /** A calendar feed is connected (its secret address is kept encrypted on the server). */
  calendar?: { name: string };
  /** Study sessions are written to a "Where MyLife" calendar in the person's Google account (login kept encrypted on the server). */
  googleSync?: GoogleSync;
  /** Task categories the person added beside the built-in five. */
  taskKinds?: CustomKind[];
  /** Which sections the Goals page shows, in order. */
  dashboard?: DashboardWidget[];
}

/** How the app looks. Synced with the account, except an uploaded image, which stays on its device. */
export interface Appearance {
  theme: "dark" | "light" | "system";
  /** Where the full-screen background comes from. "device" = an image uploaded on this device. */
  background: "none" | "url" | "device";
  backgroundUrl?: string;
  /** How visible the background image is, 0-100. */
  backgroundOpacity: number;
  /** Translucent, blurred panels. */
  glass: boolean;
  /** How solid panels are in glass mode, 20-100. */
  panelOpacity: number;
  /** Blur behind glass panels, in px. Older setting; see glassLevel. */
  blur: number;
  /** One control for the whole look: 0 = solid panels, 100 = most see-through and blurred. */
  glassLevel?: number;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** The server says this tool only reads. Anything else asks the person before it runs. */
  readOnly: boolean;
}

export interface McpServer {
  id: string;
  name: string;
  url: string;
  /** Legacy: tokens now live encrypted on the server and this is always "". */
  token: string;
  /** A token for this connection is saved on the server. */
  hasToken?: boolean;
  enabled: boolean;
  /** Tool list as of the last connect or refresh. */
  tools: McpTool[];
}

export type MemoryKind = "preference" | "pattern" | "lesson" | "fact" | "commitment";

/** One short thing the agent keeps about the person between conversations. */
export interface Memory {
  id: string;
  kind: MemoryKind;
  text: string;
  source: "agent" | "user";
  createdAt: string; // YYYY-MM-DD
}

/** One turn of the conversation with the agent. */
export interface AgentTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** What the agent looked at or saved before answering. */
  steps?: string[];
  /** The model's reasoning before the answer, shown on request. */
  thinking?: string;
  /** Figures in the answer compared with the person's data. */
  check?: { found: number; missing: string[] };
  error?: boolean;
  at?: string; // ISO timestamp
}

/** A finished conversation, kept so the assistant can look things up in it later. */
export interface PastChat {
  id: string;
  endedAt: string; // YYYY-MM-DD
  turns: { role: "user" | "assistant"; text: string }[];
}

export interface AppState {
  goals: Goal[];
  routines: Routine[];
  events: DayEvent[];
  settings: Settings;
  memories: Memory[];
  chat: AgentTurn[];
  pastChats: PastChat[];
  kpis?: Kpi[];
}

export interface GoogleSync {
  /** Name of the calendar the app made and writes to. */
  calendar: string;
  /** Minutes before each session that Google reminds the person. */
  reminderMin: number;
  /** Last time the calendar was brought up to date (ISO), and the problem if that failed. */
  lastSync?: string;
  error?: string;
}
