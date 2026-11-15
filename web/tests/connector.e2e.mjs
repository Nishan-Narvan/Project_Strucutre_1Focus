// End-to-end: drive the whole app through the claude.ai connector (MCP), against a running server and
// real Supabase, with a throwaway account that is deleted at the end. This is the "done when" check:
// create a goal, write and edit its roadmap, change its schedule, log progress, track KPIs, adjust
// routines and settings, confirm in chat, undo, and see every change in the account's data.
//
// Needs the dev server running with WML_TEST_LOGIN=1, and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY set.
//   node tests/connector.e2e.mjs
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const APP = process.env.APP ?? "http://localhost:3000", SB = env.SUPABASE_URL, SK = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json" };
let failed = 0;
const ok = (n, c, d) => { if (!c) failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "\n      got: " + String(typeof d === "string" ? d : JSON.stringify(d)).slice(0, 500)}`); };

const jar = {};
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
async function api(path, init = {}) {
  const res = await fetch(APP + path, { ...init, headers: { "Content-Type": "application/json", Cookie: cookie(), ...(init.headers ?? {}) } });
  for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const state = async () => (await api("/api/state")).body.state;

const email = `wml-mcp-${Date.now()}@example.com`, password = "Mcp-" + Math.random().toString(36).slice(2) + "A1!";
const uid = (await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json()).id;

let client;
const text = (r) => r.content.map((c) => c.text).join("\n");
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: text(r), isError: Boolean(r.isError) };
};
/** Call, and if the server asks for confirmation, confirm (as the person agreeing in chat). */
const confirmCall = async (name, args = {}) => {
  const first = await call(name, args);
  const token = first.text.match(/confirm_token: "([^"]+)"/)?.[1];
  if (!token) return { first, second: null };
  return { first, second: await call(name, { ...args, confirm_token: token }) };
};

try {
  await api("/api/test-login", { method: "POST", body: JSON.stringify({ email, password }) });
  await api("/api/state", { method: "POST", body: JSON.stringify({ mode: "demo", timezone: "Asia/Kolkata" }) });
  // The URL names the deployed site; the test talks to this local server with the same secret path
  const url = APP + new URL((await api("/api/connector", { method: "POST" })).body.url).pathname;
  client = new Client({ name: "claude-standin", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));

  const tools = (await client.listTools()).tools;
  ok(`lists every tool (${tools.length})`, tools.length >= 50 && ["create_goal", "set_roadmap", "bulk_update_roadmap", "log_kpi_value", "update_settings", "clear_demo_data", "undo_last_change", "get_recent_changes"].every((n) => tools.some((t) => t.name === n)), tools.map((t) => t.name));
  ok("write tools offer confirm_token and request_id", tools.find((t) => t.name === "create_goal").inputSchema.properties.confirm_token && tools.find((t) => t.name === "create_goal").inputSchema.properties.request_id);
  ok("read tools are marked read-only, deletes destructive", tools.find((t) => t.name === "get_overview").annotations.readOnlyHint === true && tools.find((t) => t.name === "delete_goal").annotations.destructiveHint === true);

  // 1. Create a goal: needs confirmation first; nothing changes until confirmed
  const goalArgs = { title: "Learn Rust", outcome: "Ship a CLI tool", current_level: "Beginner", target_level: "Comfortable", daily_minutes: 30, study_days: ["mon", "wed", "fri"], start_time: "07:00", deadline: "2027-01-31" };
  const c1 = await confirmCall("create_goal", goalArgs);
  ok("create_goal asks for confirmation first", /Not done yet/.test(c1.first.text) && /Create the goal "Learn Rust"/.test(c1.first.text), c1.first.text);
  ok("created after confirmation (a 4th goal fits the limit of 4)", c1.second && /Done\./.test(c1.second.text), c1.second?.text);
  let s = await state();
  const g = s.goals.find((x) => x.title === "Learn Rust");
  ok("goal is in the account at once", Boolean(g) && g.days.join() === "1,3,5" && g.hoursPerDay === 0.5, g);
  ok("a wrong token is refused", /Not done yet/.test((await call("rename_goal", { goal_id: g.id, title: "x", confirm_token: "AAAAAAAAAAAA" })).text));

  // 2. Write its roadmap (first roadmap: an ordinary change)
  const r1 = await confirmCall("set_roadmap", { goal_id: g.id, summary: "Ownership first.", phases: [
    { title: "Syntax and ownership", objective: "Read and write basic Rust", checkpoint: "Explain borrowing", tasks: [{ title: "The Book ch. 1-4", minutes: 60, kind: "learn" }, { title: "Rustlings: variables", minutes: 30, kind: "practice" }] },
    { title: "CLI project", tasks: [{ title: "Parse args with clap", minutes: 45, kind: "project" }] },
  ] });
  ok("set_roadmap applies after confirmation", /Done\./.test(r1.second?.text ?? ""), r1);
  s = await state();
  let rg = s.goals.find((x) => x.id === g.id);
  ok("roadmap and planned sessions exist", rg.roadmap.modules.length === 2 && rg.sessions.length > 0, rg.roadmap.modules.map((m) => m.title));

  // 3. Turn on auto-apply for ordinary changes (a protected setting: confirmed), then edit freely
  const a1 = await confirmCall("update_settings", { auto_apply_safe_changes: true });
  ok("auto-apply needs confirmation, then applies", /Not done yet/.test(a1.first.text) && /Done\./.test(a1.second?.text ?? ""), a1);
  const roadmap = JSON.parse((await call("get_goal_roadmap", { goal_id: g.id })).text);
  const firstTask = roadmap.phases[0].tasks[0];
  const bulk = await call("bulk_update_roadmap", { goal_id: g.id, changes: [{ action: "update_task", task_id: firstTask.id, minutes: 75 }, { action: "add_task", phase: 2, title: "Write tests", minutes: 40, kind: "practice" }] });
  ok("bulk roadmap edit applies directly once auto-apply is on", /^Done\./.test(bulk.text), bulk.text);

  // 4. Change the schedule
  const sch = await call("update_goal", { goal_id: g.id, daily_minutes: 45, study_days: "weekdays" });
  s = await state();
  rg = s.goals.find((x) => x.id === g.id);
  ok("schedule changed and re-planned", /Done\./.test(sch.text) && rg.hoursPerDay === 0.75 && rg.days.join() === "1,2,3,4,5", { text: sch.text, days: rg.days });

  // 5. Log progress
  const up = JSON.parse((await call("get_upcoming", { days: 7 })).text);
  const sess = up.flatMap((d) => d.sessions).find((x) => x.goal_id === g.id);
  const done = await call("complete_session", { goal_id: g.id, session_id: sess.id, note: "Borrow checker finally clicked" });
  const logged = await call("log_study_time", { goal_id: g.id, minutes: 25, note: "Read a blog post" });
  s = await state();
  rg = s.goals.find((x) => x.id === g.id);
  ok("session done with note, extra time logged", /Done\./.test(done.text) && rg.sessions.find((x) => x.id === sess.id)?.note === "Borrow checker finally clicked" && rg.logs?.[0]?.minutes === 25, { done: done.text, logged: logged.text });

  // 6. KPIs
  await call("create_kpi", { source: "manual", goal_id: g.id, name: "Rustlings solved", unit: "exercises", target: 20 });
  await call("create_kpi", { source: "streak" });
  const lk = await call("log_kpi_value", { kpi_id: "Rustlings solved", value: 6 });
  const kpis = JSON.parse((await call("get_kpis")).text);
  ok("KPIs tracked and logged", /Done\./.test(lk.text) && kpis.length === 2 && kpis.find((k) => k.name === "Rustlings solved").current === 6, kpis);

  // 7. Routines and events
  const ro = await call("create_routine", { title: "Commute", start_time: "08:00", end_time: "08:40", days: "weekdays" });
  const ev = await call("create_event", { title: "Rust meetup", date: "2026-12-03", start_time: "18:30", end_time: "20:30" });
  s = await state();
  ok("routine and event added", /Done\./.test(ro.text) && /Done\./.test(ev.text) && s.routines.some((r) => r.title === "Commute") && s.events.some((e) => e.title === "Rust meetup"));

  // 8. Limits: always confirmed, then enforced
  const lim = await call("update_settings", { max_active_goals: 4, max_daily_hours: 5 });
  ok("changing a limit asks even with auto-apply on", /Not done yet/.test(lim.text), lim.text);
  const over = await call("create_goal", { title: "Fifth", daily_minutes: 30, study_days: "weekdays", deadline: "2027-02-01" });
  ok("over the goal limit: clear refusal", over.isError && /limit is 4/.test(over.text), over.text);
  // Turn auto-apply off again: a change that breaks a limit must be refused at once, not offered for confirmation
  await confirmCall("update_settings", { auto_apply_safe_changes: false });
  const tooMuch = await call("update_goal", { goal_id: g.id, daily_minutes: 300 });
  ok("over the hours limit: refused before any confirmation", tooMuch.isError && /Refused: .*over the 6 h limit/.test(tooMuch.text), tooMuch.text);
  await confirmCall("update_settings", { auto_apply_safe_changes: true });
  const badIn = await call("add_task", { goal_id: g.id, phase: 1, title: "x", minutes: 9999 });
  ok("bad input: clear error", badIn.isError && /between 5 and 600/.test(badIn.text), badIn.text);

  // 9. Destructive change: confirmed, then undone; history shows who did what
  const del = await confirmCall("delete_goal", { goal_id: "Conversational Spanish" });
  ok("delete needs confirmation even with auto-apply on", /Not done yet/.test(del.first.text) && /Done\./.test(del.second?.text ?? ""), del);
  s = await state();
  ok("goal deleted", !s.goals.some((x) => x.title === "Conversational Spanish"));
  const un = await confirmCall("undo_last_change");
  s = await state();
  ok("undo brings it back", /Undone/.test(un.second?.text ?? "") && s.goals.some((x) => x.title === "Conversational Spanish"), un);
  const hist = (await call("get_recent_changes", { limit: 5 })).text;
  ok("change history lists Claude's changes", /by claude/.test(hist), hist);

  // 10. Hygiene and export
  const cd = await confirmCall("clear_demo_data");
  s = await state();
  const seeded = s.goals.flatMap((x) => x.sessions).filter((x) => x.note && ["Finally clicked once I drew it on paper first."].includes(x.note)).length;
  ok("sample notes cleared after confirmation", /Done\./.test(cd.second?.text ?? "") && seeded === 0, cd.first.text);
  const ex = JSON.parse((await call("export_data")).text);
  ok("export has everything, no keys", ex.format === "where-mylife/1" && ex.goals.length === 4 && ex.kpis.length === 2 && !JSON.stringify(ex).includes("sb_secret"));

  // 11. Retry safety
  const rq = { goal_id: g.id, phase: 1, title: "Idempotent task", minutes: 20, request_id: "same-1" };
  await call("add_task", rq);
  const again = await call("add_task", rq);
  s = await state();
  ok("the same request_id is applied once", /Already applied/.test(again.text) && s.goals.find((x) => x.id === g.id).roadmap.modules[0].tasks.filter((t) => t.title === "Idempotent task").length === 1, again.text);

  // 12. Materials, goal history and the memory file, as Claude would use them
  const mat = await call("add_material", { goal_id: g.id, url: "https://www.notion.so/Rust-Ownership-Notes-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", phase: 1 });
  await call("add_material", { goal_id: g.id, url: "D:/Learning/rust/borrowing.pdf", note: "my annotated notes" });
  const mats = JSON.parse((await call("list_materials", { goal_id: g.id })).text);
  ok("Claude links and sees materials (Notion page, local PDF)", /Done\./.test(mat.text) && mats.length === 2 && mats.some((m) => m.kind === "Notion" && m.title === "Rust Ownership Notes") && mats.some((m) => m.url === "D:/Learning/rust/borrowing.pdf"), mats);
  const story = JSON.parse((await call("get_goal_history", { goal_id: g.id })).text);
  ok("goal history shows creation, roadmap, changes and materials", story.timeline.some((e) => /Goal created/.test(e.text)) && story.timeline.some((e) => /Roadmap written/.test(e.text)) && story.timeline.some((e) => /Material added/.test(e.text)) && story.materials_linked === 2 && story.quality.sessions_done, story.timeline);
  const mem = (await call("get_memory_file", { goal_id: g.id })).text;
  ok("memory file has roadmap, daily log, history and materials", /## Goal: Learn Rust/.test(mem) && /### Daily log since the start/.test(mem) && /Rust Ownership Notes/.test(mem) && /Borrow checker finally clicked/.test(mem) && /```json/.test(mem), mem.slice(0, 300));

  const ov = (await call("get_overview")).text;
  ok("overview shows KPIs, limits and settings", /KPIS/.test(ov) && /Rustlings solved/.test(ov) && /APP LIMITS/.test(ov) && /may make ordinary changes without asking/.test(ov), ov.slice(0, 400));
  await client.close();
} finally {
  await fetch(`${SB}/auth/v1/admin/users/${uid}`, { method: "DELETE", headers: admin });
  const left = await (await fetch(`${SB}/rest/v1/user_state?user_id=eq.${uid}&select=user_id`, { headers: admin })).json();
  ok("throwaway account deleted", left.length === 0, left);
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
