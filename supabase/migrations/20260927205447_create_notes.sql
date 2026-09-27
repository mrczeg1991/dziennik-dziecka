-- Notes: owned by an auth user, attached to one of that user's children, soft-deletable.
-- `occurred_at` is a wall clock without a time zone: it stores verbatim the `YYYY-MM-DDTHH:mm`
-- the parent typed, so the round trip through a `datetime-local` input is exact.
-- `created_at` / `updated_at` are server instants recording when the row was written.
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  occurred_at timestamp not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

-- Matches the list query: one child's live notes, newest occurrence first,
-- tiebroken by the more recently written row.
create index notes_child_id_occurred_at_idx
  on public.notes (child_id, occurred_at desc, created_at desc)
  where deleted_at is null;

alter table public.notes enable row level security;

-- Three policies and no more. The absence of a `delete` policy is the guardrail
-- that makes notes unremovable through the app's client: soft delete only.
create policy "notes_select_own"
  on public.notes
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- The explicit `c.user_id = (select auth.uid())` predicate is what makes this check
-- sufficient. `children`'s own RLS also applies inside the subquery, but that is a
-- redundant second layer, not the mechanism -- do not remove the predicate as duplication.
create policy "notes_insert_own"
  on public.notes
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.children c
      where c.id = child_id and c.user_id = (select auth.uid())
    )
  );

-- The same expression in both `using` and `with check`, so an edit can neither
-- reassign a note to another account nor move it to another child.
create policy "notes_update_own"
  on public.notes
  for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.children c
      where c.id = child_id and c.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.children c
      where c.id = child_id and c.user_id = (select auth.uid())
    )
  );
