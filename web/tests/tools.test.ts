/**
 * Tests for every tool in the shared registry: a normal case, a case where a limit is broken, and
 * bad input. Each test runs a tool on the sample data, applies its changes with the same rules the
 * server uses (applyOp), and checks the result.  Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../src/lib/demo";
import { applyOp, normalizeState, OpError, type Op } from "../src/lib/ops";
import { asOne, BY_NAME, needsApproval, runSpec, TOOLS, type ToolOutput } from "../src/lib/tools/registry";
import { addDays } from "../src/lib/date";
import { progress } from "../src/lib/schedule";
import { kpiReport } from "../src/lib/kpi";
import type { AppState } from "../src/lib/types";

const T = "2026-11-12";
const fresh = (): AppState => normalizeState(createDemoState());
const ctx = (state: AppState) => ({ state, t: T, now: `${T}T10:00:00.000Z` });

/** Run a tool; its changes are applied the way the server applies them. */
function call(state: AppState, name: string, args: Record<string, unknown> = {}): { out: ToolOutput & { error?: string }; state: AppState } {
  const spec = BY_NAME[name];
  assert.ok(spec, `tool ${name} exists`);
  const out = runSpec(spec, args, ctx(state));
  return { out, state: out.ops?.length ? applyOp(state, asOne(out.ops), { t: T }) : state };
}
/** Run a tool whose change the rules should refuse; returns the reason. */
function refused(state: AppState, name: string, args: Record<string, unknown>): string {
  const out = runSpec(BY_NAME[name], args, ctx(state));
  if (out.error) return out.error;
  assert.ok(out.ops?.length, `${name} produced a change`);
  try {
    applyOp(state, asOne(out.ops as Op[]), { t: T });
  } catch (e) {
    assert.ok(e instanceof OpError, `refusal is an OpError: ${e}`);
    return e.message;
  }
  assert.fail(`${name} should have been refused`);
}
const bad = (state: AppState, name: string, args: Record<string, unknown>) => {
  const out = runSpec(BY_NAME[name], args, ctx(state));
  assert.ok(out.error, `${name} with ${JSON.stringify(args)} returns an error`);
  return out.error as string;
};

const ROADMAP = {
  summary: "Arrays first, then hashing.",
  phases: [
    { title: "Basics", objective: "Write loops fluently", checkpoint: "Solve 3 easy problems", tasks: [{ title: "Read chapter 1", minutes: 45, kind: "learn" }, { title: "Do 5 drills", minutes: 60 }] },
    { title: "Hashing", tasks: [{ title: "Hash maps", minutes: 50, kind: "learn", detail: "Video + notes" }] },
  ],
};

test("every tool has a name, description, kind and a valid schema", () => {
  const names = new Set<string>();
  for (const t of TOOLS) {
    assert.match(t.name, /^[a-z][a-z_]{2,63}$/, t.name);
    assert.ok(!names.has(t.name), `duplicate ${t.name}`);
    names.add(t.name);
    assert.ok(t.description.length > 20, `${t.name} has a useful description`);
    assert.ok(["read", "memory", "write", "destructive"].includes(t.kind));
    for (const r of t.required ?? []) assert.ok(r in t.params, `${t.name}: required "${r}" is a parameter`);
  }
  for (const n of ["create_goal", "update_goal", "rename_goal", "pause_goal", "resume_goal", "archive_goal", "delete_goal", "set_roadmap", "create_phase", "update_phase", "delete_phase", "reorder_phases", "add_task", "update_task", "delete_task", "move_task", "reorder_tasks", "bulk_update_roadmap", "complete_session", "mark_task_done", "mark_task_undone", "log_study_time", "add_note", "edit_note", "delete_note", "skip_session", "reschedule_goal", "reschedule_session", "create_kpi", "update_kpi", "delete_kpi", "log_kpi_value", "get_kpis", "create_routine", "update_routine", "delete_routine", "create_event", "update_event", "delete_event", "get_capacity", "get_settings", "update_settings", "save_memory", "update_memory", "delete_memory", "list_memories", "export_data", "clear_demo_data", "get_overview", "list_materials", "add_material", "update_material", "remove_material", "get_goal_history", "get_memory_file"])
    assert.ok(names.has(n), `tool ${n} exists`);
});

test("reading tools never change anything", () => {
  const base = fresh();
  const s = applyOp(base, { type: "add_material", goalId: base.goals[0].id, material: { id: "m1", title: "Notes", url: "https://www.notion.so/Notes-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", kind: "notion", addedAt: T } }, { t: T });
  const g = s.goals[0];
  for (const t of TOOLS.filter((x) => x.kind === "read")) {
    const out = runSpec(t, { goal_id: g.id, query: "recursion", days: 3, material_id: "m1" }, ctx(s));
    assert.ok(!out.ops?.length, `${t.name} returned no changes`);
    assert.ok(!out.error, `${t.name}: ${out.error}`);
  }
});

// ------------------------------------------------------------ goals

test("create_goal: creates and plans; respects the active-goal and hours limits; rejects bad input", () => {
  let s = fresh();
  const r = call(s, "create_goal", { title: "Learn Rust", daily_minutes: 30, study_days: ["mon", "wed"], deadline: addDays(T, 60), roadmap: ROADMAP });
  s = r.state;
  const g = s.goals.find((x) => x.title === "Learn Rust");
  assert.ok(g);
  assert.equal(g.hoursPerDay, 0.5);
  assert.deepEqual(g.days, [1, 3]);
  assert.equal(g.roadmap.modules.length, 2);
  assert.ok(g.sessions.length > 0, "sessions were planned");
  assert.ok(g.sessions.every((x) => [1, 3].includes(new Date(x.date + "T00:00:00").getDay())), "only on study days");
  // Fifth active goal is over the limit of 4
  assert.match(refused(s, "create_goal", { title: "Fifth", daily_minutes: 10, study_days: "weekdays", deadline: addDays(T, 30) }), /limit is 4/);
  // Hours: 3 demo goals use 3h15m; 3h more breaks the 6h limit
  assert.match(refused(fresh(), "create_goal", { title: "Too much", daily_minutes: 180, study_days: "every day", deadline: addDays(T, 30) }), /over the 6 h limit/);
  assert.match(bad(s, "create_goal", { title: "x", daily_minutes: 30, study_days: ["someday"], deadline: addDays(T, 9) }), /not a day/);
  assert.match(bad(s, "create_goal", { daily_minutes: 30, study_days: "weekdays", deadline: addDays(T, 9) }), /"title" is required/);
  assert.match(bad(s, "create_goal", { title: "x", daily_minutes: 30, study_days: "weekdays", deadline: "next week" }), /YYYY-MM-DD/);
  assert.match(refused(fresh(), "create_goal", { title: "Past", daily_minutes: 30, study_days: "weekdays", start_date: T, deadline: addDays(T, -1) }), /deadline must be after/);
});

test("update_goal and rename_goal: schedule changes re-plan and keep finished work", () => {
  const s = fresh();
  const g = s.goals[0];
  const doneBefore = g.sessions.filter((x) => x.done).length;
  const r = call(s, "update_goal", { goal_id: g.id, daily_minutes: 60, study_days: ["mon", "tue", "wed", "thu", "fri"], start_time: "06:30" });
  const after = r.state.goals[0];
  assert.equal(after.hoursPerDay, 1);
  assert.equal(after.prefStart, "06:30");
  assert.equal(after.sessions.filter((x) => x.done).length, doneBefore, "finished work kept");
  assert.ok(after.sessions.filter((x) => !x.done && x.date >= T).every((x) => x.minutes <= 60), "no day over the new daily time");
  assert.equal(call(s, "rename_goal", { goal_id: g.id, title: "DSA" }).state.goals[0].title, "DSA");
  assert.match(bad(s, "update_goal", { goal_id: g.id }), /Nothing to change/);
  assert.match(bad(s, "update_goal", { goal_id: "nope", title: "x" }), /No goal matches/);
  assert.match(refused(s, "update_goal", { goal_id: g.id, daily_minutes: 400 }), /over the 6 h limit/);
});

test("pause, resume, archive, delete", () => {
  let s = fresh();
  const g = s.goals[0];
  s = call(s, "pause_goal", { goal_id: g.id }).state;
  const paused = s.goals[0];
  assert.equal(paused.status, "paused");
  assert.ok(paused.sessions.every((x) => x.done), "only finished work remains");
  // While paused it does not count: active goals use 1h45m, so a new 3h goal fits (4h45m of 6h)
  const fits = call(s, "create_goal", { title: "Fits now", daily_minutes: 180, study_days: "every day", deadline: addDays(T, 20) });
  assert.ok(!fits.out.error);
  // ...and then resuming the paused 1h30m one would make 6h15m, over the limit
  assert.match(refused(fits.state, "resume_goal", { goal_id: g.id }), /over the 6 h limit/);
  s = call(s, "resume_goal", { goal_id: g.id }).state;
  assert.equal(s.goals[0].status, "active");
  assert.ok(s.goals[0].sessions.some((x) => !x.done && x.date >= T), "replanned from today");
  s = call(s, "archive_goal", { goal_id: g.id }).state;
  assert.equal(s.goals[0].status, "archived");
  assert.equal(BY_NAME.archive_goal.kind, "destructive");
  s = call(s, "delete_goal", { goal_id: g.id }).state;
  assert.ok(!s.goals.some((x) => x.id === g.id));
});

// ------------------------------------------------------------ roadmap

test("set_roadmap writes a roadmap for an empty goal, and replacing one keeps ids and finished work", () => {
  let s = call(fresh(), "pause_goal", { goal_id: fresh().goals[0].id }).state; // make room
  s = call(s, "create_goal", { title: "Empty", daily_minutes: 30, study_days: "weekdays", deadline: addDays(T, 40) }).state;
  const e = s.goals.find((x) => x.title === "Empty")!;
  assert.equal(e.roadmap.modules.length, 0);
  const w = call(s, "set_roadmap", { goal_id: e.id, ...ROADMAP });
  assert.ok(!w.out.destructive, "writing the first roadmap is not destructive");
  const written = w.state.goals.find((x) => x.id === e.id)!;
  assert.equal(written.roadmap.modules.length, 2);
  assert.ok(written.sessions.length > 0);

  // Replace the DSA roadmap keeping only its first phase. DSA is 16 days old, so dropping phases
  // with finished work is refused until the edit window is opened in Settings.
  const locked = fresh();
  const g = locked.goals[0];
  const keepPhase = { id: g.roadmap.modules[0].id, title: g.roadmap.modules[0].title, tasks: g.roadmap.modules[0].tasks };
  const args = { goal_id: g.id, phases: [keepPhase, { title: "New phase", tasks: [{ title: "New task", minutes: 30 }] }] };
  assert.match(refused(locked, "set_roadmap", args), /locked/);
  const d = call(locked, "update_settings", { edit_window_days: 0 }).state;
  const r = call(d, "set_roadmap", args);
  assert.ok(r.out.destructive, "replacing is destructive");
  const ng = r.state.goals[0];
  assert.equal(ng.roadmap.modules.length, 2);
  const keptDone = ng.sessions.filter((x) => x.done).every((x) => g.roadmap.modules[0].tasks.some((t) => t.id === x.taskId));
  assert.ok(keptDone && ng.sessions.some((x) => x.done), "finished work on kept tasks remains");
  assert.match(bad(d, "set_roadmap", { goal_id: g.id, phases: [] }), /at least one phase/);
  assert.match(bad(d, "set_roadmap", { goal_id: g.id, phases: [{ title: "x", tasks: [{ title: "t", minutes: 2 }] }] }), /between 5 and 600/);
  // No limit on tasks in a phase
  const many = Array.from({ length: 30 }, (_, i) => ({ title: `t${i}`, minutes: 20 }));
  assert.equal(call(d, "set_roadmap", { goal_id: g.id, phases: [{ title: "Big", tasks: many }] }).state.goals[0].roadmap.modules[0].tasks.length, 30);
});

test("phases: create, update, reorder, delete (delete blocked when locked)", () => {
  let s = fresh();
  const g = s.goals[2]; // created today: not locked
  s = call(s, "create_phase", { goal_id: g.id, title: "Capstone", position: 1, tasks: [{ title: "Pick a dataset", minutes: 30 }] }).state;
  let mods = s.goals[2].roadmap.modules;
  assert.equal(mods[0].title, "Capstone");
  s = call(s, "update_phase", { goal_id: g.id, phase_id: mods[0].id, checkpoint: "Dataset chosen" }).state;
  assert.equal(s.goals[2].roadmap.modules[0].checkpoint, "Dataset chosen");
  const order = [...s.goals[2].roadmap.modules.map((m) => m.id).slice(1), mods[0].id];
  s = call(s, "reorder_phases", { goal_id: g.id, order }).state;
  mods = s.goals[2].roadmap.modules;
  assert.equal(mods.at(-1)!.title, "Capstone");
  s = call(s, "delete_phase", { goal_id: g.id, phase_id: "Capstone" }).state;
  assert.ok(!s.goals[2].roadmap.modules.some((m) => m.title === "Capstone"));
  assert.match(bad(s, "reorder_phases", { goal_id: g.id, order: ["nope"] }), /no phase "nope"/);
  // The DSA goal started 16 days ago: locked
  const dsa = fresh();
  assert.match(refused(dsa, "delete_phase", { goal_id: dsa.goals[0].id, phase_id: 1 }), /locked/);
  // ...unless the edit window is set to 0 (never lock)
  const open = call(dsa, "update_settings", { edit_window_days: 0 }).state;
  assert.ok(!call(open, "delete_phase", { goal_id: dsa.goals[0].id, phase_id: 1 }).out.error);
});

test("tasks: add, update, move, reorder, delete; limits and bad input", () => {
  let s = fresh();
  const g = s.goals[2];
  s = call(s, "add_task", { goal_id: g.id, phase: 1, title: "Extra drill", minutes: 25, kind: "practice", position: 1 }).state;
  let t = s.goals[2].roadmap.modules[0].tasks[0];
  assert.equal(t.title, "Extra drill");
  s = call(s, "update_task", { goal_id: g.id, task_id: t.id, minutes: 40, detail: "Ten problems" }).state;
  t = s.goals[2].roadmap.modules[0].tasks[0];
  assert.equal(t.minutes, 40);
  s = call(s, "move_task", { goal_id: g.id, task_id: t.id, to_phase: 2, position: 1 }).state;
  assert.equal(s.goals[2].roadmap.modules[1].tasks[0].id, t.id);
  const ids = s.goals[2].roadmap.modules[1].tasks.map((x) => x.id);
  s = call(s, "reorder_tasks", { goal_id: g.id, phase_id: 2, order: [...ids].reverse() }).state;
  assert.equal(s.goals[2].roadmap.modules[1].tasks.at(-1)!.id, t.id);
  s = call(s, "delete_task", { goal_id: g.id, task_id: t.id }).state;
  assert.ok(!s.goals[2].roadmap.modules[1].tasks.some((x) => x.id === t.id));
  assert.match(bad(s, "add_task", { goal_id: g.id, phase: 9, title: "x", minutes: 20 }), /no phase "9"/);
  assert.match(bad(s, "add_task", { goal_id: g.id, phase: 1, title: "x", minutes: 1000 }), /between 5 and 600/);
  assert.match(bad(s, "reorder_tasks", { goal_id: g.id, phase_id: 1, order: ["a"] }), /exactly once|every task/);
  let full = s;
  for (let i = s.goals[2].roadmap.modules[0].tasks.length; i < 12; i++) full = call(full, "add_task", { goal_id: g.id, phase: 1, title: `fill ${i}`, minutes: 10 }).state;
  // No limit on tasks in a phase: a 13th is added
  full = call(full, "add_task", { goal_id: g.id, phase: 1, title: "13th", minutes: 10 }).state;
  assert.equal(full.goals[2].roadmap.modules[0].tasks.length, 13);
});

test("bulk_update_roadmap applies all changes or none", () => {
  const s = fresh();
  const g = s.goals[2];
  const first = g.roadmap.modules[0].tasks[0];
  const r = call(s, "bulk_update_roadmap", { goal_id: g.id, changes: [{ action: "update_task", task_id: first.id, title: "Renamed" }, { action: "add_task", phase: 2, title: "Added", minutes: 30 }] });
  assert.equal(r.state.goals[2].roadmap.modules[0].tasks[0].title, "Renamed");
  assert.ok(r.state.goals[2].roadmap.modules[1].tasks.some((x) => x.title === "Added"));
  assert.match(bad(s, "bulk_update_roadmap", { goal_id: g.id, changes: [{ action: "update_task", task_id: first.id, title: "ok" }, { action: "fly" }] }), /Change 2: unknown action/);
  // A refusal in the middle stops the whole batch
  // Editing a task that an earlier change deleted fails when applied, so none of the changes are kept
  const msg = refused(s, "bulk_update_roadmap", { goal_id: g.id, changes: [{ action: "update_task", task_id: first.id, title: "Should not stick" }, { action: "delete_task", task_id: first.id }, { action: "update_task", task_id: first.id, title: "Again" }] });
  assert.match(msg, /Change 3 of 3.*Nothing was saved/);
});

// ------------------------------------------------------------ progress

test("progress tools: complete, notes, skip, move, log time, mark task done/undone", () => {
  let s = fresh();
  const g = s.goals[1];
  const open = g.sessions.find((x) => !x.done && x.date >= T)!;
  s = call(s, "complete_session", { goal_id: g.id, session_id: open.id, note: "Went well" }).state;
  assert.equal(s.goals[1].sessions.find((x) => x.id === open.id)!.note, "Went well");
  s = call(s, "edit_note", { goal_id: g.id, session_id: open.id, note: "Went very well" }).state;
  assert.equal(s.goals[1].sessions.find((x) => x.id === open.id)!.note, "Went very well");
  s = call(s, "delete_note", { goal_id: g.id, session_id: open.id }).state;
  assert.equal(s.goals[1].sessions.find((x) => x.id === open.id)!.note, undefined);
  assert.match(bad(s, "delete_note", { goal_id: g.id, session_id: open.id }), /has no note/);

  const next = s.goals[1].sessions.find((x) => !x.done && x.date > T)!;
  s = call(s, "skip_session", { goal_id: g.id, session_id: next.id, reason: "travelling" }).state;
  assert.equal(s.goals[1].sessions.find((x) => x.id === next.id)!.skipped?.reason, "travelling");
  s = call(s, "reschedule_session", { goal_id: g.id, session_id: next.id, date: addDays(T, 3), start_time: "8:15" }).state;
  const moved = s.goals[1].sessions.find((x) => x.id === next.id)!;
  assert.equal(moved.date, addDays(T, 3));
  assert.equal(moved.start, "08:15");
  assert.equal(moved.skipped, undefined, "moving un-skips it");
  assert.match(refused(s, "skip_session", { goal_id: g.id, session_id: open.id, reason: "x" }), /already done/);
  assert.match(bad(s, "reschedule_session", { goal_id: g.id, session_id: next.id, date: addDays(T, 1), start_time: "25:00" }), /HH:MM/);

  s = call(s, "log_study_time", { goal_id: g.id, minutes: 35, note: "Podcast" }).state;
  assert.equal(s.goals[1].logs?.[0].minutes, 35);
  assert.match(refused(s, "log_study_time", { goal_id: g.id, minutes: 20, date: addDays(T, 2) }), /today or earlier/);
  assert.match(bad(s, "log_study_time", { goal_id: g.id, minutes: 0 }), /at least 1/);

  const task = s.goals[1].roadmap.modules[2].tasks[0];
  s = call(s, "mark_task_done", { goal_id: g.id, task_id: task.id }).state;
  assert.ok(s.goals[1].sessions.filter((x) => x.taskId === task.id).every((x) => x.done));
  s = call(s, "mark_task_undone", { goal_id: g.id, task_id: task.id }).state;
  assert.ok(s.goals[1].sessions.filter((x) => x.taskId === task.id).every((x) => !x.done));

  const before = progress(s.goals[0]).pct;
  s = call(s, "reschedule_goal", { goal_id: s.goals[0].id }).state;
  assert.equal(progress(s.goals[0]).pct, before, "re-planning keeps progress");
  assert.ok(!s.goals[0].sessions.some((x) => !x.done && x.date < T), "no missed sessions left behind");
});

// ------------------------------------------------------------ KPIs

test("KPIs: built-in and manual, logging, reports, limits", () => {
  let s = fresh();
  const g = s.goals[0];
  s = call(s, "create_kpi", { source: "minutes_week", goal_id: g.id }).state;
  s = call(s, "create_kpi", { source: "manual", name: "Mock score", unit: "%", target: 70, frequency: "weekly" }).state;
  const [auto, manual] = s.kpis!;
  assert.equal(auto.name, "Study time this week");
  const rep = kpiReport(s, auto, T);
  assert.ok(rep.current !== null && rep.current > 0, "computed from real sessions");
  assert.equal(rep.series.length, 28);
  s = call(s, "log_kpi_value", { kpi_id: "Mock score", value: 62 }).state;
  s = call(s, "log_kpi_value", { kpi_id: manual.id, value: 75, date: T }).state; // same date: replaces
  const m = s.kpis!.find((k) => k.id === manual.id)!;
  assert.equal(m.values.length, 1);
  assert.equal(kpiReport(s, m, T).onTarget, true);
  assert.match(refused(s, "log_kpi_value", { kpi_id: auto.id, value: 5 }), /measured automatically/);
  s = call(s, "update_kpi", { kpi_id: manual.id, target: 80 }).state;
  assert.equal(kpiReport(s, s.kpis!.find((k) => k.id === manual.id)!, T).onTarget, false);
  assert.match(bad(s, "create_kpi", { source: "manual", target: 3 }), /"name" is required/);
  assert.match(bad(s, "create_kpi", { source: "vibes" }), /must be one of/);
  assert.match(bad(s, "log_kpi_value", { kpi_id: "nope", value: 1 }), /No KPI matches/);
  const got = call(s, "get_kpis").out.result as { name: string; trend: string }[];
  assert.equal(got.length, 2);
  s = call(s, "delete_kpi", { kpi_id: manual.id }).state;
  assert.equal(s.kpis!.length, 1);
  // Deleting a goal removes its KPIs
  s = call(s, "delete_goal", { goal_id: g.id }).state;
  assert.equal(s.kpis!.length, 0);
});

// ------------------------------------------------------------ routines, events, capacity

test("routines and events: create, update, delete, capacity; bad input", () => {
  let s = fresh();
  s = call(s, "create_routine", { title: "Commute", start_time: "08:00", end_time: "08:45", days: "weekdays" }).state;
  const r = s.routines.find((x) => x.title === "Commute")!;
  assert.deepEqual(r.days, [1, 2, 3, 4, 5]);
  s = call(s, "update_routine", { routine_id: "Commute", end_time: "09:00" }).state;
  assert.equal(s.routines.find((x) => x.id === r.id)!.end, "09:00");
  s = call(s, "delete_routine", { routine_id: r.id }).state;
  assert.ok(!s.routines.some((x) => x.id === r.id));
  assert.match(bad(s, "create_routine", { title: "x", start_time: "9am", end_time: "10:00", days: "weekdays" }), /HH:MM/);
  s = call(s, "create_event", { title: "Exam", date: addDays(T, 2), start_time: "10:00", end_time: "12:00" }).state;
  const e = s.events.find((x) => x.title === "Exam")!;
  s = call(s, "update_event", { event_id: e.id, title: "Final exam" }).state;
  assert.equal(s.events.find((x) => x.id === e.id)!.title, "Final exam");
  s = call(s, "delete_event", { event_id: e.id }).state;
  assert.ok(!s.events.some((x) => x.id === e.id));
  const cap = call(s, "get_capacity", { from: T, to: addDays(T, 2) }).out.result as { days: unknown[] };
  assert.equal(cap.days.length, 3);
  assert.match(bad(s, "get_capacity", { from: T, to: addDays(T, -3) }), /1 to 62 days/);
});

// ------------------------------------------------------------ settings, memory, hygiene

test("settings: limits are configurable and enforced; limit changes always need confirmation", () => {
  let s = fresh();
  const out = runSpec(BY_NAME.update_settings, { max_active_goals: 5 }, ctx(s));
  assert.equal(needsApproval(BY_NAME.update_settings, out, true), true, "limits need confirmation even with auto-apply on");
  s = call(s, "update_settings", { max_active_goals: 5, max_daily_hours: 8, auto_apply_safe_changes: true, week_start: "sun", dashboard: ["goals", "kpis"] }).state;
  assert.equal(s.settings.limits?.maxActiveGoals, 5);
  assert.equal(s.settings.autoApplySafe, true);
  assert.deepEqual(s.settings.dashboard, ["goals", "kpis"]);
  const fourth = call(s, "create_goal", { title: "Four", daily_minutes: 30, study_days: "weekdays", deadline: addDays(T, 30) });
  assert.ok(!fourth.out.error);
  const fifth = call(fourth.state, "create_goal", { title: "Five", daily_minutes: 30, study_days: "weekdays", deadline: addDays(T, 30) });
  assert.equal(fifth.state.goals.length, 5, "a 5th goal fits the raised limit");
  const ordinary = runSpec(BY_NAME.rename_goal, { goal_id: s.goals[0].id, title: "x" }, ctx(s));
  assert.equal(needsApproval(BY_NAME.rename_goal, ordinary, true), false, "ordinary change auto-applies when allowed");
  assert.equal(needsApproval(BY_NAME.rename_goal, ordinary, false), true, "and asks when not");
  assert.match(bad(s, "update_settings", { max_active_goals: 0 }), /at least 1/);
  assert.match(bad(s, "update_settings", { dashboard: ["weather"] }), /not a section/);
  assert.match(bad(s, "update_settings", {}), /Nothing to change/);
});

test("memories: save, update, list, delete", () => {
  let s = fresh();
  s = call(s, "save_memory", { kind: "preference", text: "Likes mornings." }).state;
  const id = s.memories[0].id;
  assert.equal(call(s, "save_memory", { kind: "fact", text: "likes mornings." }).out.label, "Already knew that");
  s = call(s, "update_memory", { memory_id: id, text: "Likes early mornings." }).state;
  assert.equal(s.memories[0].text, "Likes early mornings.");
  assert.equal((call(s, "list_memories").out.result as unknown[]).length, 1);
  s = call(s, "delete_memory", { memory_id: id }).state;
  assert.equal(s.memories.length, 0);
  assert.match(bad(s, "update_memory", { memory_id: "nope", text: "x" }), /No memory/);
});

test("export_data and clear_demo_data", () => {
  let s = fresh();
  const exported = JSON.parse(call(s, "export_data").out.result as string);
  assert.equal(exported.format, "where-mylife/1");
  assert.equal(exported.goals.length, 3);
  assert.ok(!JSON.stringify(exported).includes('"apiKey":"x'), "no keys");
  const preview = runSpec(BY_NAME.clear_demo_data, {}, ctx(s));
  assert.match(preview.summary!, /Remove \d+ seeded sample notes/);
  s = call(s, "clear_demo_data", {}).state;
  const notes = s.goals.flatMap((g) => g.sessions.map((x) => x.note)).filter(Boolean);
  assert.equal(notes.length, 0, "all seeded notes gone");
  assert.equal(s.goals.length, 3, "goals kept unless asked");
  assert.equal(call(s, "clear_demo_data", { remove_demo_goals: true }).state.goals.length, 0);
  assert.match(String((call(call(s, "clear_demo_data", { remove_demo_goals: true }).state, "clear_demo_data").out.result as { note: string }).note), /No sample data/);
});

test("ops are idempotent where ids are given", () => {
  const s = fresh();
  const out = runSpec(BY_NAME.create_goal, { title: "Once", daily_minutes: 20, study_days: "weekdays", deadline: addDays(T, 20) }, ctx(s));
  const op = asOne(out.ops!);
  const once = applyOp(s, op, { t: T });
  const twice = applyOp(once, op, { t: T });
  assert.equal(twice.goals.length, once.goals.length);
});

// ------------------------------------------------------------ materials, inserting, history, memory file

import { buildMemoryFile } from "../src/lib/memoryFile";
import { detectKind, titleFromUrl } from "../src/lib/materials";
import { needsServerCopy } from "../src/lib/ops";

test("materials: links and local paths, attached to goal, phase or task; recognised; bad input refused", () => {
  assert.equal(detectKind("https://www.notion.so/Trees-and-Graphs-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d"), "notion");
  assert.equal(detectKind("https://drive.google.com/drive/folders/abc"), "folder");
  assert.equal(detectKind("https://docs.google.com/document/d/x/edit"), "doc");
  assert.equal(detectKind("https://youtu.be/abc"), "video");
  assert.equal(detectKind("D:/Notes/trees.pdf"), "pdf");
  assert.equal(detectKind("C:/Users/me/notes.md"), "local");
  assert.equal(titleFromUrl("https://www.notion.so/Trees-and-Graphs-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d"), "Trees and Graphs");
  let s = fresh();
  const g = s.goals[0];
  const task = g.roadmap.modules[3].tasks[0];
  s = call(s, "add_material", { goal_id: g.id, url: "https://www.notion.so/Trees-and-Graphs-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", phase: 4 }).state;
  s = call(s, "add_material", { goal_id: g.id, url: "D:/Notes/trees.pdf", task_id: task.id, note: "my handwritten notes" }).state;
  s = call(s, "add_material", { goal_id: g.id, url: "https://drive.google.com/drive/folders/abc", title: "DSA folder" }).state;
  const mats = s.goals[0].materials!;
  assert.equal(mats.length, 3);
  assert.equal(mats[0].phaseId, g.roadmap.modules[3].id);
  assert.equal(mats[1].taskId, task.id);
  const listed = call(s, "list_materials", { goal_id: g.id, phase: 4 }).out.result as { title: string }[];
  assert.equal(listed.length, 2, "phase listing includes its tasks' materials");
  const rm = JSON.stringify(call(s, "get_goal_roadmap", { goal_id: g.id }).out.result);
  assert.ok(rm.includes("Trees and Graphs") && rm.includes("trees.pdf") && rm.includes("DSA folder"), "roadmap read shows materials");
  assert.match(bad(s, "add_material", { goal_id: g.id, url: "notion page" }), /not a link or a file path/);
  assert.match(bad(s, "add_material", { goal_id: g.id, url: "ftp://x.org/a" }), /Only web links/);
  s = call(s, "remove_material", { goal_id: g.id, material_id: "DSA folder" }).state;
  assert.equal(s.goals[0].materials!.length, 2);
});

test("insert a phase between phases and a task between tasks; elaborate a phase", () => {
  let s = fresh();
  const g = s.goals[2];
  s = call(s, "create_phase", { goal_id: g.id, title: "Statistics refresher", position: 2, tasks: [{ title: "Distributions", minutes: 40 }] }).state;
  assert.equal(s.goals[2].roadmap.modules[1].title, "Statistics refresher");
  assert.equal(s.goals[2].roadmap.modules[0].title, g.roadmap.modules[0].title, "earlier phases stay put");
  s = call(s, "add_task", { goal_id: g.id, phase: 1, title: "Inserted second", minutes: 20, position: 2 }).state;
  assert.equal(s.goals[2].roadmap.modules[0].tasks[1].title, "Inserted second");
  s = call(s, "update_phase", { goal_id: g.id, phase_id: 1, details: "Vectors, then matrices, then derivatives.", approach: "Draw first", key_concepts: ["vectors", "matrices"] }).state;
  const m = s.goals[2].roadmap.modules[0];
  assert.equal(m.notes, "Vectors, then matrices, then derivatives.");
  assert.equal(m.zpd_scaffold, "Draw first");
});

test("goal history records the story and get_goal_history reports quality", () => {
  let s = fresh();
  s = call(s, "create_goal", { title: "History test", daily_minutes: 20, study_days: "weekdays", deadline: addDays(T, 30) }).state;
  const g = s.goals.find((x) => x.title === "History test")!;
  s = call(s, "set_roadmap", { goal_id: g.id, phases: [{ title: "One", tasks: [{ title: "a", minutes: 20 }] }] }).state;
  s = call(s, "add_material", { goal_id: g.id, url: "https://example.com/guide" }).state;
  s = call(s, "update_goal", { goal_id: g.id, deadline: addDays(T, 40) }).state;
  const h = s.goals.find((x) => x.id === g.id)!.history!;
  assert.deepEqual(h.map((e) => e.kind), ["goal_created", "roadmap_written", "material_added", "goal_edited"]);
  assert.match(h[3].text, /deadline .* -> /);
  const r = call(s, "get_goal_history", { goal_id: g.id }).out.result as { timeline: unknown[]; materials_linked: number; quality: object };
  assert.equal(r.timeline.length, 4);
  assert.equal(r.materials_linked, 1);
  const base = fresh();
  const dsa = call(base, "get_goal_history", { goal_id: base.goals[0].id }).out.result as { quality: { sessions_with_notes: string } };
  assert.match(dsa.quality.sessions_with_notes, /\d+%/);
});

test("memory file: every section, every task, every day, raw JSON", () => {
  const base = fresh();
  const s = call(base, "add_material", { goal_id: base.goals[0].id, url: "D:/Notes/trees.pdf" }).state;
  const g = s.goals[0];
  const text = buildMemoryFile(s, T, { goalId: g.id });
  for (const h of ["## How to read this file", "## The person", `## Goal: ${g.title}`, "### Where it stands now", "### Quality of work", "### Roadmap", "### Materials", "### Daily log since the start", "### Change history", "## Raw data (JSON)"]) assert.ok(text.includes(h), `has ${h}`);
  for (const m of g.roadmap.modules) for (const t of m.tasks) assert.ok(text.includes(t.title), `task ${t.title} listed`);
  const pastDates = [...new Set(g.sessions.filter((x) => x.date < T).map((x) => x.date))];
  for (const d of pastDates) assert.ok(text.includes(`- ${d} `), `day ${d} in the log`);
  assert.ok(/- \[x\] /.test(text) && /- \[ \] /.test(text), "done and remaining marked");
  assert.ok(text.includes("trees.pdf"), "materials included");
  const json = JSON.parse(text.slice(text.indexOf("```json") + 7, text.lastIndexOf("```")));
  assert.equal(json.goals[0].id, g.id);
  assert.ok(!text.includes("apiKey\":\"x"), "no keys");
  const all = buildMemoryFile(s, T);
  assert.ok(s.goals.every((x) => all.includes(`## Goal: ${x.title}`)), "all goals when no goal is given");
  assert.ok(call(s, "get_memory_file", { goal_id: g.id }).out.result === buildMemoryFile(s, T, { goalId: g.id, generatedAt: `${T}T10:00` }));
});

test("fast saves: only re-planning changes need the server's copy", () => {
  assert.equal(needsServerCopy({ type: "add_material", goalId: "g", material: { id: "m", title: "t", url: "https://x.org", kind: "link", addedAt: T } }), false);
  assert.equal(needsServerCopy({ type: "complete_session", goalId: "g", sessionId: "s", note: "", at: T }), false);
  assert.equal(needsServerCopy({ type: "reschedule_goal", goalId: "g" }), true);
  assert.equal(needsServerCopy({ type: "batch", ops: [{ type: "delete_memory", id: "m" }, { type: "reschedule_goal", goalId: "g" }] }), true);
});
