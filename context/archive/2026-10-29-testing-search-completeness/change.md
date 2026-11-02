---
change_id: testing-search-completeness
title: Search answer completeness — test-plan rollout Phase 4
status: archived
created: 2026-10-29
updated: 2026-11-02
archived_at: 2026-11-02T19:55:55Z
---

## Notes

Rollout Phase 4 of `context/foundation/test-plan.md`: "Search answer completeness".

**Risks covered:** Risk #5 (ranking half) — a question bounded to a period
returns every note whose event time falls inside it and none outside it, with
the boundary resolved in the parent's wall clock.

**Test types planned:** integration.

**Risk response intent:** prove that a period-bounded answer is complete within
its range now that ranking exists — a "how often" or "in July" question must
not return a plausible top-N subset, because a wrong count reads as
authoritative. The window conversion itself is already covered by rollout
Phase 3; what is unproven is completeness once the similarity floor and ranking
sit in front of the read.

**Corrected by research 2026-10-29.** The original wording here said "nothing
automated guards it today," citing S-03's manual Progress step 3.5. That is
overstated: `tests/integration/notes-search.test.ts:104-131` already asserts
both window edges, and `notes-search-window.test.ts:36-70` covers the
window-only path. What is genuinely unguarded is narrower and sharper — the
window predicate is **ANDed** with a relevance gate
(`supabase/migrations/20261027140907_recalibrate_search_notes_similarity_floor.sql:147-157`),
and the existing edge test deliberately neutralizes that gate by giving every
in-window note the same one-hot embedding. See `research.md`.

**Anti-pattern to avoid (from §2):** deriving the expected set by running the
same query the code runs — the oracle problem. The expected set must come from
the fixture, and the test must cover both boundary instants, not only
mid-window notes.
