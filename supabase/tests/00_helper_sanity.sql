-- 00_helper_sanity.sql — the suite's negative control.
--
-- This file asserts nothing about the application's policies. Its only job is
-- to prove that `tests.authenticate_as` actually takes effect, because if the
-- role switch silently does not happen, every assertion in 01_, 02_ and 03_
-- passes against no policy whatsoever — a gate reporting green having checked
-- nothing, which is Risk #7 in `context/foundation/test-plan.md`.
--
-- `00_` is reserved for this file. Nothing else belongs here.
--
-- Note on counts: every count below is scoped to a fixture id. A bare
-- `count(*) from public.notes` would be read against whatever earlier
-- `scripts/smoke.mjs` runs left in the local database (13 rows at the time of
-- writing; the smoke walk performs no cleanup), so it would pass or fail by
-- accident. CI sees an empty database; a developer's machine does not.

begin;

\ir helpers.inc

select plan(4);

-- Fixtures, as superuser and before any switch: two users, one child each, one
-- note each. `auth.users` needs only `id` — the other two NOT NULL columns
-- carry defaults. `children.name` (not `first_name`) and `notes.occurred_at`
-- (NOT NULL, no default) were both read off the running database in Phase 1.
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

-- 1. Baseline: without a switch, no policy is exercised at all and `auth.uid()`
--    has nothing to read.
--
--    The attribute asserted here is `BYPASSRLS`, not superuser status. On this
--    image `supabase test db` connects as `postgres`, which is NOT a superuser
--    (`rolsuper = false`, `is_superuser = off`) but DOES hold `rolbypassrls`.
--    Bypassing row security is the property that actually makes an un-switched
--    assertion vacuous, so it is the property worth pinning — if a future image
--    drops BYPASSRLS from `postgres`, the fixture inserts and the between-session
--    setup in later files change character, and this is where that shows up.
select is(
  (select rolbypassrls::text from pg_roles where rolname = current_user)
    || '|' || coalesce((select auth.uid())::text, 'null'),
  'true|null',
  'before any switch: the connection bypasses RLS and auth.uid() is null'
);

select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');

-- 2. The switch took — both halves in one assertion, so a failure names which
--    half broke. The role alone is not enough: with no claim, `auth.uid()` is
--    null and the denial assertions below would pass for the wrong reason.
select is(
  current_user || '|' || coalesce((select auth.uid())::text, 'null'),
  'authenticated|00000000-0000-0000-0000-00000000000a',
  'after authenticate_as(A): the role is authenticated AND auth.uid() is A'
);

-- 3. Positive read, and it must come before the negative one. This is the
--    assertion that proves the switch did not simply break every read — a
--    session that can see nothing at all would satisfy assertion 4 while
--    testing nothing.
select is(
  (select count(*) from public.notes where id = '00000000-0000-0000-0000-00000000a001'),
  1::bigint,
  'under A: A''s own note is visible, so the switch did not break all reads'
);

-- 4. Negative read. Only now is this meaningful.
select is(
  (select count(*) from public.notes where id = '00000000-0000-0000-0000-00000000b001'),
  0::bigint,
  'under A: B''s note is not visible'
);

select * from finish();

rollback;
