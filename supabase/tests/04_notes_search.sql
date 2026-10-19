-- 04_notes_search.sql — Risk #1 (cross-account AND cross-child isolation) and
-- soft-delete exclusion, at `search_notes`.
--
-- Phase 1 of `note-search-by-meaning` shipped only the first assertion pair:
-- `search_notes` places no ownership check on `p_child_id` itself (per the
-- plan, it is a correctness filter, not a security boundary), so the only
-- thing that can be stopping a cross-account read is RLS on `public.notes`.
-- This file proves that directly, mirroring `01_notes_isolation.sql`'s
-- fixture-then-role-switch pattern.
--
-- Phase 5 extends this file with the same-account cross-child case (the
-- `p_child_id` filter is a correctness guard, not RLS, and nothing had
-- asserted it does its job) and soft-delete exclusion (`deleted_at is null`
-- in every one of `search_notes`'s own branches). Date-boundary completeness
-- and degraded-mode (null-embedding) fallback are NOT here — both need a real
-- JavaScript runner to control embeddings and dates precisely, and both live
-- in `tests/integration/notes-search.test.ts` instead (§6.3/§6.7 of
-- `context/foundation/test-plan.md`). This file's header previously said
-- otherwise; that was a rough note from Phase 1 planning, corrected here to
-- match this plan's actual split.

begin;

\ir helpers.inc

select plan(4);

-- Fixtures as `postgres`, before any switch. Two accounts; A gets a third
-- child (same `user_id` as the existing `...0401` user) to exercise same-
-- account cross-child scoping, plus a fourth note on A's *first* child,
-- soft-deleted, to exercise soft-delete exclusion. B's note is left with no
-- embedding (nullable arm) — this file only exercises the full-text arm, so
-- B's missing embedding is simply irrelevant to it, not a gap.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000401'),
  ('00000000-0000-0000-0000-000000000402');

insert into public.children (id, user_id, name) values
  ('00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-000000000401', 'Child of A'),
  ('00000000-0000-0000-0000-0000000004c2', '00000000-0000-0000-0000-000000000402', 'Child of B'),
  ('00000000-0000-0000-0000-0000000004c3', '00000000-0000-0000-0000-000000000401', 'Second child of A');

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
  ),
  (
    '00000000-0000-0000-0000-0000000004e3',
    '00000000-0000-0000-0000-000000000401',
    '00000000-0000-0000-0000-0000000004c3',
    'szczepienie przeciwko odrze',
    now()
  );

insert into public.notes (id, user_id, child_id, content, occurred_at, deleted_at) values
  (
    '00000000-0000-0000-0000-0000000004e4',
    '00000000-0000-0000-0000-000000000401',
    '00000000-0000-0000-0000-0000000004c1',
    'usunieta notatka o goraczce',
    now(),
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

-- 2. CATCHES: the `p_child_id` filter in `search_notes`'s full-text CTE being
--    dropped or widened. Still under A's own session — A names A's *first*
--    child but searches a term that only exists on A's *second* child's note
--    ('odrze'). The function places no ownership check on `p_child_id` (both
--    children belong to the same account, so RLS alone would not catch this),
--    so the only thing that can be keeping the other child's note out is the
--    `n.child_id = p_child_id` predicate itself.
select is(
  (
    select count(*)
    from public.search_notes(
      p_child_id => '00000000-0000-0000-0000-0000000004c1',
      p_query_text => 'odrze',
      p_query_embedding => null
    )
  ),
  0::bigint,
  'A searching the first child does not find the second child''s note'
);

-- 3. CATCHES: `deleted_at is null` being dropped from `search_notes`'s
--    full-text CTE. Same child, same account, a query term drawn from the
--    soft-deleted note's own content ('goraczce') — if this returns anything,
--    the function is surfacing a note the owner already deleted.
select is(
  (
    select count(*)
    from public.search_notes(
      p_child_id => '00000000-0000-0000-0000-0000000004c1',
      p_query_text => 'goraczce',
      p_query_embedding => null
    )
  ),
  0::bigint,
  'A''s own soft-deleted note is excluded from search_notes'
);

select tests.clear_authentication();
select tests.authenticate_as('00000000-0000-0000-0000-000000000402');

-- 4. CATCHES: RLS on `public.notes` being widened or removed. B calls
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
