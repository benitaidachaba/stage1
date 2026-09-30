-- Pocket schema (v1): users via Supabase auth, data scoped by user_id.
-- Primary keys are text so the app's local ids ("tsk_…", "not_…") sync 1:1
-- without a mapping table. Every table enables Row Level Security so a
-- session can only ever touch its own rows. The log is append-only: inserts
-- only, no updates or deletes.

-- ------------------------------------------------------------------- areas --
create table if not exists public.areas (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  colour text not null default '#6e1734',
  icon text not null default 'dot',
  deadline timestamptz,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------- tasks --
create table if not exists public.tasks (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  note text not null default '',
  status text not null default 'inbox'
    check (status in ('inbox','today','scheduled','now','done','rescheduled','dropped')),
  resolution text check (resolution in ('done','rescheduled','dropped')),
  source text not null default 'typed' check (source in ('typed','voice','import')),
  due_at timestamptz,
  estimate_minutes integer,
  actual_minutes integer,
  area_id uuid references public.areas (id) on delete set null,
  important boolean not null default false,
  quick_win boolean not null default false,
  energy text check (energy in ('low','medium','high')),
  tags text[] not null default '{}',
  next_step text,
  stopped_here_note text,
  reschedule_count integer not null default 0,
  snooze_count integer not null default 0,
  completed_at timestamptz,
  dropped_at timestamptz,
  drop_reason text,
  last_decision_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------- notes --
create table if not exists public.notes (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------- steps --
create table if not exists public.steps (
  id text primary key,
  task_id text not null references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  done boolean not null default false,
  source text not null default 'user' check (source in ('user','assistant')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------- events (append-only) --
create table if not exists public.events (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id text references public.tasks (id) on delete set null,
  type text not null,
  summary text not null,
  at timestamptz not null default now(),
  meta jsonb
);

-- -------------------------------------------------------------- reminders --
-- One live reminder per task; delivery state for the escalation ladder.
create table if not exists public.reminders (
  task_id text primary key references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled','stopped')),
  step_index integer not null default 0,
  next_fire_at timestamptz,
  last_channel text,
  fire_count integer not null default 0,
  last_fired_at timestamptz,
  stopped_at timestamptz
);

-- ------------------------------------------------------------------ shares --
-- Support-person sharing (PRD 8.9). Default scope is nothing: a row only
-- exists once the user grants it, and revoking flips status.
create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  grantee_email text not null,
  grantee_id uuid references auth.users (id) on delete set null,
  scope text not null default 'read' check (scope in ('read','comment','edit')),
  status text not null default 'pending' check (status in ('pending','active','revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- --------------------------------------------------------------- indexes --
create index if not exists tasks_user_idx on public.tasks (user_id, status, due_at);
create index if not exists notes_user_idx on public.notes (user_id, updated_at desc);
create index if not exists events_user_idx on public.events (user_id, at desc);
create index if not exists steps_task_idx on public.steps (task_id);
create index if not exists areas_user_idx on public.areas (user_id);

-- ------------------------------------------------- row level security --
alter table public.areas enable row level security;
alter table public.tasks enable row level security;
alter table public.notes enable row level security;
alter table public.steps enable row level security;
alter table public.events enable row level security;
alter table public.reminders enable row level security;
alter table public.shares enable row level security;

-- Owner-only access on everything. With RLS on and no policy for anon,
-- unauthenticated requests see nothing at all.
create policy "own rows all" on public.areas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows all" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows all" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows all" on public.steps
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows all" on public.reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The log: insert freely, read your own, never update or delete.
create policy "insert own" on public.events
  for insert with check (auth.uid() = user_id);
create policy "read own" on public.events
  for select using (auth.uid() = user_id);

-- Shares: owner manages, grantee can read active grants addressed to them.
create policy "owner manages" on public.shares
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "grantee reads own grants" on public.shares
  for select using (auth.uid() = grantee_id and status = 'active');

-- ------------------------------------------------------- updated_at touch --
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();
