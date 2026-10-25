# Pathwise — working rules

## Workflow
- Work **one step at a time**: finish a single step, verify once, report briefly, wait for go-ahead.
- Phases and scope live in [docs/PRD.md](docs/PRD.md).

## Line-level review (save tokens)
- Git tag `reviewed` = every line up to it is reviewed. **Never re-read or re-check those lines.**
- To see only unreviewed lines: `git diff reviewed -- web/src` (includes uncommitted edits).
- After reviewing them: commit, then `git tag -f reviewed` — those lines are now done.
- Need context from reviewed code? Use the code map below, not a re-read. Open a reviewed file only to edit/call into it.
- `// @reviewed` file headers are just a visual hint; the git tag is the source of truth.

## Reviewed code map (web/src)
- `lib/types.ts` — domain types (Goal, Roadmap, Module, Task, Session, Routine, DayEvent, Settings, AppState)
- `lib/date.ts` — YYYY-MM-DD + HH:MM helpers, `uid()`
- `lib/schedule.ts` — `budget`, `buildSessions` (fill days ≤ daily cap, split long tasks), `progress`, `overdue`, `layoutDay` (24h placement around routines/events)
- `lib/rules.ts` — RULES (4 goals, 6 h/day, 7-day edit window, 12 tasks/module), `isEditable`, `lockDate`
- `lib/demo.ts` — `createDemoState()` (3 goals), `demoRoadmapFor(title)`
- `lib/store.tsx` — `StoreProvider` / `useStore()`; localStorage demo state; action API to be swapped for Supabase
- `components/` — `Shell` (nav), `ui` (ModuleBar, CompleteButton+note dialog, SourceBadge, KindTag, ConfirmButton, PageHeader), `Timeline`, `DayView` (Today + /day), `Road` (roadmap as winding road)
- `app/` — `/` Today, `/goals` overview, `/goals/new` brainstorm, `/goals/[id]` road + phase panel, `/calendar`, `/day/[date]`, `/routines`, `/settings`

## Design
Black/white, one crystal hue (#bfe9ff) only on what's current. Skills: `.claude/skills/frontend-design`, `.claude/skills/taste-skill` (user's brief overrides their no-glow rule).

## Stack
Next.js 15 (App Router, TS, Tailwind v4) in `web/` → Vercel (root dir `web`). Later: Supabase (auth, Postgres+RLS, Vault), worker on Railway.
