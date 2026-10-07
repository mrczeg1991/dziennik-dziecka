<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Isolation at the Enforcing Layer

- **Plan**: `context/changes/testing-isolation-boundary/plan.md`
- **Mode**: Deep
- **Date**: 2026-10-03
- **Verdict**: REVISE → **SOUND after triage** (all 6 findings fixed)
- **Findings**: 1 critical, 4 warnings, 1 observation

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | FAIL | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

7/7 paths ✓, 7/7 `config.toml` line anchors ✓, 5/5 symbols ✓, port blast-radius 5/5 refs covered ✓, brief↔plan ✓ (shared one overclaim — see F2).

Codebase verification was done inline rather than via sub-agent: both migrations are short and were read in full, the port blast radius is one grep, and F1 turns on `pg_prove`/psql semantics that live outside this repo.

## Findings

### F1 — The shared helper cannot survive the runner's execution model

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §1 — Session-switching helper
- **Detail**: `supabase/tests/_helpers.sql` fails two ways. (a) **Persistence** — the plan's own Current State Analysis records that each test file runs in its own transaction and is rolled back, so a `tests` schema created by a separately-run file does not exist when the next file starts. (b) **Discovery** — `pg_prove --ext .pg --ext .sql -r` collects by extension recursively with no underscore convention, so the file IS collected, emits no TAP plan, and fails the harness; `0` (0x30) also sorts before `_` (0x5F), so `00_helper_sanity.sql` would run first regardless. The plan's hedge ("move it to a subdirectory the runner does not recurse into") makes it worse: `-r` recurses, and an unreachable location guarantees the helper never loads. This contradicts a constraint the plan itself documented.
- **Fix A ⭐ Recommended**: Rename to `supabase/tests/helpers.inc` so the `--ext` filter skips it, then `\ir helpers.inc` at the top of each test file — inlined into that file's own transaction.
  - Strength: Persistence becomes a non-issue; keeps one definition for §6.1 to point at and preserves the negative-control design.
  - Tradeoff: Depends on psql backslash includes working under `pg_prove` and on `\ir` resolving relative to the including file.
  - Confidence: MED — HIGH that `--ext` filtering excludes a non-`.sql` file; MEDIUM on `\ir` path resolution, which Phase 2 verifies first.
  - Blind spot: Not verified whether the CLI invokes `pg_prove` with a rewritten working directory.
- **Fix B**: Drop the helper; inline the two `set local` statements per file.
  - Strength: Zero discovery and persistence risk.
  - Tradeoff: Repeated per file; §6.1 loses its single reference point and "the helper has its own test" is harder to state.
  - Confidence: HIGH — plain SQL with no indirection.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — helper renamed to `helpers.inc`, `\ir` include specified per consuming file, a verify-first instruction added, and Fix B recorded as the named fallback.

### F2 — End state promises `children` coverage no phase builds

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Desired End State; Phase 3 §1; `plan-brief.md`
- **Detail**: Desired End State claimed a PR adding "a `delete` or a `children` `update` policy" fails CI. Phase 3's six assertions covered notes select/insert/update plus `children_select_own`; Phase 4's destruction test is notes-only. Nothing asserted anything about `children` update or delete — the mutation the research widening table lists as caught by nothing today. The plan reproduced the gap it was written to close, and the brief carried the same overclaim.
- **Fix**: Add two assertions to `01_notes_isolation.sql`, parallel to Phase 4's shape — under the owner's own session, an update on their own `children` row affects zero rows, and a delete affects zero rows with the row still present.
  - Strength: ~6 lines against fixtures that already exist, reusing the zero-rows shape so §6.1's pattern stays consistent.
  - Tradeoff: Puts `children` assertions in a file named for notes.
  - Confidence: HIGH — the migration is 24 lines and verified to contain no update or delete policy.
  - Blind spot: None significant.
- **Decision**: FIXED — assertions added to Phase 3, new automated criterion and Progress row 3.5 (manual rows renumbered 3.6/3.7), Desired End State, Testing Strategy and brief all corrected.

### F3 — `auth.users` fixtures are the cost of hand-rolling, and go unaddressed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2; Critical Implementation Details
- **Detail**: `notes.user_id references auth.users (id)`, so every fixture needs a real `auth.users` row. The plan said "insert fixtures as superuser" and stopped. `auth.users` is GoTrue-owned with a column set that varies across Supabase versions and several NOT NULL columns; a minimal `(id, email)` insert often works and sometimes does not. This is the work `supabase-test-helpers`' `tests.create_supabase_user` absorbs, and it was the unpriced half of choosing the hand-rolled route.
- **Fix**: In Phase 1, while the stack is up for the grant query, capture the `auth.users` NOT NULL columns and record a confirmed minimal insert in `change.md`; Phase 2 consumes it and §6.1 publishes it.
  - Strength: Uses a window Phase 1 already opens; turns a likely mid-phase stall into a recorded fact.
  - Tradeoff: Pins the fixture shape to the current local image version.
  - Confidence: MED — confident the FK forces the insert and the column set is version-sensitive; the exact NOT NULL set for image 17.6.1.166 was not enumerated.
  - Blind spot: Whether the CI and local images agree on that column set.
- **Decision**: FIXED — Phase 1 §4 renamed to "Grant baseline and fixture shape" with the column query added, criteria 1.3/1.7 added, Phase 2 contract points at the recorded insert, §6.1 contract and brief risks updated.

### F4 — Phase 5's "Automated" criteria all require a push and a CI log

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 Success Criteria; Progress 5.1–5.3
- **Detail**: All three Automated rows need a human — a pull request, a CI run, a job log. Per `references/progress-format.md`, `/10x-goal-implement` confines itself to Automated rows and never flips Manual ones, so an unattended run would stall or mis-mark all three.
- **Fix**: Move 5.1–5.3 to Manual and give Phase 5 one genuine Automated row — assert locally that `ci.yml` parses and the new step sits between `Start local Supabase` and `Configure secrets for build and preview`.
- **Decision**: FIXED — 5.1–5.5 moved to Manual with indices and titles preserved; new row 5.6 added as the Automated check.

### F5 — Two success criteria cannot fail

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 6 criterion 6.1; Phase 1 criterion 1.4
- **Detail**: 6.1 claimed `npm run lint` and `npm run format` pass over edited Markdown. Verified: `eslint.config.js` scopes every block to `js,jsx,ts,tsx` / `astro` / `scripts/**/*.mjs`, so ESLint never sees a `.md` file; and `"format": "prettier --write ."` writes rather than checks. Both halves unfalsifiable. 1.4 (`npm run build` against the relocated API) does not connect to Supabase, so it says almost nothing about the port move. Notable because the project's own Risk #7 is "a quality gate reports green having checked nothing," and `lessons.md` records an incident of that shape.
- **Fix**: Replace 6.1 with `npx prettier --check` on the edited files; drop 1.4, since 1.3's grant query already exercises the new port.
- **Decision**: FIXED — 6.1 rewritten with the reason ESLint does not apply stated inline; 1.4 removed and its index retired.

### F6 — Phase 1 names `psql` but no way to invoke it

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §4 and criterion 1.3; Phase 1 §3
- **Detail**: Criterion 1.3 assumed a local `psql`. This is a Windows machine, the repo installs no Postgres client, and the CLI exposes no `sql` subcommand. Adjacent: Phase 1 §3 told the implementer to edit `.dev.vars`, but the file is currently empty (CI regenerates it via `cp .env .dev.vars` at `ci.yml:47`).
- **Fix**: Name `docker exec supabase_db_<project> psql -U postgres -d postgres -c "<query>"`, since `supabase start` guarantees the container; soften the `.dev.vars` instruction.
- **Decision**: FIXED — both edits applied in Phase 1.

## Post-triage verification

Progress contract re-checked after all edits: every phase's Success Criteria maps one-to-one to its Progress rows (A3/M3, A3/M1, A5/M2, A3/M2, A1/M5, A3/M4), one `## Progress` heading, no checkboxes in phase bodies, no duplicate indices. Index 1.4 is retired, leaving a permitted gap.
