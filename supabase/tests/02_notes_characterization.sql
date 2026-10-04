-- 02_notes_characterization.sql — CHARACTERIZATION, NOT GUARANTEES.
--
-- Read this header before reading any assertion below.
--
-- Every assertion in this file describes **what the policy layer does today**.
-- None of them describes a protection. If one goes red, the behaviour changed —
-- that is information, not necessarily a defect, and the right response is to
-- decide whether the change was intended and update this file, not to "fix" the
-- code back.
--
-- This is the opposite of `01_notes_isolation.sql`, where a red assertion means
-- isolation broke. The two are kept in separate files for exactly that reason:
-- a reader must never mistake a characterization for a guarantee.
--
-- The two behaviours recorded here are protections `context/foundation/test-plan.md`
-- once claimed at the policy layer and the five policies do not provide. They are
-- real protections — they just live one layer up, in the query. Recording them as
-- executable assertions means that if someone later adds child-scoping or
-- `deleted_at` filtering to a policy without updating the plan, this file says so.

begin;

\ir helpers.inc

select plan(2);

-- Fixtures as `postgres`: one account, TWO children, one live note each, plus a
-- third note that is soft-deleted.
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000c');

insert into public.children (id, user_id, name) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000c', 'First child'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000c', 'Second child');

insert into public.notes (id, user_id, child_id, content, occurred_at, deleted_at) values
  (
    '00000000-0000-0000-0000-00000000c101',
    '00000000-0000-0000-0000-00000000000c',
    '00000000-0000-0000-0000-0000000000c1',
    'live note on the first child',
    now(),
    null
  ),
  (
    '00000000-0000-0000-0000-00000000c201',
    '00000000-0000-0000-0000-00000000000c',
    '00000000-0000-0000-0000-0000000000c2',
    'live note on the second child',
    now(),
    null
  ),
  (
    '00000000-0000-0000-0000-00000000c1d1',
    '00000000-0000-0000-0000-00000000000c',
    '00000000-0000-0000-0000-0000000000c1',
    'soft-deleted note on the first child',
    now(),
    now()
  );

select tests.authenticate_as('00000000-0000-0000-0000-00000000000c');

-- 1. CHARACTERIZATION: there is no per-child separation at the policy layer.
--    `notes_select_own` is `using ((select auth.uid()) = user_id)` and carries no
--    child predicate (`20260927205447_create_notes.sql:26-30`), so an unfiltered
--    select returns notes across ALL of the account's children.
--
--    The real per-child filter is a **query** property, applied at
--    `src/lib/notes.ts:28` (`.eq("child_id", childId)`), and the code says so
--    deliberately at `:20-21`. Cross-child read isolation therefore cannot be
--    proven at this layer at all; §3 Phase 3 of `context/foundation/test-plan.md`
--    owns testing it, where an integration test can exercise the query.
select is(
  (select count(distinct child_id) from public.notes
    where user_id = '00000000-0000-0000-0000-00000000000c'),
  2::bigint,
  'an unfiltered select returns notes from BOTH of the account''s children'
);

-- 2. CHARACTERIZATION: a soft-deleted note IS returned to its own owner.
--    `deleted_at` appears in no policy predicate. It appears only in the partial
--    index at `20260927205447_create_notes.sql:18-20`, and an index predicate is
--    not a row filter — it decides what the index covers, never what a select
--    returns.
--
--    Exclusion is applied in the query, at `src/lib/notes.ts:29`, `:71` and `:90`.
--    That is also what makes a repeated soft delete idempotent rather than
--    re-stamping the date. §3 Phase 3 owns testing it.
select is(
  (select count(*) from public.notes
    where id = '00000000-0000-0000-0000-00000000c1d1'),
  1::bigint,
  'the owner''s own soft-deleted note is still returned at the policy layer'
);

select * from finish();

rollback;
