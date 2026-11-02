# Search Answer Completeness Implementation Plan

## Overview

Rollout Phase 4 of `context/foundation/test-plan.md`. Prove how `search_notes`'s
relevance gate behaves **inside** a date window — the one property of the
date-bound read that no existing test can observe — and correct the §6 cookbook
advice that would lead the next author into the same blind spot.

This phase writes tests and documentation only. No production code, no
migration, no behaviour change.

## Current State Analysis

The date-bound branch of `search_notes` ANDs the window predicate with a
relevance gate
(`supabase/migrations/20261027140907_recalibrate_search_notes_similarity_floor.sql:147-157`):

```sql
      and n.occurred_at >= p_date_start      -- :147
      and n.occurred_at < p_date_end         -- :148
      and (                                  -- :149  ANDed, not applied after
        n.fts @@ websearch_to_tsquery('simple', public.immutable_unaccent(p_query_text))
        or ( n.embedding is not null and p_query_embedding is not null
             and 1 - (n.embedding <=> p_query_embedding) >= p_similarity_threshold )
      )                                      -- :157
```

An in-window note that matches neither arm is dropped. Line 43 of the same file
nevertheless describes this branch's contract as "completeness", and uses that
description to justify the floor's value.

Existing coverage, and why none of it sees the gate:

- `tests/integration/notes-search.test.ts:104-131` proves both window edges —
  but gives every in-window note the identical `SEARCH_ONE_HOT_EMBEDDING`
  (`tests/integration/fixtures.ts:231`) and queries with that same vector, so
  cosine similarity is 1.0 for all of them. Its comment states the intent
  plainly: "only the date filter — never an accidental threshold miss — decides
  inclusion" (`:111-112`). Correct for an edge test; blind to the gate.
- `tests/integration/notes-search.test.ts:173-201` pins the floor from both
  sides using `gradedVector` — but passes **no date range**, so it runs on the
  RRF branch, not the date branch.
- `tests/integration/notes-search-window.test.ts:36-70` covers the window-only
  path end-to-end, which never reaches the RPC at all.

So the technique Phase 4 needs already exists; it has simply never been pointed
at a windowed query.

### Key Discoveries

- `tests/support/graded-vector.ts:40-45` — `gradedVector(s)` returns a unit
  vector at exactly cosine similarity `s` to `GRADED_QUERY_VECTOR`, accurate to
  ~1e-7 in `float4`. Already unit-tested at `tests/unit/graded-vector.test.ts`.
- `tests/integration/fixtures.ts:240-251` already exports
  `SEARCH_SIMILARITY_FLOOR` (0.434), `SEARCH_ABOVE_FLOOR_SIMILARITY` and
  `SEARCH_BELOW_FLOOR_SIMILARITY` (±0.02). No new constants are needed.
- `tests/integration/fixtures.ts:201-208` — each behavioural concern gets its
  own fixture child, precisely because a sibling suite asserts a complete id set
  on its child. A new concern therefore needs a new child, never an extra note
  on an existing one.
- `src/lib/search.ts:52-57` strips the period phrase before the text reaches the
  search arms; the window still comes from the raw question.
- `src/lib/date-range-parse.ts:181-185` resolves a bare month to its *most
  recent* occurrence, so a fixture pinned to a literal month expires. The
  existing `TODAY_WALL_CLOCK_DATE` pattern (`fixtures.ts:223`) is the project's
  answer to this.
- `tests/stubs/astro-env-server.ts` re-exports `OPENAI_API_KEY` from
  `process.env` — so `embedText` makes a **real API call** on any machine where
  that key is set. This is the central design constraint for Phase 2.

## Desired End State

Three new assertions exist, all green, all run by `npm run test:int`:

1. The date branch returns an in-window note that clears the similarity floor.
2. The date branch returns an in-window note with no embedding whose text
   matches — the full-text arm.
3. The date branch **omits** an in-window note that clears neither arm, and
   omits an out-of-window note that would clear the vector arm easily.

Plus one end-to-end assertion that a question combining a period phrase with a
search word reaches the database with the window applied and the phrase
stripped.

`context/foundation/test-plan.md` §6.7 no longer recommends a one-hot vector for
tests whose subject is the gate, §6.6 carries a Phase 4 note, and §3 Phase 4
reads `complete`.

Verify with: `npm run test:int` green, `npm run lint` green,
`npx astro check` reporting 0 errors, `npm run gate:scope` passing with a
re-derived count.

## What We're NOT Doing

- **Not changing the floor's behaviour.** The decision is to pin current
  behaviour, not to make the line-43 contract true. Bypassing the gate when a
  window is present would be a migration and would re-open the noise tradeoff
  the 2026-10-24 slice measured and settled.
- **Not asserting that every in-window note comes back.** That assertion is red
  today by design. The two true positives below the floor
  (`…similarity_floor.sql:53-57`, at 0.402 and 0.347) stay below it.
- **Not proving the no-cap property** with an 11+ note window. Out of scope by
  decision; the date branch has no `LIMIT` structurally (`…:135-158`).
- **Not testing the half-open window hazard** (one bound silently routing to the
  ranked branch). Unreachable from the application, since both bounds come from
  the same object at `src/lib/search.ts:78-79`.
- **Not re-testing window edges or boundary conversion.** Owned by
  `notes-search.test.ts:104-131` and Phase 3's unit tests respectively.
- **Not wiring a new CI gate.** `test:int` already runs these.
- **No model-as-judge.** Forbidden for this half by
  `context/foundation/test-plan.md:127`.

## Implementation Approach

Two new fixture children, two new test files, one documentation pass.

The core assertion is a 2×2 that isolates the AND at `:147-157`. One query, one
window, four notes on a dedicated child:

| Note | In window? | Clears a gate arm? | Expected |
| --- | --- | --- | --- |
| above-floor | yes | yes — vector, at 0.454 | **returned** |
| full-text-only | yes | yes — `fts`, no embedding at all | **returned** |
| below-floor | yes | no — 0.414, shares no word with the query | **omitted** |
| outside-window | no | yes — vector, at 0.454 | **omitted** |

Each cell fails for a distinct reason, so a regression reads as what it is:
drop the gate from the date branch and the below-floor note appears; drop the
window and the outside note appears; move the floor outside 0.430–0.438 and one
of the two floor notes flips.

Phase 2 is the same gate seen through the application. Its one hazard is the
API key: `embedText` is real whenever `OPENAI_API_KEY` is set. The fix is to
seed **both** end-to-end notes with no embedding. Then `n.embedding is not null`
at `:153` is false per-row and the vector arm cannot contribute regardless of
whether a real query embedding was produced — the test asserts the same ids on a
machine with a key and one without.

## Critical Implementation Details

**The end-to-end test must not assert `degraded`.** It varies with the presence
of `OPENAI_API_KEY` — `true` without, `false` with — while the returned ids do
not. Asserting it would reintroduce exactly the environment dependence the
no-embedding fixture removes. Degraded mode already has its own coverage at
`notes-search.test.ts:133-171`.

**Phase 2's question is a stripping regression test, not only a window test.**
`websearch_to_tsquery('simple', 'gorączka dzisiaj')` is `'gorączka' & 'dzisiaj'`.
The seeded note contains the first word and not the second, so if
`stripPeriodPhrase` ever stops removing the phrase, the conjunction matches
nothing and the test goes red. That is a feature of the chosen phrasing; keep
both words in the question.

**Fixture id-space.** `SEARCH_FIXTURE` owns digit `3`
(`FIXTURE_ID_PREFIX…0000300000…`, `fixtures.ts:201-208`). The two new children
extend that same space as `…0000300000c4` and `…0000300000c5`; they do not claim
a new suite digit, because both new files reuse `SEARCH_FIXTURE` exactly as
`notes-search-window.test.ts` does.

---

## Phase 1: Fixture and the gate-inside-window RPC test

### Overview

Add a dedicated child whose four notes isolate the AND of the window predicate
and the relevance gate, then assert the resulting id set through `.rpc()`.

### Changes Required:

#### 1. Fixture — a completeness child

**File**: `tests/integration/fixtures.ts`

**Intent**: Add a fourth child to `SEARCH_FIXTURE` carrying the 2×2 above, so
the gate and the window can each be shown to exclude a note for its own reason.
The existing children cannot be reused: `child`'s six notes are asserted as a
complete set by the date-window test, and `thresholdChild`'s two are asserted as
a complete set by the floor test.

**Contract**: Extend `SEARCH_IDS` with `completenessChild`
(`${FIXTURE_ID_PREFIX}0000300000c4`) and four note ids under
`${FIXTURE_ID_PREFIX}00003000c4NN`. Seed via the existing `NoteSeed` shape.
Reuse `SEARCH_ABOVE_FLOOR_SIMILARITY` / `SEARCH_BELOW_FLOOR_SIMILARITY` with
`gradedVector`; do not introduce new similarity constants. The in-window notes
share one fixed window distinct from the July window used by `child` — a month
with no other fixture notes — and the out-of-window note sits outside it.
The below-floor note's content must share no word with the query text used in
the test, or the full-text arm smuggles it back in and the assertion proves
nothing. The full-text-only note carries `embedding: undefined`.

Also update `SEARCH_FIXTURE`'s docstring, which currently reads "One account,
two children, eight notes" (`fixtures.ts:254`) and is already stale at three
children and eleven notes.

#### 2. The gate-inside-window assertion

**File**: `tests/integration/notes-search-completeness.test.ts` (new)

**Intent**: Call `search_notes` with a window and `GRADED_QUERY_VECTOR`, and
assert the exact id set, so the four exclusion reasons are pinned
independently.

**Contract**: Follow `notes-search.test.ts`'s shape — `beforeAll` teardown then
seed then `signInAsFixtureUser`, `afterAll` teardown, and a local
`callSearchNotes`-style helper passing `p_child_id`, `p_query_text`,
`p_query_embedding`, `p_date_start`, `p_date_end` and leaving `p_match_count`,
`p_rrf_k` and `p_similarity_threshold` at their defaults. Assert with
`toStrictEqual` on the sorted id set, then restate each exclusion as its own
`not.toContain`, matching the convention at `notes-search.test.ts:126-129` so a
failure names the reason rather than printing a set diff.

### Success Criteria:

#### Automated Verification:

- Integration tests pass: `npm run test:int`
- The new suite fails when the gate is removed: temporarily delete the
  `and ( … )` block at `…similarity_floor.sql:149-157` in a scratch copy of the
  migration, `npx supabase db reset`, confirm the below-floor note appears and
  the suite goes red, then restore
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check` reports 0 errors
- Scope gate passes with a re-derived count: `npm run gate:scope`

#### Manual Verification:

- The four notes' contents read as plausible Polish parent notes, consistent
  with the rest of `SEARCH_FIXTURE`
- The below-floor note's content shares no word with the query text, confirmed
  by reading both

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 2: End-to-end path test through `searchNotes`

### Overview

Assert that a question combining a period phrase with a search word reaches the
database with the window applied and the phrase stripped, through the real
application entry point rather than the RPC.

### Changes Required:

#### 1. Fixture — a today-scoped end-to-end child

**File**: `tests/integration/fixtures.ts`

**Intent**: Add a fifth child with two notes dated today in Warsaw, one
containing the search word and one not, so the application path can be exercised
with a window that does not expire. `windowChild` cannot be reused — its three
notes are asserted as a complete set by `notes-search-window.test.ts:38-69`.

**Contract**: `completenessE2eChild` at `${FIXTURE_ID_PREFIX}0000300000c5` with
two notes at `TODAY_WALL_CLOCK_DATE` plus a midday time, following the existing
`todayEarlyNote` / `todayLateNote` precedent (`fixtures.ts:341,347`).

**Both notes must be seeded with no embedding.** This is load-bearing, not
incidental: `tests/stubs/astro-env-server.ts` re-exports `OPENAI_API_KEY` from
`process.env`, so `embedText` performs a real API call wherever that key is set.
With `embedding` absent, `n.embedding is not null` at
`…similarity_floor.sql:153` is false for both rows, the vector arm cannot
contribute, and the assertion is identical with or without a key.

#### 2. The end-to-end assertion

**File**: `tests/integration/notes-search-completeness.test.ts`

**Intent**: Call `searchNotes` from `@/lib/search` with a question carrying both
a period phrase and a search word, and assert only the text-matching in-window
note returns.

**Contract**: `searchNotes(authenticatedClient, completenessE2eChild, "gorączka dzisiaj")`.
Assert the returned ids are exactly the matching note. Do **not** assert
`degraded` — it varies with `OPENAI_API_KEY` while the ids do not. Note in a
comment that this is the first test to import `@/lib/search` rather than call
`.rpc()`, which is what `vitest.config.ts`'s `astro:env/server` alias exists for.

### Success Criteria:

#### Automated Verification:

- Integration tests pass: `npm run test:int`
- The suite passes identically with and without a key: run `npm run test:int`
  once with `OPENAI_API_KEY` unset and once with it set, confirming the same
  result and that no API call is billed in the second run
- The test is a stripping regression guard: temporarily make
  `stripPeriodPhrase` return its input unchanged, confirm the suite goes red,
  then restore
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check` reports 0 errors
- Scope gate passes: `npm run gate:scope`

#### Manual Verification:

- A run that straddles Warsaw midnight is understood to be the one uncovered
  case, consistent with the existing note at `fixtures.ts:219-222`

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 3: Cookbook update and rollout close

### Overview

Correct the §6.7 guidance that would send the next author to a one-hot vector
for a gate test, record the phase in §6.6, and close the rollout row.

### Changes Required:

#### 1. §6.7 — split the synthetic-vector advice

**File**: `context/foundation/test-plan.md`

**Intent**: §6.7 currently tells the next author to seed a one-hot vector,
praising it because similarity 1.0 "trivially clears `search_notes`'s similarity
threshold regardless of how that default is later tuned" (`:882-889`). That
property is what makes it right for a window-edge test and disqualifying for a
test whose subject is the threshold. Make the choice conditional on what the
test is isolating.

**Contract**: Amend the section at `context/foundation/test-plan.md:874-889`.
Keep the existing rule — seed a synthetic vector, call the SQL function through
`.rpc()`, never mock the client. Add the branch: one-hot when the vector must be
neutral so another parameter decides; `gradedVector(s)` from
`tests/support/graded-vector.ts` when the threshold itself is the subject. Name
`tests/integration/notes-search-completeness.test.ts` as the reference for the
second case. Record the Phase 2 exception too — the one test that imports
`@/lib/search` instead, and the no-embedding fixture that makes it safe without
an API key.

#### 2. §6.6 — the Phase 4 note

**File**: `context/foundation/test-plan.md`

**Intent**: Add the per-rollout-phase entry, matching the three existing ones.

**Contract**: A `**§3 Phase 4 — …**` block in §6.6 (`:721`) recording the
finding this phase pinned: the window is ANDed with the relevance gate, so
"completeness" on the date branch means complete *among relevance-passing
notes*. Note the disagreement with `…similarity_floor.sql:43`, and that the
decision was to pin current behaviour rather than change it.

#### 3. §3 — close the row

**File**: `context/foundation/test-plan.md`

**Intent**: Mark the rollout phase finished.

**Contract**: §3 row 4 Status `researched` → `complete`. Bump the header's
`Last updated:` line.

### Success Criteria:

#### Automated Verification:

- Full test suite passes: `npm test`
- Linting passes: `npm run lint`
- All pre-build gates pass: `npm run gates:pre`

#### Manual Verification:

- §6.7 read end-to-end does not contradict itself — the one-hot rationale and
  the graded-vector rationale each state when they apply
- A reader who has not seen this change can tell from §6.6 why a period question
  may return fewer notes than the window holds
- §3 row 4 reads `complete` and every other row is unchanged

---

## Testing Strategy

### Integration Tests:

- The 2×2 gate matrix on `completenessChild`: in-window-above-floor and
  in-window-full-text-only returned; in-window-below-floor and
  out-of-window-above-floor omitted.
- The application path on `completenessE2eChild`: `"gorączka dzisiaj"` returns
  only the text-matching note dated today.

### Unit Tests:

None. The gate lives in SQL and cannot be reached from a unit test. The
conversion half it depends on is already covered by
`tests/unit/date-range-parse.test.ts` and `tests/unit/wall-clock.test.ts` from
rollout Phase 3.

### Manual Testing Steps:

1. `npx supabase start`, then `npm run test:int` — confirm green.
2. Unset `OPENAI_API_KEY` and re-run; confirm the same result and no billed call.
3. Temporarily remove the gate block at `…similarity_floor.sql:149-157` in a
   scratch migration copy, `npx supabase db reset`, re-run: the below-floor note
   should now appear and Phase 1's suite should go red. Restore.
4. Read §6.7 start to finish and confirm the two vector choices do not conflict.

## Performance Considerations

Six new seeded rows across two children. `SEARCH_FIXTURE` goes from 11 notes to
17; teardown deletes by explicit id and never truncates
(`fixtures.ts:423-454`), so the cost is one additional insert batch per search
suite run. `--no-file-parallelism` already serializes these files.

## Migration Notes

None. No migration is written or altered by this plan. Step 3 of Manual Testing
edits a scratch copy only and restores it.

## References

- Research: `context/changes/testing-search-completeness/research.md`
- Risk #5 and its response guidance: `context/foundation/test-plan.md:69`
- The gate under test:
  `supabase/migrations/20261027140907_recalibrate_search_notes_similarity_floor.sql:147-157`
- The contract it disagrees with: same file, `:43`
- Graded-vector technique: `tests/integration/notes-search.test.ts:173-201`
- Suite shape to copy: `tests/integration/notes-search.test.ts:46-86`
- Fixture conventions: `tests/integration/fixtures.ts:201-208, 270-357`
- Prior slice that hit this failure in production:
  `context/archive/2026-10-23-note-search-precision/frame.md` §Root Cause

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fixture and the gate-inside-window RPC test

#### Automated

- [x] 1.1 Integration tests pass: `npm run test:int` — 9733183
- [x] 1.2 The new suite fails when the gate is removed, then passes again once restored — 9733183
- [x] 1.3 Linting passes: `npm run lint` — 9733183
- [x] 1.4 Type checking passes: `npx astro check` reports 0 errors — 9733183
- [x] 1.5 Scope gate passes with a re-derived count: `npm run gate:scope` — 9733183

#### Manual

- [x] 1.6 The four notes' contents read as plausible Polish parent notes — 9733183
- [x] 1.7 The below-floor note's content shares no word with the query text — 9733183

### Phase 2: End-to-end path test through `searchNotes`

#### Automated

- [x] 2.1 Integration tests pass: `npm run test:int` — 8851fbf
- [x] 2.2 The suite passes identically with and without `OPENAI_API_KEY`, with no billed call — 8851fbf
- [x] 2.3 The test is a stripping regression guard: it goes red when `stripPeriodPhrase` is neutered, then passes once restored — 8851fbf
- [x] 2.4 Linting passes: `npm run lint` — 8851fbf
- [x] 2.5 Type checking passes: `npx astro check` reports 0 errors — 8851fbf
- [x] 2.6 Scope gate passes: `npm run gate:scope` — 8851fbf

#### Manual

- [x] 2.7 The Warsaw-midnight straddle is understood as the one uncovered case — 8851fbf

### Phase 3: Cookbook update and rollout close

#### Automated

- [x] 3.1 Full test suite passes: `npm test` — 0089992
- [x] 3.2 Linting passes: `npm run lint` — 0089992
- [x] 3.3 All pre-build gates pass: `npm run gates:pre` — 0089992

#### Manual

- [x] 3.4 §6.7 read end-to-end does not contradict itself — 0089992
- [x] 3.5 A fresh reader can tell from §6.6 why a period question may return fewer notes than the window holds — 0089992
- [x] 3.6 §3 row 4 reads `complete` and every other row is unchanged — 0089992
