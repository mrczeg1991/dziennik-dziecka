-- 04_notes_search.sql — Risk #1 (cross-account isolation), now at `search_notes`.
--
-- Phase 1 of `note-search-by-meaning` ships only this one assertion pair:
-- `search_notes` places no ownership check on `p_child_id` itself (per the
-- plan, it is a correctness filter, not a security boundary), so the only
-- thing that can be stopping a cross-account read is RLS on `public.notes`.
-- This file proves that directly, mirroring `01_notes_isolation.sql`'s
-- fixture-then-role-switch pattern.
--
-- Phase 5 (a later phase, not this one) extends this same file with
-- date-boundary completeness, soft-delete exclusion, and degraded-mode
-- fallback assertions. Do not add those here.

begin;

\ir helpers.inc

select plan(2);

-- Fixtures as `postgres`, before any switch. Two accounts, one child each,
-- one note each. B's note is left with no embedding (nullable arm) — this
-- file only exercises the full-text arm, so B's missing embedding is simply
-- irrelevant to it, not a gap.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000401'),
  ('00000000-0000-0000-0000-000000000402');

insert into public.children (id, user_id, name) values
  ('00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-000000000401', 'Child of A'),
  ('00000000-0000-0000-0000-0000000004c2', '00000000-0000-0000-0000-000000000402', 'Child of B');

insert into public.notes (id, user_id, child_id, content, occurred_at) values
  (
    '00000000-0000-0000-0000-0000000004e1',
    '00000000-0000-0000-0000-000000000401',
    '00000000-0000-0000-0000-0000000004c1',
    'wizyta kontrolna u lekarza',
    now()
  ),
  (
    '00000000-0000-0000-0000-0000000004e2',
    '00000000-0000-0000-0000-000000000402',
    '00000000-0000-0000-0000-0000000004c2',
    'nic do zgloszenia',
    now()
  );

select tests.authenticate_as('00000000-0000-0000-0000-000000000401');

-- 1. Positive control: under A's own session, a query term drawn straight
--    from A's note content ('kontrolna') is found through `search_notes`.
--    Without this, assertion 2's zero rows would prove nothing — it could
--    equally mean the function is simply broken.
select is(
  (
    select count(*)
    from public.search_notes(
      p_child_id => '00000000-0000-0000-0000-0000000004c1',
      p_query_text => 'kontrolna',
      p_query_embedding => null
    )
  ),
  1::bigint,
  'A finds A''s own note through search_notes (full-text arm)'
);

select tests.clear_authentication();
select tests.authenticate_as('00000000-0000-0000-0000-000000000402');

-- 2. CATCHES: RLS on `public.notes` being widened or removed. B calls
--    `search_notes` naming A's own `p_child_id` with the exact same query
--    term that assertion 1 proved matches — the function itself applies no
--    ownership check on that parameter, so if this returns anything at all,
--    RLS (not the function) has stopped doing its job.
select is(
  (
    select count(*)
    from public.search_notes(
      p_child_id => '00000000-0000-0000-0000-0000000004c1',
      p_query_text => 'kontrolna',
      p_query_embedding => null
    )
  ),
  0::bigint,
  'B gets nothing back from search_notes when naming A''s own child_id'
);

select tests.clear_authentication();

select * from finish();

rollback;
