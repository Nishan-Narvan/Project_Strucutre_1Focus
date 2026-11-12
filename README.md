# Where MyLife

A learning-goal tracker you can run entirely from a chat with Claude. Each goal has a roadmap of phases
and tasks, planned into daily study sessions around your routines. The app tracks progress, KPIs and
the patterns in how you actually study, and an AI assistant (in the app, or Claude through MCP) reads
all of it to tell you where you stand and to change things for you.

- **Web app:** Next.js 15 in [`web/`](web/), deployed on Vercel (root directory `web`).
- **Data:** Supabase. Each signed-in user's data is one versioned record; every change is recorded for undo.
- **Sign-in:** Google, through Supabase Auth, handled on the server.
- **AI:** bring your own key (Groq, Gemini, OpenRouter, OpenAI, Anthropic or any OpenAI-compatible endpoint)
  for the in-app assistant, and a **remote MCP server** so Claude on your own plan can run the app.

## How changes work

Every change, from a button, the in-app assistant or Claude, goes through one module,
[`web/src/lib/ops.ts`](web/src/lib/ops.ts). The server re-applies each change to its latest copy with the
same rules, so limits (active goals, study hours a day, tasks per phase, the roadmap edit window) hold
everywhere. Changing a schedule or a roadmap re-plans the goal from today and keeps finished work.

All assistant abilities are defined once, in [`web/src/lib/tools/registry.ts`](web/src/lib/tools/registry.ts),
and shared by the in-app assistant and the MCP connector:

- **Read** tools never change anything.
- **Change** tools ask first: in the app with an Allow/Skip card, in Claude by replying "Not done yet" with a
  `confirm_token`. Claude calls again with the token only after you agree. In Settings you can let ordinary
  changes apply without asking.
- **Destructive** tools (delete, archive, replace a roadmap, change a limit) always ask.
- Every change is dry-run first, so one the rules would refuse is reported at once instead of being offered
  for confirmation. Every change lands in the audit log with who made it, and `undo_last_change` reverses it.

## Connect Claude

1. In the deployed app, open **Settings → Use with Claude on your Claude plan → Turn on**, and copy the URL.
2. In claude.ai, open **Settings → Connectors → Add custom connector**, paste the URL, and leave the
   advanced settings empty.
3. In a chat, turn the connector on and ask "Where am I with my goals?"

The URL holds a secret; treat it like a password. "Make a new URL" in Settings revokes the old one.

## Tools

<!-- tools:start -->
56 tools. Inputs marked * are required. Change tools also accept `confirm_token` (second call, after the person agrees) and `request_id` (safe retries).

| Tool | Kind | What it does | Inputs | Example |
|---|---|---|---|---|
| `get_overview` | read | Start here. | none | `{}` |
| `get_goal` | read | All editable fields of one goal (title, why, levels, prior knowledge, preferences, daily minutes, study days, start time, dates, status) plus its progress. | `goal_id`* | `{"goal_id":"Crack DSA for coding interviews"}` |
| `get_goal_roadmap` | read | One goal's roadmap in the same shape set_roadmap accepts: phases (id, title, objective, checkpoint, level, key concepts, resources) and tasks (id, title, minutes, kind, detail), plus for each task whether it is done and when the rest is scheduled. | `goal_id`* | `{"goal_id":"Crack DSA for coding interviews"}` |
| `get_history` | read | Day-by-day record of the past: sessions (with ids) planned and done per goal, skipped sessions with the reason, extra study logged, and the notes written on completion. | `days`, `goal_id` | `{"days":7,"goal_id":"Crack DSA for coding interviews"}` |
| `get_upcoming` | read | The plan ahead, day by day: each session with its id, goal, task, start and end time and whether it is done, plus free and committed time. | `days` | `{"days":7}` |
| `get_capacity` | read | Free versus planned time for a date range: per day, time outside routines and events, study already planned, headroom under the daily limit, and a realistic figure scaled by the person's recent completion rate. | `from`, `to` | `{"from":"2026-11-16","to":"2026-11-22"}` |
| `recall` | read | Search everything from the past: saved memories, earlier conversations with the person, and every note they wrote when finishing a session. | `query`* | `{"query":"recursion struggles"}` |
| `create_goal` | change | Create a new learning goal. | `title`*, `outcome`, `current_level`, `target_level`, `prior_knowledge`, `learning_preferences`, `daily_minutes`*, `study_days`*, `start_time`, `start_date`, `deadline`*, `roadmap` | `{"title":"Learn Rust","daily_minutes":45,"study_days":["mon","wed","fri"],"deadline":"2027-01-31"}` |
| `update_goal` | change | Change any field of a goal: title, why, levels, prior knowledge, learning preferences, or its schedule (daily_minutes, study_days, start_time, start_date, deadline). | `goal_id`*, `title`, `outcome`, `current_level`, `target_level`, `prior_knowledge`, `learning_preferences`, `daily_minutes`, `study_days`, `start_time`, `start_date`, `deadline` | `{"goal_id":"Crack DSA for coding interviews","title":"Learn Rust"}` |
| `rename_goal` | change | Rename a goal. | `goal_id`*, `title`* | `{"goal_id":"Crack DSA for coding interviews","title":"Learn Rust"}` |
| `pause_goal` | change | Pause a goal: its unfinished sessions are taken off the plan and it stops counting toward the limits. | `goal_id`* | `{"goal_id":"Crack DSA for coding interviews"}` |
| `resume_goal` | change | Resume a paused or archived goal: its remaining work is planned again from today. | `goal_id`* | `{"goal_id":"Crack DSA for coding interviews"}` |
| `archive_goal` | **destructive** | Archive a goal you are done with or giving up on: it leaves the main list and the plan, but its history is kept. | `goal_id`* | `{"goal_id":"Crack DSA for coding interviews"}` |
| `delete_goal` | **destructive** | Delete a goal for good, with its roadmap, sessions, notes and KPIs. | `goal_id`* | `{"goal_id":"Crack DSA for coding interviews"}` |
| `set_roadmap` | change | Write or replace a goal's whole roadmap: phases in order, each with title, objective, checkpoint, resources and tasks (title, minutes, kind, detail). | `goal_id`*, `summary`, `first_principles`, `phases`* | `{"goal_id":"Learn Rust","summary":"Ownership first.","phases":[{"title":"Syntax and ownership","checkpoint":"Explain borrowing","tasks":[{"title":"The Book ch. 1-4","minutes":60,"kind":"learn"}]}]}` |
| `create_phase` | change | Add a phase to a goal's roadmap, with its tasks, at a position (default: the end). | `goal_id`*, `position`, `id`, `title`*, `objective`, `checkpoint`, `level`, `key_concepts`, `resources`, `tasks` | `{"goal_id":"Crack DSA for coding interviews","title":"Learn Rust","position":1}` |
| `update_phase` | change | Change a phase's title, objective, checkpoint, level or key concepts. | `goal_id`*, `phase_id`*, `title`, `objective`, `checkpoint`, `level`, `key_concepts` | `{"goal_id":"Crack DSA for coding interviews","phase_id":2,"title":"Learn Rust"}` |
| `delete_phase` | **destructive** | Remove a phase and its tasks from a roadmap. | `goal_id`*, `phase_id`* | `{"goal_id":"Crack DSA for coding interviews","phase_id":2}` |
| `reorder_phases` | change | Put a goal's phases in a new order. | `goal_id`*, `order`* | `{"goal_id":"Crack DSA for coding interviews","order":["p1","p3","p2"]}` |
| `add_task` | change | Add one task to a phase of a goal's roadmap, at a position (default: the end of the phase). | `goal_id`*, `phase`*, `title`*, `minutes`*, `kind`, `detail`, `position` | `{"goal_id":"Crack DSA for coding interviews","phase":2,"title":"Learn Rust","minutes":40,"kind":"practice"}` |
| `update_task` | change | Change a task's title, detail, minutes or kind. | `goal_id`*, `task_id`*, `title`, `detail`, `minutes`, `kind` | `{"goal_id":"Crack DSA for coding interviews","task_id":"dsa4x1a2b3c","title":"Learn Rust"}` |
| `delete_task` | **destructive** | Remove a task from a roadmap, with its sessions. | `goal_id`*, `task_id`* | `{"goal_id":"Crack DSA for coding interviews","task_id":"dsa4x1a2b3c"}` |
| `move_task` | change | Move a task to another phase, or to another position in the same phase. | `goal_id`*, `task_id`*, `to_phase`*, `position` | `{"goal_id":"Crack DSA for coding interviews","task_id":"dsa4x1a2b3c","to_phase":3,"position":1}` |
| `reorder_tasks` | change | Put the tasks of one phase in a new order. | `goal_id`*, `phase_id`*, `order`* | `{"goal_id":"Crack DSA for coding interviews","phase_id":2,"order":["p1","p3","p2"]}` |
| `bulk_update_roadmap` | change | Apply many roadmap changes to one goal in a single step, all or nothing. | `goal_id`*, `changes`* | `{"goal_id":"Learn Rust","changes":[{"action":"update_task","task_id":"t1","minutes":75},{"action":"add_task","phase":2,"title":"Write tests","minutes":40}]}` |
| `complete_session` | change | Mark one planned session done, with an optional note on what was learned or where they got stuck. | `goal_id`*, `session_id`*, `note` | `{"goal_id":"Crack DSA for coding interviews","session_id":"s9f8e7d6","note":"Recursion finally clicked"}` |
| `mark_task_done` | change | Mark a whole task done: every remaining session of it, with one optional note. | `goal_id`*, `task_id`*, `note` | `{"goal_id":"Crack DSA for coding interviews","task_id":"dsa4x1a2b3c","note":"Recursion finally clicked"}` |
| `mark_task_undone` | change | Undo completion of a task: all its sessions become unfinished again and their notes are cleared. | `goal_id`*, `task_id`* | `{"goal_id":"Crack DSA for coding interviews","task_id":"dsa4x1a2b3c"}` |
| `log_study_time` | change | Record study done outside the plan (an unplanned session). | `goal_id`*, `minutes`*, `date`, `note` | `{"goal_id":"Crack DSA for coding interviews","minutes":40,"date":"2026-11-20"}` |
| `add_note` | change | Add a note to a session (what was learned, links, blockers). | `goal_id`*, `session_id`*, `note`* | `{"goal_id":"Crack DSA for coding interviews","session_id":"s9f8e7d6","note":"Recursion finally clicked"}` |
| `edit_note` | change | Change the note on a session, for example to correct it or add a link. | `goal_id`*, `session_id`*, `note`* | `{"goal_id":"Crack DSA for coding interviews","session_id":"s9f8e7d6","note":"Recursion finally clicked"}` |
| `delete_note` | **destructive** | Remove the note from a session. | `goal_id`*, `session_id`* | `{"goal_id":"Crack DSA for coding interviews","session_id":"s9f8e7d6"}` |
| `skip_session` | change | Skip a planned session on purpose, with a reason. | `goal_id`*, `session_id`*, `reason`* | `{"goal_id":"Crack DSA for coding interviews","session_id":"s9f8e7d6","reason":"Travelling"}` |
| `reschedule_goal` | change | Re-plan one goal from today: finished work is kept and everything unfinished, including missed and skipped sessions, is laid out again from today. | `goal_id`* | `{"goal_id":"Crack DSA for coding interviews"}` |
| `reschedule_session` | change | Move one unfinished session to another date, optionally at a set start time. | `goal_id`*, `session_id`*, `date`*, `start_time` | `{"goal_id":"Crack DSA for coding interviews","session_id":"s9f8e7d6","date":"2026-11-20","start_time":"07:00"}` |
| `get_kpis` | read | All KPIs (or one goal's) with current value, target, whether it is on target, 7- and 28-day averages, trend and the last 28 days of values. | `goal_id` | `{"goal_id":"Crack DSA for coding interviews"}` |
| `create_kpi` | change | Track a number against a target. | `name`, `goal_id`, `source`*, `unit`, `target`, `direction`, `frequency` | `{"source":"manual","name":"Mock interview score","unit":"%","target":70,"goal_id":"Crack DSA for coding interviews"}` |
| `update_kpi` | change | Change a KPI's name, unit, target, direction, frequency or goal. | `kpi_id`*, `name`, `unit`, `target`, `direction`, `frequency`, `goal_id` | `{"kpi_id":"Mock interview score","name":"Mock interview score"}` |
| `delete_kpi` | **destructive** | Stop tracking a KPI and delete its logged values. | `kpi_id`* | `{"kpi_id":"Mock interview score"}` |
| `log_kpi_value` | change | Record a value for a manual KPI on a date (default today). | `kpi_id`*, `value`*, `date`, `note` | `{"kpi_id":"Mock interview score","value":62,"date":"2026-11-20"}` |
| `create_routine` | change | Add a recurring block of the person's life (sleep, work, gym, meals) that study is planned around. | `title`*, `start_time`*, `end_time`*, `days`*, `color` | `{"title":"Gym","start_time":"18:00","end_time":"19:00","days":["mon","wed","fri"]}` |
| `update_routine` | change | Change a routine's name, times, days or colour. | `routine_id`*, `title`, `start_time`, `end_time`, `days`, `color` | `{"routine_id":"Gym","title":"Learn Rust"}` |
| `delete_routine` | **destructive** | Remove a recurring routine. | `routine_id`* | `{"routine_id":"Gym"}` |
| `create_event` | change | Add a one-off busy block on a date (a dentist visit, a trip), so no study is placed then. | `title`*, `date`*, `start_time`*, `end_time`* | `{"title":"Dentist","date":"2026-11-20","start_time":"17:45","end_time":"18:30"}` |
| `update_event` | change | Change a one-off event's title, date or times. | `event_id`*, `title`, `date`, `start_time`, `end_time` | `{"event_id":"ev7k2m","title":"Learn Rust"}` |
| `delete_event` | **destructive** | Remove a one-off event. | `event_id`* | `{"event_id":"ev7k2m"}` |
| `get_settings` | read | The app's settings: limits in force, whether assistants may auto-apply safe changes, week start, default task length, dashboard sections, theme and model. | none | `{}` |
| `update_settings` | change | Change settings: limits (max_active_goals, max_daily_hours, max_tasks_per_phase, edit_window_days; 0 days = roadmaps never lock), auto_apply_safe_changes, week_start, default_task_minutes, dashboard (which sections the Goals page shows, in order), theme. | `max_active_goals`, `max_daily_hours`, `max_tasks_per_phase`, `edit_window_days`, `auto_apply_safe_changes`, `week_start`, `default_task_minutes`, `dashboard`, `theme` | `{"auto_apply_safe_changes":true}` |
| `list_memories` | read | Everything saved about the person, with ids, kinds and dates. | none | `{}` |
| `save_memory` | memory | Remember one durable thing about the person for future conversations: a preference, a constraint, a commitment they made, or a pattern or lesson the data supports. | `kind`*, `text`* | `{"kind":"preference","text":"Studies best before work."}` |
| `update_memory` | memory | Correct or refine a saved memory, keeping its id. | `memory_id`*, `text`*, `kind` | `{"memory_id":"m3x9","text":"Studies best before work.","kind":"practice"}` |
| `delete_memory` | **destructive** | Delete a saved memory that turned out wrong or out of date. | `memory_id`* | `{"memory_id":"m3x9"}` |
| `export_data` | read | Everything in the account as JSON: goals with roadmaps and sessions, routines, events, KPIs, memories and settings (no keys or tokens). | none | `{}` |
| `clear_demo_data` | **destructive** | Remove the sample data the app starts with: the seeded session notes (the same few sentences repeated across goals) and, if remove_demo_goals is true, the three sample goals. | `remove_demo_goals` | `{"remove_demo_goals":false}` |
| `undo_last_change` | **destructive** | Reverse the most recent change to the person's data, whoever made it. | none | `{}` |
| `get_recent_changes` | read | The most recent changes: when, who (web, assistant, claude) and what. | `limit` | `{"limit":10}` |
<!-- tools:end -->

## Setup

1. Create a Supabase project. In the SQL editor run [`supabase/migrations/0001_claude_connector.sql`](supabase/migrations/0001_claude_connector.sql)
   and then [`0002_accounts.sql`](supabase/migrations/0002_accounts.sql).
2. Enable Google under Authentication → Sign In / Providers, with an OAuth client from Google Cloud whose
   redirect URI is `https://<project>.supabase.co/auth/v1/callback`. Add your app's `/auth/callback` URLs
   under Authentication → URL Configuration.
3. Copy [`web/.env.example`](web/.env.example) to `web/.env.local` and fill in `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` and `WML_ENCRYPTION_KEY`. Add the same three in Vercel.
4. `cd web && npm install && npm run dev`

## Tests

- `npm test`: every tool, with a normal case, a broken limit and bad input, on the sample data.
- `node tests/connector.e2e.mjs`: drives the whole app through the MCP connector against a running dev
  server and real Supabase, with a throwaway account that is deleted afterwards. Needs the dev server
  started with `WML_TEST_LOGIN=1`.
- `npm run docs:tools`: regenerates the tool table above from the registry.

More on the design: [`docs/AGENT_ARCHITECTURE.md`](docs/AGENT_ARCHITECTURE.md).
