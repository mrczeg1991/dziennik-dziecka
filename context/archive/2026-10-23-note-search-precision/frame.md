# Frame Brief: Exact-word precision in note search (S-04)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.
>
> **Outcome: the slice's ranking premise was measured and refuted. A heavier
> defect was found instead — a miscalibrated similarity floor in S-03 that
> silently drops matching notes for inflected Polish questions.**
>
> Two corrections were made during this frame and are recorded as such: the
> symptom is not mis-ordering but emptiness (§Measurement), and the cause is not
> the period phrase but the `0.5` floor (§Root Cause).

## Reported Observation

**(a) The roadmap's anticipated claim**, authored 2026-10-01 — *before* S-03
existed — `context/foundation/roadmap.md:92`:

> "rodzic pytający o dokładne słowo — nazwę leku, liczbę, nazwisko lekarza —
> dostaje notatkę zawierającą właśnie to słowo wyżej niż notatkę jedynie
> podobną znaczeniowo."

Status `proposed`. A *prediction*, not an observation.

**(b) The user's recalled report** (2026-10-23): an exact-word question returned
the right note **present but ranked below a merely-similar one**. Question text
and result order were never recorded.

**This did not reproduce.** What reproduces is an *empty* result.

## Initial Framing (preserved)

- **User's stated cause or approach**: semantic matching is inherently fuzzy, so
  exact-word questions need added ranking sharpness layered on top of S-03.
- **User's proposed direction**: open S-04 as a slice that adds precision.
- **Pre-dispatch narrowing**: "saw bad ordering"; shape "present but ranked too
  low"; token form "inflected Polish form".

## Measurement (2026-10-24)

Local stack. Four notes on one child, `occurred_at` in July 2026, verified in the
UI; all four carry embeddings. N1 `Kupiłam nowe buty…` (05.07), N2 `Gorączka 38,5
wieczorem…` (12.07), N3 `Katar od trzech dni…` (20.07), N4 `Podałam Nurofen 2,5 ml,
bo bolał ząb…` (28.07).

**Step 1 — UI behaviour:**

| Question | Period banner | Result |
| --- | --- | --- |
| `Czy dostawał Nurofenu w lipcu?` | yes, July 2026 | **zero records** |
| `Czy dostawał Nurofen w lipcu?` | yes, July 2026 | correct note |
| `Czy dostawał Nurofenu?` | no | correct note |
| `Gorączka w lipcu` | yes, July 2026 | fever note |

**Step 2 — actual cosine similarity** (`text-embedding-3-small`, measured directly
against the stored embeddings; script was read-only and lives outside the repo):

| Question | N1 | N2 | N3 | **N4** |
| --- | --- | --- | --- | --- |
| `Czy dostawał Nurofenu w lipcu?` | 0.262 | 0.225 | 0.230 | **0.475** |
| `Czy dostawał Nurofen w lipcu?` | 0.318 | 0.286 | 0.288 | **0.592** |
| `Czy dostawał Nurofenu?` | 0.267 | 0.215 | 0.243 | **0.507** |
| `Czy dostawał Nurofen?` | 0.314 | 0.290 | 0.326 | **0.662** |
| `Nurofenu` | 0.091 | 0.085 | 0.079 | **0.324** |
| `Nurofen` | 0.102 | 0.166 | 0.136 | **0.525** |
| `Gorączka w lipcu` | 0.296 | **0.596** | 0.381 | 0.324 |
| `Czy miał gorączkę w lipcu?` | 0.276 | **0.491** | 0.341 | 0.369 |

Bold = the note that genuinely answers the question. Floor is `0.5`.

**Cost of inflection** (same note, one letter changed): `−0.201` bare word
(0.525 → 0.324), `−0.155` sentence (0.662 → 0.507), `−0.117` sentence with phrase
(0.592 → 0.475).
**Cost of the period phrase**: `−0.070` base form (0.662 → 0.592), `−0.032`
inflected (0.507 → 0.475).

**Inflection costs 2–6× more than the period phrase.**

### What the numbers establish

1. **The floor cuts through the middle of the true-positive band.** True positives
   span `0.475 – 0.662`; true negatives top out at `0.381`. The gap `0.381 – 0.475`
   is empty, so a floor near `0.42–0.44` separates cleanly with margin on both
   sides. At `0.5`, two genuine matches are discarded.
2. **The one "working" case passes by 0.007.** `Czy dostawał Nurofenu?` scores
   `0.507`. The conclusion that ranking is adequate rests on that margin.
3. **A second, previously unseen empty case**: `Czy miał gorączkę w lipcu?` scores
   `0.491` against the fever note sitting in the window → zero results. A natural
   Polish question with an inflected noun. The Nurofen case is not an outlier; it
   is the rule for inflected questions.
4. **Ordering itself is never wrong.** In every row, the correct note scores highest
   of the four by a wide margin (e.g. `0.662` vs `0.314/0.290/0.326`). There is no
   mis-ranking to fix — only a cut-off applied before ranking matters.

## Root Cause

> **`p_similarity_threshold = 0.5` is miscalibrated for `text-embedding-3-small` on
> short Polish text with inflected queries.** Inflected question forms cost
> `0.12–0.20` cosine similarity against base-form note text, which places genuine
> matches on both sides of a fixed `0.5` floor. The vector arm is the *only* gate
> that can admit such a note, because the lexical arm cannot fire — so a note that
> plainly answers the question is dropped silently and the parent sees
> "Brak notatek pasujących do pytania."

Three facts make the floor the sole decider:

- **The lexical arm cannot rescue it.** `fts` is `to_tsvector('simple', …)` with no
  stemming (`20261017103455_…sql:28-34`, stated there as intent: *"Inflection and
  synonym coverage is the embedding arm's job"*), and `websearch_to_tsquery` ANDs
  unquoted words while `'simple'` strips no Polish stopwords. An inflected token
  cannot match, and a sentence requires every word verbatim.
- **The period phrase is a secondary contributor, not the cause.** It is consumed by
  the date filter yet left in both `p_query_text` and `embedText` (`search.ts:35-37`;
  `date-range-parse.ts` exports only `formatDateRange:64` and
  `parsePolishDateRange:98` — no strip helper exists). Measured cost: `0.03–0.07`.
  Worth fixing, but it is not what crosses the floor.
- **`ed302b8` is three days old and extended this floor to the common path.** Before
  it, the RRF branch admitted every embedded note. Its own header warned: *"If 0.5
  turns out to be too strict for text-embedding-3-small on short Polish text, the
  symptom is a question returning 'Brak notatek pasujących do pytania.' for a note
  that plainly matches."* **That prediction is now measured as correct.** On the RRF
  branch, `0.507` is all that stands between the current behaviour and the same
  failure.

**Why this is serious rather than cosmetic**: the date-bound branch exists to
guarantee *completeness* — `20261019215004_…sql:14-19`, *"every matching note in the
interval, not just the few most similar."* It returns zero. The project's own
motivating example is period-shaped (*"jak często Jaś miał gorączkę w lipcu?"*,
`fr-006-research/libraries.md:107`) and measures `0.491` — it fails. The UI
compounds it: the placeholder is `np. Co jadła w zeszłym tygodniu?`
(`children/[id].astro:115`), steering parents straight at this path.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **Miscalibrated `0.5` floor vs inflected Polish** | Measured: true positives `0.475–0.662`, true negatives ≤ `0.381`, inflection costs `0.12–0.20`. Two genuine matches fall below the floor; one passes by `0.007`. | **CONFIRMED by measurement** |
| **D2: RRF gives exactness no weight advantage** | Arithmetic is sound on paper (`1/51` tie, arm-presence worth 4.67× the within-arm spread). But measurement shows the correct note scores highest in every single row — ordering is never the failure. | **REFUTED as a live problem** |
| **Period phrase not stripped from query text / embedded text** | Real and unfixed (no strip helper; `search.ts:35-37` passes the raw question), and it does make the text arm structurally dead for period questions. Measured similarity cost only `0.03–0.07`. | **Real, secondary** |
| **D4: observed question landed in the chronological branch** | It did route there, but the branch returned nothing — chronological ordering cannot be the symptom. | **REFUTED as the cause** |
| **D4b: date branch sorts opposite to the rest of the product** | `notes.ts:31` is `occurred_at desc`; the date branch is `asc` (`…sql:139`). Real, cheap, still **unobserved** — with zero rows there is nothing to order. | **STRONG, latent** |
| **D1: lexical arm inert for these queries** | Confirmed, and it is why the floor is the only gate. No Polish config, no dictionary, no `pg_trgm`, no prefix match, no query normalization exists anywhere in the repo. | **STRONG** |
| **Pool sizing / `match_count`** | Inner limit 100 against a six-note child; `full_text` has no limit. Provably inert. | **NONE** |

## Narrowing Signals

- `Czy dostawał Nurofen w lipcu?` working while `Czy dostawał Nurofenu w lipcu?`
  fails — same length, same phrase, one letter — isolated inflection as the
  dominant variable. This came from the user and overturned the brief's prior
  root cause.
- Q2 returning the correct note removed the justification for S-04 as a ranking slice.
- Q1 returning zero rather than a bad order redirected the whole investigation
  from ranking to recall.
- The measured gap `0.381 – 0.475` turned "is 0.5 too strict?" from an opinion
  into a number.

## Cross-System Convention

- **Completeness is the date branch's stated contract**, and it is violated.
- **A reranker / Polish-specialised model stays parked.** `roadmap.md:136` and
  `test-plan.md:924-930` gate it on S-03's accuracy proving too low. Retrieval
  *ordering* is fine; the defect is a cut-off. The gate is still not met.
- **A second magic number was already rejected** (`impl-review.md:135-138`):
  *"Introduces a second unvalidated magic number."* The fix here does not add a
  number — it **measures the one that already exists**.
- **Nothing is instrumented.** No test asserts order, and none covers an inflected
  question whose words are absent from the note. `idsOf()` sorts by id
  (`notes-search.test.ts:54-56`); fixtures share one one-hot vector
  (`fixtures.ts:194-200`), so five notes sit at distance 0.0 and no threshold
  behaviour can be pinned there.
- **`pg_trgm`** (`libraries.md:40`, ruled in for *"inflection near-misses"*) would
  address inflection in the lexical arm — a real option, but not required to fix
  the measured defect.

## Reframed Problem Statement

> **The actual problem to plan around is**: a question asked in natural, inflected
> Polish returns "Brak notatek pasujących do pytania." for a note that plainly
> answers it, because `p_similarity_threshold = 0.5` sits inside the true-positive
> similarity band for this embedding model and language, and the lexical arm cannot
> compensate. Retrieval ranking is correct; the cut-off is wrong.

The initial framing — "semantic matching is too fuzzy, add exact-word sharpness" —
is **refuted by measurement**. In all eight measured questions the correct note
scored highest of the four. S-04 as conceived has no defect to fix, so the
roadmap's own instruction applies: *"ten kawałek należy zawęzić albo zaparkować,
nie rozbudować"* (`roadmap.md:100`).

## Confidence

**HIGH** on the direction and the mechanism: 32 measured similarity values, a clean
separating gap, a one-letter controlled comparison, and the failure reproduced in
the UI exactly where the numbers predict it.

**Bounded by sample size.** Four notes, eight questions, one child. The *direction*
(`0.5` is too strict) is unambiguous; the *replacement value* is not. `0.42–0.44`
separates perfectly on this fixture, but a fixture this small cannot fix a
production constant — widening the note set before choosing a number is part of
the work, not a precondition for starting it.

## What Changes for /10x-plan

1. **S-04 does not proceed as written.** Its ranking premise is measured and
   refuted. Narrow it to the latent items or park it — no reranker, no third arm,
   no arm re-weighting.
2. **The real work is a new change against S-03's similarity floor**: measure
   `p_similarity_threshold` against a wider, realistic Polish note set and set it
   from data, instead of the current unvalidated `0.5`. The caller passes no
   tuning parameters today (`search.ts:33-39`), so retuning requires a migration —
   decide in the plan whether the value stays a SQL default or becomes
   caller-supplied.
3. **Reverting `ed302b8` is on the table and should be decided explicitly.** It
   introduced this floor to the RRF branch three days ago; on the measured data
   that branch clears it by `0.007`. Reverting restores over-broad results, which
   is a different failure — the plan must choose, not drift.
4. **Secondary, cheap, carry along**: strip the recognized period phrase before
   `p_query_text` and `embedText` (worth `0.03–0.07`); fix `asc`/`desc` against
   `listNotes`; reconsider the placeholder that steers parents into period questions.
5. **Do not change the floor and strip the phrase in the same step** without
   measuring between them, or neither effect will be attributable.
6. **Roadmap needs updating** (`/10x-roadmap`, not this skill): the open unknown at
   `roadmap.md:99` — *"czy nieostrość dopasowania znaczeniowego jest realnym
   problemem"* — is **answered: no, ordering is fine; the cut-off is the problem**,
   with the table above as the record.

## References

- Measurement procedure: `verification-scenarios.md` (same folder); numbers in §Measurement above
- Floor and both branches: `supabase/migrations/20261020200647_tune_search_notes_rrf_relevance.sql:70-87, 86, 104-127, 137-139`, and its self-warning at `:29-36`
- Date branch's completeness contract: `supabase/migrations/20261019215004_fix_search_notes_text_threshold.sql:14-19`
- `'simple'` ceiling: `supabase/migrations/20261017103455_add_notes_search.sql:28-34`
- Query path / no strip helper: `src/lib/search.ts:33-39`; `src/lib/date-range-parse.ts:64, 98, 136-149`
- Embedding model: `src/lib/embeddings.ts:4, 19-20`
- Sort inconsistency: `src/lib/notes.ts:31`
- UI indicators and placeholder: `src/pages/children/[id].astro:115, 135-137, 140-142, 145`
- Test blind spots: `tests/integration/notes-search.test.ts:16-22, 54-56`; `tests/integration/fixtures.ts:194-200`
- Prior decisions: `context/foundation/roadmap.md:92-101, 136`; `context/foundation/test-plan.md:924-930`; `context/foundation/fr-006-research/libraries.md:40, 107`; `context/changes/fr-006-research/research.md:70, 161-175`; `context/archive/2026-10-16-note-search-by-meaning/reviews/impl-review.md:126-127, 135-138`
- Investigations: 3 parallel read-only sub-agents (lexical-arm blindness; RRF fusion arithmetic; gating + branch routing + prior-art sweep)
