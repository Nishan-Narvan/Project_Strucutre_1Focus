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
- `lib/demo.ts` — `createDemoState()` (3 goals), `demoRoadmapFor(title)`
- `lib/store.tsx` — `StoreProvider` / `useStore()`; localStorage demo state; action API to be swapped for Supabase
- `components/` — `Shell` (nav), `ui` (ModuleBar, SourceBadge, KindTag, Check, ConfirmButton, PageHeader), `Mermaid`, `Timeline`
- `app/` — `/` dashboard, `/goals/new`, `/goals/[id]`, `/calendar`, `/day/[date]`, `/routines`, `/settings`

## Stack
Next.js 15 (App Router, TS, Tailwind v4) in `web/` → Vercel (root dir `web`). Later: Supabase (auth, Postgres+RLS, Vault), worker on Railway.
