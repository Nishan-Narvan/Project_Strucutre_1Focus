-- Where MyLife: server-side copy of the app's data, so claude.ai can reach it as a custom connector.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Access model: the browser holds a secret connector token. The server stores only its SHA-256 hash
-- and finds the row by it. Only the server talks to these tables, with the service role key, so
-- row-level security is switched on with no policies: the public anon key can read and write nothing.

create table if not exists public.connector_snapshots (
  token_hash text primary key,
  state      jsonb not null,
  timezone   text not null default 'UTC',
  updated_at timestamptz not null default now()
);

-- Changes asked for from claude.ai, waiting for the app to apply them through its own rules.
create table if not exists public.connector_actions (
  id         bigint generated always as identity primary key,
  token_hash text not null references public.connector_snapshots (token_hash) on delete cascade,
  action     jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists connector_actions_token_idx on public.connector_actions (token_hash, id);

alter table public.connector_snapshots enable row level security;
alter table public.connector_actions enable row level security;
