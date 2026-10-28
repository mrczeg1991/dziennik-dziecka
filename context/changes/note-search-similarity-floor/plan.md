# Similarity Floor Re-derivation Implementation Plan

## Overview

`public.search_notes`'s `p_similarity_threshold` carries an unmeasured `0.5` that sits inside the true-positive similarity band for inflected Polish questions, so notes that plainly answer a question are silently dropped and the parent sees "Brak notatek pasujących do pytania." This plan re-derives that constant from a committed, repeatable Polish corpus, pins the result with a test that fails if the value drifts across either side of the measured boundary, and only then removes the period phrase from the query text — with a measurement between the two changes so each effect stays attributable.

## Current State Analysis

**The constant and where it bites.** `supabase/migrations/20261020200647_tune_search_notes_rrf_relevance.sql` is the live definition. `p_similarity_threshold float default 0.5` (`:45`) gates the vector arm of **both** branches: the RRF semantic CTE at `:86` (`where 1 - top_k.distance >= p_similarity_threshold`) and the date-bound branch at `:124`. No caller passes it — `src/lib/search.ts:33-39` sends five of eight parameters, `tests/integration/notes-search.test.ts:68-74` mirrors the same five, and `supabase/tests/04_notes_search.sql` sends three with `p_query_embedding => null`. Every value change is therefore a migration, and nothing anywhere pins the current number in either direction.

**What was measured (2026-10-24, recorded in `../note-search-precision/frame.md` §Measurement).** Four hand-made Polish notes, eight questions, real `text-embedding-3-small` embeddings, cosine similarity computed directly against the stored vectors. True positives span `0.475–0.662`; true negatives cap at `0.381`; the band `0.381–0.475` is empty. An inflected question form costs `0.117–0.201` similarity against base-form note text; the period phrase costs `0.032–0.070`. Three questions return nothing today: `Czy dostawał Nurofenu w lipcu?` (`0.475`), `Czy miał gorączkę w lipcu?` (`0.491` against the fever note), and the bare `Nurofenu` (`0.324`). `Czy dostawał Nurofenu?` passes by `0.007`. Ordering is correct in every row — there is no mis-ranking to fix.

**Why four notes is not enough.** This repo already rejected setting a constant from a handful of measurements. `context/archive/2026-10-16-note-search-by-meaning/reviews/impl-review.md:130-134` rejected `p_text_rank_threshold float default 0.05` because *"`0.05` is derived from three measurements, not from real usage."* The accepted alternative removed the predicate instead. That precedent does not say "delete this floor" — the `ts_rank_cd` predicate was **dead** (never cleared `0.5` at any value), while this one is **live and separating**, just positioned wrong. What the precedent does bind is provenance: a number must come from a corpus someone else can re-measure.

**The test harness cannot express a threshold.** `tests/integration/fixtures.ts:194-200` defines one `SEARCH_ONE_HOT_EMBEDDING`, reused as every seeded note's vector **and** as `p_query_embedding`, so the only similarities the suite can produce are `1.0` or absent. The fixture comment states this as intent: *"comfortably over `search_notes`'s default `p_similarity_threshold` (0.5) regardless of how that default is later tuned."* No helper for constructing a vector at a target cosine distance exists anywhere in the repo, and no `.mjs` under `scripts/` computes a cosine, dot product, or norm.

**An artifact whose stated reason expires.** `tests/integration/notes-search.test.ts:16-22` records a deliberate refusal to assert absence on the RRF branch: *"the floor's 0.5 default is explicitly unvalidated against real Polish note text, so an absence assertion here would be pinning a number nobody has measured yet."* Once the number is measured, that reason no longer holds.

**No corpus exists.** There is no `supabase/seed.sql`, although `supabase/config.toml:60-65` declares `sql_paths = ["./seed.sql"]` with `enabled = true`. No generator, factory, or committed dataset. Notes can only be created through the UI write path or by direct insert with the service-role key. `supabase/tests/04_notes_search.sql:34-74` is the one in-repo precedent for inserting accounts, children, and notes directly as `postgres`.

**Script conventions.** `scripts/` holds four gates, `smoke.mjs`, one shared `lib/wall-clock.mjs`, and `backfill-embeddings.mjs`. All are plain ESM `.mjs` with zero npm dependencies (the backfill excepted — it imports the already-present `@supabase/supabase-js`), configured purely through `process.env`, and **no script reads `process.argv`**. `backfill-embeddings.mjs:3` is explicit that it sits outside the gate chain: *"Run manually, never as part of `npm run gates`."* There is precedent for a manually-run non-gate script; there is none for a read-only script that prints numbers instead of a PASS/FAIL verdict.

**Gate coupling and the blocking seat.** `scripts/gate-scope.mjs:27` carries `eslintFiles: { mode: "exact", value: 54 }` — adding any linted file must bump it in the same commit, re-derived rather than guessed. `unitTestsPassed` is a floor at `72`; leave it alone on an additive change. `npm run gates` (which Cloudflare's build command calls) is the only blocking seat; the integration suite runs solely in the advisory `smoke` job, so a threshold test there **cannot** stop a deploy.

**Deployment state is disputed in-repo.** `impl-review.md:52-54` says both newer migrations are local-only; `context/archive/2026-10-16-note-search-by-meaning/plan.md:639-640` ticks a step that implies the two earlier ones reached the hosted project; `../note-search-precision/verification-scenarios.md:12-13` says the hosted project has no search at all. `gate:drift` is the only arbiter and all three secrets it needs are present in `.env`.

## Desired End State

`p_similarity_threshold` carries a value derived from a corpus committed to the repository, with the full similarity table recorded in the migration header beside it. An integration test seeds notes at known cosine distances on both sides of that value and fails if the boundary moves. The three questions measured as returning nothing now return their notes, and `Czy dostawał Nurofenu?` — which passed by `0.007` — still returns its note with real margin. The period phrase no longer reaches `p_query_text` or `embedText`, and the measurement that separates its effect from the threshold's is recorded.

Verify by: `npx supabase db reset && npm run test:unit && npm run test:int && npm run test:db`, then the manual question walk in Phase 3 and Phase 4.

### Key Discoveries:

- `p_similarity_threshold` gates both branches from one parameter — `20261020200647_tune_search_notes_rrf_relevance.sql:86` and `:124`
- Nothing passes it; every change is a migration — `src/lib/search.ts:33-39`
- Fixtures can only produce similarity `1.0` or absent — `tests/integration/fixtures.ts:194-200`
- A refusal to assert absence, justified by the unmeasured number — `tests/integration/notes-search.test.ts:16-22`
- `seed.sql` is declared and enabled but missing — `supabase/config.toml:60-65`
- Direct account/child/note insertion as `postgres` already has a precedent — `supabase/tests/04_notes_search.sql:34-74`
- A measured-but-thin constant was rejected on provenance grounds — `impl-review.md:130-134`
- Adding a linted file requires a same-commit counter bump — `scripts/gate-scope.mjs:27`
- Migrations are never edited in place; each is a fresh `create or replace` with the whole body restated and a header naming its predecessor — all three search migrations
- The period phrase is consumed by the date filter yet left in both the text query and the embedded text; no strip helper exists — `src/lib/search.ts:35-37`, `src/lib/date-range-parse.ts:64, 98`

## What We're NOT Doing

- **Changing the `asc`/`desc` sort direction of the date-bound branch.** Real inconsistency against `src/lib/notes.ts:31`, but nobody has observed it — the branch was returning zero rows. Excluded by decision.
- **Rewording the search placeholder** (`src/pages/children/[id].astro:115`). Excluded by decision; it is a UI concern in an otherwise SQL-and-calibration change.
- **Touching `context/foundation/test-plan.md`.** §2 has no risk covering a silently dropped match and §7 still excludes accuracy tuning although its re-evaluation condition has fired. Both are real gaps, both belong to `/10x-test-plan --refresh`, which owns that file. Excluded by decision.
- **Updating the §6 cookbook** — same file, same owner.
- **Splitting the threshold per branch, or moving it to the caller.** One SQL constant, by decision.
- **Retuning `p_rrf_k` or `p_match_count`.** Neither was measured and neither is implicated.
- **Removing the floor.** It separates; it is merely positioned wrong. If the wider corpus shows overlapping bands, the decided response is to favour recall (set under the lowest true positive and record the cost), not to delete the predicate.
- **A reranker, a Polish-specialised embedding model, or `pg_trgm` as a third arm.** `context/foundation/roadmap.md:136` parks these behind a condition about ranking accuracy; the measurement showed ordering is correct, so the condition is not met.
- **Reviving S-04 as a ranking slice.** Its premise was refuted — see `../note-search-precision/frame.md`.
- **Pushing migrations to the hosted project.** Required before the code that depends on them deploys (`context/deployment/deploy-plan.md:79-82`), and it will make `gate:drift` report repo-ahead until done — but it is an outward-facing action owned by the deploy runbook and confirmed at execution time, not performed silently by this plan. See Migration Notes.

## Implementation Approach

Four phases, ordered so that no behaviour changes until the number has a defensible provenance, and so that the two causes of empty results are never changed in the same step.

Phases 1 and 2 touch no product behaviour: they build a committed corpus and a read-only measurement tool, then produce the number and its table. Phase 3 lands the number in a migration and gives the test harness the one capability it lacks — vectors at known cosine distances — so the boundary is pinned on both sides. Phase 4 removes the period phrase from the query text and re-measures, which is only meaningful because Phase 3 closed with its own measurement.

The corpus is authored rather than harvested: it is committed to `supabase/seed.sql`, so anyone can re-derive the number, which is precisely what the rejected `p_text_rank_threshold` lacked.

## Critical Implementation Details

**Constructing a vector at a known cosine similarity.** For unit vectors, cosine similarity equals the dot product. With the query vector fixed at `e₁ = [1, 0, 0, …]`, a note vector `[s, √(1−s²), 0, …]` has cosine similarity exactly `s`. pgvector's `<=>` is cosine *distance*, so `search_notes` computes `1 - (embedding <=> q)` and recovers `s`. `vector(1536)` stores `float4`, so expect agreement to roughly `1e-7` — margins of `0.02` around the chosen value are far outside that.

**Where the vector helper lives, and why not in `fixtures.ts`.** The unit test for this math must run with no database and no credentials, and `tests/integration/fixtures.ts:26-47` is built on the opposite contract (*"Absent credentials fail, they do not skip"*). Put the helper in its own module and import it from both sides rather than importing `fixtures.ts` from `tests/unit/`. Confirm during implementation whether `fixtures.ts` calls `requireEnv` at module scope — if it does, importing it from a unit test fails outright.

**Threshold notes need their own child.** Existing `SEARCH_FIXTURE` assertions count notes inside date windows for one child, and every `search_notes` call is scoped by `p_child_id`. Add a second child carrying only the threshold notes; existing assertions then cannot see them and stay valid.

**A question that is only a period phrase.** After Phase 4 strips the recognized phrase, `w lipcu` leaves an empty string. `embedText("")` and `websearch_to_tsquery('simple', '')` are two separate problems. The correct behaviour is the date window alone — which is the date branch's documented completeness contract (`20261019215004_fix_search_notes_text_threshold.sql:14-19`) and the right answer to "what happened in July". Decide the mechanism in Phase 4 and cover it with a unit test.

**Measurement discipline.** Write the question set and the expected note for each question **before** running the script; an expected set derived from the query under test is the oracle problem that `test-plan.md` §6.3 names as the anti-pattern. Change no constant during a measurement run — `0.5`, `50` and `10` stay put until the table is complete.

**`backfill:embeddings` needs a key that is not in `.env`.** It requires `SUPABASE_SERVICE_ROLE_KEY` (`scripts/backfill-embeddings.mjs:33-35`), scripts do not load `.env`, and that variable is absent from it. Export it on the command line each run, from `npx supabase status -o env`.

---

## Phase 1: Corpus and measurement tool

### Overview

Commit a repeatable Polish note corpus and a read-only script that reports cosine similarities for a question set against it. No product behaviour changes.

### Changes Required:

#### 1. Seed corpus

**File**: `supabase/seed.sql` (new)

**Intent**: Give the local stack a realistic Polish note corpus large enough to calibrate a threshold against, committed so the number can be re-derived by anyone. 20–30 notes across one account and two children, written to mirror how the parent actually writes: abbreviated, mixed health and daily life, inflected forms, numbers and medication names, occurrence dates spread across several months.

**Contract**: Inserts into `auth.users`, `public.children`, `public.notes` with fixed UUIDs, following the direct-insert pattern already used by `supabase/tests/04_notes_search.sql:34-74`. `embedding` is left null — Phase 1 step 3 fills it. Reserve a UUID prefix distinct from the integration harness's `f1c70000-0000-0000-0000-` (`tests/integration/fixtures.ts:72`) so a seeded database and a test run cannot collide. `supabase/config.toml:60-65` already points at this path; no config change is needed.

#### 2. Measurement script

**File**: `scripts/measure-similarity.mjs` (new)

**Intent**: Report, for each question in a fixed set, the cosine similarity against every live note, so a human can read the true-positive and true-negative bands off one table and choose a value. Read-only: it must never write to the database.

**Contract**: Plain ESM, zero npm dependencies, configured only through `process.env` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`), no `process.argv` — matching every other script in the directory. Absent credentials fail rather than skip. Reads notes over PostgREST, embeds each question through the same endpoint and model as `src/lib/embeddings.ts:3-4` (`text-embedding-3-small`, 1536 dimensions, no `dimensions` parameter), computes cosine in JS, and prints a question × note table marking which values clear the current threshold, plus the observed min/max and the count of values inside a narrow band around it. Exits 0 on success, 1 on a thrown error. Explicitly **not** part of `npm run gates` — state that in the header comment, as `backfill-embeddings.mjs:3` does. The question set and each question's expected note live as constants at the top of the file, so a re-run reproduces the same measurement.

#### 3. Fill embeddings

**File**: none — operational step

**Intent**: Give every seeded note a real embedding, so the measurement reflects the model the product actually uses.

**Contract**: `npm run backfill:embeddings` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` exported. The script is idempotent and selects exactly the live notes with a null embedding (`scripts/backfill-embeddings.mjs:123-129`). It has not been run end to end since its paging rewrite (`impl-review.md:46-48`), so treat a clean run here as new evidence.

#### 4. Gate counter

**File**: `scripts/gate-scope.mjs`

**Intent**: Keep the scope gate honest after adding a linted file.

**Contract**: Re-derive `EXPECTED.eslintFiles` and set it to the measured count — never guess the delta (`scripts/gate-scope.mjs:27`). Leave `unitTestsPassed` alone; it is a floor and this phase adds no unit test.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies all six migrations and the new seed without error
- A direct query reports at least 20 live notes across two children, every one with a non-null embedding
- `npm run lint` passes
- `npx astro check` reports 0 errors
- `npm run gate:scope` passes after the counter is re-derived
- `node scripts/measure-similarity.mjs` exits 0 and prints a complete question × note table
- Running the script twice against unchanged data produces identical numbers

#### Manual Verification:

- The corpus reads like the parent's own notes — Polish, abbreviated, a mix of health and daily life — reviewed and accepted by the user
- The printed table is legible enough to read the true-positive and true-negative bands off it directly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Measure and choose the value

### Overview

Produce the similarity table over the committed corpus and derive the threshold from it by a stated rule. The output of this phase is a number and its evidence, not code.

### Changes Required:

#### 1. Question set and expectations, written first

**File**: `scripts/measure-similarity.mjs`

**Intent**: Fix the question set and the expected note for each question before any value is read, so the measurement cannot be fitted to a conclusion.

**Contract**: At least 12 questions as constants at the top of the file, covering: inflected and base-form variants of the same noun, bare keywords and full sentences, questions with and without a recognized period phrase, medication names, numbers, and at least two questions whose correct answer is "no note matches". Each carries its expected note id or an explicit "none".

#### 2. Record the measurement

**File**: `context/changes/note-search-similarity-floor/change.md`

**Intent**: Record the table, the derived bands, the chosen value and its margin, so the migration header and any later review can cite a provenance rather than an assertion.

**Contract**: A `## Pomiar` section carrying the question × note table, the true-positive band, the true-negative band, the chosen value, the margin on each side, and — if the bands overlap — the number of true negatives the chosen value admits.

#### 3. Derive the value

**File**: none — decision step

**Intent**: Turn the table into one number by a rule fixed in advance.

**Contract**: If the bands are separated, take the midpoint of the empty gap. If they overlap, set the value just below the lowest true positive and record how many true negatives that admits — favouring recall, because the parent would rather scan one extra note than miss the one they were looking for, the RRF branch truncates to ten anyway, and the date branch's contract is completeness.

### Success Criteria:

#### Automated Verification:

- `node scripts/measure-similarity.mjs` exits 0 with the full question set in place
- Two consecutive runs produce identical values, confirming the measurement is deterministic

#### Manual Verification:

- The question set and each expected note were written down before the first value was read
- No constant in `search_notes` was altered during the measurement
- The table, both bands, the chosen value and its margins are recorded in `change.md`
- The chosen value follows the stated rule, and where the bands overlap the admitted-negative count is recorded alongside it

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Land the value and pin it

### Overview

Put the derived value into a new migration following the established replacement convention, give the test harness the ability to express a cosine similarity, and pin the boundary from both sides.

### Changes Required:

#### 1. Threshold migration

**File**: `supabase/migrations/<timestamp>_recalibrate_search_notes_similarity_floor.sql` (new)

**Intent**: Replace `search_notes` with the measured default in place of `0.5`, and record the evidence in the header so the number's provenance travels with it.

**Contract**: A fresh `create or replace function public.search_notes(...)` restating the entire body — the 8-parameter signature byte-identical except the `p_similarity_threshold` default, `returns table`, `language sql / stable / security invoker`, and all five CTEs. Never edit `20261020200647` in place; no migration in this repo's history has ever been modified. The header comment follows the pattern of all three predecessors: one line naming what it replaces and why, the measured numbers (both bands, the chosen value, the corpus size), the user-visible symptom the old value produced, and an explicit "everything else is unchanged from `20261020200647_tune_search_notes_rrf_relevance.sql`" delta statement. Where the measurement favoured recall over a clean separation, say so and give the admitted-negative count.

#### 2. Graded vector helper

**File**: `tests/support/graded-vector.ts` (new)

**Intent**: Let a fixture seed a note whose cosine similarity to a fixed query vector is a chosen number, which is the one thing the current harness cannot do.

**Contract**: Exports a function returning a 1536-element unit vector at a requested cosine similarity against `e₁`, and `e₁` itself as the query vector. No database access, no imports from `tests/integration/fixtures.ts`, so a unit test can import it with no credentials and no stack. See Critical Implementation Details for the construction.

#### 3. Helper unit test

**File**: `tests/unit/graded-vector.test.ts` (new)

**Intent**: Pin the math, in the only seat that can block a deploy.

**Contract**: Asserts the returned vector has 1536 elements and unit length, that its dot product with the query vector equals the requested similarity within float tolerance, and that the boundary inputs behave (similarity 0 and 1). Follows `tests/unit/wall-clock.test.ts` as the reference unit test per `test-plan.md` §6.2.

#### 4. Threshold fixture and assertions

**File**: `tests/integration/fixtures.ts`, `tests/integration/notes-search.test.ts`

**Intent**: Seed two notes straddling the chosen value on a dedicated child and assert that one is returned and the other is not — so moving the constant in either direction turns a test red. Remove the recorded refusal to assert absence, whose stated reason has expired.

**Contract**: `SEARCH_FIXTURE` gains a second child and two notes carrying vectors from the graded helper, one at the chosen value plus a margin and one at the chosen value minus a margin; the RPC is called with the helper's query vector and no date range, so the RRF branch's floor is what decides. Existing assertions are scoped by `p_child_id` and must remain untouched and passing. In `notes-search.test.ts`, replace the `:16-22` comment block with one stating the value is now measured, citing where the table lives, and keep the file's existing `.rpc()`-not-`@/lib/search` rationale intact.

#### 5. Gate counter

**File**: `scripts/gate-scope.mjs`

**Intent**: Keep the scope gate honest after two more linted files.

**Contract**: Re-derive `EXPECTED.eslintFiles` again. Leave `unitTestsPassed` as a floor.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies the new migration cleanly
- `npm run test:db` passes with no change to its existing assertion count
- `npm run test:unit` passes, including the graded-vector math
- `npm run test:int` passes, including the two new threshold assertions and every pre-existing assertion
- Temporarily setting the migration's default to the old `0.5` makes the new integration assertion fail, then reverting makes it pass again
- `npm run lint` passes and `npx astro check` reports 0 errors
- `npm run gate:scope` passes after the counter is re-derived

#### Manual Verification:

- `Czy dostawał Nurofenu w lipcu?` returns the Nurofen note in the UI
- `Czy miał gorączkę w lipcu?` returns the fever note
- The bare `Nurofenu` returns the Nurofen note
- `Czy dostawał Nurofenu?` still returns its note, now with real margin rather than `0.007`
- A plainly unrelated question still shows "Brak notatek pasujących do pytania."
- The measurement is re-run on the new value and recorded in `change.md` before Phase 4 begins

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase 4 must not begin until the re-measurement above is recorded — otherwise the two changes become inseparable.

---

## Phase 4: Strip the period phrase

### Overview

Stop sending the recognized period phrase to the text query and the embedding, now that the date filter has already consumed it, and measure the effect separately from the threshold's.

### Changes Required:

#### 1. Strip helper

**File**: `src/lib/date-range-parse.ts`

**Intent**: Expose the removal of a recognized period phrase from a question, so the caller can pass the date filter a window and the search arms a question with the already-consumed words taken out.

**Contract**: A new export alongside `formatDateRange:64` and `parsePolishDateRange:98`, returning the question with the matched phrase removed and whitespace tidied. It must recognize exactly the same phrases as `parsePolishDateRange` — including the bare-substring, non-word-boundary matching the module deliberately uses (`:88-90`) — so the two can never disagree about what was consumed. Define and document the empty-result case: a question consisting only of a period phrase.

#### 2. Use it in the query path

**File**: `src/lib/search.ts`

**Intent**: Send the stripped text to both search arms while the date window keeps coming from the original question.

**Contract**: `parsePolishDateRange` continues to see the raw question; the stripped text is what reaches `embedText` and `p_query_text` (`:35-37`). The `degraded` contract, the throw-on-query-failure behaviour, and the returned `dateRange` shape are unchanged.

#### 3. Unit tests for the strip

**File**: `tests/unit/date-range-parse.test.ts`

**Intent**: Pin the strip's behaviour in the blocking seat, alongside the existing parser tests.

**Contract**: Extends the existing suite. Covers: a sentence with a month phrase, a sentence with `dzisiaj`/`wczoraj`, a question that is only a period phrase, a question with no recognized phrase (unchanged output), and a phrase appearing without a preposition — the substring-matching case. Parity with `parsePolishDateRange` on the same inputs is the central assertion.

#### 4. Handle the empty-text case end to end

**File**: `src/lib/search.ts`

**Intent**: Make a question that is only a period phrase return that window's notes rather than an error or an empty list.

**Contract**: When the stripped text is empty, the date window alone decides the result — the date branch's documented completeness contract. Avoid calling the embeddings endpoint with empty input. Keep the `degraded` flag meaning what it means today: the embedding could not be produced, not "nothing was asked".

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` passes, including every new strip case
- `npm run test:int` passes with no change to existing assertions
- `npm run lint` passes and `npx astro check` reports 0 errors
- `npm run gate:scope` passes
- `npm run gate:routes` and `npm run gate:build-output` pass

#### Manual Verification:

- `Czy dostawał Nurofenu w lipcu?` and `Czy miał gorączkę w lipcu?` return their notes
- A question that is only `w lipcu` returns that month's notes rather than an error or emptiness
- A question with no period phrase behaves exactly as it did after Phase 3
- The measurement is re-run and recorded, attributing the similarity gain from the strip separately from the threshold change

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- Graded vector construction: dimension, unit length, exact dot product against the query vector, boundary inputs
- Period-phrase strip: every phrase class the parser recognizes, parity with the parser, the no-phrase passthrough, the phrase-only question, and substring matching without a preposition

### Integration Tests:

- Two notes straddling the chosen threshold on a dedicated child: the one above is returned, the one below is not, on the RRF branch with no date range
- Every pre-existing `notes-search` assertion continues to pass, confirming the new child and notes are invisible to child-scoped queries

### Manual Testing Steps:

1. Ask `Czy dostawał Nurofenu w lipcu?` — the Nurofen note comes back
2. Ask `Czy miał gorączkę w lipcu?` — the fever note comes back
3. Ask the bare `Nurofenu` — the Nurofen note comes back
4. Ask `Czy dostawał Nurofenu?` — still returned, with margin
5. Ask something no note covers — "Brak notatek pasujących do pytania." still appears
6. After Phase 4, ask `w lipcu` alone — that month's notes come back, no error
7. Re-run `scripts/measure-similarity.mjs` after Phase 3 and again after Phase 4, recording both

## Performance Considerations

Lowering the floor admits more rows into the RRF semantic arm, but that arm already runs inside `limit greatest(p_match_count * 10, 100)` (`20261020200647_…sql:84`) and `rrf_candidates` truncates to `p_match_count`, so the result size is unchanged. The date-bound branch has no limit, so a lower floor widens its output in proportion to how many in-window notes clear the new value — acceptable at this scale and consistent with that branch's completeness contract, but worth watching if the corpus ever grows by an order of magnitude. The HNSW index continues to serve the semantic arm because the `order by … limit n` shape at `:80-85` is untouched.

## Migration Notes

The new migration changes only a default; existing rows and indexes are untouched and no backfill is needed. `supabase start` and `npx supabase db reset` apply it locally with no extra step.

Two things follow from adding a migration, and neither is executed by this plan:

- **`gate:drift` will report repo-ahead** until the migration reaches the hosted project (`scripts/gate-migration-drift.mjs:217-224`). That gate sits inside `gates:pre` → `npm run gates`, which Cloudflare's build command calls, so the deploy path fails until the push happens. This is the gate working as designed.
- **`npx supabase db push` is required before any code depending on the migration deploys** (`context/deployment/deploy-plan.md:79-82`). It is an outward-facing action against production: confirm with the user before running it, do not fold it into a phase.

The repo currently disagrees with itself about what the hosted project already has. Running `npm run gate:drift` with the three secrets from `.env` settles it and is worth doing before any push, but it is diagnostic and outside this plan's phases.

## References

- Frame brief: `context/changes/note-search-precision/frame.md` — the measurement and the refuted ranking premise
- Verification procedure: `context/changes/note-search-precision/verification-scenarios.md`
- Live function: `supabase/migrations/20261020200647_tune_search_notes_rrf_relevance.sql:45, 80-87, 104-127`
- The self-warning this change confirms: same file, `:29-36`
- Date branch's completeness contract: `supabase/migrations/20261019215004_fix_search_notes_text_threshold.sql:14-19`
- Rejected measured-but-thin constant: `context/archive/2026-10-16-note-search-by-meaning/reviews/impl-review.md:130-134`
- Query path: `src/lib/search.ts:30-39`; `src/lib/date-range-parse.ts:64, 88-90, 98`
- Harness and its limits: `tests/integration/fixtures.ts:26-47, 72, 194-200`; `tests/integration/notes-search.test.ts:16-22`
- Direct-insert precedent: `supabase/tests/04_notes_search.sql:34-74`
- Script conventions: `scripts/backfill-embeddings.mjs:1-16, 33-35, 123-129`; `scripts/gate-scope.mjs:27`
- Cookbook entries this follows: `context/foundation/test-plan.md` §6.2, §6.3, §6.7

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Corpus and measurement tool

#### Automated

- [x] 1.1 `npx supabase db reset` applies all six migrations and the new seed without error — 5747f31
- [x] 1.2 A direct query reports at least 20 live notes across two children, every one with a non-null embedding — 5747f31
- [x] 1.3 `npm run lint` passes — 5747f31
- [x] 1.4 `npx astro check` reports 0 errors — 5747f31
- [x] 1.5 `npm run gate:scope` passes after the counter is re-derived — 5747f31
- [x] 1.6 `node scripts/measure-similarity.mjs` exits 0 and prints a complete question × note table — 5747f31
- [x] 1.7 Running the script twice against unchanged data produces identical numbers — 5747f31

#### Manual

- [x] 1.8 The corpus reads like the parent's own notes — Polish, abbreviated, a mix of health and daily life — reviewed and accepted by the user — 5747f31
- [x] 1.9 The printed table is legible enough to read the true-positive and true-negative bands off it directly — 5747f31

### Phase 2: Measure and choose the value

#### Automated

- [x] 2.1 `node scripts/measure-similarity.mjs` exits 0 with the full question set in place — f9ddba0
- [x] 2.2 Two consecutive runs produce identical values, confirming the measurement is deterministic — f9ddba0

#### Manual

- [x] 2.3 The question set and each expected note were written down before the first value was read — f9ddba0
- [x] 2.4 No constant in `search_notes` was altered during the measurement — f9ddba0
- [x] 2.5 The table, both bands, the chosen value and its margins are recorded in `change.md` — f9ddba0
- [x] 2.6 The chosen value follows the stated rule, and where the bands overlap the admitted-negative count is recorded alongside it — f9ddba0

### Phase 3: Land the value and pin it

#### Automated

- [x] 3.1 `npx supabase db reset` applies the new migration cleanly — 9720b4a
- [x] 3.2 `npm run test:db` passes with no change to its existing assertion count — 9720b4a
- [x] 3.3 `npm run test:unit` passes, including the graded-vector math — 9720b4a
- [x] 3.4 `npm run test:int` passes, including the two new threshold assertions and every pre-existing assertion — 9720b4a
- [x] 3.5 Temporarily setting the migration's default to the old `0.5` makes the new integration assertion fail, then reverting makes it pass again — 9720b4a
- [x] 3.6 `npm run lint` passes and `npx astro check` reports 0 errors — 9720b4a
- [x] 3.7 `npm run gate:scope` passes after the counter is re-derived — 9720b4a

#### Manual

- [x] 3.8 `Czy dostawał Nurofenu w lipcu?` returns the Nurofen note in the UI — 9720b4a
- [x] 3.9 `Czy miał gorączkę w lipcu?` returns the fever note — 9720b4a
- [x] 3.10 The bare `Nurofenu` returns the Nurofen note — 9720b4a
- [x] 3.11 `Czy dostawał Nurofenu?` still returns its note, now with real margin rather than `0.007` — 9720b4a
- [x] 3.12 A plainly unrelated question still shows "Brak notatek pasujących do pytania." — 9720b4a
- [x] 3.13 The measurement is re-run on the new value and recorded in `change.md` before Phase 4 begins — 9720b4a

### Phase 4: Strip the period phrase

#### Automated

- [x] 4.1 `npm run test:unit` passes, including every new strip case
- [x] 4.2 `npm run test:int` passes with no change to existing assertions
- [x] 4.3 `npm run lint` passes and `npx astro check` reports 0 errors
- [x] 4.4 `npm run gate:scope` passes
- [x] 4.5 `npm run gate:routes` and `npm run gate:build-output` pass

#### Manual

- [ ] 4.6 `Czy dostawał Nurofenu w lipcu?` and `Czy miał gorączkę w lipcu?` return their notes
- [ ] 4.7 A question that is only `w lipcu` returns that month's notes rather than an error or emptiness
- [ ] 4.8 A question with no period phrase behaves exactly as it did after Phase 3
- [x] 4.9 The measurement is re-run and recorded, attributing the similarity gain from the strip separately from the threshold change
