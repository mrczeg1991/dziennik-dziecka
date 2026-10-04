-- 01_notes_isolation.sql — Risk #1 at the enforcing layer.
--
-- Every assertion below names the specific policy mutation it catches, drawn
-- from the widening table at
-- `context/changes/testing-isolation-boundary/research.md:285-299`. An assertion
-- with no named mutation does not belong in this file.
--
-- Why this file exists at all: in this schema every prohibition is an *absent*
-- policy, so removal is loud (legitimate operations break) but **widening is
-- silent**. Four of the six traced widenings are invisible to `scripts/smoke.mjs`
-- because the handler filters first and the policy is never the thing that fails.
--
-- These are guarantees, not characterizations. If one goes red, isolation broke.
-- Characterizations live in `02_notes_characterization.sql` — never mix them.

begin;

\ir helpers.inc

select plan(12);

-- Fixtures as `postgres`, before any switch. Two accounts, one child each, one
-- note each. `auth.users` needs only `id`; `children.name` (not `first_name`)
-- and `notes.occurred_at` (NOT NULL, no default) were read off the running
-- database in Phase 1.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');

insert into public.children (id, user_id, name) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000000a', 'Child of A'),
  ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000000b', 'Child of B');

insert into public.notes (id, user_id, child_id, content, occurred_at) values
  (
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-00000000000a',
    '00000000-0000-0000-0000-0000000000ca',
    'note belonging to A',
    now()
  ),
  (
    '00000000-0000-0000-0000-00000000b001',
    '00000000-0000-0000-0000-00000000000b',
    '00000000-0000-0000-0000-0000000000cb',
    'note belonging to B',
    now()
  );

select tests.authenticate_as('00000000-0000-0000-0000-00000000000b');

-- 1. CATCHES: `notes_select_own` → `using (true)`.
--    The HTTP walk cannot see this one: `listNotes` applies its own
--    `.eq("child_id", childId)` (`src/lib/notes.ts:28`) and the notes page is
--    already gated by `getChild`, so no step ever reads a notes list under a
--    session that should not see those rows.
select is(
  (select count(*) from public.notes where id = '00000000-0000-0000-0000-00000000a001'),
  0::bigint,
  'B cannot select A''s note'
);

-- 2. CATCHES: the `(select auth.uid()) = user_id` half of `notes_insert_own`.
--    An INSERT whose `with check` fails raises 42501 — unlike UPDATE and DELETE
--    below, where the guard is an absent or non-matching `using` clause and the
--    statement simply affects no rows. The difference is not stylistic: asserting
--    the wrong one of the two fails against a correct database.
select throws_ok(
  $$insert into public.notes (user_id, child_id, content, occurred_at)
    values (
      '00000000-0000-0000-0000-00000000000a',
      '00000000-0000-0000-0000-0000000000cb',
      'forged ownership',
      now()
    )$$,
  '42501',
  null,
  'B cannot insert a note carrying A''s user_id'
);

-- 3. CATCHES: the child-ownership `exists` removed from `notes_insert_own`.
--    **This is the assertion the HTTP walk structurally cannot reach.**
--    `src/pages/api/notes.ts:38` short-circuits on `getChild`, which returns null
--    for a foreign child and redirects at `:42-44`, so `createNote` is never
--    called with a foreign `child_id` and the policy's `with check` is never the
--    thing that fails. Only a direct statement reaches it.
select throws_ok(
  $$insert into public.notes (user_id, child_id, content, occurred_at)
    values (
      '00000000-0000-0000-0000-00000000000b',
      '00000000-0000-0000-0000-0000000000ca',
      'own account, foreign child',
      now()
    )$$,
  '42501',
  null,
  'B cannot insert a note against A''s child_id even with B''s own user_id'
);

-- 4. CATCHES: `notes_update_own`'s `using` widened.
--    Zero rows affected, NOT an error: a non-matching `using` filters the row out
--    of the statement's scope rather than raising. The smoke walk catches this
--    one only incidentally and carries no evidence about the mechanism — it
--    matches `location` with `startsWith` and `/dashboard?error=` is also emitted
--    for "note not found" (`research.md:290`).
with updated as (
  update public.notes
     set content = 'hijacked by B'
   where id = '00000000-0000-0000-0000-00000000a001'
  returning 1
)
select is(
  (select count(*) from updated),
  0::bigint,
  'B''s update of A''s note affects zero rows'
);

-- 5. CATCHES: the child-ownership `exists` removed from `notes_update_own`'s
--    `with check`. Here `using` passes (B's own note, B's own child) and the new
--    row fails the check, so this one DOES raise. No handler ever attempts a
--    reassignment — `src/lib/notes.ts:67-72` writes `{content, updated_at}` only
--    — so the policy is the sole guard and nothing else would ever notice.
select throws_ok(
  $$update public.notes
       set child_id = '00000000-0000-0000-0000-0000000000ca'
     where id = '00000000-0000-0000-0000-00000000b001'$$,
  '42501',
  null,
  'B cannot move their own note to A''s child'
);

-- 6. CATCHES: `children_select_own` → `using (true)`.
select is(
  (select count(*) from public.children where id = '00000000-0000-0000-0000-0000000000ca'),
  0::bigint,
  'B cannot select A''s child row'
);

select tests.clear_authentication();

-- 7. The other half of the helper. `clear_authentication` is what lets a test set
--    up fixtures between two users' sessions, so it needs its own assertion
--    rather than being trusted because the file happens to pass. Note the
--    identity it returns to is `postgres`, which is not a superuser on this image
--    but does hold BYPASSRLS — see assertion 1 of `00_helper_sanity.sql`.
select is(
  current_user || '|' || coalesce((select auth.uid())::text, 'null'),
  'postgres|null',
  'clear_authentication returns to postgres with no claim'
);

select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');

-- 8-10. CATCHES: any permissive `children` update or delete policy being added.
--       `children` has a select and an insert policy and nothing else
--       (`20260923221601_create_children.sql:12-24`), so these two operations are
--       the same absent-policy mechanism as `notes` delete: the statement runs,
--       matches zero rows, and raises nothing. Never `throws_ok` here.
--
--       Both are asserted under the **owner's own** session deliberately. A
--       non-owner would be blocked by account scoping anyway, which would prove
--       nothing about the missing update/delete policies. No step and no route in
--       the app issues either statement (`src/pages/api/children.ts` exports only
--       `POST`), so nothing but this file would ever notice.
with updated as (
  update public.children
     set name = 'renamed by its own owner'
   where id = '00000000-0000-0000-0000-0000000000ca'
  returning 1
)
select is(
  (select count(*) from updated),
  0::bigint,
  'an update on the owner''s own children row affects zero rows'
);

with deleted as (
  delete from public.children
   where id = '00000000-0000-0000-0000-0000000000ca'
  returning 1
)
select is(
  (select count(*) from deleted),
  0::bigint,
  'a delete of the owner''s own children row affects zero rows'
);

-- The second half matters: a row count of zero would also be satisfied by a row
-- that never existed, or by one the session simply cannot see.
select is(
  (select count(*) from public.children where id = '00000000-0000-0000-0000-0000000000ca'),
  1::bigint,
  'the owner''s own children row is still present after the delete'
);

select tests.clear_authentication();

-- 11-12. The grant surface, pinned.
--
-- Read off the running database in Phase 1: the image bootstrap's
-- `alter default privileges ... grant all` is literal and neither migration
-- revokes anything, so `authenticated` holds **all seven** privileges on both
-- tables — not the four a reader might expect. `anon` holds the same seven,
-- which is worth stating plainly: it is the policies, not the grants, that keep
-- an anonymous caller out.
--
-- These two assertions are **expected to fail** the day finding `F5`'s Fix B
-- column grants are adopted. That failure is the signal to update the test, not
-- a defect.
select table_privs_are(
  'public',
  'notes',
  'authenticated',
  array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
  'authenticated holds exactly the seven bootstrap privileges on public.notes'
);

select table_privs_are(
  'public',
  'children',
  'authenticated',
  array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
  'authenticated holds exactly the seven bootstrap privileges on public.children'
);

select * from finish();

rollback;
