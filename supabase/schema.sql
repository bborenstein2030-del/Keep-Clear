-- Keepclear database setup. Paste into Supabase: SQL Editor > New query > Run.
-- Safe to run more than once.

-- One row per person, holding their whole Keepclear plan as JSON.
create table if not exists public.user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  version bigint not null default 1,          -- bumps on every save; used to catch two devices saving at once
  updated_at timestamptz not null default now()
);

-- Row Level Security: each signed-in person can only see and change their own row.
alter table public.user_data enable row level security;

drop policy if exists "Read own data" on public.user_data;
create policy "Read own data" on public.user_data
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Create own data" on public.user_data;
create policy "Create own data" on public.user_data
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Update own data" on public.user_data;
create policy "Update own data" on public.user_data
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Delete own data" on public.user_data;
create policy "Delete own data" on public.user_data
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Live updates between devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_data'
  ) then
    alter publication supabase_realtime add table public.user_data;
  end if;
end $$;

-- Lets a signed-in person delete their own account (and, through the cascade, their data).
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = (select auth.uid());
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
