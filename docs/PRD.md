# Pathwise — Product Requirements Document

**Status:** Draft v0.1 · **Date:** 2026-10-25 · **Owner:** TBD

## 1. Summary

Pathwise turns a learning goal ("Get interview-ready in DSA in 10 weeks") into a personalised, research-backed roadmap and a daily schedule. The user brings their own AI API key (Claude, or another provider). The AI researches how people actually learn the subject (Reddit, YouTube, official docs, courses), designs modules using **first-principles decomposition** and the **Zone of Proximal Development (ZPD)**, cross-verifies the roadmap, and breaks it into daily tasks ("data points"). The tasks land on a calendar and a 24-hour daily timeline, alongside the user's other goals and everyday routines. Each goal has a progress bar based on how far through its modules the user is.

## 2. Problem

- Self-learners don't know **what order** to learn things in, or **where to start** given what they already know.
- Good advice is scattered across Reddit threads, YouTube videos and docs, and it often contradicts itself.
- Plans fall apart because they ignore **real time**: deadlines, work, sleep and other goals competing for the same hours.
- Generic roadmaps aren't fitted to the learner's level or time limit.

## 3. Target users

| Persona | Need |
|---|---|
| Career switcher | Job-ready skill by a hard date, around a full-time job |
| Student | Exam/interview prep with several subjects at once |
| Hobbyist / lifelong learner | Structured path through a new subject at their own pace |

## 4. Goals and non-goals

**Goals (v1)**
1. Bring-your-own-key AI with provider choice (Anthropic Claude first-class; OpenAI-compatible providers supported).
2. Goal → research → modules → daily tasks, fitted to level and time limit.
3. Roadmap shows its reasoning: first principles, ZPD analysis, dependency diagram, sources, verification report.
4. Calendar plus a 24-hour daily timeline combining all goals and routines.
5. Progress tracking per goal at module level, plus rescheduling when the user falls behind.

**Non-goals (v1)**
- Hosting course content ourselves; we link out to sources.
- Social features, sharing, cohorts.
- Native mobile apps (the web app is responsive).
- Pathwise-paid AI usage; v1 is bring-your-own-key only.

## 5. User stories

1. As a user, I can add an API key for Claude or another provider, test it, and pick a model.
2. As a user, I can create a goal with: subject, desired outcome, current level and what I already know, target level, start date, deadline, hours per day, available weekdays, preferred study time, and learning preferences.
3. As a user, I can watch the AI work through its stages (research → design → cross-verify → schedule) with live progress.
4. As a user, I can see the roadmap: summary, first principles, ZPD breakdown, Mermaid dependency diagram, modules, resources with source type, and the verification report.
5. As a user, each module shows its objective, the principle it builds on, its scaffolding, key concepts, a mastery checkpoint, resources, and daily tasks.
6. As a user, daily tasks are placed automatically on my calendar and in free slots on my 24-hour timeline, around my routines (sleep, work, gym, meals) and one-off events.
7. As a user with several goals, I see all of them on one dashboard, each with a module-segmented progress bar.
8. As a user, I can tick tasks off from the timeline, the calendar day, or the goal page.
9. As a user who missed days, I get a "behind schedule" warning and can reschedule the remaining work from today.
10. As a user, I can manage recurring routines and add one-off events for a specific day.

## 6. Functional requirements

### 6.1 API key and provider settings
- Providers: Anthropic (default model `claude-opus-5-5`), OpenAI, OpenRouter, Google Gemini (OpenAI-compatible endpoint), and a custom OpenAI-compatible base URL.
- "Test connection" makes a minimal call and shows the result.
- Keys are **encrypted at rest** (Supabase Vault) and **only used server-side**. They are never returned to the browser after saving; the UI shows the last 4 characters only.
- Live web research is available when the provider supports it. Anthropic uses the server-side web search tool. If a provider has no search, resources are marked "unverified (model knowledge)".

### 6.2 Roadmap generation pipeline
This runs as a background job, since it can take several minutes. Each stage's output is saved, so a failed run resumes from the failed stage.

| Stage | Input | Output |
|---|---|---|
| 1. Research | Goal brief | Research brief: consensus learning order, disagreements, top resources with URLs (Reddit, YouTube, docs, courses, books), pitfalls |
| 2. Design | Brief + research + time budget | Roadmap JSON (schema §6.3), built from first principles and starting at the learner's ZPD edge |
| 3. Cross-verify | Draft + fresh searches | Critique: missing topics, prerequisite order, level fit, time realism, resource quality and link validity, confidence score |
| 4. Finalise | Draft + critique | Final roadmap JSON with a `verification` section (confidence, consensus notes, changes made, open risks) |
| 5. Schedule | Final roadmap + availability | Daily sessions (deterministic code, no AI) |

- Total task time targets **about 85% of the time budget**, leaving about 15% as buffer.
- Resource URLs are checked against URLs seen in search results and get a badge: **✓ found in research** or **unverified**.
- Structured output (JSON schema) is used where the provider supports it.

### 6.3 Roadmap data model (AI output)
```
Roadmap { title, summary,
  first_principles[]: { principle, explanation },
  zpd: { can_do_alone[], can_do_with_guidance[], out_of_reach_now[], strategy },
  diagram_mermaid,
  modules[]: { title, level, objective, first_principle, zpd_scaffold, estimated_hours,
               key_concepts[], checkpoint,
               resources[]: { title, url, source_type: reddit|youtube|docs|course|article|book|other, why },
               tasks[]: { title, minutes, kind: learn|practice|project|review|quiz, detail } },
  verification: { confidence_score, consensus_notes, changes_made[], open_risks[] } }
```

### 6.4 Scheduling
- **Budget** = available weekdays between start date and deadline × hours per day.
- **Day filling:** tasks keep their prerequisite order and fill each available day up to the daily cap. Tasks longer than the remaining time that day are split into parts ("Part 2/3").
- **Timeline placement:** sessions go into the first free gap at or after the goal's preferred start time, then into earlier gaps. They avoid routines (including overnight routines such as sleep from 23:00 to 07:00) and one-off events. Sessions that can't fit are flagged as conflicts.
- **Multiple goals** share the same day. Placement order follows goal priority (v1: creation order; drag-to-reorder later).
- **Overdue:** undone sessions dated before today count as "behind". Reschedule keeps completed work and re-fills the remaining minutes from today.
- **Overflow:** if the plan runs past the deadline, show a warning with the required hours per day versus the available hours per day.

### 6.5 Progress
- Goal % = completed task minutes ÷ total task minutes.
- The progress bar is **segmented by module** (segment width ∝ module size, fill ∝ module completion). It also shows the current module, days left, and an on-track/behind status.

### 6.6 Screens
| Screen | Contents |
|---|---|
| Dashboard | Goal cards (progress bar, current module, today's load, behind warning), today's agenda, API-key banner if missing |
| New goal | Form, live budget preview ("≈ 42 study days · 63 h"), generation progress panel with stages, cancel/retry |
| Goal detail | Overview, first principles, ZPD columns, diagram, verification card, module accordion with resources and tasks |
| Calendar | Month grid with a coloured chip per goal per day (minutes, done state); click → day view |
| Day view | 24-hour vertical timeline (routines, events, study blocks, now-line), task checklist, add one-off event |
| Routines | Recurring activities: title, start, end, weekdays, colour |
| Settings | Provider, model, key (masked), web research toggle, test connection, data export |

## 7. Non-functional requirements
- **Security:** Supabase Auth; row-level security on every table (`user_id = auth.uid()`); API keys in Vault and decrypted only in server code; no keys in client bundles or logs.
- **Performance:** dashboard first paint < 1.5 s; the timeline renders 24 h smoothly on mobile.
- **Reliability:** the generation job survives a closed tab, resumes per stage, and has a per-stage timeout.
- **Responsive:** works at 380 px width.
- **Cost transparency:** show the token usage for each generation (user pays their provider).

## 8. Architecture

```
Next.js (App Router, TypeScript, Tailwind)  ──►  Vercel
  ├─ UI (dashboard, calendar, timeline, goal pages)
  ├─ Route handlers: settings, goals, sessions, routines
  └─ Enqueue generation job
                     │
Supabase  ◄──────────┤
  ├─ Postgres + RLS (profiles, goals, modules, tasks, sessions, routines, events, jobs)
  ├─ Auth (email magic link + Google)
  └─ Vault (encrypted provider keys)
                     │
Generation worker (Railway, Node)  — long-running AI pipeline; polls `jobs` table,
  calls provider with the user's decrypted key, writes stage results + roadmap,
  updates job progress (Supabase Realtime → UI live progress)
```

The worker is separate because a full pipeline (research + verification with web search) can run longer than serverless function limits.

### Data tables (v1)
`profiles` · `provider_keys` (vault secret id, provider, model, last4) · `goals` (brief fields, colour, priority, status) · `roadmaps` (goal_id, JSON, verification, sources) · `modules` · `tasks` · `sessions` (task_id, date, minutes, part, done) · `routines` · `events` · `generation_jobs` (stage, status, progress text, stage outputs, error, usage)

## 9. Phases

| Phase | Scope |
|---|---|
| **P0: Frontend with demo data** *(current)* | All screens built with realistic demo data (3 goals, routines, events); client-side scheduler and progress; no backend |
| P1: Supabase | Auth, schema + RLS, persistence, routines/events CRUD |
| P2: AI pipeline | Key vault, worker on Railway, 4-stage pipeline, live progress, resume |
| P3: Polish | Rescheduling UX, drag-to-reorder goal priority, notifications/reminders, .ics export |

## 10. Success metrics
- ≥ 70% of created goals reach a generated roadmap without error.
- ≥ 40% of users tick off at least one task in their first 3 days.
- Weekly active goals per active user ≥ 1.5.
- Median verification confidence ≥ 75.

## 11. Risks and open questions
- **Provider CORS/limits:** all calls are server-side, which avoids CORS but means we handle rate limits and retries.
- **Link rot / hallucinated URLs:** mitigated by search-grounded research plus URL badges. Optional: a HEAD-check worker.
- **Plan size:** long goals (e.g. 6 months × 3 h/day) produce many tasks. Cap at about 150 tasks and let the scheduler split long tasks across days.
- **Open:** should Pathwise offer a hosted model for users without a key (paid tier)?
- **Open:** Google Calendar two-way sync in P3?
