<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Note search by meaning

- **Plan**: context/changes/note-search-by-meaning/plan.md
- **Scope**: Full plan (Phases 1–5 of 5)
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-19
- **Verdict**: REJECTED
- **Findings**: 2 critical, 3 warnings, 5 observations

## Triage outcome (2026-10-20)

All 10 findings decided and fixed. The REJECTED verdict above describes the state at review time
and is left as the historical record.

| Finding | Decision | Verified? |
|---|---|---|
| F1 threshold scale | Fixed — new migration `20261019215004` | ✅ proven on live DB + test:db 26/26 |
| F2 fetch timeout | Fixed — `AbortSignal.timeout` on both call sites | ✅ abort probe: null in 1016ms |
| F3 stale gate floor | Fixed — floor re-derived to 72 | ✅ gate:scope passes |
| F4 missing coverage | Fixed — new regression test | ✅ passes on fixed fn, **fails on pre-fix fn** (negative control) |
| F5 backfill 1000-row cap | Fixed — paging helper | ⚠️ lint/syntax only, not run end to end |
| F6 month → future year | Fixed — most-recent-occurrence | ✅ 72 unit tests pass |
| F7 RRF relevance floor | Fixed — new migration `20261020200647` | ⚠️ applied; suites pass, but 0.5 still unmeasured |
| F8 HNSW unused | Fixed — same migration | ✅ shape proven index-eligible (forced plan) |
| F9 .gitignore no-op | Fixed — `git rm --cached` | ✅ `git check-ignore` confirms |
| F10 window not shown | Fixed — `formatDateRange` + render | ✅ 4 unit tests, astro check clean |

**Landed as two commits, deliberately.** F1–F6, F9 and F10 are all verified and ship together.
F7+F8 ship alone in a second commit so the unvalidated relevance floor can be held back, reverted
or retuned without disturbing F1 — which is a real user-facing bug fix the hosted project still
has. The integration suite's header comment moves with F7, because it documents the absence of the
floor and is accurate right up until that migration lands.

**Verification completed after the Docker restart:** both migrations applied with
`supabase migration up --local`; `npm run test:db` 26/26 pass; `npm run test:int` 10/10 pass;
lint clean; `astro check` 0 errors; 72 unit tests; all 3 scope gates pass.

**Still outstanding — carry these forward, they are not closed:**

1. **Validate F7's 0.5 similarity floor against real notes before deploying.** It is applied
   locally and the fixture suites pass, but the fixtures use a synthetic one-hot vector whose
   self-similarity is 1.0, so they clear any threshold trivially and prove nothing about the
   number. Nothing in this repo has measured a real `text-embedding-3-small` similarity on short
   Polish text. This is the one change from this review that can make the feature worse.
2. **`scripts/backfill-embeddings.mjs` has not been run end to end** since the paging rewrite — it
   needs a real `OPENAI_API_KEY`. Phase 4's automated criterion ("exits 0 against a local seeded
   database") therefore no longer has a fresh observation behind it.
3. **`npm run gates` still cannot complete locally** — `gate:drift` requires
   `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` and `SUPABASE_ACCESS_TOKEN`, and fails rather
   than skips by deliberate design. Every other link passes.
4. **Both new migrations are local-only.** `20261019215004` (F1) and `20261020200647` (F7+F8) have
   been applied to the local database but not pushed. F1 in particular is a user-visible bug fix
   that the hosted project still has.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

**Overall: REJECTED** — two CRITICAL findings. Both are small, local fixes in otherwise
faithful work: every one of the 17 planned files matches its stated Intent and Contract,
with no behavioral drift. The two criticals are a scale mismatch in one SQL predicate and
a missing `AbortSignal` on one `fetch`.

## Automated verification actually run

| Command | Result |
|---|---|
| `npm run test:unit` | PASS — 67 tests, 2 files |
| `npm run lint` | PASS — clean |
| `npm run gate:scope` | PASS — eslint 54/54, astro 55, unit 67 |
| `npm run gate:routes` | PASS — 4 assertions over 12 routes |
| `npx astro check` | PASS — 0 errors, 0 warnings, 3 hints |
| `npm run test:db` | PASS — 5 files, 26 tests (incl. `04_notes_search.sql`) |
| `npm run test:int` | PASS — 3 files, 9 tests (with local DB env supplied) |
| `npm run build` | PASS |
| `npm run gate:build-output` | PASS — no secret/JWT/identifier under `dist/client` |
| `npm run gates` (end to end) | **NOT VERIFIABLE HERE** — `gate:drift` requires `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`; it fails rather than skips, by deliberate design. Every other link in the chain passes. |

Manual item 1.3 independently confirmed: `vector 0.8.2` in schema `extensions` (iterative
index scans available since 0.8.0). Manual items 2.3–2.4, 3.4–3.7, 4.2–4.3 are behavioral
or operator-performed and leave no diff evidence; 4.3 asserts a run against the hosted
project, which cannot be verified from here. See F4 on 3.7 specifically.

## Findings

### F1 — One threshold parameter compared against two incomparable scales; date-bound text-only search returns nothing

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261017103503_create_search_notes_function.sql:110
- **Detail**: `p_similarity_threshold` (default `0.5`) is used twice in
  `date_range_candidates`. At line 116 it is correct — compared against
  `1 - (embedding <=> q)`, a cosine similarity in `[0,1]`. At line 110 the *same* `0.5` is
  compared against `ts_rank_cd(..., 32)`, whose normalization flag 32 produces values an
  order of magnitude smaller. Measured on this project's own local Postgres with realistic
  Polish note text: one matching term → `0.0909`, two terms → `0.0476`, fever note →
  `0.0909`. All far below `0.5`, so the full-text arm of the date-bound branch can
  essentially never fire; that branch is vector-only in practice.

  Proven end-to-end on the live local database (in a rolled-back transaction): a note
  reading `jadla dzisiaj zupe pomidorowa`, `occurred_at 2026-07-04`, `embedding = null`,
  queried for `zupe` —
  - with the July window → **0 rows**
  - same query, no date range → **1 row**

  This defeats the plan's single most load-bearing requirement ("returns every matching
  note in the interval, not just the few most similar") in exactly the degraded case the
  UI advertises: `src/pages/children/[id].astro:131` renders *"wyszukiwanie częściowo
  niedostępne — wyniki tylko tekstowe"* while text-only matching is structurally impossible
  on that path. It also silently hides any pre-backfill note (`embedding is null`) from a
  date-bounded question even when the queried word appears verbatim in it.

  Note the plan itself is partly the source: it specified "a fixed similarity threshold"
  (singular) for both arms. The code faithfully implements what was written — which is why
  Plan Adherence is PASS and this lands under Safety & Quality.
- **Fix A ⭐ Recommended**: Drop the text-rank threshold from the date-bound branch entirely — keep `n.fts @@ websearch_to_tsquery(...)` as the only text condition.
  - Strength: The date window is already the hard filter, and the plan's stated intent for this branch is completeness, not sharpness ("no top-N truncation applies inside it"). A rank floor contradicts that intent regardless of its value. Smallest possible diff; nothing to tune.
  - Tradeoff: A very loose query inside a wide window returns more rows. Acceptable — ranking sharpness is explicitly deferred to slice S-04 (`note-search-precision`).
  - Confidence: HIGH — removes the dead predicate rather than guessing a magic number, and matches the branch's documented purpose.
  - Blind spot: Unmeasured on a child with hundreds of notes in one window; at this project's scale that is not yet reachable.
- **Fix B**: Split the parameter — add `p_text_rank_threshold float default 0.05` and leave `p_similarity_threshold` for the cosine comparison only.
  - Strength: Keeps a tunable floor on both arms; preserves the symmetry the plan imagined.
  - Tradeoff: Introduces a second unvalidated magic number, on the same scale problem that caused this bug. `0.05` is derived from three measurements, not from real usage.
  - Confidence: MEDIUM — correct in shape, but the value is a guess and the migration's own comment already warns that `0.5`/`50` are unvalidated.
  - Blind spot: Has not been checked against a note that matches on a stopword-heavy phrase.
- **Decision**: FIXED via Fix A — new migration
  `supabase/migrations/20261019215004_fix_search_notes_text_threshold.sql` does
  `create or replace function public.search_notes(...)` with the text-rank threshold
  removed from the date-bound branch. Delivered as a new migration rather than an edit to
  20261017103503, which is already applied locally and (per Progress 4.3) pushed to the
  hosted project. Applied locally with `supabase migration up`. Verified on the live DB:
  date window + null embedding + literal word → 1 row (was 0); no-date-range → 2 rows (no
  regression); non-matching word in window → 0 (branch is not a catch-all); out-of-window
  note still excluded → 1 (exclusive upper bound intact). `npm run test:db` 26/26 pass.

### F2 — OpenAI fetch has no timeout; a stalled upstream can lose the note the parent typed

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/embeddings.ts:22
- **Detail**: The `fetch` to OpenAI passes no `signal`, and no `AbortSignal`/
  `AbortController` appears anywhere in `src/` or `scripts/`. `embedText` is `await`ed on
  three request paths: `createNote` (src/lib/notes.ts:56, **before** the insert at 57-59),
  `updateNoteContent` (src/lib/notes.ts:78, before the update), and `searchNotes`.

  The `catch { return null }` at :38-40 only converts *rejections*. A connection that is
  accepted and then stalls — routine during an upstream incident or rate-limit
  backpressure — never rejects, so the degradation path never runs. On Cloudflare Workers
  the platform kills the request instead, so a parent pressing save loses the note they
  typed. That directly contradicts this function's own documented guarantee at
  src/lib/notes.ts:47-49 and embeddings.ts:10-11 ("a note's save never depends on, or is
  blocked by, the external AI call succeeding") and the PRD guardrail that notes are never
  lost. The same stall blows the plan's 10-second NFR on a page render.
- **Fix**: Add `signal: AbortSignal.timeout(5000)` to the fetch options at src/lib/embeddings.ts:22, and mirror it in scripts/backfill-embeddings.mjs.
  - Strength: `AbortSignal.timeout` *rejects* on expiry, so the existing `catch` already converts it to the documented `null` degradation with no other change. One line per call site.
  - Tradeoff: A slow-but-succeeding call above 5s now degrades instead of completing; for a 1536-dim embedding of a short note that is a wide margin.
  - Confidence: HIGH — supported on the Workers runtime and requires no new control flow.
  - Blind spot: 5000ms is a judgment call, not measured against observed p99 latency.
- **Decision**: FIXED as proposed. `signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)` added at
  src/lib/embeddings.ts (5s, request path) and scripts/backfill-embeddings.mjs (30s, since
  one call there embeds up to `BATCH_SIZE` notes and no request is waiting on it). Required
  one supporting change: `AbortSignal` added to the hand-maintained `scripts/**/*.mjs`
  globals list in eslint.config.js:89, matching that config's existing convention —
  `no-undef` caught its absence. Abort semantics verified against a server that accepts and
  then stalls: the call returned `null` in 1016ms through the existing `catch`, confirming
  the claim that no new control flow is needed. lint clean, astro check 0 errors, unit 67/67,
  gate:scope 54/54.

### F3 — `gate:scope` unit-test floor left at 35 while the suite passes 67, defeating the gate's stated purpose

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/gate-scope.mjs:38
- **Detail**: `EXPECTED.unitTestsPassed` is still `{ mode: "floor", value: 35 }`, derived
  when `wall-clock.test.ts` was the only unit file. The suite now passes 67 — confirmed by
  the gate's own output in this review: `PASS unit tests passed -> 67 (expected at least
  35)`. Phase 5 correctly re-derived the sibling `eslintFiles` exact count (47 → 54) but
  not this floor.

  Delete `tests/unit/date-range-parse.test.ts`, or drop it via a bad `vitest.config.ts`
  `include`, and the count falls 67 → 35, `35 >= 35` still passes, `gate:scope` prints
  PASS and `npm run gates` is green — while the only coverage the exclusive-upper-bound
  date logic has is silently gone. That is precisely the "suite quietly getting smaller"
  failure the file's own comment at :34-38 says the floor exists to catch.
- **Fix**: Raise `EXPECTED.unitTestsPassed.value` to 67 in scripts/gate-scope.mjs:38.
- **Decision**: FIXED as proposed. Floor raised 35 → 67, and the comment above it now says to
  re-derive on every added unit-test file (its old text pinned the number to "§3 Phase 3",
  which is what let it go stale). Verified: `gate:scope` now prints `unit tests passed -> 67
  (expected at least 67)` and passes.

### F4 — The orchestration layer has no automated coverage, which is why F1 shipped green

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: tests/integration/notes-search.test.ts:1-20
- **Detail**: The integration suite calls `.rpc("search_notes")` directly rather than
  going through `src/lib/search.ts`, documented at :1-20 as deliberate (importing
  `@/lib/search` would pull in `astro:env/server`). The consequence is that the SQL layer
  is covered while the orchestration layer — date-parse → RPC plumbing and the `degraded`
  flag — has no automated test at all.

  Compounding it, the date-boundary test at :105 puts the one-hot embedding on *every*
  in-window note on purpose, so the vector arm carries every assertion in that case and
  the text arm is never exercised inside a date window. That is the exact hole F1 lives
  in. Manual item 3.7 ("simulating an `OPENAI_API_KEY` failure still returns full-text
  matches") was therefore necessarily checked without a date phrase in the question —
  with one, as proven in F1, it returns nothing.
- **Fix A ⭐ Recommended**: Add one integration case to the existing suite: date range + `p_query_embedding: null` + a literal word from an in-window note, asserting that note comes back. Pairs with whichever F1 fix is chosen.
  - Strength: Three lines in a suite that already has the fixture and the harness; it is the regression test for F1 and would have caught it. Needs no new file, no id-space, no change to the stubbing decision.
  - Tradeoff: Still does not cover `search.ts` itself; the `degraded` flag stays untested.
  - Confidence: HIGH — `SEARCH_FIXTURE` already contains an embedding-less full-text-only note, so the fixture needs no change.
  - Blind spot: Has not been run; the assertion's exact expected set depends on the F1 fix chosen.
- **Fix B**: Leave coverage as is and record the gap for `test-plan.md` §3 Phase 4.
  - Strength: The plan's "What We're NOT Doing" explicitly reserves the completeness/boundary suite to that later change — this is plan-sanctioned deferral, not an oversight.
  - Tradeoff: F1's regression test ships later than F1's fix, so nothing stops it recurring in the interim.
  - Confidence: MEDIUM — defensible by the plan's own words, but weak given that the gap just produced a critical.
  - Blind spot: Depends on test-plan Phase 4 actually being opened; it is not yet scheduled.
- **Decision**: FIXED via Fix A — new `describe` block "search_notes degraded mode inside a date
  window" at the end of tests/integration/notes-search.test.ts. It queries `"spacerze"` (a word
  unique to `nearNote`, mid-window) with `queryEmbedding: null` inside the 07-01..07-08 window,
  asserting exactly `[nearNote]`, plus a separate assertion that `atWindowStartNote` is absent —
  which proves the text arm still discriminates rather than the window becoming a catch-all once
  F1's threshold was removed. No fixture change needed.

  **Verified with a negative control**, which is the part that matters for a regression test. On
  the fixed function the suite is 10/10. The pre-F1 function body (20261017103503) was then
  re-applied to the local database and the file re-run: this test alone failed, with
  `AssertionError: expected [] to strictly equal [ Array(1) ]` — the zero-rows bug exactly — while
  the other three passed. So the test is specific to F1 rather than broadly coupled. The fixed
  function was restored afterwards and both suites re-confirmed green.

### F5 — Backfill script silently caps at 1000 rows and reports success

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/backfill-embeddings.mjs:107
- **Detail**: The select filters `embedding is null` / `deleted_at is null` but applies no
  `.range()` or `.limit()`. `supabase/config.toml:18` sets `max_rows = 1000`, so PostgREST
  truncates the response at 1000 silently. With 2500 notes needing an embedding the script
  reports "Found 1000 note(s)", backfills 1000 and exits 0 — and the operator reasonably
  concludes the backfill is complete.

  Data safety itself is correct: only `embedding` is ever written, never `content`, and
  re-running picks up whatever is still null, so the script is self-healing. The defect is
  the misleading completion report, not data loss.
- **Fix**: Page with `.range(offset, offset + 999)` until a short page returns, or state in the header comment that the script must be re-run until it reports 0 found.
- **Decision**: FIXED by paging. New `selectAllPending()` helper reads the entire backlog before
  anything is written, looping on `.range(offset, offset + PAGE_SIZE - 1)` with `.order("id")`
  until a page comes back empty.

  Two details worth keeping: the read completes *before* the first write, because `embedding` is
  both the column the select filters on and the column the run mutates — an interleaved pager
  would shift its own offsets and skip rows. And the offset advances by rows *actually received*,
  never by `PAGE_SIZE`, so a `max_rows` configured below `PAGE_SIZE` narrows the pages instead of
  punching holes in them. `.order("id")` is required for offset stability.

  Verified by `node --check`, lint and `gate:scope`. Not executed end to end: the script needs a
  real `OPENAI_API_KEY` and the local database, which Docker took down (see F4).

### F6 — A bare month name always resolves to the current year, silently producing a future window

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/date-range-parse.ts:120
- **Detail**: A month locative resolves to the current year, documented as intended at
  tests/unit/date-range-parse.test.ts:108. On 2026-03-10 a parent asking *"Co jadła w
  lipcu?"* about July 2025 gets the window `2026-07-01 .. 2026-08-01` — entirely in the
  future, so zero notes, with nothing telling them the year was assumed.
- **Fix**: If the resolved month is in the future relative to the anchor date, roll back one year.
- **Decision**: FIXED as proposed. A bare month now resolves to its most recent occurrence
  (`monthNum > month ? year - 1 : year`) in src/lib/date-range-parse.ts; the anchor's own month
  stays in the current year. The 12-row month table in tests/unit/date-range-parse.test.ts was
  re-derived against its June anchor — months Jan–Jun stay 2026, Jul–Dec now resolve to 2025 — so
  the one table exercises both directions, plus an explicit regression case for the March-asks-
  about-July scenario. 72 unit tests pass.

### F7 — No relevance floor in the RRF branch makes the "no matches" message unreachable

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261017103503_create_search_notes_function.sql:84
- **Detail**: The non-date-range branch applies no similarity floor — the `semantic` CTE
  admits every embedded note of the child, so RRF always returns
  `min(p_match_count, note_count)` rows. For a child with 6 notes, any question whatsoever
  returns all 6, and src/pages/children/[id].astro:135 ("Brak notatek pasujących do
  pytania.") is unreachable except for a child with no notes at all. The migration's
  comments and tests/integration/notes-search.test.ts:16-20 both acknowledge this as
  accepted-for-now, which is why it is an observation.
- **Fix**: None now — retune `p_similarity_threshold` or add a floor to the RRF branch once real usage data exists, as the migration's own note already says. Naturally revisited by slice S-04.
- **Decision**: FIXED (with F8) in
  `supabase/migrations/20261020200647_tune_search_notes_rrf_relevance.sql` — the `semantic` CTE is
  now gated on `1 - distance >= p_similarity_threshold`, making the RRF branch symmetric with the
  date-bound branch and making "Brak notatek pasujących do pytania." reachable.

  ⚠ **This is the one change in this review that could make the feature worse rather than better.**
  It is now applied locally and `test:db` (26/26) and `test:int` (10/10) both pass — but that is
  weak evidence: the fixtures seed a synthetic one-hot vector whose self-similarity is 1.0, so
  they clear any threshold trivially. The 0.5 default has never been measured against this
  project's real Polish, abbreviated notes — the roadmap carries that as an open unknown (owner:
  user) — and this change is the first thing that lets that unmeasured number decide what a parent
  sees on the common no-date-range path. If 0.5 is too strict for text-embedding-3-small on short
  Polish text, the symptom is "Brak notatek" for a note that plainly matches. Validate against
  real notes and lower the default before relying on it. The migration's own header carries this
  same warning.

  Also required a comment correction: tests/integration/notes-search.test.ts's header documented
  the *absence* of a floor as an accepted limitation, which this makes false.

### F8 — HNSW index is unlikely to be used by the read path it was built for

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20261017103503_create_search_notes_function.sql:67
- **Detail**: The `semantic` CTE has no inner `LIMIT`; `p_match_count` is applied only in
  `rrf_candidates`, after the window function has ranked every one of the child's embedded
  notes. An HNSW top-k path requires `ORDER BY ... LIMIT`, so
  `notes_embedding_hnsw_idx` (20261017103455_add_notes_search.sql:39) is likely unused and
  every question does a full distance pass over the child's notes. Well inside the 10s NFR
  at a private diary's scale — a dead index, not a live defect.
- **Fix**: Add `order by n.embedding <=> p_query_embedding limit greatest(p_match_count * 10, 100)` inside the `semantic` CTE if note counts ever grow.
- **Decision**: FIXED (with F7) in the same migration. The ordering and limit moved into an inner
  subquery with `row_number()` running over its result, which is the `order by <=> ... limit n`
  shape pgvector needs to use an HNSW index. The limit is deliberately much wider than
  `p_match_count` (`greatest(p_match_count * 10, 100)`) because RRF fuses this arm's *rank* with
  the text arm's, so the candidate pool has to stay broad enough for fusion to still reorder
  anything. Unlike F7 this half is a pure plan change with no behavioral effect.

  **Verified index-eligible, which is as far as this can be taken.** `pg_index` confirms
  `notes_embedding_hnsw_idx` is valid, ready, `amname = hnsw`, predicate `(deleted_at IS NULL)`.
  With 3000 synthetic notes loaded and `enable_seqscan = off`, the plan becomes
  `Index Scan using notes_embedding_hnsw_idx` with `Order By: (embedding <=> ...)` — so the new
  shape genuinely can be served by the index, which the old window-function-over-every-row shape
  is what prevented.

  Left on cost, the planner still picks `Seq Scan` + `Sort` at 3000 rows, which is correct: a seq
  scan of 3000 rows is cheaper than an HNSW traversal. That matches this finding's original
  reading — a dead index at a private diary's scale, not a live defect — so the fix is
  forward-looking rather than a present speedup. One caveat not chased: the forced plan was
  measured without the `child_id` filter that the real function always applies, and a filtered
  HNSW scan is the case pgvector's iterative index scans (0.8.0+; this project has 0.8.2) exist to
  handle.

### F9 — New `.gitignore` rule has no effect because the file it targets is already tracked

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .gitignore:33
- **Detail**: `supabase/snippets/` was added, but `supabase/snippets/Untitled query 234.sql`
  is already tracked, so the rule does not apply to it and future edits stay tracked.
  Contents verified harmless — `select count(*) from public.notes;`, no secret and nothing
  masked. `.vs/` matches nothing tracked, and no file that should be tracked became
  ignored. Worth noting that in this repo `.gitignore` is load-bearing beyond hygiene:
  ESLint scope is gitignore-driven and `gate:scope` asserts an exact file count.
- **Fix**: `git rm --cached "supabase/snippets/Untitled query 234.sql"` so the rule achieves its intent.
- **Decision**: FIXED as proposed. Untracked via `git rm --cached`; the file is still on disk, and
  `git check-ignore -v` now confirms `.gitignore:34` matches it. The removal is staged and will
  land with the commit.

### F10 — A recognized date window is never surfaced to the parent

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/search.ts:52
- **Detail**: `SearchResult.dateRange` is computed and returned but never read by
  src/pages/children/[id].astro, so the UI never tells the parent that their question was
  interpreted as a date-bounded one. This is what makes F1 and F6 silent rather than
  diagnosable: in all three cases the parent sees an empty result with no indication that a
  window was applied, or which one.
- **Fix**: Render the resolved window above the results when `dateRange` is non-null, e.g. "wyniki z okresu 1–31 lipca".
- **Decision**: FIXED as proposed. New `formatDateRange()` exported from
  src/lib/date-range-parse.ts, rendered as "wyniki z okresu <od> – <do>" above the results in
  src/pages/children/[id].astro, including when the result is empty — which is the case it exists
  for.

  The formatter lives beside the parser so the calendar arithmetic stays with the rest of it, and
  it renders the *inclusive* last day (`end` minus one day): `end` is exclusive everywhere in that
  module, so printing it raw would name a day whose notes are deliberately absent. Four unit tests
  cover a whole month, a single day, a year boundary and a non-leap February.
