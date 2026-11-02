---
date: 2026-10-29T12:33:38+01:00
researcher: marcin.zegunia2
git_commit: 0fd065890006ebb61ce1882287cd8d79a81b3d7b
branch: master
repository: dziennik-dziecka
topic: "Grounding rollout Phase 4 — search answer completeness within a period window (Risk #5, ranking half)"
tags: [research, codebase, search_notes, date-window, similarity-floor, testing]
status: complete
last_updated: 2026-10-29
last_updated_by: marcin.zegunia2
---

# Research: Search answer completeness within a period window

**Date**: 2026-10-29T12:33:38+01:00
**Researcher**: marcin.zegunia2
**Git Commit**: 0fd065890006ebb61ce1882287cd8d79a81b3d7b (working tree dirty: `context/foundation/test-plan.md` modified, this change folder untracked)
**Branch**: master
**Repository**: dziennik-dziecka

## Research Question

Ground rollout Phase 4 of `context/foundation/test-plan.md`. Verify Risk #5
(ranking half): *a question bounded to a period returns every note whose event
time falls inside it and none outside it, with the boundary resolved in the
parent's wall clock.* Establish where completeness can actually break, what is
already tested, and what the cheapest useful new test layer is.

## Summary

**The risk is real, and it is not where the test plan assumed.** Phase 4's row
describes the danger as a *truncated subset* — "a ranking returns a plausible
subset" (`context/foundation/test-plan.md:69`). On the date-bound branch that
specific failure is structurally impossible: `date_range_candidates` has no
`LIMIT`, and `p_match_count` never reaches it. The real exposure is a different
mechanism with the same user-visible symptom — a **relevance gate ANDed with the
window**, which silently removes in-window notes.

Four findings, in the order they matter:

1. **The window is ANDed with a relevance gate, not applied after it.** In
   `supabase/migrations/20261027140907_recalibrate_search_notes_similarity_floor.sql:147-157`,
   a note inside the window survives only if it also matches the full-text arm
   *or* clears `p_similarity_threshold` (default `0.434`). An in-window note
   that matches neither is dropped. Completeness on this branch is complete
   *among relevance-passing notes*, not complete within the window.

2. **The same file asserts the opposite contract.** Line 43 justifies the
   floor's value with "the date-bound branch's contract is completeness." That
   sentence is used as an argument for favouring recall; the SQL 100 lines below
   does not implement it unconditionally. This is a documented contract that the
   code does not keep — the most valuable thing a Phase 4 test can pin down.

3. **Two in-window notes are known to sit below the floor, on purpose.**
   `…similarity_floor.sql:53-57` records `Czy uderzył się w głowę?` at 0.402 and
   `Co z uchem?` at 0.347 as true positives left below 0.434 knowingly. For a
   "how often … w lipcu" question, each such note is a silent undercount.

4. **The existing date test deliberately neutralizes the gate it would need to
   catch this.** `tests/integration/notes-search.test.ts:104-131` already proves
   both window edges — but every in-window note carries the identical
   `SEARCH_ONE_HOT_EMBEDDING` (`tests/integration/fixtures.ts:231`, applied at
   `:285,292,299,306,313`) and the query uses that same vector, so cosine
   similarity is 1.0 for all of them and the floor can never decide. Its own
   comment says so: "only the date filter — never an accidental threshold miss —
   decides inclusion" (`notes-search.test.ts:111-112`). That was the right call
   for an edge test and is exactly the hole Phase 4 fills.

**Correction to this change's `change.md`:** the claim "nothing automated guards
it today" is wrong and should be narrowed. Automated date-window coverage exists
(items 1–3 under *Existing coverage* below). Only the interaction of the
relevance gate with the window is unguarded.

**Cheapest useful layer:** integration, against the local Supabase stack,
calling the RPC directly — the harness already exists. No new tool, runner, or
dependency is needed. A unit test cannot reach this (the gate is in SQL); e2e
would be more expensive and less precise.

## Detailed Findings

### The two read paths for a period question

A period-bounded question takes one of two paths, decided at
`src/lib/search.ts:59`:

| Path | Trigger | Read | Relevance gate? | Row cap? |
| --- | --- | --- | --- | --- |
| **A — window only** | stripped text has no letters/digits *and* a window parsed | `listNotesInRange`, `src/lib/notes.ts:58-78` | **No** | **No** |
| **B — window + text** | anything else with a window | `search_notes` date branch | **Yes** | No |

Path A is genuinely complete: `.gte("occurred_at", range.start).lt("occurred_at", range.end)`
with no `.limit` or `.range` (`src/lib/notes.ts:58-78`). It exists *because* the
date branch is gated — the comment at `src/lib/search.ts:60-65` states that
routing a bare `w lipcu` through the RPC "would answer it with nothing," since a
blank text query matches no row and a null embedding switches the vector arm
off.

Path B is the exposed one, and it is the path any "how often" question takes,
because `jak często` is not a period phrase — only the `w lipcu` part is
stripped, leaving `jak często …` as live query text.

### The relevance gate (decisive evidence)

`supabase/migrations/20261027140907_recalibrate_search_notes_similarity_floor.sql:135-158`,
read directly:

```sql
  date_range_candidates as (
    ...
    where n.child_id = p_child_id
      and n.deleted_at is null
      and p_date_start is not null
      and p_date_end is not null
      and n.occurred_at >= p_date_start      -- :147  inclusive start
      and n.occurred_at < p_date_end         -- :148  exclusive end
      and (                                  -- :149  ANDed with the window
        n.fts @@ websearch_to_tsquery('simple', public.immutable_unaccent(p_query_text))
        or (
          n.embedding is not null
          and p_query_embedding is not null
          and 1 - (n.embedding <=> p_query_embedding) >= p_similarity_threshold
        )
      )                                      -- :157
  ),
```

There is no `LIMIT` anywhere in this CTE (`:135-158`). The two caps that exist —
`limit greatest(p_match_count * 10, 100)` at `:115` and `limit p_match_count` at
`:133` — sit inside the RRF-only CTEs, which `:131` (`where p_date_start is null
or p_date_end is null`) empties whenever both bounds are supplied.

Four ways an in-window note fails the gate at `:149-157`:

- its `embedding` is null (`:153`) and the full-text arm misses;
- `p_query_embedding` is null (`:154`) and the full-text arm misses — the
  degraded mode, which happens whenever `OPENAI_API_KEY` is absent or the
  embedding call fails (`src/lib/search.ts:72, 93`);
- cosine similarity falls below 0.434 (`:155`) — the two measured cases at
  `…similarity_floor.sql:53-57`;
- the full-text arm cannot rescue an inflected Polish word, because `fts` uses
  the `'simple'` configuration with no stemming
  (`supabase/migrations/20261017103455_add_notes_search.sql:28-31`).

### Half-open window: a latent contract hazard, not a live bug

Passing only one bound sends the call to the **RRF branch**, where the window is
not applied at all and `limit p_match_count` (default 10) does truncate
(`:131, :133`). The application cannot trigger this today: both parameters come
from the same object, so they are null together or set together
(`src/lib/search.ts:78-79`, `p_date_start: dateRange?.start ?? null`). Any other
caller of the RPC — a pgTAP file, a future script, a test — can. Worth one
assertion; not worth a sub-phase.

### Boundary conversion is already correct and already covered

The only timezone source is hardcoded `Europe/Warsaw`
(`src/lib/wall-clock.ts:16-22`), consumed once at
`src/lib/date-range-parse.ts:138`. `occurred_at` is `timestamp` **without** time
zone (`supabase/migrations/20260927205447_create_notes.sql:10`), and the date
parameters are the same type, so no conversion happens in the comparison. The
window is half-open: inclusive start, exclusive end
(`date-range-parse.ts` returns `{start, end}` with exclusive `end`; SQL `:147-148`
matches). Phase 3 covered the conversion in `tests/unit/wall-clock.test.ts` and
`tests/unit/date-range-parse.test.ts` (361 lines, every call with an injected
`now`). **Phase 4 should not re-test this.**

### Existing coverage (what Phase 4 must not duplicate)

1. `tests/integration/notes-search.test.ts:104-131` — both window edges, exact
   id set, with `not.toContain` on the three excluded notes. Gate neutralized by
   the shared one-hot vector.
2. `tests/integration/notes-search.test.ts:147-171` — degraded mode (null
   embedding) inside a window, full-text arm only, expects `[nearNote]`.
3. `tests/integration/notes-search-window.test.ts:36-70` — Path A end-to-end
   through the real `searchNotes` with "dzisiaj", asserting ids, ascending
   order, and `degraded === false`.
4. `tests/integration/notes-search.test.ts:173-201` — the similarity floor
   asserted from both sides, using `gradedVector` at 0.434 ± 0.02 — but **with no
   date range**, so on the RRF branch only.

Item 4 is the key observation for planning: the graded-vector technique that
Phase 4 needs **already exists** (`tests/support/graded-vector.ts`, with its own
unit test at `tests/unit/graded-vector.test.ts`). Phase 4 is largely a matter of
combining the item-4 technique with the item-1 window, which no current test
does.

### Test harness facts a plan can rely on

- Real local Supabase over HTTP; no mocks. Env vars `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, read at
  `tests/integration/fixtures.ts:28-30`, failing hard when absent (`:32-53`).
- Seeding by service-role client, queries under test by an RLS-bound anon client
  signed in as the fixture user (`fixtures.ts:67-70, 468-478`).
- `SEARCH_FIXTURE` (`fixtures.ts:270-357`): 1 user, 3 children, 11 notes.
  Reserved id prefix `f1c70000-0000-0000-0000-`, enforced by `assertReserved`
  (`:362-370`). Teardown deletes by explicit id and never truncates (`:423-454`).
- `test:int` runs `--no-file-parallelism` (`package.json:24`) because the two
  search suites share `SEARCH_FIXTURE`.
- The RPC is callable directly with all 8 parameters; the existing helper
  `callSearchNotes` (`notes-search.test.ts:67-86`) passes 5 and defaults
  `p_match_count` 10, `p_rrf_k` 50, `p_similarity_threshold` 0.434.
- **Testability constraint:** `searchNotes` takes no clock parameter
  (`src/lib/search.ts:47-51`), so period phrases resolve against the real clock.
  Any Path-B end-to-end test must either use fixed-date notes with an absolute
  month phrase, or the existing `TODAY_WALL_CLOCK_DATE` trick
  (`fixtures.ts:223`), which is evaluated once at module import.

### The oracle rule, restated

`context/foundation/test-plan.md:69` and `:453`: the expected set comes from the
fixture, never from re-running `search_notes`. `:551-552` adds: assert on **ids,
not counts** — "a count passes while the wrong row is returned." Both apply
directly here, and the second one bites harder than usual for a completeness
test, where counting is the tempting shortcut.

## Code References

- `supabase/migrations/20261027140907_recalibrate_search_notes_similarity_floor.sql:147-157` — the window AND the relevance gate; the decisive lines
- `…_recalibrate_search_notes_similarity_floor.sql:43` — "the date-bound branch's contract is completeness"
- `…_recalibrate_search_notes_similarity_floor.sql:53-57` — the two true positives knowingly left below 0.434
- `…_recalibrate_search_notes_similarity_floor.sql:131-133` — the RRF branch's `limit p_match_count`, unreachable with both bounds set
- `supabase/migrations/20260927205447_create_notes.sql:10` — `occurred_at timestamp not null`
- `supabase/migrations/20261017103455_add_notes_search.sql:28-31` — `'simple'` fts config, no Polish stemming
- `src/lib/search.ts:59-67` — the Path A / Path B fork
- `src/lib/search.ts:74-80` — the RPC call; no limit or threshold passed
- `src/lib/notes.ts:58-78` — `listNotesInRange`, ungated and uncapped
- `src/lib/wall-clock.ts:16-22` — the only timezone source, hardcoded Europe/Warsaw
- `tests/integration/notes-search.test.ts:104-131` — existing edge test, gate neutralized
- `tests/integration/notes-search.test.ts:173-201` — existing floor test, RRF branch only
- `tests/integration/fixtures.ts:231` — `SEARCH_ONE_HOT_EMBEDDING`
- `tests/support/graded-vector.ts` — `gradedVector(sim)`, the technique Phase 4 needs

## Architecture Insights

- **Completeness here is a two-word phrase hiding two properties.** "No
  truncation" is guaranteed by construction on the date branch. "No filtering"
  is not guaranteed at all. The project's documents use the single word for
  both, which is how the gap survived three slices.
- **The floor is a product decision, not a defect.** Lowering it to 0.40 would
  recover one of the two known misses and raise admitted noise from 13 to 32
  (`…similarity_floor.sql:53-57` and
  `context/archive/2026-10-24-note-search-similarity-floor/change.md:272-285`).
  A Phase 4 test must therefore pin *the behaviour as specified*, not assert
  that every in-window note comes back — that assertion would be red today by
  design.
- **The PRD removes the escape hatch.** `context/foundation/prd.md:85`: "No
  synthesized text summaries — NL-query answers are a list of matching notes,
  not a generated summary." There is no computed count to be wrong; the parent
  counts the returned list. The completeness of that list *is* the count's
  correctness, which is what makes Risk #5's "a wrong count reads as
  authoritative to a doctor" concrete rather than rhetorical.

## Historical Context (from prior changes)

- `context/archive/2026-10-11-testing-runner-and-read-boundaries/plan.md:121-126` —
  Phase 3 explicitly excluded the window-completeness test ("No subject exists
  in production code, and roadmap S-03 owns the read") and refused to leave a
  skipped placeholder.
- `context/archive/2026-10-16-note-search-by-meaning/plan.md:121-124` — S-03
  decided "the date window is a hard filter … and *no* top-N truncation applies
  inside it," while in the same breath gating completeness on "every row whose
  combined relevance clears a fixed similarity threshold." Both halves of the
  present ambiguity are in one paragraph.
- `context/archive/2026-10-16-note-search-by-meaning/reviews/impl-review.md:226-228` —
  records the completeness gap as a "plan-sanctioned deferral" to test-plan
  Phase 4.
- **A deferral loop, now closed.** Phase 3 and `roadmap.md:87` say S-03 owns the
  completeness test; S-03's plan (`:91-94`) and its impl-review (`:226-228`) say
  test-plan Phase 4 owns it. Each deferred to the other. This change is where it
  lands.
- `context/archive/2026-10-23-note-search-precision/frame.md` §Root Cause — the
  refutation that parked S-04 was itself a completeness failure: "the date-bound
  branch exists to guarantee completeness … It returns zero," for
  `Czy miał gorączkę w lipcu?` at 0.491 against the then-floor of 0.5. **The
  failure Phase 4 would catch has already happened once in this project.**
- `context/foundation/test-plan.md:127` — model-as-judge is forbidden for this
  half: "never for the completeness or count half of a period question — that
  half has a deterministic oracle in the fixture."

## Related Research

- `context/archive/2026-09-26-fr-006-research/` — FR-006 search research (not
  re-read for this question).
- No prior `research.md` exists for the window-completeness question
  specifically; the three archived search slices carry the decisions instead.

## Open Questions

1. **Product, blocking the plan's oracle:** should a period-bounded question
   bypass the similarity floor? Three defensible answers, and the test differs
   for each:
   - *(a) No — current behaviour is correct.* Phase 4 asserts the gate applies
     inside the window, documenting it as intended. Cheapest; locks in the two
     known misses.
   - *(b) Yes for window-only, no for window+text* — which is what the code does
     today via Path A. Phase 4 asserts the split explicitly.
   - *(c) Yes whenever a window is present* — a behaviour change (pass a
     disabling `p_similarity_threshold`, or drop the gate from
     `date_range_candidates`), making the `:43` comment true. This is a
     migration, not just a test, and exceeds Phase 4's stated scope.
2. Is the asc/desc mismatch between `src/lib/notes.ts:31` (descending) and the
   date branch's ascending order (`…similarity_floor.sql:170`) still live? Noted
   as latent in the S-04 frame and excluded from the floor slice
   (`…similarity_floor/plan.md:48`); not traced here.
3. The bare-month-name finding F6 (a bare month always resolving to the current
   year) was reported in S-03's impl-review `:273-281`; its outcome was not
   traced. `src/lib/date-range-parse.ts:181-185` now reads
   `const resolvedYear = monthNum > month ? year - 1 : year;`, which appears to
   resolve to the most recent occurrence rather than the current year — the
   finding looks addressed, but this was not confirmed against the review's
   resolution.

**Gaps in this research:** nothing was executed — no test run, no `supabase
start`, no query against a live database, so every behavioural claim is read
from source rather than observed. The three earlier `search_notes` migrations
(M3–M5) were read by targeted grep only, relying on the M6 header's statement at
`:65-68` that everything but the one default is unchanged.
