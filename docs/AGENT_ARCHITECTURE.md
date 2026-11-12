# Where MyLife — Agent and memory architecture

**Status:** Draft v0.1 · **Date:** 2026-11-11 · Extends [PRD.md](PRD.md) §6.2 and §8

## 0. What is built today

The first working version runs without a database, on the data in the browser:

| Piece | Where | Notes |
|---|---|---|
| Key and model | Settings, `lib/providers.ts` | Groq, Gemini, OpenRouter, OpenAI, Anthropic or a custom endpoint, all through the OpenAI-compatible chat format. The key is kept in the browser |
| Relay | `app/api/agent/route.ts` | Stateless. Passes each request to the provider; stores and logs nothing |
| Stats and snapshot | `lib/insight.ts` | §4 and §5 computed from the local state: completion, pace, weekday and time-of-day patterns, capacity |
| Assistant | `components/AgentBot.tsx` | A robot button in the corner of every page that opens the chat window. The key form is inside it when no model is set |
| Tools | `lib/agent/tools.ts` | Read: `get_goal_roadmap`, `get_history`, `get_upcoming` (with start and end times). Memory: `save_memory`, `delete_memory`. Plan: `reschedule_goal`, `add_task` |
| Connections | `app/api/mcp/route.ts`, Settings | Outside services over MCP (Streamable HTTP, URL plus optional bearer token). Their tools are offered to the model alongside the built-in ones |
| Approval | `approvalFor` in `tools.ts`, `run.ts` | Plan changes and any MCP tool not marked read-only are shown to the person and run only on Allow. This is the first form of §6.2 |
| Agent loop | `lib/agent/run.ts` | Runs in the browser, because the data lives there. Up to 10 steps per question. Reasons in `<think>` first (shown as "How it got there"), then answers |
| Model choice | `lib/agent/models.ts` | Connecting lists the provider's models, ranks them, and sends each candidate a tiny real message until one answers. Working alternates are saved as fallbacks and used when the chosen model is gone, out of quota or down |
| Honesty check | `checkFigures` in `run.ts` | Every figure in an answer is compared with the data the model was given; figures not found there are named under the answer |
| Memory | `state.memories`, memory view in the assistant | Layer 4. The person can read, add and delete memories |
| Retrieval | `lib/agent/recall.ts` | Keyword relevance (BM25-style) over memories, earlier conversations (`state.pastChats`) and completion notes. The best matches are added to each question automatically; the `recall` tool searches further |

**Claude plan access.** Anthropic does not allow a Claude Pro or Max subscription to be used by other apps,
so the in-app assistant always runs on an API key. The plan is reached the other way round: Where MyLife is an
MCP server (`/api/connector/<token>/mcp`) that the person adds to claude.ai as a custom connector. The browser
syncs a copy of the data, without keys or tokens, to Supabase (`connector_snapshots`). Changes Claude makes are
queued in `connector_actions` and applied by the browser through the store's own actions, so the rules in
`lib/rules.ts` still hold. This is the first server-side storage and the first piece of the Supabase phase.

**Full control (2026-11-12).** The person can run the whole app from a chat. Every ability is one tool in
`web/src/lib/tools/registry.ts`, shared by the in-app assistant and the claude.ai connector: goals (create,
edit, pause, resume, archive, delete), roadmaps (write or replace with `set_roadmap`, phases, tasks, bulk
edits), progress (sessions, notes, skips, moves, extra study), KPIs, routines, events, capacity, settings
(including the limits), memories, export and clean-up. Changes are dry-run, then confirmed (Allow card in the
app, `confirm_token` in Claude) unless they are ordinary and the person enabled auto-apply; destructive ones
always ask. All of them land in the audit log, and `undo_last_change` reverses the latest. The README's tool
table is generated from the registry.

Not built yet: the activity log, reviews, background jobs, OAuth sign-in for MCP servers that
require it, changing hours or deadlines through the agent, and a model-written roadmap for new
goals. When the data moves to Supabase, the loop moves to the server and the tools read the
database instead of local state.

## 1. What this adds

The PRD describes an AI that builds one roadmap for one goal and then stops. This document turns
that into a standing agent that knows the whole picture:

- every goal, past and present, and how each one actually went
- how much of the plan gets done, on which days and at what time of day
- how much time and energy is left before a new goal is taken on
- what it learned about the person, kept between conversations

It uses that picture to decide: how big a new goal can be, when to say "not yet", when to lighten
a plan, and what to change after a bad week.

The design rests on three rules:

1. **Code counts, the model judges.** Every number (completion rate, free hours, pace) is computed
   by SQL or TypeScript. The model reads those numbers and reasons about them. It never does
   schedule arithmetic itself.
2. **Nothing is forgotten, little is remembered.** Every action is logged forever in a raw log.
   Only a small, curated set of conclusions is kept as memory and shown to the model.
3. **The agent proposes, the person decides.** Anything that changes a plan is a proposal the user
   accepts or rejects. The hard limits in `lib/rules.ts` are enforced by code and the agent cannot
   pass them.

## 2. System overview

```
Browser (Next.js UI)
  ├─ Goals page, plus button opens the agent window (chat + brief)
  ├─ Today, Calendar, Routines
  ├─ Proposals inbox ("the agent suggests…")
  └─ "What the agent knows" page (read, edit, delete memories)
                     │
Next.js route handlers (Vercel)
  ├─ /api/agent/chat        short streaming turns: new goal intake, "ask about my plan"
  ├─ /api/proposals         accept / reject
  └─ every user action also writes one row to the activity log
                     │
Supabase
  ├─ Postgres + RLS
  │    app data    goals, roadmaps, modules, tasks, sessions, routines, events
  │    activity    append-only log of everything that happened
  │    stats       views and a daily rollup table, computed by SQL
  │    memories    short notes the agent keeps about the person
  │    reviews     weekly reviews and end-of-goal retrospectives
  │    proposals   suggested changes waiting for a yes or no
  │    jobs, agent_runs   work queue and a trace of every model call
  ├─ Auth, Vault (provider keys), Realtime (live progress)
  └─ pg_cron: enqueue daily and weekly jobs
                     │
Worker (Railway, Node)
  ├─ roadmap pipeline (PRD §6.2), now fed with the snapshot
  ├─ daily check, weekly review, goal retrospective
  └─ memory consolidation
                     │
Model provider, called with the user's own key (Anthropic first, OpenAI-compatible others)
```

One shared package, `agent/`, is imported by both the route handlers and the worker. It holds the
snapshot builder, the tool definitions, the provider adapter and the agent loop, so a chat turn and
a background job behave the same way.

## 3. Memory: five layers

| Layer | What it holds | Written by | Lifetime |
|---|---|---|---|
| 1. Activity log | Every event, raw | Code | Forever, never edited |
| 2. Stats | Numbers derived from the log | SQL | Recomputed |
| 3. Reviews | A summary per week and per finished goal | Agent | Forever |
| 4. Memories | Short conclusions about the person | Agent and user | Until replaced or archived |
| 5. Conversation | The current chat | Chat | Summarised when it ends |

### 3.1 Activity log

`activity (id, user_id, at, type, goal_id, session_id, data jsonb)`

Types: `session_done`, `session_reopened`, `session_missed`, `goal_created`, `goal_edited`,
`goal_paused`, `goal_resumed`, `goal_finished`, `goal_dropped`, `plan_rescheduled`,
`routine_changed`, `event_added`, `proposal_accepted`, `proposal_rejected`, `chat_ended`.

This is the source of truth for history. It must exist from the first day real data is stored,
because history cannot be rebuilt later.

Two changes to existing data make history possible:

- **Goals are never deleted.** `goals.status` becomes `active | paused | finished | dropped` with
  an `ended_at`. "Delete" in the UI becomes "drop". A dropped goal is the most useful lesson the
  agent can have.
- **Completion captures effort.** The note dialog that already opens on completion gets one extra
  tap: easy, ok or hard. Stored as `sessions.effort`. This is the only direct energy signal the
  user is asked for.

### 3.2 Stats (code only)

`stats_daily (user_id, goal_id, date, planned_min, done_min, sessions_planned, sessions_done)`,
filled by a nightly job, plus views on top of it:

| View | Answers |
|---|---|
| `v_goal_pace` | Is this goal ahead or behind, in days? Planned versus done to date |
| `v_completion_28d` | Share of planned minutes actually done over the last 28 days, per goal and overall |
| `v_completion_by_slot` | The same rate split by weekday and part of day (morning, afternoon, evening, night) |
| `v_effort_by_kind` | Easy/ok/hard share by task kind (learn, practice, project, review, quiz) |
| `v_capacity` | Free, committed and realistic minutes per weekday (see §5) |

### 3.3 Reviews

`reviews (id, user_id, kind weekly|goal, goal_id, period_start, period_end, summary, numbers jsonb)`

- **Weekly review:** what was planned, what got done, what slipped and why (from the completion
  notes), and what the agent proposed.
- **Goal retrospective:** written once when a goal is finished or dropped. How long it really took
  against the plan, where it stalled, what the load was at the time, what to do differently.

Retrospectives are how previous goals inform the next one. The last 4 weekly reviews and all
retrospectives go into the snapshot.

### 3.4 Memories

`memories (id, user_id, scope user|goal, goal_id, kind, text, evidence jsonb, confidence,
source agent|user, status active|superseded|archived, superseded_by, created_at, updated_at,
last_used_at)`

A memory is one plain sentence with proof attached:

| Kind | Example |
|---|---|
| `preference` | Prefers a video walkthrough first, then practice problems |
| `pattern` | Finishes 90% of morning sessions and 55% of sessions after 20:00 |
| `lesson` | Dropped Spanish in week 3, when DSA went up to 1.5 h a day |
| `fact` | Works 09:00 to 17:30 on weekdays, gym on Monday, Wednesday, Friday |
| `commitment` | Agreed on 2026-11-08 to keep Sundays free |

Rules that keep memory trustworthy:

- **Evidence is required.** A `pattern` or `lesson` must point at stats or activity rows, and needs
  at least 8 sessions behind it. Two bad days are not a pattern.
- **Update, don't pile up.** Before saving, the agent sees the existing memories and must either
  update one, replace one (the old row becomes `superseded`), or show the new one is different.
- **Small on purpose.** At most 150 active memories per user. A weekly consolidation job merges
  duplicates and archives notes that were not used for 12 weeks and have low confidence.
- **The user owns it.** The "What the agent knows" page lists every memory with its evidence. The
  user can edit or delete any of them, and can add their own (`source = user`, always trusted over
  the agent's).
- **Memory is data, not instructions.** Text from attachments, web research or old memories is
  never treated as a command. Only the conversation with the user gives instructions.

Retrieval starts simple: load all active user-scope memories plus those for the goal in question.
At 150 short sentences this fits easily. Add `pgvector` search only if that stops being true.

## 4. The snapshot: how the agent "senses everything"

Every model call, in chat or in a background job, starts with the same compact picture built by one
function, `buildSnapshot(userId, purpose, goalId?)`. It is assembled by code from layers 2 to 4:

```
today, timezone
rules            4 goals, 6 h a day, 7-day edit window, 12 tasks a phase
capacity         per weekday: free / committed / realistic minutes; headroom for a new goal
active goals     title, outcome, deadline, hours per day, % done, tasks done of total,
                 pace in days ahead or behind, 28-day completion rate, current phase, streak
this week        roadmap tasks due and done, missed days
past goals       one retrospective each: planned vs actual, how it ended, the lesson
recent weeks     last 4 weekly reviews, a few lines each
memories         active user memories, plus this goal's
open proposals   what is already waiting for an answer
```

Target size is 3,000 to 6,000 tokens. Parts that rarely change (rules, memories, past goals) go
first so providers that support prompt caching can reuse them.

The snapshot gives the overview. For detail, the agent uses tools.

## 5. Time and energy

All of this is computed by code and handed to the agent as numbers.

```
free(day)        = 24 h − routines − one-off events          (layoutDay already knows this)
committed(day)   = sum of active goals' planned minutes on that day
rule_headroom    = 6 h − committed
completion_rate  = done minutes ÷ planned minutes, last 28 days
headroom(day)    = min(free − committed, rule_headroom)
realistic(day)   = headroom × completion_rate
```

`realistic` is the honest answer to "how much can I add?". Someone who finishes 60% of what they
plan will finish about 60% of what they add.

Energy is read from three signals, cheapest first:

1. **When work actually gets done:** `v_completion_by_slot`. A slot with a low rate is a low-energy
   slot, whatever the user says about it.
2. **The effort tap** on completion: easy, ok, hard, split by task kind.
3. **The completion notes**, read by the weekly review ("too tired after the gym").

Starting policy for a new goal, to be tuned with real data:

| 28-day completion rate | The agent's stance on a new goal |
|---|---|
| 80% or more | Fine to add, sized to `realistic` headroom |
| 60% to 80% | Add smaller: fewer hours a day or a later deadline, placed in the strongest slots |
| Under 60% | Recommend against. Offer to lighten or pause a current goal first |

The user can always overrule the agent, inside the hard limits. Being overruled is logged and
becomes evidence for later.

## 6. One agent, several jobs

One agent with one set of tools, run in different modes. Not a team of agents talking to each
other: that adds cost and failure points without adding knowledge.

| Mode | Trigger | Runs on | What it does |
|---|---|---|---|
| Intake | Plus button on the Goals page | Vercel, streaming | Talks the goal through, reads attachments, checks capacity and past goals, fills the brief, pushes back if the goal does not fit |
| Planner | "Build my roadmap" | Worker | The PRD §6.2 pipeline, now given the snapshot so phases are sized to what the person really completes |
| Daily check | pg_cron, early morning | Worker | Mostly code: mark yesterday's undone sessions missed, update stats. Calls the model only when something needs a decision |
| Weekly review | pg_cron, Sunday evening | Worker | Writes the review, updates memories, raises proposals |
| Retrospective | Goal finished or dropped | Worker | Writes the retrospective and the lessons |
| Ask | Chat from any page | Vercel, streaming | Answers "why am I behind?" or "can I take Friday off?" from the snapshot and tools |
| Consolidation | pg_cron, weekly | Worker | Merges, replaces and archives memories |

### 6.1 Tools

The agent acts only through tools. Each tool runs server-side under the user's row-level security.

| Read | Write |
|---|---|
| `get_goal(goal_id)` roadmap, phases, tasks | `update_brief(fields)` intake only |
| `get_schedule(from, to)` sessions and free slots | `start_roadmap_job(brief)` |
| `get_stats(view, filters)` | `save_memory(kind, text, evidence)` |
| `get_activity(filters)` raw history | `update_memory(id, …)` / `replace_memory(id, …)` |
| `get_reviews(kind, limit)` | `propose_change(type, payload, reason, evidence)` |
| `search_memories(query)` | `write_review(…)` background modes only |

There is no tool that edits a plan directly. Changes go through `propose_change`.

### 6.2 Proposals and autonomy

`proposals (id, user_id, goal_id, type, payload jsonb, reason, evidence jsonb,
status pending|accepted|rejected|expired, created_at, decided_at, expires_at)`

| The agent does alone | Needs the user's yes |
|---|---|
| Read anything in the user's data | Reschedule missed work |
| Write reviews and memories | Change hours per day, study days or start time |
| Mark sessions missed (a fact, not a choice) | Move a deadline |
| Raise proposals | Pause, resume or drop a goal |
| | Add, remove or reorder roadmap tasks |

Accepting a proposal applies its payload through the same validated code path the UI uses, so the
rules in `lib/rules.ts` hold. Each decision is logged, and a run of rejections of one type becomes
a memory ("does not want deadlines moved").

## 7. Two flows

**Starting a new goal**

1. User clicks plus. The route handler builds the snapshot and opens a conversation.
2. The agent asks what and why, reads attachments, and compares the ask with capacity and with the
   retrospectives of similar past goals.
3. It fills the brief with `update_brief`. If the goal does not fit, it says so with the numbers
   and offers options: fewer hours, a later deadline, or pausing another goal.
4. User confirms. `start_roadmap_job` queues the pipeline; progress streams over Realtime.
5. When the chat ends, it is summarised and any durable facts are saved as memories.

**Weekly review**

1. pg_cron queues a `weekly_review` job per active user.
2. The worker builds the snapshot and loads the week's activity and completion notes.
3. The agent writes the review, updates or adds memories, and raises at most 3 proposals.
4. The Goals page shows the review and the proposals. The answers are logged as activity.

## 8. Cost, safety and failure

- **The user pays for tokens**, so every background mode is switchable in Settings, and Settings
  takes two models: one for planning and chat, a cheaper one for reviews and consolidation.
  `agent_runs` records model, tokens and tools used for each run, shown as usage in the UI.
- **Cheap by default.** The daily check is code first and calls the model only on a real change.
  With no provider key, stats, pace and capacity still work, because they never needed the model.
- **Jobs resume.** Background modes use the same `jobs` table and per-stage saving as the roadmap
  pipeline, with a per-run step limit so a looping agent stops.
- **Keys and privacy** as in the PRD: keys in Vault and used only server-side, row-level security
  on every new table, attachments in Supabase Storage. Deleting an account deletes the log,
  memories and reviews.

## 9. Build order

| Phase | Adds |
|---|---|
| P0 (now, demo data) | The agent window on the Goals page (done). Next: compute capacity and completion rate client-side from the demo state and have the scripted agent use them. Keep ended goals instead of deleting them |
| P1 Supabase | `activity` log from day one, `goals.status`, `sessions.effort`, `stats_daily` and the views. No model needed |
| P2 AI pipeline | `agent/` package: snapshot, tools, loop, provider adapter. Intake and Planner modes. `memories`, `conversations`, `agent_runs` |
| P3 | Weekly review, retrospectives, proposals inbox, daily check, "What the agent knows" page, consolidation |

## 10. Open questions

- Is the one-tap effort rating enough for energy, or should there be a short morning check-in?
- Should any proposal type ever apply itself (for example rescheduling a single missed session)?
- With bring-your-own-key, is a weekly review on by default or opt-in?
- Should the agent track things outside learning goals (sleep, gym) through Routines, or stay with
  goals only?
