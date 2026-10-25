# Pathwise — working rules

## Workflow
- **Read [TASKS.md](TASKS.md) first.** ✅ tasks are done and verified — never re-verify them; build on them.
- Work **one step at a time**: finish a single step, verify once, mark it ✅ in TASKS.md, report briefly, wait for go-ahead.
- Phases and scope live in [docs/PRD.md](docs/PRD.md).

## Review markers (save tokens)
- A file whose first line is `// @reviewed YYYY-MM-DD` (or `/* @reviewed YYYY-MM-DD */` in CSS) is reviewed and stable.
- **Do not re-read reviewed files** unless the current task requires changing or calling into them; rely on the summary below.
- When you change a reviewed file, update its date. New files get the marker once they build cleanly.

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
