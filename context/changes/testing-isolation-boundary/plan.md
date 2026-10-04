# Isolation at the Enforcing Layer — Implementation Plan

## Overview

Stand up the project's first database-layer test suite — pgTAP run by the Supabase
CLI — so that a **widened** row-security policy fails a gate instead of shipping
silently. Wire the suite into CI as a required gate, and correct the three places
`context/foundation/test-plan.md` claims protections the schema does not implement.

This is §3 Phase 1 of the test plan. It covers Risk #1 (a parent sees notes that are
not theirs) and Risk #4 (a note is silently changed or vanishes) at the only layer
that enforces them, and it closes open review finding `F5`.

## Current State Analysis

**The policy surface is five policies across two tables, and it is the whole schema.**
`supabase/migrations/` contains exactly two files; there are no triggers and no SQL
functions.

| Table | select | insert | update | delete |
|---|---|---|---|---|
| `children` | `children_select_own` | `children_insert_own` | **none** | **none** |
| `notes` | `notes_select_own` (account only) | `notes_insert_own` (+ child ownership) | `notes_update_own` (+ child ownership, both `using` and `with check`) | **none** |

**There is no test at this layer.** `supabase/tests/` does not exist, there is no
`npm test` script, and the only automated coverage is `scripts/smoke.mjs` — 36 steps,
76 assertions, running over HTTP against handler-mediated routes.

**The HTTP walk cannot see the mutation that matters.** Because every prohibition in
this schema is an *absent* policy, removal is loud (legitimate operations break) but
widening is silent. Four of six traced widenings go undetected:
`notes_select_own → using (true)`, removing the child-ownership `exists` from
`notes_insert_own` or from `notes_update_own`, and adding any permissive `children`
update/delete policy. The handler filters first, so the policy is never the thing
that fails (`src/pages/api/notes.ts:37-44`;
`context/changes/testing-isolation-boundary/research.md:285-299`).

**Three claims in the test plan are wrong about the layer.** Research checked each
against the migrations:

| Claim | Where | Reality |
|---|---|---|
| "one child's notes [kept] from everyone else" | `test-plan.md:81` (§3 Phase 1 goal) | `notes_select_own` carries no child predicate; per-child separation is a *query* property (`src/lib/notes.ts:28`) |
| "no privilege exists to destroy a note row" | `test-plan.md:81` | Inverts the mechanism — the DELETE **grant** exists, the DELETE **policy** does not, so a delete affects zero rows and raises **no error** |
| "a soft-deleted note is not returned even to its own owner" | `test-plan.md:65` (Risk #1) | `deleted_at` appears in no policy predicate, only in a partial index; at the policy layer a soft-deleted row **is** returned to its owner |

**The local stack does not start on this machine.** `supabase start` fails with
`listen tcp 0.0.0.0:54322: bind`. Confirmed in-session: `netsh` reports the TCP
exclusion range **54274–54373**, which swallows *every* default Supabase local port
this project declares — API `54321`, db `54322`, shadow `54320`, pooler `54329`,
studio `54323`, mailpit `54324`, analytics `54327`. CI (`ubuntu-latest`) is unaffected.

**Tooling is in place and unused.** pgTAP 1.3.3 ships in the pinned image
`public.ecr.aws/supabase/postgres:17.6.1.166`; the CLI enables and drops the extension
around each run; each test file runs in its own transaction and is rolled back.
`.github/workflows/ci.yml` has a `smoke` job whose database is migrated and holds zero
rows at exactly one point — line 43.

## Desired End State

`supabase test db` runs a pgTAP suite under `supabase/tests/` both locally and in CI.
A pull request that widens any of the five policies — or adds a `notes` `delete`
policy, or any `children` `update` or `delete` policy — fails CI. `test-plan.md` §6.1 answers "how do I add a
database policy test here?" with a named reference file and a run command, and §2/§3
no longer assert protections the schema does not provide.

Verify by: running `npm run test:db` locally to a green suite; then deliberately
rewriting `notes_select_own` to `using (true)` and confirming the suite goes red.

### Key Discoveries:

- `supabase/migrations/20260927205447_create_notes.sql:26-30` — `notes_select_own` is
  `using ((select auth.uid()) = user_id)` and nothing else. Account-scoped, not
  child-scoped. The code states this deliberately at `src/lib/notes.ts:20-21`.
- `supabase/migrations/20260927205447_create_notes.sql:41-45`, `:53-66` — child
  ownership **is** a policy property, but only for `insert` and `update`. That
  asymmetry is the shape the suite must test around.
- The image bootstrap runs `alter default privileges in schema public grant all on
  tables to postgres, anon, authenticated, service_role`
  (`.../00000000000000-initial-schema.sql:40`) and neither migration revokes anything.
  So `authenticated` **holds** DELETE. A `throws_ok` assertion on delete would test the
  wrong failure and **fail against a correct database**.
- `src/lib/notes.ts:70`, `:89` — edit and soft delete match on `.eq("id", noteId)` with
  **no `user_id` and no `child_id`**. Cross-account isolation for both write paths rests
  entirely on `notes_update_own`, with no handler filter behind it. This is the
  strongest single argument for testing the update policy directly.
- `supabase test db` connects as a superuser, and `service_role` carries `BYPASSRLS`
  (`.../initial-schema.sql:31`). Without an explicit role switch the assertions
  exercise no policy at all — and still pass.
- `.github/workflows/ci.yml:43` is the only point in the `smoke` job where the database
  is migrated-but-untouched. A step after `:48` or `:53` would see rows the smoke walk
  created.
- `supabase/.temp/linked-project.json` links this working copy to the hosted project
  `dziennik-dziecka` (`ojhtrttucvuthgxxmpce`). `supabase/.temp` is gitignored, so CI has
  no link — but locally a stray `--linked` or `--db-url` would reach production, and the
  fixtures insert into `auth.users`.
- `supabase/config.toml:62,65` — `[db.seed] enabled = true` points at `./seed.sql`,
  which does not exist. Configured but inert; fixtures belong in the test files, not here.

## What We're NOT Doing

- **Not hardening the column posture.** No `revoke`/`grant` migration and no
  `before update` trigger. The suite *characterizes* the current posture — including
  that the policy permits an owner to clear `deleted_at` — rather than changing it.
  Finding `F5` is closed as "Fix A, database half deferred", with the characterization
  test as the tripwire for the day someone adds column grants or a browser-side client.
- **Not testing cross-child read isolation.** It cannot be proven at this layer. Phase 6
  hands it to §3 Phase 3 as an owned item. No second child is added to `scripts/smoke.mjs`.
- **Not standing up Vitest.** Unit and integration remain §3 Phase 3. §6.2 and §6.3 stay
  `TBD`.
- **Not touching `scripts/smoke.mjs`.** The test plan says keep it; pgTAP sits below it,
  not in place of it. Fix A's two proposed smoke assertions are superseded by pgTAP
  equivalents, which reach the mechanism the smoke script cannot
  (`impl-review.md:110` anticipated exactly this).
- **Not fixing `F7`** (`softDeleteNote` does not bump `updated_at`). Same rows, different
  concern, still `PENDING`. Flagged in Open Risks only.
- **Not adding a `seed.sql`.** Each pgTAP file creates and rolls back its own fixtures.
- **Not wiring the migration-drift check, the gate-integrity check, or the route-guard
  coverage test.** Those are §3 Phase 2.
- **Not running anything against the linked hosted project.**

## Implementation Approach

Four ideas drive the sequencing.

**First, make the thing runnable, then make it true.** The local stack cannot start on
this machine, so Phase 1 is plumbing. It also ends by reading the realized grants off a
running database — research Open Question 1 rests on three agreeing sources, none of
them this database, and the answer decides whether the delete assertion is shaped as
"zero rows" or "permission error".

**Second, the negative control is written before any positive assertion.** A
hand-rolled role switch that silently fails leaves every later test passing against no
policy whatsoever — the exact shape of Risk #7, a gate reporting green having checked
nothing. So Phase 2's first test asserts that the switch *took*: under
`set local role authenticated` with user A's claim, a row belonging to B is invisible,
and `current_user` / `auth.uid()` are what we think they are. Every later file reuses
that helper.

**Third, assert the mechanism, not the observable.** Where the plain-language guarantee
and the database mechanism diverge, the test follows the mechanism and a comment records
the divergence. Delete is the clearest case: the correct assertion is *zero rows
affected plus the row still present*, never `throws_ok`.

**Fourth, the honest inverse is an assertion, not an omission.** Where the policy layer
does *not* provide a protection the test plan claimed, the suite asserts the actual
behaviour — a session reads both of its children's notes; an owner sees their own
soft-deleted row. These are characterization tests. They document the boundary and they
go red if someone later adds child-scoping or `deleted_at` filtering at the policy layer
without updating the plan.

## Critical Implementation Details

**Role switching must be transactional and must restore.** `set local role` is bounded
by the surrounding transaction, which `supabase test db` already provides per file.
Fixtures (rows in `auth.users`, `public.children`, `public.notes`) must be inserted
**before** the switch, as superuser — `auth.users` is not writable by `authenticated`,
and the point is to test reading *someone else's* row, which the policies would prevent
you from creating under the target role.

**`(select auth.uid())` reads `request.jwt.claim.sub`, not the role.** Setting the role
without the claim yields a null `auth.uid()`, under which `notes_select_own` matches
nothing — so every "cannot see B's row" assertion passes for the wrong reason. The
helper must set both, and the negative control must prove a *positive* read works under
the claim (A sees A's own note) before any denial assertion is trusted.

**Ordering in CI is fixed by one constraint.** The step goes at `ci.yml:43` — after
`Start local Supabase` and before `Configure secrets for build and preview`. Later is
wrong: the smoke walk leaves two auth users, one child and two notes behind per run
(`scripts/smoke.mjs` performs no cleanup), and a `table_privs_are` or row-count
assertion would then be reading a dirtied database.

## Phase 1: Make the local stack startable and read the real grants

### Overview

Move every declared local port out of the Windows reserved range, follow the change into
the three files that reference a port, and confirm the stack genuinely comes up. Then
read the realized `authenticated` grants from the running database to settle research
Open Question 1 before any assertion is written against them.

### Changes Required:

#### 1. Local port block

**File**: `supabase/config.toml`

**Intent**: Shift the declared local ports out of the confirmed TCP exclusion range
54274–54373 so `supabase start` can bind. Every default this project declares falls
inside it, so moving `[db] port` alone is insufficient — Kong would still fail on 54321.

**Contract**: Add 100 to each declared port, landing the block in the free 54374–56815
span. Six lines change: `:10` api `54321→54421`, `:29` db `54322→54422`, `:31`
`shadow_port 54320→54420`, `:41` pooler `54329→54429`, `:91` studio `54323→54423`,
`:102` inbucket `54324→54424`, `:373` analytics `54327→54427`. Leave the commented-out
`smtp_port`/`pop3_port` lines alone. Re-run `netsh interface ipv4 show excludedportrange
protocol=tcp` before committing to confirm the new block is clear — the exclusion list is
assigned dynamically and can move after a reboot.

#### 2. Port references outside the Supabase config

**Files**: `.env.example`, `README.md`

**Intent**: Keep the documented local setup consistent with the new API port, so a fresh
clone's copy-paste still works.

**Contract**: `.env.example:1` `SUPABASE_URL` and `README.md:103` both move to the new
API port; `README.md:113` moves to the new Studio port. CI needs no change — `ci.yml:42`
derives both values from `supabase status -o env`.

#### 3. Local environment files

**Files**: `.env`, `.dev.vars` (both gitignored)

**Intent**: Point the running app at the relocated local API.

**Contract**: Same `SUPABASE_URL` edit as `.env.example`. Not committed; listed so the
implementer does not lose a working local setup to a confusing connection error.
`.dev.vars` is currently empty — CI regenerates it with `cp .env .dev.vars`
(`ci.yml:47`) — so edit it only if it has a line to edit.

#### 4. Grant baseline and fixture shape

**File**: none — two recorded command results

**Intent**: Settle research Open Question 1 against *this* database rather than against
the image bootstrap, Supabase's documentation and S-02's recollection. The answer decides
whether Phase 4's delete assertion is "zero rows affected" or "permission error". While
the stack is up, also capture the `auth.users` column requirements Phase 2's fixtures
depend on — that discovery is the unpriced half of hand-rolling the helper instead of
using `supabase-test-helpers`' `tests.create_supabase_user`, and it is far cheaper here
than mid-phase.

**Contract**: Run both queries through the container the CLI already started —
`docker exec supabase_db_<project> psql -U postgres -d postgres -c "<query>"`
(`docker ps` gives the exact container name). Do not assume a local `psql` on PATH:
this machine installs no Postgres client and the CLI exposes no `sql` subcommand.
Against the running local database, run

```sql
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('notes','children')
  and grantee in ('anon','authenticated')
order by grantee, table_name, privilege_type;
```

Paste the result into `change.md` under `## Notes`. The expectation is that
`authenticated` holds `SELECT, INSERT, UPDATE, DELETE` on both. **If it does not, stop
and revisit Phase 4** — the delete assertion shape depends on this.

Then capture the fixture shape. `notes.user_id references auth.users (id)`, so every
fixture needs a real `auth.users` row, and that table is GoTrue-owned with a column set
that moves between Supabase versions:

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'auth' and table_name = 'users' and is_nullable = 'NO'
order by ordinal_position;
```

Derive the smallest `insert into auth.users (...)` that succeeds, confirm it twice with
different uuids, and record it in `change.md` beside the grants. Phase 2 consumes that
exact statement rather than rediscovering it, and §6.1 publishes it as the fixture
pattern.

### Success Criteria:

#### Automated Verification:

- `netsh interface ipv4 show excludedportrange protocol=tcp` shows no exclusion overlapping the new port block
- `supabase start` completes and `supabase status` reports the API and DB as running on the new ports — exit code alone is not evidence, because the CLI exits 0 while the stack fails to start
- `docker exec … psql` against the DB container returns the grant query and the `auth.users` NOT NULL column list above

#### Manual Verification:

- `npm run dev` loads the app and a sign-in against the local stack succeeds
- The grant query result is pasted into `change.md` and matches the expected `SELECT, INSERT, UPDATE, DELETE` for `authenticated` on both tables
- A minimal `insert into auth.users (...)` is confirmed to succeed twice and is recorded in `change.md`

---

## Phase 2: Suite skeleton and its negative control

### Overview

Create the test directory, the session-switching helper, and the npm script — then write
the one test whose job is to prove the helper works, so that no later assertion can pass
vacuously under a superuser connection.

### Changes Required:

#### 1. Session-switching helper

**File**: `supabase/tests/helpers.inc`

**Intent**: Give every test file one way to run statements as a specific authenticated
user, and one way to return to superuser for fixture setup. Hand-rolled rather than
`supabase-test-helpers` so the repo gains no new install step in either environment.

**Contract**: Two SQL functions in a `tests` schema created by the file itself.
`tests.authenticate_as(user_id uuid)` sets `request.jwt.claim.sub` and
`request.jwt.claims` (the JSON form, which newer `auth.uid()` implementations read) and
then `set local role authenticated`. `tests.clear_authentication()` resets the role and
the claims. Both must use `set local` so the surrounding per-file transaction bounds them.

**This file is included, never run as a test**, and both halves of that matter:

- *Discovery*: `pg_prove --ext .pg --ext .sql -r` collects by extension, recursively.
  It has no underscore convention and `-r` defeats any subdirectory, so the only
  reliable exclusion is an extension it does not match — hence `.inc`.
- *Persistence*: each test file runs in its own transaction and is rolled back, so a
  `tests` schema created by a separately-run file would not exist when the next file
  starts. The helper must therefore be inlined into each consuming file's own
  transaction, via psql's `\ir helpers.inc` (include-relative, resolved against the
  including file's directory rather than the CWD).

**Verify `\ir` first.** Before writing any assertion, confirm a one-line `\ir` include
resolves under `supabase test db`. If the CLI invokes `pg_prove` with a working
directory that breaks it, fall back to inlining the two `set local` statements directly
in each test file and drop this file — the suite's design does not otherwise depend on
the helper existing.

#### 2. Negative control

**File**: `supabase/tests/00_helper_sanity.sql`

**Intent**: Prove the role switch actually takes effect. If it silently does not, every
assertion in Phases 3 and 4 passes against no policy at all — a gate reporting green
having checked nothing, which is Risk #7 in the test plan.

**Contract**: Opens with `\ir helpers.inc`. Fixtures for two users (A, B), one child
each, one note each, inserted as superuser using the `auth.users` insert Phase 1
recorded in `change.md` — do not improvise it here. Then four assertions, in this order:

1. Before any switch, `current_user` is a superuser and `auth.uid()` is null.
2. After `tests.authenticate_as(A)`, `current_user` is `authenticated` **and**
   `auth.uid()` equals A — both halves, because the role without the claim is the
   failure mode that makes denial assertions pass for the wrong reason.
3. **Positive read**: under A, `select count(*) from public.notes` returns A's note.
   This is the assertion that proves the switch did not simply break all reads.
4. **Negative read**: under A, B's note is not visible.

Assertion 3 must precede 4 in the file; a reviewer reading top-to-bottom should see the
mechanism established before it is used.

#### 3. Run command

**File**: `package.json`

**Intent**: Give the suite a name the cookbook and CI can both use, in a repo that
currently has no `test` script at all.

**Contract**: Add `"test:db": "supabase test db"` to `scripts`. Do not claim the bare
`test` name — §3 Phase 3 will want it for the unit and integration runner, and a
`test` script that runs only policy tests would be misleading.

### Success Criteria:

#### Automated Verification:

- `npm run test:db` runs and `00_helper_sanity.sql` passes all four assertions
- Temporarily commenting out the `set local role` line in the helper makes assertion 2 fail — confirming the control is not itself vacuous
- `pg_prove` discovers exactly the intended files: `supabase test db` output lists `00_helper_sanity.sql` and does not list `helpers.inc` at all

#### Manual Verification:

- The fixture rows are gone after the run — `select count(*) from public.notes` against the local database returns the pre-run count, confirming the per-file transaction rolled back

---

## Phase 3: Risk #1 — exposure at the policy layer

### Overview

Assert that account isolation holds on every operation that has a policy, pin the grant
surface so a widening shows up as a diff, and record the two boundaries the policy layer
does *not* provide.

### Changes Required:

#### 1. Cross-account isolation

**File**: `supabase/tests/01_notes_isolation.sql`

**Intent**: Catch the four policy widenings `scripts/smoke.mjs` is blind to. Each
assertion targets one specific widening, so a failure names its own cause.

**Contract**: Fixtures: users A and B, one child each, one note each. Under B's session:

- B cannot select A's note — breaks if `notes_select_own` becomes `using (true)`.
- B cannot insert a note carrying A's `user_id` — breaks if the `user_id` half of
  `notes_insert_own` goes.
- B cannot insert a note against A's `child_id` even with B's own `user_id` — breaks if
  the child-ownership `exists` goes. **This is the one the HTTP walk structurally cannot
  reach**, because `src/pages/api/notes.ts:38` short-circuits on `getChild` before
  `createNote` is called; note that in a comment.
- B's update of A's note affects **zero rows** — breaks if `notes_update_own`'s `using`
  is widened. Assert the row count, not an error.
- B cannot move their own note to A's child — breaks if the `exists` is removed from
  `notes_update_own`'s `with check`. Reassignment is never attempted by any handler
  (`src/lib/notes.ts:67-72` writes `{content, updated_at}` only), so the policy is the
  sole guard.
- B cannot select A's child row — `children_select_own`.

Then two assertions under the **owner's own** session, parallel in shape to Phase 4's
delete test, covering the one widening the research table lists as caught by nothing:

- an update on the owner's own `children` row affects **zero rows** — breaks if any
  permissive `children` update policy is added.
- a delete of the owner's own `children` row affects **zero rows**, and the row is
  still present — breaks if any `children` delete policy is added.

`children` has no update and no delete policy (`...create_children.sql:12-24`), so these
are the same absent-policy mechanism as `notes` delete: zero rows affected, no error
raised. Never `throws_ok`.

#### 2. Grant surface

**File**: `supabase/tests/01_notes_isolation.sql` (same file)

**Intent**: Turn the Phase 1 grant reading into a permanent assertion, so a future
migration that adds or removes a privilege is visible as a test failure rather than
discovered later.

**Contract**: `table_privs_are` for `authenticated` on `public.notes` and
`public.children`, listing exactly the privileges Phase 1 recorded. Add a comment stating
that this test is expected to fail if `F5`'s Fix B column grants are ever adopted — that
failure is the signal to update the test, not a defect.

#### 3. The two honest inverses

**File**: `supabase/tests/02_notes_characterization.sql`

**Intent**: Record, as executable assertions, the two protections the test plan claimed
and the policy layer does not provide. Kept in a separate file from the isolation
assertions so nobody reads a characterization test as a guarantee.

**Contract**: A file-level comment naming it a characterization file — these assertions
describe current behaviour, and a failure means the behaviour changed, not that
something broke. Fixtures: one user with **two** children, one note each, plus one
soft-deleted note.

- Under that user, a `select` with no `child_id` filter returns notes from **both**
  children. Comment must point at `src/lib/notes.ts:28` as where the real per-child
  filter lives, and at §3 Phase 3 as where it gets tested.
- Under that user, the soft-deleted note **is** returned. Comment must state that
  exclusion happens at `src/lib/notes.ts:29`, `:71`, `:90`, and that the partial index
  predicate at `...create_notes.sql:18-20` is an index predicate, not a row filter.

### Success Criteria:

#### Automated Verification:

- `npm run test:db` passes with all three files green
- Rewriting `notes_select_own` to `using (true)` in a scratch copy of the migration makes `01_notes_isolation.sql` fail, and the failing assertion names cross-account select
- Removing the child-ownership `exists` from `notes_insert_own` in a scratch copy makes the foreign-`child_id` insert assertion fail
- Adding a permissive `for update` policy on `children` in a scratch copy makes the zero-rows `children` update assertion fail
- `npm run smoke` still passes end to end against the relocated local stack

#### Manual Verification:

- Each assertion in `01_notes_isolation.sql` is traceable to one row of the widening table in `research.md:285-299`, with no row left uncovered and no assertion without a named mutation it catches
- The characterization file reads unambiguously as "this is what happens today", not as "this is protected"

---

## Phase 4: Risk #4 — destruction and column scope

### Overview

Assert the destruction guarantee in the shape the database actually produces, and record
the column posture the policy layer cannot restrict.

### Changes Required:

#### 1. Delete

**File**: `supabase/tests/03_notes_destruction.sql`

**Intent**: Prove no note row can be removed through the app's client, using the
mechanism that actually applies. The `authenticated` role **holds** the DELETE grant; what
is missing is a DELETE policy, so a delete succeeds against zero rows and raises nothing.

**Contract**: Under the owner's own session — the strongest case, since a non-owner would
be blocked by account scoping anyway — `delete from public.notes where id = <own note>`
affects **zero rows**, and the row is still present afterwards. Both halves: row count
alone would pass if the row never existed.

A `throws_ok` or `42501` assertion here is wrong and would fail against a correct
database. State that in a comment, and cite
`context/archive/2026-09-26-first-child-note/plan.md:166`, which recorded the accurate
observable, over `:58`, which recorded the loose phrasing.

Add a second comment recording the one real physical-destruction path:
`user_id ... on delete cascade` to `auth.users`
(`...create_notes.sql:7`), reachable only via the Auth admin API or a service-role key,
neither of which this app uses (verified across all nine client call sites,
`research.md:220-245`). The test must not claim a note row can *never* be destroyed
without that condition.

#### 2. Column posture

**File**: `supabase/tests/03_notes_destruction.sql` (same file)

**Intent**: Characterize what `notes_update_own` does not restrict, so the decision to
defer `F5`'s Fix B is recorded as a passing test rather than as a note in a review.

**Contract**: Under the owner's session, on the owner's own row, two assertions that the
update **succeeds**:

- clearing `deleted_at` back to `null` on a soft-deleted note (an un-delete),
- changing `occurred_at`.

Comments must state: a row-level policy restricts rows, not columns; the live guarantee
is handler discipline (`src/lib/notes.ts:67-72`, `:86-91`,
`src/pages/api/notes/[id].ts:54` ignores a submitted `occurred_at`) backed by
`SUPABASE_KEY` never reaching a browser (`astro.config.mjs:19-20`); and that **these two
assertions are expected to flip to failures the day Fix B lands**
(`impl-review.md:111`) — that is the intended signal.

### Success Criteria:

#### Automated Verification:

- `npm run test:db` passes with all four files green
- Adding a permissive `for delete` policy in a scratch copy of the migration makes the destruction assertion fail
- The delete assertion passes without any exception handling, confirming no error is raised

#### Manual Verification:

- The comment block distinguishing grant from policy is accurate enough that a reader who has not read `research.md` would not write a `throws_ok` assertion next time
- The two column-posture assertions are unmistakably labelled as characterization, with the Fix B trigger condition named

---

## Phase 5: Make it a gate

### Overview

Run the suite in CI at the one point the database is clean, pin the CLI the gate now
depends on, and prove the gate fails for the reason it exists.

### Changes Required:

#### 1. CI step

**File**: `.github/workflows/ci.yml`

**Intent**: Enforce the suite on every pull request to `master`, satisfying the §5 gate
"database policy tests — local + CI".

**Contract**: A new `- name: Run database policy tests` step running `supabase test db`,
inserted in the `smoke` job **immediately after `Start local Supabase` (ends `:42`) and
before `Configure secrets for build and preview` (`:43`)**. The position is load-bearing:
at that point the database is migrated and holds zero rows and zero `auth.users`; after
`:48` or `:53` it holds whatever the smoke walk left behind, and `scripts/smoke.mjs`
performs no cleanup. The `ci` job is not a candidate — no CLI, no database.

#### 2. CLI pin

**File**: `.github/workflows/ci.yml`

**Intent**: This phase makes CI depend on `supabase test db` behaviour and on
CLI-managed pgTAP enablement, which is a wider surface than `start`/`stop` alone. An
unpinned `latest` can change that behaviour between two runs of the same commit.

**Contract**: `ci.yml:37` `version: latest` → `version: 2.117.0`, matching
`package-lock.json:9396`. Note that §3 Phase 2 owns gate integrity generally; this pin is
scoped to the dependency this phase introduces.

#### 3. Mutation check

**File**: none — a verification procedure

**Intent**: A gate that has never been seen to fail is not known to be a gate.

**Contract**: On a scratch branch, widen `notes_select_own` to `using (true)`, push, and
confirm the `smoke` job fails at the new step and not at a later one. Delete the branch.
Record the run URL in `change.md`.

### Success Criteria:

#### Automated Verification:

- `ci.yml` parses and the new step sits between `Start local Supabase` and `Configure secrets for build and preview` — checkable locally, and the position is load-bearing

#### Manual Verification:

- A pull request to `master` runs the new step and the `smoke` job passes
- The scratch branch with the widened policy fails CI, and the failure is reported by the policy-test step rather than by the smoke walk
- The pinned CLI version appears in the job log and matches `package-lock.json`
- The failing run's log names which assertion failed clearly enough to diagnose without re-running locally
- The run URL for the deliberate failure is recorded in `change.md`

---

## Phase 6: Write the guide back

### Overview

Fill §6.1 so the next policy test has a pattern to copy, correct the three overstated
claims, hand the cross-child gap to §3 Phase 3, and close `F5`.

### Changes Required:

#### 1. Cookbook §6.1

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD` placeholder with the canonical answer to "how do I add a
database policy test in this project?"

**Contract**: Under `### 6.1 Adding a database policy test`, replace the TBD bullet with:
location (`supabase/tests/`), naming (`NN_subject.sql`, `00_` reserved for the helper
sanity check), the helper (`tests.authenticate_as`, included per file with
`\ir helpers.inc`, and the rule that fixtures are inserted as superuser *before* the
switch), the minimal `auth.users` insert every fixture needs, the reference file
(`supabase/tests/01_notes_isolation.sql`), the run command (`npm run test:db`), and three
rules the phases earned:

- assert the mechanism, not the plain-language guarantee — for delete that means zero
  rows affected, never `throws_ok`;
- a characterization test belongs in a file labelled as such, never beside a guarantee;
- the role switch has its own test, and any new helper function needs one too.

#### 2. The three corrections

**File**: `context/foundation/test-plan.md`

**Intent**: Stop the guide asserting protections the schema does not implement. §1
principle 3 already says research is ground truth when the plan and research disagree
about where a failure lives; this applies it.

**Contract**: Three edits, each narrow:

- `:65` Risk #1 "What would prove protection" — drop "and a soft-deleted note is not
  returned even to its own owner" from the policy-layer clause and attach it to the
  integration layer, where `src/lib/notes.ts:29` actually applies it.
- `:81` §3 Phase 1 Goal — remove "and one child's", and restate the destruction clause as
  the mechanism: no delete *policy* exists, so a delete affects no rows. Keep the row's
  Risks and Test types columns unchanged.
- `:81`-adjacent §3 Phase 3 Goal — add the cross-child read boundary as an owned item of
  that phase, naming it as the gap Phase 1 could not cover.

#### 3. Stack and gates

**File**: `context/foundation/test-plan.md`

**Intent**: Move the two rows that said "none yet — see §3 Phase 1" to their delivered
state.

**Contract**: §4 `database policy tests` row — tool becomes pgTAP 1.3.3 via Supabase CLI
2.117.0, note records the hand-rolled helper and *why* `supabase-test-helpers` was not
adopted (no new install step in either environment), `checked:` set to the
implementation date. §5 `database policy tests` row — `required after §3 Phase 1` becomes
`required — wired`. Add a short §6.6 note recording the finding the phase actually
taught: deny-by-default makes removal loud and widening silent, which is why a policy
test and an HTTP walk are not substitutes.

#### 4. Close F5

**File**: `context/archive/2026-09-26-first-child-note/reviews/impl-review.md`

**Intent**: Record the decision this phase was designated to make.

**Contract**: **Blocked by the `AGENTS.md:8` hard rule — `context/archive/` is
immutable.** Record the decision in this change's `change.md` under `## Notes` instead:
`F5 — Decision: Fix A, database half deferred`, with the reasoning (the two smoke
assertions Fix A proposed are superseded by `03_notes_destruction.sql`, which reaches the
mechanism the smoke script cannot) and the tripwire (the two column-posture assertions
flip to failures the day Fix B lands). Note the same in §6.6.

#### 5. Repository guidelines

**File**: `AGENTS.md`

**Intent**: `AGENTS.md:35` currently reads "No unit/integration suite yet" and names
`scripts/smoke.mjs` as the only coverage. That is now wrong in a way that would mislead
the next agent.

**Contract**: §Testing Guidelines gains `npm run test:db` and the `supabase/tests/`
location; §Build, Test, and Development Commands gains the same script; §Commit & Pull
Request Guidelines notes that the `smoke` job now also runs policy tests. Keep the
existing sentence about no unit/integration suite — it is still true.

### Success Criteria:

#### Automated Verification:

- `npx prettier --check` passes on each edited Markdown file (`npm run lint` does not apply — `eslint.config.js` scopes every block to `js,jsx,ts,tsx` / `astro` / `scripts/**/*.mjs`, and `npm run format` writes rather than checks, so neither can fail)
- `grep -n "TBD" context/foundation/test-plan.md` no longer matches §6.1
- No file under `context/archive/` is modified — `git status` shows none

#### Manual Verification:

- A reader who opens §6.1 cold can write a new policy test without reading `research.md`
- §2 Risk #1 and §3 Phase 1 no longer claim any protection the five policies do not provide
- `change.md` records the `F5` decision and the Phase 1 grant reading
- §3 Phase 1 Status reads `complete`

---

## Testing Strategy

The deliverable of this change *is* tests, so the strategy question is how we know the
tests themselves are sound.

### Database policy tests:

- Cross-account denial on every operation that has a policy: `notes` select, insert,
  update; `children` select.
- The child-ownership `exists` on both `notes_insert_own` and `notes_update_own` —
  including the foreign-`child_id` insert, which no HTTP test can reach.
- Absent-policy operations — `notes` delete, `children` update, `children` delete:
  zero rows affected, no error raised, row still present.
- Grant surface pinned via `table_privs_are`.
- Characterization: both-children read, owner-visible soft delete, permitted un-delete,
  permitted re-date.

### Mutation testing (how we verify the tests):

Each assertion is justified by a specific mutation it catches, drawn from the widening
table at `research.md:285-299`. Five are exercised for real against scratch copies:
`notes_select_own → using (true)` (Phase 3), the `exists` removed from
`notes_insert_own` (Phase 3), a permissive `children` `for update` policy added
(Phase 3), a permissive `notes` `for delete` policy added (Phase 4), and the same
select widening pushed to CI (Phase 5). An assertion with no named mutation it
catches does not belong in the suite.

### Negative control:

`00_helper_sanity.sql` is itself verified by breaking the helper — commenting out the
role switch must make it fail. A control that cannot be made to fail is not a control.

### Manual testing steps:

1. `supabase start` on the relocated ports, then `npm run dev` and sign in — confirms
   the port move did not break the running app.
2. `npm run test:db` — green.
3. Comment out `set local role authenticated` in `helpers.inc`; re-run; assertion 2
   must fail. Restore.
4. In a scratch edit of `20260927205447_create_notes.sql`, set `notes_select_own` to
   `using (true)`; `supabase db reset`; re-run; the cross-account select assertion must
   fail. Restore and reset.
5. `npm run smoke` against the relocated stack — confirms no regression.
6. Push the widened policy on a scratch branch; confirm CI fails at the policy step.

## Performance Considerations

Negligible and worth one sentence: the suite is four small files against an empty local
database, each in its own rolled-back transaction, adding seconds to a `smoke` job that
already boots a full Supabase stack. The only real cost is the CLI's extension
create/drop around the run, which the CLI manages itself.

## Migration Notes

**No schema migration ships in this change.** That is the direct consequence of choosing
to characterize the column posture rather than harden it, and it means the hosted project
`dziennik-dziecka` needs no action.

The port move affects local developer setup only. Anyone with an existing `.env` or
`.dev.vars` must update `SUPABASE_URL`, and anyone with a running stack should
`supabase stop` before restarting on the new ports. `README.md` and `.env.example` carry
the new values for a fresh clone.

One standing hazard, unchanged by this plan but worth repeating because the fixtures
insert into `auth.users`: `supabase/.temp/linked-project.json` links this working copy to
the hosted project. Never run `supabase test db` with `--linked` or `--db-url`.

## References

- Research: `context/changes/testing-isolation-boundary/research.md`
- Test plan (the phase this implements): `context/foundation/test-plan.md:81` (§3 Phase 1), `:65` (Risk #1), `:68` (Risk #4)
- Policy surface: `supabase/migrations/20260927205447_create_notes.sql:22-66`, `supabase/migrations/20260923221601_create_children.sql:12-24`
- Why per-child scoping is a query property: `src/lib/notes.ts:20-21`, `:28`; `context/archive/2026-09-26-first-child-note/plan.md:117`
- The accurate delete observable: `context/archive/2026-09-26-first-child-note/plan.md:166`
- Finding `F5` (column scope, decided here): `context/archive/2026-09-26-first-child-note/reviews/impl-review.md:105-116`
- Finding `F7` (flagged, not scoped): `.../impl-review.md:128-136`
- The prior rejection this phase reverses: `context/archive/2026-09-23-child-profiles/plan.md:37`
- CI attachment point: `.github/workflows/ci.yml:39-43`
- Existing HTTP coverage to preserve: `scripts/smoke.mjs`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Make the local stack startable and read the real grants

#### Automated

- [ ] 1.1 Port exclusion check shows no overlap with the new port block
- [ ] 1.2 `supabase start` completes and `supabase status` reports API and DB running on the new ports
- [ ] 1.3 Grant query and `auth.users` NOT NULL column query both return results against the relocated local database

#### Manual

- [ ] 1.5 `npm run dev` loads and a local sign-in succeeds
- [ ] 1.6 Grant query result pasted into `change.md` and matches the expected privileges
- [ ] 1.7 Minimal working `auth.users` insert confirmed and recorded in `change.md`

### Phase 2: Suite skeleton and its negative control

#### Automated

- [ ] 2.1 `npm run test:db` runs and `00_helper_sanity.sql` passes all four assertions
- [ ] 2.2 Removing the role switch from the helper makes assertion 2 fail
- [ ] 2.3 `pg_prove` discovers the intended files and does not collect `helpers.inc` as a test

#### Manual

- [ ] 2.4 Fixture rows are absent after the run, confirming per-file rollback

### Phase 3: Risk #1 — exposure at the policy layer

#### Automated

- [ ] 3.1 `npm run test:db` passes with all three files green
- [ ] 3.2 Widening `notes_select_own` to `using (true)` fails the cross-account select assertion
- [ ] 3.3 Removing the child-ownership `exists` from `notes_insert_own` fails the foreign-`child_id` insert assertion
- [ ] 3.4 `npm run smoke` still passes against the relocated local stack
- [ ] 3.5 Adding a permissive `children` update policy fails the zero-rows `children` update assertion

#### Manual

- [ ] 3.6 Every assertion traces to one row of the widening table, with no row uncovered
- [ ] 3.7 The characterization file reads as current behaviour, not as a guarantee

### Phase 4: Risk #4 — destruction and column scope

#### Automated

- [ ] 4.1 `npm run test:db` passes with all four files green
- [ ] 4.2 Adding a permissive `for delete` policy fails the destruction assertion
- [ ] 4.3 The delete assertion passes with no exception handling, confirming no error is raised

#### Manual

- [ ] 4.4 The grant-versus-policy comment block is accurate enough to prevent a future `throws_ok`
- [ ] 4.5 Column-posture assertions are labelled as characterization with the Fix B trigger named

### Phase 5: Make it a gate

#### Automated

- [ ] 5.6 `ci.yml` parses and the new step sits at the intended position

#### Manual

- [ ] 5.1 A pull request runs the new step and the `smoke` job passes
- [ ] 5.2 The scratch branch with a widened policy fails CI at the policy-test step
- [ ] 5.3 The pinned CLI version in the job log matches `package-lock.json`
- [ ] 5.4 The failing run's log names the failing assertion clearly enough to diagnose
- [ ] 5.5 The deliberate-failure run URL is recorded in `change.md`

### Phase 6: Write the guide back

#### Automated

- [ ] 6.1 `npx prettier --check` passes on each edited Markdown file
- [ ] 6.2 §6.1 of `test-plan.md` no longer contains a `TBD` placeholder
- [ ] 6.3 `git status` shows no modified file under `context/archive/`

#### Manual

- [ ] 6.4 A cold reader can write a new policy test from §6.1 alone
- [ ] 6.5 §2 Risk #1 and §3 Phase 1 no longer claim unprovided protections
- [ ] 6.6 `change.md` records the `F5` decision and the Phase 1 grant reading
- [ ] 6.7 §3 Phase 1 Status reads `complete`
