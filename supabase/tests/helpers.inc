-- Session-switching helpers for the pgTAP suite. INCLUDED, never run as a test.
--
-- Two separate reasons this file carries the `.inc` extension:
--
--   * Discovery. `pg_prove --ext .pg --ext .sql -r` collects by extension,
--     recursively. It honours no underscore convention and `-r` defeats any
--     attempt to hide the file in a subdirectory, so an extension pg_prove
--     does not match is the only reliable exclusion.
--
--   * Persistence. Each test file runs in its own transaction and is rolled
--     back, so a `tests` schema created by a separately-run file would not
--     exist when the next file starts. The helper must therefore be inlined
--     into each consuming file's own transaction, via `\ir helpers.inc` —
--     include-relative, resolved against the including file's directory
--     rather than the process CWD.
--
-- Usage, including the one ordering that is load-bearing:
--
--     begin;
--     \ir helpers.inc
--     select plan(<n>);
--
--     -- Fixtures FIRST, while still superuser. Two reasons: `auth.users` is
--     -- not writable by `authenticated`, and the whole point is to read
--     -- someone else's row — which the policies would stop you from creating
--     -- under the target role in the first place.
--     insert into auth.users (id) values ('...');
--
--     select tests.authenticate_as('...');
--     ... assertions ...
--     select * from finish();
--     rollback;

create schema if not exists tests;

-- `authenticated` must still be able to reach these functions after the switch,
-- and a schema created by a superuser grants PUBLIC no usage by default.
grant usage on schema tests to public;

-- Switch the session to one authenticated user.
--
-- Sets the claim AND the role, because the two fail differently and it is the
-- pair that makes a later denial assertion trustworthy:
--
--   * role without claim — `auth.uid()` is null, so `notes_select_own` matches
--     nothing, so every "cannot see B's row" assertion passes for entirely the
--     wrong reason. That is Risk #7 in `context/foundation/test-plan.md`: a
--     gate reporting green having checked nothing.
--   * claim without role — the session is still superuser, no policy is
--     exercised at all, and the assertions still pass.
--
-- `request.jwt.claims` (the JSON form) is set alongside `request.jwt.claim.sub`
-- because newer `auth.uid()` implementations read it. On this engine
-- (PostgreSQL 17.6 via Supabase CLI 2.117.0) `claim.sub` alone is sufficient —
-- confirmed live, see `context/changes/testing-isolation-boundary/change.md` —
-- but setting both keeps the helper working if the image's `auth.uid()` changes
-- shape under us.
--
-- Every set_config passes is_local => true, so the surrounding per-file
-- transaction bounds the switch and nothing leaks into the next test file.
create or replace function tests.authenticate_as(user_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Return to the connection's own identity, so a test can set up further
-- fixtures between two users' sessions. That identity is `postgres`, which is
-- not a superuser on this image but does hold BYPASSRLS — which is what makes
-- it usable for fixture setup. See assertion 1 of `00_helper_sanity.sql`.
--
-- `role = none` resets to the session user and is always permitted. `set role
-- postgres` is not: `authenticated` holds no membership in `postgres`, so it
-- would fail at exactly the point a test needs to get back out.
create or replace function tests.clear_authentication() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
