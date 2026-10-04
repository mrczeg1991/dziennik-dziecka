-- 03_notes_destruction.sql — Risk #4: destruction, and the column scope a
-- row-level policy cannot reach.
--
-- This file is deliberately MIXED, and each half is labelled:
--   * assertions 1-2 are a GUARANTEE — a note row cannot be removed through the
--     app's client. Red means the guarantee broke.
--   * assertions 3-4 are CHARACTERIZATION — they record what `notes_update_own`
--     does not restrict. Red means the posture changed, which is the signal this
--     file exists to give.
--
-- ============================================================================
-- READ THIS BEFORE WRITING ANOTHER DELETE ASSERTION
-- ============================================================================
--
-- The `authenticated` role **HOLDS** the DELETE privilege. It holds all seven
-- bootstrap privileges on both tables — read off the running database in Phase 1
-- and pinned by `table_privs_are` in `01_notes_isolation.sql`. The image's
-- `alter default privileges ... grant all` is literal and neither migration
-- revokes anything.
--
-- What is missing is the DELETE **policy**. With row security enabled and no
-- permissive DELETE policy, the statement is allowed to run, matches zero rows,
-- and **raises nothing**.
--
-- Therefore `throws_ok` or a `42501` assertion here is WRONG and would FAIL
-- against a correct database. It would be testing for a permission error that
-- the grant makes impossible. Contrast `01_notes_isolation.sql` assertions 2, 3
-- and 5, where the guard is a `with check` violation and 42501 *is* the right
-- assertion — the two shapes are not interchangeable.
--
-- Two archived statements say this, and only one of them is accurate:
--   * `context/archive/2026-09-26-first-child-note/plan.md:166` — "`delete from
--     public.notes` as an authenticated user affects no rows, because no
--     `delete` policy exists". **This is the one to trust.**
--   * `.../plan.md:58` — "no privilege exists that can destroy a row". This
--     inverts the mechanism: the privilege exists; the policy does not. Written
--     as prose it reads fine; taken as a test specification it produces the
--     wrong assertion.
--
-- ============================================================================
-- THE ONE REAL PATH TO PHYSICAL DESTRUCTION
-- ============================================================================
--
-- `notes.user_id ... references auth.users (id) on delete cascade`
-- (`20260927205447_create_notes.sql:7`). Deleting the *account* physically
-- removes its note rows. That path is reachable only through the Auth admin API
-- or a service-role key, neither of which this app uses — verified across all
-- nine client call sites (`research.md:220-245`).
--
-- So the guarantee these assertions support is scoped: a note row cannot be
-- destroyed **through the app's client**. It is not "a note row can never be
-- destroyed", and this file does not claim that. The `child_id` cascade
-- (`:8`) is unreachable for a different reason: `children` has no delete policy
-- and no delete route.

begin;

\ir helpers.inc

select plan(4);

-- Fixtures as `postgres`: one account, one child, one live note and one
-- already-soft-deleted note.
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000d');

insert into public.children (id, user_id, name) values
  ('00000000-0000-0000-0000-0000000000cd', '00000000-0000-0000-0000-00000000000d', 'Child of D');

insert into public.notes (id, user_id, child_id, content, occurred_at, deleted_at) values
  (
    '00000000-0000-0000-0000-00000000d001',
    '00000000-0000-0000-0000-00000000000d',
    '00000000-0000-0000-0000-0000000000cd',
    'a live note',
    '2026-01-15T10:00',
    null
  ),
  (
    '00000000-0000-0000-0000-00000000d0d1',
    '00000000-0000-0000-0000-00000000000d',
    '00000000-0000-0000-0000-0000000000cd',
    'an already soft-deleted note',
    '2026-01-16T10:00',
    now()
  );

select tests.authenticate_as('00000000-0000-0000-0000-00000000000d');

-- 1. GUARANTEE. CATCHES: any permissive `for delete` policy being added to
--    `public.notes`.
--
--    Asserted under the **owner's own** session on purpose — the strongest case.
--    A non-owner would be stopped by account scoping in `notes_select_own`
--    anyway, which would prove nothing about the missing delete policy.
--
--    Note there is no exception handling anywhere in this statement. That is the
--    point: if the delete raised, this statement would error and the test would
--    die rather than pass. Its passing is itself the evidence that nothing is
--    raised.
with deleted as (
  delete from public.notes
   where id = '00000000-0000-0000-0000-00000000d001'
  returning 1
)
select is(
  (select count(*) from deleted),
  0::bigint,
  'the owner''s delete of their own note affects zero rows'
);

-- 2. GUARANTEE, second half. A row count of zero would also be satisfied by a
--    row that never existed, or by one this session cannot see. Both halves are
--    needed; neither alone is evidence.
select is(
  (select count(*) from public.notes where id = '00000000-0000-0000-0000-00000000d001'),
  1::bigint,
  'the note row is still present after the delete'
);

-- ============================================================================
-- COLUMN POSTURE — CHARACTERIZATION FROM HERE DOWN
-- ============================================================================
--
-- A row-level policy restricts which **rows** an update may touch, never which
-- **columns** it may write. `notes_update_own` pins `user_id` and `child_id` in
-- both `using` and `with check` and pins nothing else, so at the policy layer an
-- owner may write any column of their own row — including un-stamping a soft
-- delete and re-dating an event.
--
-- The live guarantee is handler discipline, not the database:
--   * `src/lib/notes.ts:69` writes only `{content, updated_at}` on an edit;
--   * `src/lib/notes.ts:88` writes only `{deleted_at}` on a soft delete;
--   * `src/pages/api/notes/[id].ts:54` explicitly ignores a submitted
--     `occurred_at` — "an edit changes the text, never the moment";
-- backed by `SUPABASE_KEY` never reaching a browser: both values are declared
-- server-only secrets (`astro.config.mjs:19-20`) and read through
-- `astro:env/server` (`src/lib/supabase.ts:3`). That is an unusual posture for a
-- Supabase anon key and would be quietly undone by any future browser-side
-- client.
--
-- **These two assertions are EXPECTED to flip to failures the day finding F5's
-- Fix B lands** — column-scoped grants (`revoke update ... ; grant update
-- (content, updated_at, deleted_at) ...`) or a `before update` trigger
-- (`context/archive/2026-09-26-first-child-note/reviews/impl-review.md:111-115`).
-- That failure is the intended signal that the guarantee moved into Postgres, not
-- a defect. Update this file then; do not weaken the hardening to keep it green.
--
-- F5's decision for this change is recorded in
-- `context/changes/testing-isolation-boundary/change.md`: Fix A, database half
-- deferred, with these assertions as the tripwire.

-- 3. CHARACTERIZATION: the policy layer permits an un-delete. Clearing
--    `deleted_at` back to null on the owner's own soft-deleted row succeeds.
--    Nothing in `notes_update_own` mentions `deleted_at`.
with undeleted as (
  update public.notes
     set deleted_at = null
   where id = '00000000-0000-0000-0000-00000000d0d1'
  returning 1
)
select is(
  (select count(*) from undeleted),
  1::bigint,
  'the policy layer PERMITS the owner to clear deleted_at (an un-delete)'
);

-- 4. CHARACTERIZATION: the policy layer permits a re-date. Changing
--    `occurred_at` — the parent's wall clock for when the thing happened, and the
--    list's sort key — succeeds. The handler is what refuses this, not the policy.
with redated as (
  update public.notes
     set occurred_at = '2030-12-31T23:59'
   where id = '00000000-0000-0000-0000-00000000d001'
  returning 1
)
select is(
  (select count(*) from redated),
  1::bigint,
  'the policy layer PERMITS the owner to change occurred_at (a re-date)'
);

select * from finish();

rollback;
