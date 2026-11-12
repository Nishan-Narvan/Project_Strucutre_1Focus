/**
 * Writes the tool table in the root README from the tool registry, so the docs always match the code.
 *   npm run docs:tools
 */
import { readFileSync, writeFileSync } from "node:fs";
import { TOOLS, type ToolSpec } from "../src/lib/tools/registry";

const README = new URL("../../README.md", import.meta.url);
const START = "<!-- tools:start -->";
const END = "<!-- tools:end -->";

/** Plausible example values, by parameter name, so each example reads like a real call. */
const SAMPLE: Record<string, unknown> = {
  goal_id: "Crack DSA for coding interviews",
  title: "Learn Rust",
  outcome: "Ship a CLI tool in Rust",
  current_level: "Beginner",
  target_level: "Comfortable",
  prior_knowledge: "Python",
  learning_preferences: "Short videos, lots of practice",
  daily_minutes: 45,
  study_days: ["mon", "wed", "fri"],
  start_time: "07:00",
  start_date: "2026-11-16",
  deadline: "2027-01-31",
  phase: 2,
  phase_id: 2,
  to_phase: 3,
  task_id: "dsa4x1a2b3c",
  session_id: "s9f8e7d6",
  minutes: 40,
  kind: "practice",
  detail: "Ten problems, timed",
  position: 1,
  note: "Recursion finally clicked",
  reason: "Travelling",
  date: "2026-11-20",
  days: 7,
  from: "2026-11-16",
  to: "2026-11-22",
  query: "recursion struggles",
  summary: "Arrays first, then hashing.",
  source: "manual",
  name: "Mock interview score",
  unit: "%",
  target: 70,
  value: 62,
  direction: "up",
  frequency: "weekly",
  kpi_id: "Mock interview score",
  routine_id: "Gym",
  event_id: "ev7k2m",
  end_time: "08:45",
  memory_id: "m3x9",
  text: "Studies best before work.",
  remove_demo_goals: false,
  max_active_goals: 5,
  edit_window_days: 0,
  auto_apply_safe_changes: true,
  theme: "light",
  order: ["p1", "p3", "p2"],
};

function example(t: ToolSpec): Record<string, unknown> {
  if (t.name === "set_roadmap")
    return { goal_id: "Learn Rust", summary: "Ownership first.", phases: [{ title: "Syntax and ownership", checkpoint: "Explain borrowing", tasks: [{ title: "The Book ch. 1-4", minutes: 60, kind: "learn" }] }] };
  if (t.name === "bulk_update_roadmap") return { goal_id: "Learn Rust", changes: [{ action: "update_task", task_id: "t1", minutes: 75 }, { action: "add_task", phase: 2, title: "Write tests", minutes: 40 }] };
  if (t.name === "create_routine") return { title: "Gym", start_time: "18:00", end_time: "19:00", days: ["mon", "wed", "fri"] };
  if (t.name === "create_event") return { title: "Dentist", date: "2026-11-20", start_time: "17:45", end_time: "18:30" };
  if (t.name === "create_kpi") return { source: "manual", name: "Mock interview score", unit: "%", target: 70, goal_id: "Crack DSA for coding interviews" };
  if (t.name === "create_goal") return { title: "Learn Rust", daily_minutes: 45, study_days: ["mon", "wed", "fri"], deadline: "2027-01-31" };
  if (t.name === "update_settings") return { auto_apply_safe_changes: true };
  if (t.name === "save_memory") return { kind: "preference", text: "Studies best before work." };
  const keys = [...(t.required ?? []), ...Object.keys(t.params).filter((k) => !(t.required ?? []).includes(k)).slice(0, (t.required ?? []).length ? 1 : 2)];
  return Object.fromEntries(keys.filter((k) => k in SAMPLE).map((k) => [k, SAMPLE[k]]));
}

const kindLabel: Record<ToolSpec["kind"], string> = { read: "read", memory: "memory", write: "change", destructive: "**destructive**" };
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const firstSentence = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();

const rows = TOOLS.map((t) => {
  const inputs = Object.keys(t.params).map((k) => ((t.required ?? []).includes(k) ? `\`${k}\`*` : `\`${k}\``)).join(", ") || "none";
  return `| \`${t.name}\` | ${kindLabel[t.kind]} | ${cell(firstSentence(t.description))} | ${inputs} | \`${cell(JSON.stringify(example(t)))}\` |`;
});
rows.push(
  "| `undo_last_change` | **destructive** | Reverse the most recent change to the person's data, whoever made it. | none | `{}` |",
  "| `get_recent_changes` | read | The most recent changes: when, who (web, assistant, claude) and what. | `limit` | `{\"limit\":10}` |",
);

const table = [
  `${TOOLS.length + 2} tools. Inputs marked * are required. Change tools also accept \`confirm_token\` (second call, after the person agrees) and \`request_id\` (safe retries).`,
  "",
  "| Tool | Kind | What it does | Inputs | Example |",
  "|---|---|---|---|---|",
  ...rows,
].join("\n");

const md = readFileSync(README, "utf8");
const a = md.indexOf(START), b = md.indexOf(END);
if (a === -1 || b === -1) throw new Error(`README needs ${START} and ${END} markers.`);
writeFileSync(README, `${md.slice(0, a + START.length)}\n${table}\n${md.slice(b)}`);
console.log(`Wrote ${rows.length} tools to README.md`);
