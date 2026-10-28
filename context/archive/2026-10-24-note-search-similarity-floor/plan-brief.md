# Similarity Floor Re-derivation — Plan Brief

> Full plan: `context/changes/note-search-similarity-floor/plan.md`
> Frame brief: `context/changes/note-search-precision/frame.md`

## What & Why

A question asked in natural, inflected Polish returns "Brak notatek pasujących do pytania." for a note that plainly answers it, because `p_similarity_threshold = 0.5` sits inside the true-positive similarity band for this embedding model and language, and the lexical arm cannot compensate. Retrieval ranking is correct; the cut-off is wrong.

This plan re-derives that constant from a committed corpus, pins it with a test, then removes the period phrase from the query text — measuring between the two so each effect stays attributable.

## Starting Point

`search_notes` applies one `p_similarity_threshold` to the vector arm of both branches (`20261020200647_…sql:86, :124`), and no caller passes it, so the SQL default is the only value it ever has. A measurement on 2026-10-24 found true positives at `0.475–0.662` and true negatives capping at `0.381` — the floor cuts through the middle of genuine matches, and `Czy dostawał Nurofenu?` clears it by `0.007`. The migration that introduced this floor to the common path three days earlier warned about exactly this outcome in its own header. Nothing pins the number: the integration fixtures share one one-hot vector, so every seeded similarity is `1.0` or absent, and the suite records a deliberate refusal to assert absence *because* `0.5` was unmeasured.

## Desired End State

A parent asking about a medication, a symptom or a number in ordinary Polish — inflected, in a sentence, with or without naming a month — gets the note that answers it. The threshold carries a value derived from a corpus committed to the repository, with its table recorded beside it in the migration header, and an integration test turns red if that boundary moves in either direction.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| What the defect is | A miscalibrated cut-off, not mis-ranking | In all eight measured questions the correct note scored highest; only the floor dropped it | Frame |
| S-04's ranking premise | Refuted, not deferred | Measurement showed ordering is correct, so the slice as conceived has no defect to fix | Frame |
| Threshold form | One SQL default, re-derived | Keeps the shape three migrations already established; the measured gap shows one number does separate | Plan |
| Calibration corpus | 20–30 authored Polish notes committed as `supabase/seed.sql` | Repeatability is exactly what the rejected `p_text_rank_threshold` lacked; also fills a file `config.toml:60-65` already declares | Plan |
| Measurement tool | `scripts/measure-similarity.mjs`, read-only, outside `npm run gates` | Makes the number re-derivable by anyone; follows `backfill-embeddings.mjs`'s manually-run precedent | Plan |
| How to pin the number | Graded-vector helper + unit test for the math + integration test straddling the value | The only shape that can fail when the constant drifts; the harness cannot express a threshold today | Plan |
| If the bands overlap | Favour recall — set under the lowest true positive, record the admitted negatives | A parent would rather scan one extra note than miss the one they wanted; RRF truncates to ten anyway | Plan |
| Period phrase | In scope, but as a separate phase after the threshold is measured | Worth the measured `0.03–0.07`, but changing both at once makes neither attributable | Plan |

## Scope

**In scope:**

- A committed Polish note corpus and a read-only measurement script
- The derived threshold, landed as a new `create or replace` migration with its evidence in the header
- A graded-vector test helper, its unit test, and an integration test pinning both sides of the value
- Removal of the now-expired refusal comment in `notes-search.test.ts:16-22`
- Stripping the recognized period phrase from `p_query_text` and the embedded text, as the final phase

**Out of scope:**

- The date branch's `asc` sort against `listNotes`' `desc` — real, but unobserved
- The search placeholder that steers parents into period questions
- `test-plan.md` §2's missing risk and §7's stale exclusion — owned by `/10x-test-plan --refresh`
- Splitting the threshold per branch, or moving it to the caller
- Retuning `p_rrf_k` or `p_match_count`
- A reranker, Polish-specialised models, or `pg_trgm` — parked at `roadmap.md:136`, and the condition for reviving them is not met
- Pushing migrations to the hosted project — required before deploy, confirmed separately

## Architecture / Approach

Nothing about the search architecture changes: the hybrid shape, the two branches, RRF, the HNSW index and `SECURITY INVOKER` all stay as they are. One constant moves, and the test harness gains one capability it never had — constructing a vector at a chosen cosine similarity, which for unit vectors is just `[s, √(1−s²), 0, …]` against a query of `[1, 0, 0, …]`.

The sequencing is the design. Phases 1 and 2 change no behaviour and exist to give the number a provenance; Phase 3 lands it and pins it; Phase 4 removes the period phrase, which is only interpretable because Phase 3 closed with its own measurement.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Corpus and measurement tool | `supabase/seed.sql`, `scripts/measure-similarity.mjs`, embeddings filled | Authored Polish may not match how the parent actually writes, biasing the number |
| 2. Measure and choose the value | The similarity table, both bands, the chosen value and its margins | Bands may overlap, in which case recall wins and precision is paid for explicitly |
| 3. Land the value and pin it | Migration, graded-vector helper, unit test, integration assertions | The integration half cannot block a deploy; only the helper's unit test sits in the blocking seat |
| 4. Strip the period phrase | Strip helper, wired into the query path, with unit tests | A question that is only a period phrase leaves empty text — two separate failure modes to handle |

**Prerequisites:** Docker and a local Supabase stack; `OPENAI_API_KEY` in `.env`; `SUPABASE_SERVICE_ROLE_KEY` exported on the command line (it is not in `.env` and scripts do not read that file); Phase 4 must not start until Phase 3's re-measurement is recorded.

**Estimated effort:** ~3–4 sessions across 4 phases. Phase 1 is the largest, because authoring the corpus is the slow part.

## Open Risks & Assumptions

- **The corpus is authored, not harvested.** If it does not reflect how the parent abbreviates and inflects, the derived number inherits that bias. The Phase 1 manual criterion is a user review of the corpus for exactly this reason.
- **`backfill-embeddings.mjs` has not been run end to end since its paging rewrite** (`impl-review.md:46-48`), so Phase 1 is also its first real exercise.
- **Only the unit test can block a deploy.** The integration suite runs in the advisory `smoke` job, so the assertion that pins the threshold cannot stop a bad value from shipping — it can only report.
- **The hosted project's schema state is contradicted by the repo's own documents.** `gate:drift` is the only arbiter; running it is recommended before any push and is outside the phases.
- **`gate:drift` will fail from the moment the migration is committed** until it is pushed, which blocks the Cloudflare deploy path by design.
- **`test-plan.md` §2 still has no risk covering a silently dropped match**, so nothing in the risk map describes the defect this change fixes. Deliberately left to `/10x-test-plan`.

## Success Criteria (Summary)

- A parent asking `Czy dostawał Nurofenu w lipcu?`, `Czy miał gorączkę w lipcu?`, or the bare `Nurofenu` gets the note that answers it
- A question no note covers still says "Brak notatek pasujących do pytania."
- The threshold's value can be re-derived from the repository by anyone, and a test fails if it drifts
