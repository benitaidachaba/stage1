-- Pocket records are reached only through authenticated app server routes.
-- Composite keys prevent one account's local IDs colliding with another's.
create schema if not exists pocket;
create table if not exists pocket.records (
  owner_id text not null,
  kind text not null check (kind in ('task', 'note', 'area', 'event', 'settings')),
  id text not null,
  document jsonb,
  version integer not null default 1 check (version > 0),
  edited_at timestamptz not null default now(),
  primary key (owner_id, kind, id),
  check (document is null or jsonb_typeof(document) = 'object')
);
-- No browser/Data API role receives access. The app's server credential is
-- the only entry point; every statement scopes its rows to the verified user.
revoke all on schema pocket from public;
revoke all on pocket.records from public;
alter table pocket.records enable row level security;
