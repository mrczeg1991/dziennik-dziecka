# Search Answer Completeness — Plan Brief

> Full plan: `context/changes/testing-search-completeness/plan.md`
> Research: `context/changes/testing-search-completeness/research.md`

## What & Why

Rollout Phase 4 of `context/foundation/test-plan.md` closes Risk #5: a parent
asking "how often was she ill in July" gets a wrong answer that reads as
authoritative. The date-bound branch of `search_notes` ANDs its window with a
relevance gate, so an in-window note that clears neither the full-text arm nor
the 0.434 similarity floor is silently dropped — while line 43 of the same
migration calls that branch's contract "completeness". This phase pins what the
code actually does, so the asymmetry stops being invisible.

## Starting Point

The search suite is in good shape and still cannot see this. `notes-search.test.ts:104-131`
proves both window edges, but gives every in-window note the same one-hot
embedding so similarity is 1.0 and the floor never decides — deliberately, per
its own comment. `notes-search.test.ts:173-201` pins the floor from both sides
with graded vectors, but passes no date range, so it exercises the ranked branch
instead. The technique exists; it has never been pointed at a windowed query.
Two true positives are knowingly below the floor today (0.402 and 0.347), and
this exact failure already happened once in production — it is what refuted and
parked roadmap slice S-04.

## Desired End State

A period-bounded question's behaviour is pinned by tests that fail for distinct,
nameable reasons: remove the gate and a below-floor note appears; remove the
window and an outside note appears; move the floor outside its measured
0.430–0.438 gap and a floor note flips. The §6 cookbook tells the next author
which synthetic vector to reach for, and why one-hot is the wrong choice when
the threshold itself is the subject.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| What counts as correct | Pin current behaviour; do not change the floor | Testable today and inside a test-only phase; changing it is a migration that re-opens the noise tradeoff settled 2026-10-24 | Plan |
| Assertion scope | Gate-inside-window only | The one property no existing test can observe; no-cap and half-open were explicitly dropped | Plan |
| Read paths | RPC **and** end-to-end through `searchNotes` | RPC owns the floor; end-to-end owns the plumbing — window pass-through and phrase stripping | Plan |
| End-to-end embeddings | Seed both notes with **no** embedding | `embedText` is real wherever `OPENAI_API_KEY` is set; an absent embedding switches the vector arm off per-row, so ids match with or without a key | Plan |
| Clock strategy | `dzisiaj` + `TODAY_WALL_CLOCK_DATE`, not a literal month | A bare month resolves to its most recent occurrence, so a fixed-month fixture expires | Research |
| Cookbook scope | §6.7 caveat plus a §6.6 phase note | Fixes the misleading advice at the point of use and keeps the per-phase record the three shipped phases established | Plan |
| Mechanism in §2 | Relevance gate, not truncation | The date branch has no `LIMIT`; `p_match_count` never reaches it, so the "truncated subset" framing was wrong | Research |

## Scope

**In scope:**

- A fixture child carrying a 2×2 of in/out-of-window × passes/fails the gate
- An RPC assertion on the exact returned id set, with each exclusion restated
- A today-scoped child and an end-to-end assertion through `@/lib/search`
- §6.7 correction, §6.6 phase note, §3 row 4 → `complete`

**Out of scope:**

- Any migration or behaviour change to the floor
- Asserting that *every* in-window note returns — red today by design
- The no-cap (11+ notes) proof and the half-open window hazard
- Re-testing window edges or wall-clock conversion (Phase 3 and S-03 own them)
- Any new CI gate; `test:int` already runs these

## Architecture / Approach

One query, one window, four notes on a dedicated child:

| Note | In window? | Clears an arm? | Expected |
| --- | --- | --- | --- |
| above-floor | yes | yes — vector, 0.454 | returned |
| full-text-only | yes | yes — `fts`, no embedding | returned |
| below-floor | yes | no — 0.414, no shared word | omitted |
| outside-window | no | yes — vector, 0.454 | omitted |

Phase 2 is the same gate seen through the application: `"gorączka dzisiaj"`
against two today-dated notes, one carrying the word. Because the phrase is
stripped before the text reaches the arms, the question doubles as a stripping
regression guard — leave `dzisiaj` in and the `'gorączka' & 'dzisiaj'`
conjunction matches nothing.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Fixture + gate RPC test | The 2×2 assertion on a new child | A below-floor note whose content accidentally shares a word with the query — the full-text arm then smuggles it back in and the test proves nothing |
| 2. End-to-end path test | `searchNotes` with phrase + word | A developer's `OPENAI_API_KEY` triggering a real call; mitigated by seeding no embedding |
| 3. Cookbook + close | §6.7, §6.6, §3 row 4 | Amending §6.7 without contradicting its surrounding text |

**Prerequisites:** a running local Supabase (`npx supabase start`) with
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` exported.
No OpenAI key required.
**Estimated effort:** ~1–2 sessions across 3 phases. No production code changes.

## Open Risks & Assumptions

- **This pins an undercount as correct.** A parent asking "how often … w lipcu"
  can still miss the two notes below the floor, and after this phase a passing
  suite says that is intended. Whether a windowed question should bypass the
  floor remains an open product question, deliberately not answered here.
- A run straddling Warsaw midnight breaks Phase 2's today-scoped fixture. It
  fails loudly rather than passing wrongly — the same tradeoff
  `notes-search-window.test.ts` already accepts.
- `SEARCH_FIXTURE` grows from 11 notes to 17 across five children. Its docstring
  is already stale at "two children, eight notes" and is corrected in Phase 1.

## Success Criteria (Summary)

- The date branch's real contract is written down and enforced: complete within
  the window *among relevance-passing notes*, not complete within the window.
- Moving the similarity floor, removing the gate, or breaking phrase stripping
  each turns a specific, named assertion red.
- The next person adding an AI-dependent test reads §6.7 and picks the right
  synthetic vector for what they are isolating.
