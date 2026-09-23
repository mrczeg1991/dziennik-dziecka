-- Children profiles: owned by an auth user, readable/insertable only by that user.
create table public.children (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  birth_date date null,
  created_at timestamptz not null default now()
);

create index children_user_id_created_at_idx on public.children (user_id, created_at);

alter table public.children enable row level security;

create policy "children_select_own"
  on public.children
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "children_insert_own"
  on public.children
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
