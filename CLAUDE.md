# Where MyLife — working rules

## Workflow
- Work **one step at a time**: finish a single step, verify once, report briefly, wait for go-ahead.
- **Scope (user, 2026-11-11): two features are the backbone and come before everything else.** (1) Bring your own API key and pick a model (Groq, Gemini and other OpenAI-compatible providers). (2) A real AI agent that reads the person's data and patterns to say where they stand, what each goal needs, whether a roadmap should change, and whether to add a goal. No scripted or hardcoded AI text. The phases in [docs/PRD.md](docs/PRD.md) no longer decide priority.
- Agent design and what is built so far: [docs/AGENT_ARCHITECTURE.md](docs/AGENT_ARCHITECTURE.md). New features should fit it.

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
- `components/` — `Shell` (nav), `ui` (ModuleBar, CompleteButton+note dialog, SourceBadge, KindTag, ConfirmButton, PageHeader), `Timeline`, `DayView` (Today + /day), `Road` (roadmap as winding road), `NewGoalDialog` (agent chat + brief pop-up, opened by the plus button on `/goals`)
- `app/` — `/` redirects to `/goals` (in `next.config.ts`), `/goals` overview (ring cards), `/today`, `/goals/[id]` road + phase panel, `/calendar`, `/day/[date]`, `/routines`, `/settings` (model + key, MCP connections)
- Assistant (not yet reviewed):
  - `components/AgentBot.tsx` — robot button in the corner of every page (mounted in `Shell`) + chat window, memory view, approval card. `ModelForm` (provider/key/model, also in Settings), `McpConnections` (Settings).
  - `lib/providers.ts` (provider table, `rankModels`; no hardcoded model ids), `lib/insight.ts` (all stats + `snapshotText`, computed by code), `lib/agent/tools.ts` (read tools, `recall`, memory, `reschedule_goal`, `add_task`, MCP tools, `plainSchema`, `approvalFor`), `lib/agent/models.ts` (`chatOnce`, `listModels`, `connectModel` = list + real test message per candidate), `lib/agent/run.ts` (`askAgent` loop: retrieval, `<think>` reasoning, model fallback on 404 / zero quota / 429 / 5xx, Gemini `extra_content` signatures kept, `checkFigures`), `lib/agent/recall.ts` (BM25-style search over memories, past chats, notes).
  - `app/api/agent/route.ts` (stateless relay to the model provider; logs provider errors, never the key), `app/api/mcp/route.ts` (stateless MCP client, Streamable HTTP with SSE fallback, URL + optional bearer token; no OAuth yet), `lib/server/net.ts` (public-https check).
  - State gained `memories`, `chat`, `pastChats`, `settings.apiKey`, `settings.fallbacks`, `settings.mcp`. Anything that changes data or an outside service asks the person first.
  - "Connected" is only shown after a model answered a real test message. Never pick a model by name pattern alone.
- Claude.ai connector (not yet reviewed). A Claude Pro/Max subscription may NOT be used by this app (Anthropic terms); instead the app is an MCP server that claude.ai adds as a custom connector:
  - `app/api/connector/[token]/mcp/route.ts` — stateless MCP server (web-standard Streamable HTTP), reuses `LOCAL_TOOLS`/`runTool` + `get_overview`; writes are queued, not applied.
  - `app/api/sync/route.ts` — browser pushes the data copy (POST), pulls queued changes (GET), acks (PATCH), deletes (DELETE). Bearer = connector token.
  - `lib/server/supabase.ts` — PostgREST via fetch with the service role key (server-only); tables in `supabase/migrations/0001_claude_connector.sql`; env in `web/.env.example`. Only the SHA-256 of the token is stored.
  - `lib/connector.ts` (token, `syncPayload` strips apiKey / MCP tokens / connector), `components/ConnectorSync.tsx` (push 3s after changes, pull on focus + every 60s), `components/ClaudeConnector.tsx` (Settings).
- After deleting a page, a stale `.next/types/app/<page>` can break `tsc` and the check build (`NEXT_DIST_DIR=.next-check npx next build`); delete that generated folder.

## Design
Black/white, one crystal hue (#bfe9ff) only on what's current. Skills: `.claude/skills/frontend-design`, `.claude/skills/taste-skill` (user's brief overrides their no-glow rule).

## Stack
Next.js 15 (App Router, TS, Tailwind v4) in `web/` → Vercel (root dir `web`). Later: Supabase (auth, Postgres+RLS, Vault), worker on Railway.
