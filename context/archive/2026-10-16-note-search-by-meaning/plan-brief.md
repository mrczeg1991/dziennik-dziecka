# Note search by meaning — Plan Brief

> Full plan: `context/changes/note-search-by-meaning/plan.md`
> Research: `context/changes/fr-006-research/research.md`

## What & Why

Implements FR-006 (roadmap slice S-03): on a child's page, a parent asks a free-text
question about that child's notes and gets back the matching notes with their dates
and links to the source entries — no synthesized summary. This is the product's named
differentiator (PRD §Success Criteria, Secondary) and the roadmap's North Star for
milestone M-2.

## Starting Point

`public.notes` exists with full CRUD and RLS isolation (`src/lib/notes.ts`,
`src/pages/children/[id].astro`, `src/pages/api/notes.ts`), but nothing related to
search exists yet: no pgvector/full-text extension, no embedding, no AI call anywhere
in the codebase. This is a clean slate for the feature, confirmed by a fresh grep
across `src/`, `supabase/`, and `scripts/`.

## Desired End State

A parent types a question into a form on their child's page and, on reload, sees the
notes that match it — by meaning, not just shared words — each with its date. A
question naming a period ("w lipcu") narrows the result to every matching note in that
window, not a truncated top few. If the AI call fails, search still works on text
alone, visibly marked as degraded rather than silently worse.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Matching approach | Semantic embeddings (hybrid with full-text), not text-only | Needed to catch paraphrases like "gorączkę" → "gorączka 38,5" that no Polish stemming config can | Plan (interview) |
| Date-range parsing | Deterministic Polish phrase parser, no second LLM call | Zero added latency/cost against the 10s NFR; date-cutoff completeness becomes a pure testable function | Plan (interview) |
| AI/embeddings provider | OpenAI (`text-embedding-3-small`), not Workers AI | User's explicit choice, overriding the research-recommended Workers AI path | Plan (interview) |
| Cloudflare plan | Stay on Free | Matches `infrastructure.md`'s own named mitigation; no new recurring cost before the feature proves its value | Plan (interview) |
| Existing-notes backfill | In this plan, as a manual-trigger script | Keeps the irreversible one-time processing step under explicit user control, per the roadmap's own review-before-backfill sequencing | Plan (interview) |
| AI-call failure (query time) | Fall back to full-text-only, marked degraded | Matches this codebase's "explicit degradation, never silent emptiness" convention while staying useful within 10s | Plan (interview) |
| CI coverage of the AI path | Stub the embedding client in tests; no real OpenAI calls in CI | Keeps the blocking test gate deterministic and free of a new external-outage failure mode | Plan (interview) |
| Date range + topic together | Hard date filter + similarity threshold (not top-N) within the window | Preserves the topic word's meaning even when a date is also named — a pure date-only filter would ignore "gorączka" entirely once a month is mentioned | Plan (interview) |

## Scope

**In scope:**
- `pgvector` + `unaccent` extensions, embedding + full-text columns on `notes`, one
  `SECURITY INVOKER` ranking function
- OpenAI embedding calls on note create/edit (best-effort, never blocks the save)
- Deterministic Polish date-range parser
- Question form + results on the existing child page (no new route)
- Manual one-time backfill script for pre-existing notes
- Baseline unit/integration/policy tests

**Out of scope:**
- S-04 (search precision for exact-word questions) — later slice
- The dedicated search-completeness test rollout — `test-plan.md` §3 Phase 4, a
  separate change opened after this one ships
- Upgrading the Cloudflare plan
- Any new npm dependency (OpenAI called via plain `fetch`)
- A privacy-policy document (roadmap already resolved notes may leave current hosting)

## Architecture / Approach

Database-first: migrations add the extensions/columns/function before any app code
touches them. One `search_notes()` SQL function fuses full-text and vector ranking via
RRF when no date is named, or switches to a hard-date-filter + similarity-threshold
mode (no truncation) when one is. The question form is a plain `GET` HTML form
reloading the same Astro page — consistent with every other interaction in this
codebase, which uses no client-side fetch anywhere today. Every AI call (write-time and
query-time) degrades to `null`/text-only on failure, mirroring `createClient()`'s
existing contract.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database foundation | Extensions, columns, `search_notes()` function | `unaccent()` not being `IMMUTABLE` breaks the generated column — has a documented fallback (trigger) |
| 2. Embeddings write path | New/edited notes get embeddings, best-effort | `supabase-js` vector serialization needs verifying, not assuming |
| 3. Question UI + orchestration | Date parser, search orchestration, page wiring | Date+topic threshold behavior is a genuinely novel design point, not a copy of an existing pattern |
| 4. One-time backfill | Manual script for pre-existing notes | Irreversible; gated on a manual content review the plan cannot perform |
| 5. Tests, gates, runbook | Policy/unit/integration tests, gate re-derivation, deploy runbook update | None beyond the mechanical re-derivation discipline this codebase already enforces |

**Prerequisites:** S-02 (notes exist) — already shipped. `OPENAI_API_KEY` obtained and
ready to configure as a Cloudflare secret in Phase 5.
**Estimated effort:** 5 phases, single-session implementation per phase with manual
pause points after Phases 1, 3, and 4.

## Open Risks & Assumptions

- `0.5` similarity threshold and `rrf_k = 50` are documented but unvalidated defaults —
  real match quality on this project's actual Polish, abbreviated health notes is an
  open unknown the roadmap already owns (owner: user), not something this plan can
  measure before real usage exists.
- The deterministic date-range parser only recognizes a fixed phrase set; an
  unanticipated phrasing silently falls through to ranked (non-date-bound) search
  rather than erroring — documented behavior, not a bug, but worth remembering when
  reading "no date match" results.
- `unaccent()`'s immutability and the exact `supabase-js` vector serialization format
  are both flagged for verification at implementation time rather than assumed.

## Success Criteria (Summary)

- A parent asking a question gets back notes matching its meaning, with dates
- A period-bound question returns every matching note in that window, never a
  truncated subset
- A failed AI call degrades to text-only search rather than breaking the page
- Existing notes become searchable once the reviewed backfill script is run
