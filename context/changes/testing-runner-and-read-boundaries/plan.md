# A Runner, and the Read Boundaries Nothing Can Reach Today — Implementation Plan

## Overview

Rollout phase 3 of `context/foundation/test-plan.md`. Two jobs: stand up the
project's first JavaScript test runner, then use it to cover the read boundaries
that live in the **query** rather than in a database policy — the places Phase 1
proved the policy layer structurally cannot protect.

The phase also corrects its own contract. §3 Phase 3's row currently promises a
period-bounded-read test whose subject does not exist in production code; that
half is handed to roadmap slice S-03, which owns the read. The correction lands
before the first test is written.

## Current State Analysis

**No JavaScript test runner exists.** `package.json` has no `vitest`, no `jest`,
and no `test` script. The only things asserting anything today are
`scripts/smoke.mjs` (38 HTTP steps) and `supabase test db` (pgTAP, 18
assertions across three files). §4 of the test plan records the
unit+integration row as `none yet — see §3 Phase 3`.

**Phase 1 wrote this phase's brief.** `supabase/tests/02_notes_characterization.sql`
is a deliberate characterization file, and both its assertions hand work forward:

- `:63-78` — `notes_select_own` carries no child predicate, so an unfiltered
  select returns notes across **all** of the account's children. The real
  per-child filter is a query property at `src/lib/notes.ts:28`. The file states
  "§3 Phase 3 of `context/foundation/test-plan.md` owns testing it, where an
  integration test can exercise the query."
- `:80-94` — `deleted_at` appears in no policy predicate, only in the partial
  index at `20260927205447_create_notes.sql:18-20`, and an index predicate is not
  a row filter. A soft-deleted note **is** returned to its own owner at the
  policy layer. Exclusion happens at `src/lib/notes.ts:29`, `:71` and `:90`.
  "§3 Phase 3 owns testing it."

**The period-bounded read does not exist.** `listNotes` (`src/lib/notes.ts:24`)
filters by `child_id` and `deleted_at` and orders by `occurred_at` — it has no
`.gte()` or `.lte()`, and no caller passes a date range. A repo-wide grep for
`.gte(`/`.lte(` returns nothing. The window read belongs to roadmap **S-03**
(`note-search-by-meaning`, status `ready`), whose Outcome line states: *"Pytanie
o okres („w lipcu", „ostatni tydzień") zawęża wynik twardo do tego przedziału i
zwraca z niego wszystkie pasujące notatki, nie tylko kilka najbardziej
podobnych."*

**What of Risk #5 *is* testable today** is the conversion half.
`occurred_at` is `timestamp not null` — *without* time zone
(`supabase/migrations/20260927205447_create_notes.sql:10`) — and stores verbatim
the `YYYY-MM-DDTHH:mm` the parent typed. `src/lib/wall-clock.ts` is the entire
conversion surface: `WALL_CLOCK_RE`, `warsawWallClock(at)` resolving
`Europe/Warsaw` through `Intl.DateTimeFormat("sv-SE", …)`, and `formatWallClock`
which slices rather than constructing a `Date`. The future-tolerance comparison
at `src/pages/api/notes.ts:65` is the fourth piece and is currently inline.

**`warsawWallClock` exists three times, and only two are duplicates.**
`src/lib/wall-clock.ts:16` is the original; `scripts/smoke.mjs:33` is a
deliberate copy ("Mirrors src/lib/wall-clock.ts rather than importing it, since
this script stays dependency- and build-free"); `localNow()` in
`src/components/notes/AddNoteForm.tsx:15` uses the **device** zone, not Warsaw —
a semantic difference the comment at `:27-28` explains, not a drift.

**Adding files perturbs an existing gate.** `scripts/gate-scope.mjs:20` pins
`eslintFiles: { mode: "exact", value: 41 }`, and `tsconfig.json:3` includes
`**/*`, so `astro check` type-checks every new test file and its floor at `:26`
moves too. Both numbers must be re-derived in the same commit that adds files.

**Only one CI job has a migrated database.** `.github/workflows/ci.yml:43-94`
(`smoke`) starts a local Supabase stack; the `ci` job has none. The comment at
`:65-67` is explicit: the database is migrated and holds zero rows **only**
before the smoke walk, because `scripts/smoke.mjs` performs no cleanup. The job
currently exports only `API_URL` and `ANON_KEY` from `supabase status -o env`
(`:64`).

## Desired End State

`npm run test:unit` and `npm run test:int` both exist and pass. Four named
protections hold that nothing asserted before this phase:

1. A parent's own soft-deleted note does not come back from `listNotes`.
2. One child's notes do not appear in the other child's list.
3. An edit changes `content` and `updated_at` and nothing else on the row.
4. The wall clock a note is stored under is the parent's wall clock, including
   across both of Poland's daylight-saving transitions.

Unit tests run in Cloudflare's blocking build seat via `gate:scope`; integration
tests run in CI's `smoke` job. §5's `unit + integration` gate row reads
`required — wired` and says plainly which half blocks a deploy and which does
not. §6.2 and §6.3 of the test plan are written for real, so "how do I add a
test for X here" has an answer that is not "TBD".

Verify by: `npm run test:unit && npm run test:int && npm run gates` locally with
a local Supabase stack up, then `grep -c "TBD — see §3 Phase 3"
context/foundation/test-plan.md` returning 0.

### Key Discoveries:

- `supabase/tests/02_notes_characterization.sql:63-94` — Phase 1 named both
  read boundaries as this phase's work, with the exact query lines that own them.
- `src/lib/notes.ts:28-29` — the two filters under test; the docstring at `:20-21`
  says deliberately that RLS does not supply the `child_id` filter.
- `scripts/smoke.mjs:321-358` — the walk executes at **top level**, unguarded,
  and ends in `process.exit()`. Importing the module from a test would run the
  entire HTTP walk. The copy of `warsawWallClock` at `:33` is also a local
  `function`, not an export, so it cannot be imported at all.
- Vitest 5.0.3's vite peer range is `^6.4.0 || ^7.0.0 || ^8.0.0`; this repo has
  Vite 8.3.0 and `@types/node` 24.13.4 already present transitively, satisfying
  its `>=24.0.0` peer.
- Vitest's `--reporter=json` writes to `.vitest/json/output.json` **by default,
  not stdout** — unlike the two stdout-parsing counters already in
  `gate-scope.mjs`. Fields include `numTotalTests`, `numPassedTests`,
  `numTotalTestSuites`, `numTodoTests`.
- `scripts/smoke.mjs:305` already carries this project's own version of the
  quantity-floor pattern: `EXPECTED_STEPS = 38`, with the comment "a steps array
  that lost its contents … would exit 0 having asserted nothing."
- §7 of the test plan excludes multi-time-zone behaviour, but says nothing about
  a second UTC offset **within** Europe/Warsaw. DST is in scope; a second zone
  is not.

## What We're NOT Doing

- **The period-bounded read, and its window-completeness test.** No subject
  exists in production code, and roadmap S-03 owns the read. Phase 1 of this
  plan narrows §3 Phase 3's row accordingly and records the obligation on S-03.
- **A skipped or `.todo` placeholder for the window test.** A skipped test
  reports green, which would let §5's new gate gate over nothing — Risk #7
  wearing Risk #5's clothes.
- **Deduplicating `localNow()` in `AddNoteForm.tsx`.** It reads the device zone
  on purpose (`:27-28`), which is a different value from Warsaw, not a stale
  copy. The divergence is recorded in §7 under the existing single-zone
  exclusion rather than removed.
- **Rendering `.astro` components or React islands.** §4 keeps that layer at
  `none yet — low priority`, and §7 excludes the budget it would serve.
- **UI snapshot or visual-regression tests.** §7 excludes them.
- **Promoting anything to a browser driver.** §4: not yet justified.
- **Replacing or shrinking `scripts/smoke.mjs`.** §4 says "Keep it; do not
  replace it."
- **Testing `listNotes`' ordering.** The smoke walk already asserts rendered
  note order over HTTP; a second assertion one layer down adds cost, not signal.
- **Wiring the recommended post-edit hook.** Hook configuration is owned outside
  this plan, and §5 records it as recommended-not-required on purpose.

## Implementation Approach

The runner lands first and on a real subject, not a placeholder: Phase 1's
tests cover `formatWallClock` and `WALL_CLOCK_RE`, which are pure string
behaviour with no environment dependency. That proves the runner, the path
alias and both existing gates still agree before anything harder is attempted.

Phase 2 then takes the half of Risk #5 that has a subject. Two small
production refactors make it testable, and both are covered by existing smoke
steps, so neither is an unverified change: extracting `warsawWallClock` into a
sibling `scripts/lib/wall-clock.mjs` that `smoke.mjs` imports (keeping the
script free of npm dependencies and of any build step), and extracting the
inline future-tolerance comparison out of the route handler.

Phase 3 builds the integration harness. These are query properties, so there is
no honest substitute for a real local Postgres with RLS live: fixtures are
seeded with the service-role key (bypassing RLS, as the pgTAP fixtures do) and
read back through an anon client signed in as the fixture user. The expected
set always comes from the fixture, never from re-running the query under test —
§2's stated anti-pattern for Risk #5.

Phase 4 seats the suite. Phase 5 writes the cookbook, which is what makes this
rollout phase worth more than its four tests.

## Critical Implementation Details

**`getViteConfig()` loads `astro.config.mjs`, including `adapter: cloudflare()`.**
§4 names `getViteConfig()` as the stack choice, so it is the primary route, but
the Cloudflare adapter may contribute workerd-oriented Vite plugins to a `node`
test run. If `npm run test:unit` fails inside config resolution rather than in
an assertion, fall back to `defineConfig` from `vitest/config` plus an explicit
`resolve.alias` mapping `@/` to `./src/`, and record the fallback in §4 when
Phase 5 updates that row. Nothing this phase tests imports `astro:env/server`,
so the fallback loses nothing: `src/lib/notes.ts`'s only Astro-adjacent imports
are type-only and erase at runtime.

**Ordering inside the `smoke` CI job is load-bearing.** The integration step must
sit immediately after `Run database policy tests` and before
`Configure secrets for build and preview`. That is the only window where the
database is migrated and empty; after the smoke walk it holds whatever the walk
left behind, and `scripts/smoke.mjs` performs no cleanup.

**The service-role key must never reach `src/`.** It is read from `process.env`
inside `tests/integration/` only. `npm run gate:build-output` already scans the
built client output for secret values and would catch a leak, but the import
boundary is the actual guarantee: no file under `src/` references it.

## Phase 1: Contract correction, then the runner

### Overview

Correct what §3 Phase 3 promises before writing a test against it, then install
and prove the runner on the one subject that needs no environment at all.

### Changes Required:

#### 1. The quality contract

**File**: `context/foundation/test-plan.md`

**Intent**: §3 Phase 3's row promises a period-bounded-read test whose subject
does not exist. Narrow the row's Goal and Risks-covered columns so the plan on
disk stops over-promising, and point the window half at the slice that owns the
read.

**Contract**: Row 3 of the §3 table (`context/foundation/test-plan.md:83`).
Goal drops the period-bounded-read clause and keeps the runner plus the three
query-layer boundaries. The `Risks covered` cell changes from
`#5 (window half), #4 (column half), #1 (soft-delete and cross-child halves)`
to `#5 (conversion half), #4 (column half), #1 (soft-delete and cross-child halves)`.
Add one sentence to the **Order rationale** paragraph below the table recording
that the window half moved to S-03 and why. Leave the `Status` cell at
`change opened` — Phase 5 marks it `complete`. Do not touch §6.2/§6.3 here;
Phase 5 rewrites both.

#### 2. The receiving obligation

**File**: `context/foundation/roadmap.md`

**Intent**: Make S-03 inherit the window-completeness test as a stated
obligation, not a lost intention, so the slice's own plan cannot omit it
silently.

**Contract**: The `- **Risk:**` line of the `### S-03` block
(`context/foundation/roadmap.md:87`) already names the trap — *"pytanie o okres
wymaga twardego odcięcia po dacie i kompletności w przedziale"*. Append one
sentence to that line stating that the completeness test for the window belongs
to S-03, that the expected set must come from the fixture rather than from the
query under test, and that `context/foundation/test-plan.md` §3 Phase 3 handed
it over. Bump the frontmatter `updated:` to today. Touch nothing else — S-03
stays `ready`.

#### 3. Runner dependency and scripts

**File**: `package.json`

**Intent**: Add Vitest and the two commands that select the unit and integration
directories, so CI can run each half in the job that can support it.

**Contract**: `vitest` as a devDependency at `^5.0.3` (peer-compatible with the
installed Vite 8.3.0). Scripts: `test:unit` running the suite once over
`tests/unit`, `test:int` running it once over `tests/integration`, and `test`
running both in that order. All three must be single-run, not watch mode.

#### 4. Runner configuration

**File**: `vitest.config.ts` (new)

**Intent**: Configure Vitest through Astro's helper so the `@/*` path alias and
the project's Vite settings apply without being restated.

**Contract**: Default-exports `getViteConfig()` from `astro/config` with
`test.environment` set to `"node"` — required from Astro 6 onward for anything
that may touch Astro's renderer, and this project is on Astro 7. Includes a
`/// <reference types="vitest/config" />` triple-slash directive. See
*Critical Implementation Details* for the fallback if adapter resolution fails.

#### 5. First unit tests

**File**: `tests/unit/wall-clock.test.ts` (new)

**Intent**: Prove the runner on real subject matter rather than a placeholder
assertion — `formatWallClock`'s slicing and `WALL_CLOCK_RE`'s shape, both pure
string behaviour with no clock, zone or environment dependency.

**Contract**: Imports `describe`/`it`/`expect` explicitly from `vitest` (not
globals, so `eslint.config.js` needs no globals entry) and
`formatWallClock`/`WALL_CLOCK_RE` from `@/lib/wall-clock`. Covers:
`formatWallClock` on a `YYYY-MM-DDTHH:mm` value and on a
`YYYY-MM-DDTHH:mm:ss` value — the docstring at `src/lib/wall-clock.ts:27`
promises both — asserting the `dd.mm.rrrr, HH:mm` output; and `WALL_CLOCK_RE`
accepting the `datetime-local` shape while rejecting a seconds-bearing value, an
offset-bearing value, and a date-only value.

#### 6. Keep the reporter's output directory out of tracked scope

**File**: `.gitignore`

**Intent**: Vitest's JSON reporter writes under `.vitest/` by default, and
ESLint's scope is `.gitignore`-driven — an untracked, unignored output directory
would move `gate:scope`'s exact count unpredictably between runs.

**Contract**: Add `.vitest/` (and the gate's output file path, if Phase 4 places
it outside that directory).

#### 7. Re-derive the scope floors

**File**: `scripts/gate-scope.mjs`

**Intent**: New files enter both tools' scope, so the exact ESLint count and the
`astro check` floor must move in the same commit that adds them.

**Contract**: `EXPECTED.eslintFiles.value` and `EXPECTED.astroCheckFiles.value`
(`:20` and `:26`). **Re-derive both by running the commands the file names
(`npx eslint . -f json`, `npx astro check`) — never compute a delta by hand.**
The comment at `:18-19` states this obligation already; honour it rather than
restating it.

### Success Criteria:

#### Automated Verification:

- Unit tests pass and report a non-zero count: `npm run test:unit`
- Linting passes over the new test files: `npm run lint`
- Type checking passes over the new test files: `npx astro check`
- Scope gates pass with re-derived counts: `npm run gate:scope`
- The full blocking gate chain still passes: `npm run gates`

**Verification note (2026-10-12).** `npm run gates` was verified
member-by-member rather than as one chain: `gate:scope`, `gate:routes`, `build`
and `gate:build-output` all passed, but `gate:drift` is unrunnable on a machine
without `SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD` and fails rather than
skipping by design (§6.6, "absent credentials fail, they do not skip"). Nothing
in this phase touches migrations or schema, and the gate runs with real secrets
from Cloudflare's build command and CI's scheduled sweep. Criterion 1.5 is
recorded as passed on that basis.

#### Manual Verification:

- §3 Phase 3's row no longer promises a period-bounded-read test, and the Order
  rationale paragraph says where that half went
- S-03's Risk line in the roadmap carries the window-completeness obligation,
  including the fixture-not-query requirement
- Confirm whether `getViteConfig()` resolved cleanly or the documented fallback
  was needed, and note which, for Phase 5's §4 row

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 2: The wall-clock boundary, including both DST transitions

### Overview

Cover the half of Risk #5 that has a subject today. Two small production
extractions make the boundary testable; both are already covered by existing
smoke steps, so neither change ships unverified.

### Changes Required:

#### 1. A shared wall clock the smoke walk can import

**File**: `scripts/lib/wall-clock.mjs` (new)

**Intent**: `scripts/smoke.mjs:33` holds a hand-copy of `warsawWallClock`, and
it cannot be imported — it is a local `function`, and the module runs its entire
HTTP walk at top level (`:321-358`) before exiting the process. Move the
function into a sibling plain-ESM module so both the walk and a test can import
the same code.

**Contract**: Exports `warsawWallClock(at = new Date())` with behaviour
identical to `src/lib/wall-clock.ts:16`. Zero npm dependencies and no build
step — a relative import of a sibling `.mjs` is neither, so `smoke.mjs`'s stated
constraint ("dependency- and build-free") still holds and `node
scripts/smoke.mjs` still runs unchanged. `eslint.config.js:86-91` already scopes
`scripts/**/*.mjs`, so the file is linted on arrival with no config change.

#### 2. The smoke walk uses the shared module

**File**: `scripts/smoke.mjs`

**Intent**: Delete the copy and import the shared function, reducing three
implementations to two — one TypeScript original and one `.mjs` sibling with a
test tying them together.

**Contract**: Remove the local `warsawWallClock` (`:31-37`) and import it from
`./lib/wall-clock.mjs`. **Do not restructure the top-level walk**: its execution
path is what CI depends on, and `EXPECTED_STEPS = 38` (`:305`) does not protect
against the walk failing to run at all. The verification below is what proves
this edit safe.

#### 3. The future-tolerance predicate becomes testable

**File**: `src/lib/wall-clock.ts`, `src/pages/api/notes.ts`

**Intent**: The "not in the future" boundary is an inline comparison in the
route handler (`src/pages/api/notes.ts:65`) and cannot be unit-tested where it
sits. Extract it as a pure predicate next to the other wall-clock functions.

**Contract**: A new export in `src/lib/wall-clock.ts` taking the submitted
wall-clock string and resolving the comparison against
`warsawWallClock(new Date(now + tolerance))`, with the existing
`FUTURE_TOLERANCE_MS = 5 * 60_000` moving with it. `src/pages/api/notes.ts`
calls it in place of the inline comparison and keeps the same user-facing
message. **Behaviour must not change** — the reason this is safe is that
`scripts/smoke.mjs:174` already asserts a note dated a year ahead is rejected
and `:183` that a backdated note is accepted, so a regression here fails the
smoke walk. Carry the `:8-11` comment explaining *why* the tolerance exists
(a Worker's `Date.now()` reports the time of the last I/O) to its new home —
without it the constant reads as arbitrary.

#### 4. The boundary tests

**File**: `tests/unit/wall-clock.test.ts`

**Intent**: Assert that the wall clock a note is stored under is the parent's
wall clock, at the two instants per year where that is hardest, and that the
two implementations of it agree.

**Contract**: Extends the Phase 1 file. Covers:

- `warsawWallClock` at fixed UTC instants either side of **spring-forward**
  (last Sunday of March, when 02:00 local does not exist and the offset moves
  +01:00 → +02:00) and **fall-back** (last Sunday of October, +02:00 → +01:00).
  Assert the returned wall-clock string, which is what reaches `occurred_at`.
- Parity: `scripts/lib/wall-clock.mjs`'s export and `@/lib/wall-clock`'s export
  return identical strings across the same fixed instant set, including both
  transitions. This is the test that makes the remaining duplication safe.
- The future-tolerance predicate: a value just inside the tolerance accepted, a
  value beyond it rejected, and a backdated value accepted — exercised against
  an injected instant, never the real clock.

Instants are passed in explicitly; no test may read `new Date()` without
pinning it, or it will pass or fail depending on the day it runs.

#### 5. Re-derive the scope floors

**File**: `scripts/gate-scope.mjs`

**Intent**: Two new files entered scope.

**Contract**: As Phase 1 item 7 — re-derive both numbers by running the commands.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including both DST transition cases: `npm run test:unit`
- The parity test confirms `scripts/lib/wall-clock.mjs` and
  `src/lib/wall-clock.ts` agree across the fixed instant set
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Scope gates pass with re-derived counts: `npm run gate:scope`
- The smoke walk still runs and still reports all 38 steps passing, against a
  local preview with a local Supabase stack: `npm run smoke`

#### Manual Verification:

- `npm run smoke` output was read, not just exit-checked — confirm it printed
  `All 38 smoke steps passed` rather than exiting 0 over an unexecuted walk
- The future-date and backdated smoke steps still pass, confirming the predicate
  extraction preserved behaviour
- The tolerance comment explaining the Worker clock survived the move

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 3: The integration harness and the three read boundaries

### Overview

Build the fixture harness and assert the three protections that live in the
query layer — the two Phase 1 explicitly handed forward, plus Risk #4's column
half.

### Changes Required:

#### 1. The fixture harness

**File**: `tests/integration/fixtures.ts` (new)

**Intent**: Seed and tear down a known set of rows against a local Supabase
stack, so every expected set in this directory comes from the fixture rather
than from the query under test.

**Contract**: Reads the local stack's URL, anon key and service-role key from
`process.env`; fails loudly with the command to get them
(`supabase status -o env`) if any is absent — **never skips**, per §6.6's
"absent credentials fail, they do not skip". Exposes:

- a service-role client used only for seeding and deleting;
- a factory returning an anon client signed in as a fixture user, type-compatible
  with `SupabaseServerClient` (`src/lib/children.ts:4`), which is what
  `listNotes` takes;
- seed and teardown helpers operating on **fixed, reserved UUIDs** in a
  distinctive prefix, mirroring the readable-id style of
  `supabase/tests/02_notes_characterization.sql:29-59`.

Teardown deletes **by id** — never by truncation — and runs both before and
after each suite, so a dirty local database or a previously failed run cannot
make a suite pass or fail for the wrong reason, and no real note is ever at
risk. The service-role key is referenced here and nowhere under `src/`.

#### 2. The two boundaries Phase 1 handed forward

**File**: `tests/integration/notes-read-boundaries.test.ts` (new)

**Intent**: Assert the two protections `02_notes_characterization.sql` recorded
as *absent* from the policy layer and named this phase's work.

**Contract**: Calls `listNotes` from `@/lib/notes` with an authenticated fixture
client. Two assertions, each deriving its expected set from the fixture:

- **Soft-delete exclusion** — the fixture gives one child a live note and a
  soft-deleted note belonging to the *same* owner; `listNotes` returns only the
  live one. This is the query property at `src/lib/notes.ts:29`;
  `02_notes_characterization.sql:89-94` proves the policy layer returns both.
- **Cross-child scoping** — the fixture gives one account two children with
  notes each; `listNotes` for the first child returns its notes and none of the
  second child's. This is `src/lib/notes.ts:28`;
  `02_notes_characterization.sql:73-78` proves the policy layer returns both
  children's rows.

Assert on the returned note **ids** against the fixture's ids, not on counts
alone: a count passes while the wrong row is returned.

#### 3. Risk #4's column half

**File**: `tests/integration/notes-edit-scope.test.ts` (new)

**Intent**: Assert that an edit changes the note's text and nothing else. No
row-level policy restricts which **columns** an update may write
(`notes_update_own` constrains ownership, not column scope), so this is a
handler-level guarantee with no layer below it.

**Contract**: Reads the complete row via the service-role client, calls
`updateNoteContent` from `@/lib/notes` through an authenticated fixture client,
re-reads the complete row, and asserts a **full-row diff**: every column
byte-identical except `content` (changed to the new text) and `updated_at`
(permitted to differ). Build the comparison by enumerating the keys the row
actually returned and subtracting the two-name allowlist — **not** by listing
the columns to check. A column added to `notes` later is then covered
automatically, and widening the allowlist becomes the deliberate review moment.
This is §6.6's enumerate-then-invert pattern, the one credited for the
route-guard gate, applied to columns instead of routes.

#### 4. The integration command and its contract

**File**: `package.json`

**Intent**: `test:int` already exists from Phase 1; document what it requires so
a developer running it without a stack gets an answer rather than a stack trace.

**Contract**: No script change if Phase 1's `test:int` is correct. The
environment contract — local stack running, three values exported from
`supabase status -o env` — is enforced by `fixtures.ts` and written up in §6.3
by Phase 5.

#### 5. Re-derive the scope floors

**File**: `scripts/gate-scope.mjs`

**Contract**: As before — re-derive by running the commands.

### Success Criteria:

#### Automated Verification:

- Integration tests pass against a local stack: `npm run test:int`
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Scope gates pass with re-derived counts: `npm run gate:scope`
- Unit tests still pass: `npm run test:unit`

#### Manual Verification:

- Mutation check: breaking each of the three queries under test makes the
  corresponding test fail, and all three edits were reverted — remove
  `.is("deleted_at", null)` from `src/lib/notes.ts:29` for the soft-delete test,
  `.eq("child_id", childId)` from `:28` for the cross-child test, and add a
  second column to the `updateNoteContent` payload for the full-row diff. A test
  that cannot fail is not covering anything
- Run `npm run test:int` twice in a row against the same local database and
  confirm both runs pass, proving teardown is idempotent
- Confirm no row outside the reserved fixture id prefix was deleted or modified
- Confirm no file under `src/` references the service-role key

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 4: Seat the suite in the gates

### Overview

Put the unit suite in the blocking seat and the integration suite in CI, then
floor what the runner reports so a shrinking suite fails instead of passing
green. State the resulting asymmetry rather than claiming both halves block.

### Changes Required:

#### 1. The test-count floor

**File**: `scripts/gate-scope.mjs`

**Intent**: §6.6's Phase 2 lesson is that at the tooling layer total failure is
loud and partial shrinkage is silent: a gate that examined 4 files instead of 38
exits 0 and prints nothing. The same is true of a suite that ran 3 assertions
instead of 20. Floor the quantity, because the enforcing layer cannot be asked
whether it really checked.

**Contract**: A third `EXPECTED` entry and a third `GATES` row, following the
file's existing shape — a `measure` function returning `{ command, count,
detail }`, with a `null` count treated as a failure (`:81-87`). Two differences
from the two existing counters, both load-bearing:

- The JSON reporter does **not** write to stdout. Invoke with
  `--outputFile` and read that file; a missing or unparseable file is a `null`
  count, i.e. a failure.
- Floor `numPassedTests`, **not** `numTotalTests`. A test converted to `.todo`
  or `.skip` still counts in the total, so flooring the total would let a
  deletion hide behind a skip. Optionally floor `numTotalTestSuites` as well, to
  catch a whole file dropping out.

Scope this entry to the **unit** suite only: `gate:scope` runs inside
`npm run gates`, which Cloudflare's build command calls, and that environment
has no database.

#### 2. Unit tests in the `ci` job

**File**: `.github/workflows/ci.yml`

**Intent**: Give the unit suite fast feedback on every branch, matching how the
other gates are duplicated between CI and the blocking seat.

**Contract**: A `npm run test:unit` step in the `ci` job, placed before
`npm run gate:scope` — the same ordering rationale as the comment at `:27-28`,
so a suite that ran over a fraction of its files fails at the gate rather than
passing silently.

#### 3. Integration tests in the `smoke` job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the integration suite in the only job with a migrated database,
in the only window where that database is empty.

**Contract**: Widen the `supabase status -o env` grep at `:64` from
`^(API_URL|ANON_KEY)=` to also capture `SERVICE_ROLE_KEY`. Add a
`npm run test:int` step **immediately after** `Run database policy tests`
(`:68-69`) and **before** `Configure secrets for build and preview` (`:70`),
sourcing `supabase.env` and mapping the three values to the names
`tests/integration/fixtures.ts` reads. Extend the `:65-67` comment to record
that a second consumer now depends on that position.

#### 4. Flip the gate row, and name the asymmetry

**File**: `context/foundation/test-plan.md`

**Intent**: §5's `unit + integration` row reads
`required after §3 Phase 3`. It is now wired — but only half of it blocks a
deploy, and the table must not imply otherwise.

**Contract**: Row at `context/foundation/test-plan.md:149`. `Required?` becomes
`required — wired`. Add a sentence below the table, in the same register as the
existing GitHub-is-advisory note in §6.6: unit tests are in the blocking seat
via `gate:scope` inside `npm run gates`, which Cloudflare's build command calls;
integration tests need a database that seat does not have, so they are CI-only
and therefore advisory on a repository without branch protection. Do not write
`required — wired` against the integration half without this sentence.

### Success Criteria:

#### Automated Verification:

- The floor is live and correct: `npm run gate:scope` passes
- The floor actually catches shrinkage: renaming a unit test file so it stops
  matching makes `npm run gate:scope` fail naming the shortfall, then revert
- The full blocking chain passes locally: `npm run gates`
- Both suites pass: `npm run test:unit && npm run test:int`

#### Manual Verification:

- Push a branch and confirm the `ci` job runs `test:unit`, and that a PR into
  `master` runs `test:int` in the `smoke` job
- Confirm the `smoke` job's integration step ran against an empty database — its
  output should show the fixture teardown finding nothing to remove on the
  first run
- Read §5's new sentence and confirm it states plainly which half can block a
  deploy and which cannot

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 5: Close the contract — write the cookbook

### Overview

The four tests are the smaller half of this phase's value. §6 becomes the
canonical answer to "how do I add a test for X in this project?", which is what
`/10x-tdd` reads in the next lesson.

### Changes Required:

#### 1. The stack row

**File**: `context/foundation/test-plan.md`

**Intent**: §4's unit+integration row reads `none yet — see §3 Phase 3`. Record
what was actually adopted, with the versions and the dated check the table's own
convention requires.

**Contract**: Row at `context/foundation/test-plan.md:115`. Tool becomes Vitest
with the installed version and the Vite version it is peer-matched to; Notes
records the `getViteConfig()` route and the `node` environment requirement from
Astro 6 onward — **or the fallback, if Phase 1 found one necessary** — plus the
run commands and a `checked:` date of the day this phase lands.

#### 2. §6.2 — adding a unit test

**File**: `context/foundation/test-plan.md:244-246`

**Intent**: Replace the `TBD` with the four things a cookbook entry must answer.

**Contract**: Location (`tests/unit/`), naming (`<subject>.test.ts`, explicit
`vitest` imports rather than globals, so no ESLint globals entry is needed),
reference test (`tests/unit/wall-clock.test.ts`, naming the DST cases as the
pattern worth copying — pin the instant, never read the real clock), and run
command (`npm run test:unit`). Add the obligation that comes with the floor:
adding or removing a test file means re-deriving `EXPECTED` in
`scripts/gate-scope.mjs` in the same commit, exactly as the ESLint count already
requires.

#### 3. §6.3 — adding an integration test

**File**: `context/foundation/test-plan.md:248-253`

**Intent**: Replace the `TBD`. Its current text promises the date-window
completeness pattern, which moved to S-03 — so this entry documents the pattern
that *was* built and points at the one that has not been.

**Contract**: Location (`tests/integration/`), naming, prerequisites (local
stack up; the three values from `supabase status -o env`; credentials fail
rather than skip), the fixture contract (reserved ids, delete-by-id teardown
both sides, never truncate), and the run command. State the rule the directory
exists to enforce: **the expected set comes from the fixture, never from
re-running the query under test** — §2's named anti-pattern for Risk #5.
Reference test: `tests/integration/notes-read-boundaries.test.ts`, with
`notes-edit-scope.test.ts` named as the enumerate-then-invert variant for
column-scope assertions. Close with one line recording that the date-window
completeness pattern lands with roadmap S-03, which owns the period-bounded
read.

#### 4. §6.6 — the per-phase note

**File**: `context/foundation/test-plan.md:398+`

**Intent**: Each rollout phase leaves behind what it learned that the next
reader could not re-derive. Phase 1's note was about deny-by-default asymmetry;
Phase 2's was about the inversion at the tooling layer.

**Contract**: A `**§3 Phase 3 — …**` block in the established voice, recording
what this phase actually found rather than restating the plan. At minimum: that
the row's window half had no subject in production code and why that was handed
to S-03 rather than built speculatively; that Phase 1's characterization file
is what made this phase's scope unambiguous, which is an argument for writing
characterizations rather than deleting them; that three implementations of
`warsawWallClock` were two duplicates and one deliberate semantic difference,
and how the test tells them apart; and the honest statement that only the unit
half reached the blocking seat, because the seat has no database.

#### 5. §7 — the negative space gains an entry

**File**: `context/foundation/test-plan.md:492+`

**Intent**: `localNow()` in `AddNoteForm.tsx` validates against the **device**
zone while the server validates against Europe/Warsaw. For a single parent in
Poland these coincide; a future reader will otherwise read it as a bug.

**Contract**: One entry under the existing single-zone exclusion, naming the
divergence, why it is deliberate (`src/components/notes/AddNoteForm.tsx:27-28`),
what makes it harmless today (one parent, one zone), and the re-evaluation
trigger — a second zone, which §7's existing multi-time-zone entry already names.
Source: this phase.

#### 6. Status and freshness

**File**: `context/foundation/test-plan.md`

**Intent**: Advance the orchestrator's state and record the review.

**Contract**: §3 row 3's `Status` cell to `complete`. §8's strategy line gains a
parenthetical noting the §4 and §5 rows this phase updated, matching how Phase
2's update was recorded. Phase 4's §3 row stays `not started` — it still waits
on S-03.

### Success Criteria:

#### Automated Verification:

- No placeholder remains:
  `grep -c "TBD — see §3 Phase 3" context/foundation/test-plan.md` returns 0
- §3 Phase 3's row reads `complete`
- Everything still passes after the documentation pass:
  `npm run test:unit && npm run test:int && npm run gates`

#### Manual Verification:

- §6.2 and §6.3 each answer all four cookbook questions — location, naming,
  reference test, run command — without the reader opening another file
- Hand §6.2 and §6.3 to a reader unfamiliar with the project and confirm they
  could add a test from those sections alone
- §6.6's note records findings, not a restatement of this plan
- §4's row carries a `checked:` date and names whichever config route was
  actually used

---

## Testing Strategy

### Unit Tests:

- `formatWallClock` — both input shapes the docstring promises (`:mm` and
  `:mm:ss`), asserting the `dd.mm.rrrr, HH:mm` output
- `WALL_CLOCK_RE` — accepts the `datetime-local` shape; rejects seconds, an
  offset, and a date-only value
- `warsawWallClock` — fixed instants either side of both Europe/Warsaw DST
  transitions, which is where a wall-clock conversion actually breaks
- Parity between `src/lib/wall-clock.ts` and `scripts/lib/wall-clock.mjs` across
  the same instant set — the test that makes the remaining duplication safe
- The future-tolerance predicate — just inside, beyond, and backdated, against
  an injected instant

Key edge case discipline: no unit test may read `new Date()` unpinned. A test
whose result depends on the day it runs is not a test.

### Integration Tests:

- A parent's own soft-deleted note does not come back from `listNotes`
  (`src/lib/notes.ts:29`; the policy layer returns it —
  `02_notes_characterization.sql:89-94`)
- One child's notes do not appear in the other child's list
  (`src/lib/notes.ts:28`; the policy layer returns both —
  `02_notes_characterization.sql:73-78`)
- An edit leaves every column byte-identical except `content` and `updated_at`,
  asserted by full-row diff against a two-name allowlist

Every expected set is derived from the fixture. Assertions name ids, not counts.

### Manual Testing Steps:

1. With a local Supabase stack up, run `npm run test:unit` and `npm run test:int`
   and read the reported counts, not just the exit codes.
2. Run `npm run test:int` a second time against the same database; confirm it
   passes again.
3. Mutation-check each of the three integration assertions by breaking the query
   it covers, confirming the test fails, then reverting (Phase 3 lists the exact
   three edits).
4. Rename a unit test file so it stops matching, confirm `npm run gate:scope`
   fails naming the shortfall, then revert.
5. Run `npm run smoke` and confirm the output reads `All 38 smoke steps passed`
   — the one thing that proves the `smoke.mjs` edit did not stop the walk from
   executing.
6. Push a branch, then open a PR into `master`, and confirm the new steps appear
   in the `ci` and `smoke` jobs respectively.

## Performance Considerations

`gate:scope` now runs the unit suite, so `npm run gates` — which Cloudflare's
build command calls on every push to `master` — gets slower by the unit suite's
runtime. That is acceptable only while the unit suite stays fast, which is the
real reason the floor is scoped to `tests/unit` and the integration suite is
not in that seat. If the unit suite ever needs a database or a network call, it
belongs in `tests/integration` instead, and §6.2 should say so.

The integration suite starts no services of its own: it reuses the stack the
`smoke` job already pays for, and seeds a handful of rows.

## Migration Notes

No data migration and no schema change. Two production refactors ship with
existing coverage as their safety net: the `warsawWallClock` extraction is
proven by `npm run smoke` still reporting 38 passing steps, and the
future-tolerance extraction by the future-date and backdated steps at
`scripts/smoke.mjs:174` and `:183`. Both are revertible in a single commit.

The `smoke` job gains a dependency on `SERVICE_ROLE_KEY` being exported from
`supabase status -o env`. That value is the local stack's well-known development
key, not a repository secret — §6.6 records that this repository has no
repository secrets at all.

## References

- Quality contract and this phase's row: `context/foundation/test-plan.md` §3
  Phase 3, §2 Risk Response Guidance (#1, #4, #5, #7), §4, §5, §6.6, §7
- What Phase 1 handed forward:
  `supabase/tests/02_notes_characterization.sql:63-94`
- The queries under test: `src/lib/notes.ts:24-38` (`listNotes`), `:62-75`
  (`updateNoteContent`)
- The boundary surface: `src/lib/wall-clock.ts`, `src/pages/api/notes.ts:59-67`
- The copy to be shared: `scripts/smoke.mjs:31-37`; the walk that must keep
  running: `:300-358`
- The gate to extend: `scripts/gate-scope.mjs:16-27`, `:69-106`
- The job with a database, and its ordering constraint:
  `.github/workflows/ci.yml:43-94`, especially `:64` and `:65-67`
- The slice receiving the window half: `context/foundation/roadmap.md` §S-03
  (`note-search-by-meaning`, status `ready`)
- Prior phase plans: `context/changes/testing-gates-that-gate/plan.md`,
  `context/archive/2026-10-03-testing-isolation-boundary/plan.md`
- Lint scope rule this phase must not break:
  `context/foundation/lessons.md` (scoped override + scope assertion)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Contract correction, then the runner

#### Automated

- [x] 1.1 Unit tests pass and report a non-zero count: `npm run test:unit` — 71e5055
- [x] 1.2 Linting passes over the new test files: `npm run lint` — 71e5055
- [x] 1.3 Type checking passes over the new test files: `npx astro check` — 71e5055
- [x] 1.4 Scope gates pass with re-derived counts: `npm run gate:scope` — 71e5055
- [x] 1.5 The full blocking gate chain still passes: `npm run gates` — 71e5055

#### Manual

- [x] 1.6 §3 Phase 3's row no longer promises a period-bounded-read test, and the Order rationale paragraph says where that half went — 71e5055
- [x] 1.7 S-03's Risk line in the roadmap carries the window-completeness obligation, including the fixture-not-query requirement — 71e5055
- [x] 1.8 Confirm whether `getViteConfig()` resolved cleanly or the documented fallback was needed, and note which, for Phase 5's §4 row — 71e5055

### Phase 2: The wall-clock boundary, including both DST transitions

#### Automated

- [x] 2.1 Unit tests pass, including both DST transition cases: `npm run test:unit` — 3740884
- [x] 2.2 The parity test confirms `scripts/lib/wall-clock.mjs` and `src/lib/wall-clock.ts` agree across the fixed instant set — 3740884
- [x] 2.3 Linting passes: `npm run lint` — 3740884
- [x] 2.4 Type checking passes: `npx astro check` — 3740884
- [x] 2.5 Scope gates pass with re-derived counts: `npm run gate:scope` — 3740884
- [x] 2.6 The smoke walk still runs and still reports all 38 steps passing, against a local preview with a local Supabase stack: `npm run smoke` — 3740884

#### Manual

- [x] 2.7 `npm run smoke` output was read, not just exit-checked — confirm it printed `All 38 smoke steps passed` rather than exiting 0 over an unexecuted walk — 3740884
- [x] 2.8 The future-date and backdated smoke steps still pass, confirming the predicate extraction preserved behaviour — 3740884
- [x] 2.9 The tolerance comment explaining the Worker clock survived the move — 3740884

### Phase 3: The integration harness and the three read boundaries

#### Automated

- [x] 3.1 Integration tests pass against a local stack: `npm run test:int`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Type checking passes: `npx astro check`
- [x] 3.4 Scope gates pass with re-derived counts: `npm run gate:scope`
- [x] 3.5 Unit tests still pass: `npm run test:unit`

#### Manual

- [x] 3.6 Mutation check: breaking each of the three queries under test makes the corresponding test fail, and all three edits were reverted
- [x] 3.7 Run `npm run test:int` twice in a row against the same local database and confirm both runs pass, proving teardown is idempotent
- [x] 3.8 Confirm no row outside the reserved fixture id prefix was deleted or modified
- [x] 3.9 Confirm no file under `src/` references the service-role key

### Phase 4: Seat the suite in the gates

#### Automated

- [ ] 4.1 The floor is live and correct: `npm run gate:scope` passes
- [ ] 4.2 The floor actually catches shrinkage: renaming a unit test file so it stops matching makes `npm run gate:scope` fail naming the shortfall, then revert
- [ ] 4.3 The full blocking chain passes locally: `npm run gates`
- [ ] 4.4 Both suites pass: `npm run test:unit && npm run test:int`

#### Manual

- [ ] 4.5 Push a branch and confirm the `ci` job runs `test:unit`, and that a PR into `master` runs `test:int` in the `smoke` job
- [ ] 4.6 Confirm the `smoke` job's integration step ran against an empty database — its output should show the fixture teardown finding nothing to remove on the first run
- [ ] 4.7 Read §5's new sentence and confirm it states plainly which half can block a deploy and which cannot

### Phase 5: Close the contract — write the cookbook

#### Automated

- [ ] 5.1 No placeholder remains: `grep -c "TBD — see §3 Phase 3" context/foundation/test-plan.md` returns 0
- [ ] 5.2 §3 Phase 3's row reads `complete`
- [ ] 5.3 Everything still passes after the documentation pass: `npm run test:unit && npm run test:int && npm run gates`

#### Manual

- [ ] 5.4 §6.2 and §6.3 each answer all four cookbook questions — location, naming, reference test, run command — without the reader opening another file
- [ ] 5.5 Hand §6.2 and §6.3 to a reader unfamiliar with the project and confirm they could add a test from those sections alone
- [ ] 5.6 §6.6's note records findings, not a restatement of this plan
- [ ] 5.7 §4's row carries a `checked:` date and names whichever config route was actually used
