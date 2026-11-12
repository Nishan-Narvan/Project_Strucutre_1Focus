-- Where MyLife: accounts. Each signed-in user's data lives on the server, which becomes the source of truth.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run. Safe to run again.
--
-- Only the app's server talks to these tables, using the secret (service role) key. Row-level security is on
-- with no policies, so the public key can read and write nothing. The server checks who is signed in and only
-- ever touches that user's rows.

-- One record per user: all goals, roadmaps, sessions, routines, events, memories and chat, as one document.
-- `version` goes up by one on every change, so two writers can never silently overwrite each other.
create table if not exists public.user_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  state      jsonb not null,
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);

-- Every change: who made it (web, assistant, claude), what it was, and the data as it was before, for undo.
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  at         timestamptz not null default now(),
  actor      text not null,
  op         text not null,
  args       jsonb,
  before     jsonb,
  version    bigint not null,
  request_id text,
  unique (user_id, request_id)
);
create index if not exists audit_log_user_idx on public.audit_log (user_id, id desc);

-- API keys and connection tokens, encrypted by the app's server before they are stored.
create table if not exists public.user_secrets (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       text not null,
  updated_at timestamptz not null default now()
);

-- The secret part of each user's claude.ai connector URL, stored only as a SHA-256 hash.
create table if not exists public.connector_tokens (
  token_hash text primary key,
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.user_state enable row level security;
alter table public.audit_log enable row level security;
alter table public.user_secrets enable row level security;
alter table public.connector_tokens enable row level security;

-- Save a change in one transaction: only if nobody else changed the data since `p_expected`,
-- recording the before-state in the audit log, and ignoring a request already applied.
-- Returns the new version, -1 if the data changed in the meantime, -2 if this request was already applied.
create or replace function public.wml_commit(
  p_user uuid, p_expected bigint, p_state jsonb, p_actor text, p_op text, p_args jsonb, p_request_id text, p_audit boolean
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  if p_request_id is not null and exists (select 1 from audit_log where user_id = p_user and request_id = p_request_id) then
    return -2;
  end if;

  select state into v_before from user_state where user_id = p_user and version = p_expected for update;
  if not found then
    return -1;
  end if;

  update user_state set state = p_state, version = p_expected + 1, updated_at = now() where user_id = p_user;

  if p_audit then
    insert into audit_log (user_id, actor, op, args, before, version, request_id)
    values (p_user, p_actor, p_op, p_args, v_before, p_expected + 1, p_request_id);
    -- Keep the most recent 100 changes per user
    delete from audit_log where user_id = p_user and id < (
      select id from audit_log where user_id = p_user order by id desc offset 99 limit 1
    );
  end if;

  return p_expected + 1;
end;
$$;

revoke all on function public.wml_commit(uuid, bigint, jsonb, text, text, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.wml_commit(uuid, bigint, jsonb, text, text, jsonb, text, boolean) to service_role;

-- The connector from 0001 kept a synced copy and a queue. Data now lives in user_state, so both go.
drop table if exists public.connector_actions;
drop table if exists public.connector_snapshots;
