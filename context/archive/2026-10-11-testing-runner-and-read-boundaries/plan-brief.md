# A Runner, and the Read Boundaries Nothing Can Reach Today — Plan Brief

> Full plan: `context/changes/testing-runner-and-read-boundaries/plan.md`

## What & Why

Rollout phase 3 of `context/foundation/test-plan.md`. This project has no
JavaScript test runner at all — the only things asserting anything are an
in-repo HTTP walk and database policy tests. That leaves a specific gap: the
protections that live in the **query** rather than in a database policy have no
layer below them, and Phase 1 proved it by writing them down as
characterizations of what the policy layer *does not* do. This phase stands up
the runner and closes those boundaries.

## Starting Point

`supabase/tests/02_notes_characterization.sql` records two facts and hands both
forward by name: an unfiltered select returns notes from **all** of an account's
children (the per-child filter is a query property at `src/lib/notes.ts:28`),
and a soft-deleted note **is** returned to its own owner (`deleted_at` appears
in no policy predicate; exclusion happens at `src/lib/notes.ts:29`). Risk #4's
column half is similar — no row-level policy restricts which *columns* an update
may write. Meanwhile `src/lib/wall-clock.ts` holds the entire wall-clock
conversion surface, untested, and `warsawWallClock` exists in three places.

## Desired End State

Four protections hold that nothing asserted before: a parent's own soft-deleted
note stays out of their list; one child's notes stay out of the other child's;
an edit changes the note's text and nothing else on the row; and the wall clock
a note is stored under is the parent's wall clock, including across both of
Poland's daylight-saving transitions. Unit tests run in Cloudflare's blocking
build seat; integration tests run in CI. §6 of the test plan stops saying "TBD"
and becomes the real answer to "how do I add a test for X in this project?"

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Risk #5's window half | Hand the period-bounded read to roadmap S-03 | `listNotes` has no date filter and no caller passes a range — the read belongs to S-03, so testing it here would mean inventing a speculative API first | Plan |
| Window test as a skipped spec | Rejected | A skipped test reports green, which would let §5's new gate gate over nothing — Risk #7 wearing Risk #5's clothes | Plan |
| Test layout | `tests/unit/` and `tests/integration/`, selected by path | Mirrors the existing `supabase/tests/` precedent, and the unit/integration split is exactly what CI must act on — a path is the cheapest selector | Plan |
| Integration auth | Seed with the service-role key, read through an authenticated anon session | Mirrors `02_notes_characterization.sql` — fixed readable fixture ids, and the expected set comes from the fixture, which is what §2 demands for Risk #5 | Plan |
| Fixture isolation | Reserved UUIDs, deleted by id before and after; never truncate | Idempotent on a dirty local database and on a failed previous run, and no real note is ever at risk | Plan |
| Runner gate-integrity | A test-count floor added to `scripts/gate-scope.mjs`, flooring `numPassedTests` | §6.6's lesson is to assert a quantity, not the enforcing layer's behaviour; a `.todo` conversion still counts in `numTotalTests`, so the total is the wrong number to floor | Plan |
| Wall-clock test depth | Both Europe/Warsaw DST transitions | A DST instant is where wall-clock conversion actually breaks, and §7 excludes multi-*zone* work, not a second offset within the one zone | Plan |
| The three `warsawWallClock` copies | Extract `scripts/lib/wall-clock.mjs`, pin it by test; leave `AddNoteForm`'s alone | The smoke copy is a true duplicate worth collapsing; `localNow()` reads the *device* zone on purpose, so it is a semantic difference, not drift | Plan |
| Risk #4's column assertion | Full-row diff against a two-name allowlist | A column added to `notes` later is covered automatically — §6.6's enumerate-then-invert pattern, applied to columns instead of routes | Plan |
| Runner configuration | `getViteConfig()` per §4, with a pre-decided fallback | §4 already named it; nothing under test imports `astro:env/server`, so a plain Vitest config plus an explicit `@/` alias loses nothing if the Cloudflare adapter interferes | Plan |

## Scope

**In scope:**

- Vitest `^5.0.3` (peer-compatible with the installed Vite 8.3.0), `vitest.config.ts`, `test:unit` / `test:int` scripts
- Unit tests: `formatWallClock`, `WALL_CLOCK_RE`, `warsawWallClock` across both DST transitions, the future-tolerance predicate, and TS-vs-`.mjs` parity
- Integration tests: soft-delete exclusion, cross-child scoping, edit column-scope
- Two small production extractions, each covered by an existing smoke step: `scripts/lib/wall-clock.mjs`, and the future-tolerance predicate out of the route handler
- A test-count floor in `gate-scope.mjs`; both CI jobs wired; §5's gate row flipped with its asymmetry stated
- `test-plan.md` §3, §4, §5, §6.2, §6.3, §6.6, §7, §8; `roadmap.md` S-03's Risk line

**Out of scope:**

- The period-bounded read and its window-completeness test (S-03 owns both)
- Deduplicating `localNow()` in `AddNoteForm.tsx` — recorded in §7 instead
- Rendering `.astro` components or React islands; UI snapshots; a browser driver
- Replacing or shrinking `scripts/smoke.mjs`; testing `listNotes`' ordering
- Wiring the post-edit hook (owned outside this plan, and recommended-not-required by design)

## Architecture / Approach

```
tests/unit/        → pure logic, no services     → ci job + gate:scope (blocking seat)
tests/integration/ → local Supabase, RLS live    → smoke job only (no DB in the blocking seat)

seed (service role, RLS bypassed) → read (anon client, signed in) → assert against the fixture
```

Fixtures are seeded with the service-role key and read back through an
authenticated session, so the assertion exercises the query with RLS live while
the expected set comes from the fixture rather than from re-running the query
under test. The runner lands on pure string behaviour first so that the runner,
the path alias and the two existing scope gates are known to agree before
anything harder is attempted.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Contract correction, then the runner | §3 row narrowed and S-03 given the obligation; Vitest installed and proven on `formatWallClock` / `WALL_CLOCK_RE` | `getViteConfig()` may drag the Cloudflare adapter into a node test run — fallback is pre-decided |
| 2. The wall-clock boundary | `scripts/lib/wall-clock.mjs` shared with the smoke walk; DST, parity and tolerance tests | Editing `smoke.mjs` could stop the walk from executing; `EXPECTED_STEPS` does not catch that, so the output must be read |
| 3. Integration harness and three boundaries | Reserved-UUID fixtures; soft-delete, cross-child and column-scope assertions | A test that cannot fail covers nothing — each assertion is mutation-checked by hand |
| 4. Seat the suite in the gates | Test-count floor; both CI jobs wired; §5 row flipped | Claiming "required — wired" for a half that cannot block a deploy |
| 5. Close the contract | §6.2, §6.3, §6.6, §7, §4 and the status cell written for real | Writing a restatement of this plan instead of what the phase found |

**Prerequisites:** Local Supabase CLI and a runnable local stack (`supabase start`) for phases 3-5; nothing else. Phases 1, 2 and 4's floor work need no database. Roadmap S-03 need not ship first — this phase hands work *to* it.

**Estimated effort:** ~3-4 sessions across 5 phases; phases 2 and 5 are the longest, phase 4 the shortest.

## Open Risks & Assumptions

- **`getViteConfig()` × the Cloudflare adapter is unverified.** Vitest is not installed, so it could not be tried during planning. The fallback (plain Vitest config plus an explicit `@/` alias) is documented and loses nothing, but phase 1 may spend a cycle discovering which route it is on.
- **Editing `scripts/smoke.mjs` touches the only thing currently asserting anything.** Its walk runs at top level and its own `EXPECTED_STEPS = 38` floor does not protect against the walk failing to execute at all — hence the explicit "read the output, don't exit-check it" criterion.
- **Only the unit half reaches the blocking seat.** Cloudflare's build command has no database, so integration tests are CI-only, and CI is advisory on this repository (no branch protection on the free plan — §6.6). §5 must say so rather than imply both halves gate.
- **DST assertions pin Poland's current transition rules.** An EU rule change would need the fixtures revisited; the alternative was leaving the function that writes `occurred_at` untested.
- **Risk #5's window half stays uncovered until S-03 ships.** Accepted deliberately: the obligation is recorded on S-03's Risk line, not left as an intention.

## Success Criteria (Summary)

- A parent cannot see a note that is not theirs *by child* and cannot see their own deleted note — and that now holds at the layer where the filter actually lives, not just over HTTP
- A note the parent saved cannot be silently altered beyond its text, proven by a diff that covers columns nobody has added yet
- "How do I add a test for this?" has an answer in `test-plan.md` §6 that a reader can follow without asking anyone
