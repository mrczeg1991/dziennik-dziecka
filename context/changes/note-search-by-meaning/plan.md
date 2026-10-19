# Note search by meaning — Implementation Plan

## Overview

Implements FR-006 / roadmap slice S-03: on a child's page, a parent asks a free-text
question about that child's notes and gets back the matching notes with their dates
and links to the source entries. Matching combines semantic similarity (OpenAI
embeddings + pgvector) with exact-text matching (Polish-aware full text search), fused
in one database-side ranking function. A question naming a period ("w lipcu", "ostatni
tydzień") is additionally bounded by a hard date cutoff that returns every matching
note in that window, not a truncated top-N.

## Current State Analysis

- `public.notes` exists (`supabase/migrations/20260927205447_create_notes.sql`) with
  three RLS policies (`select`/`insert`/`update`, no `delete`) scoping every row to
  `user_id = auth.uid()`. No search-related column, extension, or function exists yet.
- `src/lib/notes.ts` holds `listNotes`/`createNote`/`updateNoteContent`/`softDeleteNote`,
  all taking a session-scoped Supabase client and relying on RLS for account isolation
  plus an explicit `child_id` filter for per-child scoping (RLS does not supply that —
  see the doc comment at `src/lib/notes.ts:18-23`).
- `src/pages/children/[id].astro` renders one child's notes: auth/ownership resolved
  through `getChild` (unknown or foreign child → 404), a failed list query rendered as
  an explicit error, never as "no notes" (`listFailed`, lines 53-60, 84-89). All
  mutation is plain HTML `POST` forms with a full-page redirect — no client-side fetch
  or JSON API exists anywhere in this codebase today.
- `src/lib/protected-routes.json` guards `/children` and `/api/notes` by prefix;
  `npm run gate:routes` enforces every route is classified.
- No pgvector, pg_trgm, unaccent, or full-text config exists in `supabase/config.toml`
  or any migration. No `ai`/`openai`/`zod` package is installed. Cloudflare is on the
  Free plan; `context/foundation/infrastructure.md:87` and
  `context/deployment/deploy-plan.md:201-202` both explicitly defer a Workers-Paid
  upgrade "until FR-006 is built" — a decision this plan does not revisit (stays Free,
  per the interview below).
- `tests/integration/fixtures.ts` already carries a 4-part fixture contract (reserved
  id prefix, teardown-on-both-sides, two clients, disjoint id spaces) used by suites 1
  (`notes-read-boundaries.test.ts`) and 2 (`notes-edit-scope.test.ts`); the cookbook
  (`context/foundation/test-plan.md` §6.3) already names id-space `3` as the next free
  slot.
- Prior research exists at `context/changes/fr-006-research/research.md` (2026-09-26,
  pre-dates the `notes` table). Its stack-compatibility findings still hold; its
  provider recommendation (Workers AI) was overridden in this planning session (see
  Key Decisions in the brief) and its date-range approach (LLM structured extraction)
  was replaced by a deterministic parser — both decided interactively below, not by
  re-opening that document's open questions.

## Desired End State

A parent on `/children/<id>` can type a question into a form on that page and, on the
same page reload, see the notes that match it — each with its date and nothing else
synthesized. A question containing a recognized Polish period phrase narrows the result
to that date window and returns every matching note in it. If the OpenAI call fails or
times out, the page still returns full-text-only matches rather than failing outright,
clearly marked as degraded. Existing notes (written before this ships) are not
searchable by meaning until the manual backfill script is run once, after the
reviewer-note below is satisfied.

**Verification**: `npm run test:unit`, `npm run test:int`, `npm run test:db`, and
`npm run gates` all pass; manually asking a question on a seeded child's page returns
the expected note(s), and asking about a date with no matching notes correctly returns
none (not every note).

### Key Discoveries:

- `createClient()` (`src/lib/supabase.ts:5-8`) and every data-access function in
  `src/lib/notes.ts` degrade explicitly (`null`, thrown error, `found: boolean`) rather
  than ever rendering a false empty/success state — the embedding client and the search
  orchestrator must follow the same contract.
- `occurred_at` is a **bare wall clock with no time zone** (`supabase/migrations/20260927205447_create_notes.sql:10`,
  doc comment in `src/lib/wall-clock.ts:1-4`): it stores the `YYYY-MM-DDTHH:mm` string
  the parent typed, verbatim. A date-range parser must therefore produce range
  boundaries in that same bare-wall-clock string space (Poland local time via
  `warsawWallClock()`), never a UTC `Date` comparison — otherwise the boundary is wrong
  by the DST offset twice a year, exactly the class of bug `tests/unit/wall-clock.test.ts`
  exists to catch.
- Research confirmed pgvector/pg_trgm/unaccent install into the `extensions` schema on
  Supabase, not `public` — any SQL referencing their types or functions inside a
  function body must schema-qualify them (`fr-006-research/research.md:70`,
  "Confirmed compatible" table).
- `fr-006-research/research.md`'s single most load-bearing finding (Gap 1) still
  applies unchanged: the search RPC must be called through the existing
  `@supabase/ssr` session client, never a service-role client, and the function itself
  must stay `SECURITY INVOKER` (the default) — RLS is this project's only isolation
  boundary, and a service-role call bypasses it regardless of the function's own
  definition.

## What We're NOT Doing

- Not implementing S-04 (`note-search-precision`) — ranking sharpness for exact-word
  questions is a separate, later slice per the roadmap's own prerequisite ordering.
- Not writing the dedicated completeness/boundary test suite for this feature —
  `context/foundation/test-plan.md` §3 Phase 4 ("Search answer completeness") explicitly
  reserves that to its own change, opened only after this feature exists. This plan
  ships baseline unit + integration coverage (Phase 5) and defers the deep
  boundary-sweep testing to that later change.
- Not upgrading the Cloudflare plan. Stays on Free per the interview decision; if CPU
  limits are hit in practice, that is a follow-up, not part of this plan.
- Not adding a privacy-policy document. The roadmap's milestone already resolved that
  notes may leave the current hosting boundary (`roadmap.md:35`); this plan treats that
  as settled and does not reopen it for the OpenAI provider choice.
- Not adding any new npm dependency. OpenAI's embeddings endpoint is called with plain
  `fetch`, matching this codebase's zero-dependency script convention
  (`scripts/smoke.mjs`, `scripts/gate-*.mjs`) — no `openai`, `ai`, or `zod` package.
- Not building a client-side JS search UI. The question form is a plain `GET` HTML
  form reloading the same Astro page, consistent with every other interaction in this
  codebase (no fetch-based island exists anywhere today).
- Not adding real OpenAI calls to CI. The embedding client is stubbed in integration
  tests; a real end-to-end check is manual, post-deploy.

## Implementation Approach

Database-first: add the extensions, columns, and one ranking function before any
application code touches them (mirrors this repo's established migration-then-code
ordering). The ranking function has two behavior modes selected by whether a date
range was recognized in the question:

- **No date range** — Reciprocal Rank Fusion (RRF, `k = 50`, matching Supabase's own
  hybrid-search guide default rather than the RRF paper's `60`, per the prior
  research's correction) combines the text-search rank and the vector-similarity rank,
  returning the top `match_count` (default 10) rows.
- **Date range present** — the date window is a hard filter (`occurred_at` between the
  parsed bounds), and *no* top-N truncation applies inside it: every row whose combined
  relevance clears a fixed similarity threshold is returned, ordered chronologically.
  This is the behavior the roadmap's own risk note demands ("returns every matching
  note in the interval, not just the few most similar") and is the one design point
  settled explicitly in this planning session rather than left to the implementer.

Everything that touches the external AI call (write-path embedding, query-path
embedding) degrades to `null`/full-text-only on failure, never a hard error and never a
silent empty result — the same contract `src/lib/supabase.ts` already uses for a
missing configuration.

## Critical Implementation Details

**`unaccent()` is not `IMMUTABLE`, and a generated column requires it to be.** Postgres's
`unaccent` contrib function is `STABLE` (its behavior can depend on the installed
dictionary), but a `GENERATED ALWAYS AS (...) STORED` column — and any index on an
expression — requires an `IMMUTABLE` function. The standard fix, well documented across
Postgres/Supabase discussions of this exact error, is a thin wrapper:

```sql
create or replace function public.immutable_unaccent(text)
returns text
language sql
immutable
as $$ select extensions.unaccent('extensions.unaccent', $1) $$;
```

Use `public.immutable_unaccent(content)` inside the generated `fts` column expression,
not `extensions.unaccent(...)` directly. Verify the exact dictionary-name argument
against the installed `unaccent` extension version while implementing Phase 1 — if the
wrapper's `immutable` claim is rejected by Postgres for this project's exact extension
version, fall back to a `before insert or update` trigger maintaining `fts` instead of
a generated column.

**Schema-qualify every pgvector/unaccent type and operator class.** Supabase installs
extensions into the `extensions` schema, not `public`
(`fr-006-research/research.md:70`). Reference `extensions.vector(1536)` and
`extensions.vector_cosine_ops` explicitly in the migration and the function body — an
unqualified `vector` type reference is the "function/type does not exist" failure mode
the prior research flagged.

**Verify how `supabase-js` serializes a `number[]` into a `vector` column before
trusting it in Phase 2.** Confirm with one real insert during implementation whether
passing the embedding as a plain JS array to `.insert({ embedding })` round-trips
correctly, or whether it must be sent as the pgvector literal string
(`` `[${embedding.join(",")}]` ``). Do not assume either without checking — this project
has no generated-types layer to catch a silent miscast.

## Phase 1: Database foundation — extensions, columns, search function

### Overview

Enables `pgvector` and `unaccent`, adds a vector column and a generated full-text
column to `notes`, and ships the one ranking function both the write path and the
question UI will call.

### Changes Required:

#### 1. Extensions, columns, indexes

**File**: new migration via `supabase migration new add_notes_search`

**Intent**: Enable `vector` and `unaccent` in the `extensions` schema; add
`notes.embedding extensions.vector(1536)` (nullable — a note without one is simply
excluded from the semantic arm, never an error) and a generated `notes.fts tsvector`
column over `public.immutable_unaccent(content)` with the `'simple'` text-search
config (no stemming is available for Polish — see the research's Correction #2 — so
exact/accent-insensitive word matching is the ceiling this arm aims for; synonym and
inflection coverage is the embedding arm's job). Add an HNSW index on `embedding` and a
GIN index on `fts`, both filtered `where deleted_at is null` to match the existing
`notes_child_id_occurred_at_idx` convention.

**Contract**: `notes.embedding extensions.vector(1536)` nullable;
`notes.fts tsvector generated always as (to_tsvector('simple', public.immutable_unaccent(content))) stored`;
`create index ... using hnsw (embedding extensions.vector_cosine_ops) where deleted_at is null`;
`create index ... using gin (fts) where deleted_at is null`. The `immutable_unaccent`
wrapper function from Critical Implementation Details ships in this same migration.

#### 2. The ranking function

**File**: new migration via `supabase migration new create_search_notes_function`

**Intent**: One `SECURITY INVOKER` SQL function, callable only through the
session-scoped client, that performs both ranking modes described in Implementation
Approach. `child_id` is a hard filter parameter to the function itself (not a
post-filter chained after `.rpc()`), per the research's confirmed finding that a
`.eq()` chained after `.rpc()` is applied only after the function's own ranking and
limit have already run.

**Contract**:

```
search_notes(
  p_child_id uuid,
  p_query_text text,
  p_query_embedding extensions.vector(1536),
  p_date_start timestamp default null,
  p_date_end timestamp default null,
  p_match_count int default 10,
  p_rrf_k int default 50,
  p_similarity_threshold float default 0.5
) returns table (id uuid, content text, occurred_at timestamp, created_at timestamptz, updated_at timestamptz)
language sql stable security invoker
```

No `with check`/ownership logic inside the function body — RLS on `public.notes`
already restricts every row the function can select to the calling account, exactly as
`listNotes` relies on it today. `p_child_id` scopes the result to one child for
correctness (per the roadmap's own risk note), not as a security boundary. When
`p_date_start`/`p_date_end` are both non-null, skip RRF/`match_count` entirely and
return every row in range whose text-rank or vector-similarity clears
`p_similarity_threshold`, ordered by `occurred_at`. `p_similarity_threshold` and
`p_rrf_k` are named constants the caller can override; document in the function's SQL
comment that `0.5` and `50` are unvalidated defaults, not measured values — real
match quality on this project's actual Polish, abbreviated notes is explicitly an open
unknown the roadmap already carries (owner: user), and this function should be easy to
retune once real usage exists.

### Success Criteria:

#### Automated Verification:

- `npm run test:db` passes, including a new pgTAP file asserting `search_notes` runs
  under `authenticated` and returns nothing for another account's notes (mirrors
  `01_notes_isolation.sql`'s pattern)
- `npx supabase db push --dry-run` (or local `supabase start`) applies both migrations
  cleanly

#### Manual Verification:

- `select extversion from pg_extension where extname = 'vector'` confirms a version
  with iterative index scan support, per the research's still-open question 4
- One real `select public.search_notes(...)` call against a seeded local database
  returns the expected row shape

**Implementation Note**: Pause here for manual confirmation the migrations applied and
the function is callable before starting Phase 2.

---

## Phase 2: Embeddings write path

### Overview

New notes get an embedding at write time; edited notes get a recomputed one. Every
embedding call is best-effort — a note's save never depends on, or is blocked by, the
external AI call succeeding, per the PRD guardrail that notes are never lost.

### Changes Required:

#### 1. OpenAI client module

**File**: `src/lib/embeddings.ts` (new)

**Intent**: Wraps a single `fetch` call to OpenAI's embeddings endpoint
(`text-embedding-3-small`, native 1536 dimensions — fits pgvector's HNSW limit of 2000
for the plain `vector` type with no truncation needed). Returns `null` on missing
configuration, a non-OK response, or a thrown error — mirrors `createClient()`'s
contract exactly, so every caller already knows how to handle it.

**Contract**: `embedText(text: string): Promise<number[] | null>`. Reads
`OPENAI_API_KEY` from `astro:env/server`.

#### 2. Astro env schema

**File**: `astro.config.mjs`

**Intent**: Declares the new secret the same way `SUPABASE_URL`/`SUPABASE_KEY` already
are.

**Contract**: `OPENAI_API_KEY: envField.string({ context: "server", access: "secret", optional: true })`.

#### 3. Wire into note create/edit

**File**: `src/lib/notes.ts`

**Intent**: `createNote` computes `embedText(content)` before the insert and includes
the result (possibly `null`) in the same insert payload — no second round trip.
`updateNoteContent` recomputes the embedding whenever `content` changes (a stale
embedding describing the old text would silently mis-rank future questions) and
includes it in the same update payload.

**Contract**: Both functions' signatures are unchanged from the caller's perspective;
only their internal payload gains an `embedding` field. Verify the array-vs-string
serialization question from Critical Implementation Details here, before relying on it
in Phase 1's own manual verification.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` and `npm run lint` pass with the new module
- New/updated `EXPECTED.eslintFiles` in `scripts/gate-scope.mjs` re-derived per
  `context/foundation/test-plan.md` §6.2 and committed in the same commit as the new
  files

#### Manual Verification:

- Creating a note through the UI, then reading it back from the database directly,
  shows a non-null `embedding` column when `OPENAI_API_KEY` is configured
- Temporarily unsetting `OPENAI_API_KEY` and creating a note still succeeds, with
  `embedding` left `null`

---

## Phase 3: Question UI and search orchestration

### Overview

A parent can type a question on a child's page and see matching notes on reload. Date
phrases narrow the result to a hard window; an embedding failure degrades to
full-text-only rather than failing the page.

### Changes Required:

#### 1. Deterministic Polish date-range parser

**File**: `src/lib/date-range-parse.ts` (new)

**Intent**: Recognizes a bounded set of common Polish period phrases ("w lipcu" and
other month names, "dzisiaj", "wczoraj", "w tym tygodniu", "w zeszłym/ostatnim
tygodniu", "w tym miesiącu", "w zeszłym miesiącu", "w tym roku", "w zeszłym roku") and
converts a recognized phrase into a `{ start, end }` pair of bare wall-clock strings
(exclusive upper bound), computed from `warsawWallClock()` — never from a UTC `Date`
comparison, per the Key Discoveries note on `occurred_at`'s stored shape. An
unrecognized phrase (or none) returns `null`, falling through to the ranked,
non-date-bound search mode.

**Contract**: `parsePolishDateRange(question: string, now: Date = new Date()): { start: string; end: string } | null`.
Table-driven against pinned instants in its unit tests, following the same pattern as
`tests/unit/wall-clock.test.ts` (§6.2's reference test) — including both 2026
Europe/Warsaw DST transitions, since a month/week boundary computed across one of them
is exactly where this parser could silently drift by an hour.

#### 2. Search orchestration

**File**: `src/lib/search.ts` (new)

**Intent**: Given a question and a child id, parses the date range, calls
`embedText(question)`, and calls `.rpc("search_notes", {...})` through the
session-scoped client with `p_child_id` as a function parameter (never a chained
`.eq()`). When `embedText` returns `null` (unconfigured or failed), still calls the
RPC with a null embedding and a degraded flag the caller renders explicitly — the
function's own ranking naturally falls back to text-only scoring since the vector arm
contributes nothing. Throws on a genuine query failure rather than returning an empty
list, matching `listNotes`'s contract.

**Contract**: `searchNotes(supabase, childId, question): Promise<{ results: Note[]; degraded: boolean; dateRange: { start: string; end: string } | null }>`.

#### 3. Page wiring

**File**: `src/pages/children/[id].astro`

**Intent**: Reads `Astro.url.searchParams.get("q")`; when present and non-empty, calls
`searchNotes` and renders a results section above the existing notes list, reusing the
existing card/list styling. A query failure renders the same explicit-error pattern as
`listFailed`, never a false "no matches." A degraded result shows a small inline note
("wyszukiwanie częściowo niedostępne — wyniki tylko tekstowe") rather than silently
returning worse results unlabeled. The question form is a plain `GET` form
(`action={`/children/${id}`}`, `method="GET"`) with an `input[name=q]` pre-filled from
the current query — no new route, no client-side JS, no change to
`protected-routes.json` (the page is already under the `/children` guard prefix).

**Contract**: No new Astro route or API endpoint. The existing page's frontmatter gains
a conditional search branch; the existing template gains a form and a results block.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` passes for the date-range parser
- `npm run lint` and `npx astro check` pass
- `npm run gate:scope` re-derived and passing per §6.2/§6.4

#### Manual Verification:

- Asking a question matching an existing note's topic (different word, same meaning)
  returns that note
- Asking a question naming a recognized period returns every note in that window, not
  a truncated subset
- Asking a question naming an unrecognized period phrase still returns ranked
  (non-date-bound) results rather than erroring
- Simulating an `OPENAI_API_KEY` failure (unset it) still returns full-text matches,
  visibly marked as degraded

**Implementation Note**: Pause here for manual confirmation before Phase 4 — the
backfill script in Phase 4 depends on this phase's embedding/search contract being
correct, and is itself irreversible once run against real data.

---

## Phase 4: One-time backfill script

### Overview

A manually-triggered, idempotent script that computes embeddings for every note that
doesn't have one yet — covering both the initial backfill of pre-existing notes and
retrying any note whose write-time embedding call failed in Phase 2.

### Changes Required:

#### 1. Backfill script

**File**: `scripts/backfill-embeddings.mjs` (new)

**Intent**: Zero-dependency script, run manually
(`SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... node scripts/backfill-embeddings.mjs`
against the target project — local or hosted), connecting with the service-role key
(this is an offline admin script run by the sole account owner, not a request path, so
`BYPASSRLS` is the correct tool here, not a bug). Selects every row where
`embedding is null and deleted_at is null`, computes an embedding per row, and writes
it back. Re-running it after a partial failure or after Phase 2 shipped simply
processes whatever still has `embedding is null` — no separate "retry" mode needed.
Respects OpenAI's 100-item batch cap on the embeddings endpoint if the note count ever
approaches it (unlikely at this project's scale, but cheap to batch defensively).

**Contract**: `npm run backfill:embeddings` script entry added to `package.json`. No
`npm run gates` dependency — this is an operator tool, not part of the deploy or CI
path, and is never run automatically.

### Success Criteria:

#### Automated Verification:

- `node scripts/backfill-embeddings.mjs` exits 0 against a local seeded database with
  at least one pre-existing null-embedding note

#### Manual Verification:

- **Before running against the real hosted database**: review existing notes for
  names or other directly identifying content, per the roadmap's own sequencing
  (`roadmap.md:84` — this review must happen before the irreversible step, not after).
  This review is yours to perform; the plan does not and cannot verify note content on
  your behalf.
- After running against the hosted project, a note written before this feature existed
  becomes findable through the question UI

---

## Phase 5: Tests, gates, and deploy runbook

### Overview

Baseline correctness coverage for the new isolation-sensitive and date-boundary logic,
plus the mechanical gate/runbook updates every new file in this codebase carries.

### Changes Required:

#### 1. Database policy test

**File**: `supabase/tests/04_notes_search.sql` (new; next free number after
`03_notes_destruction.sql`)

**Intent**: Asserts `search_notes` run as one authenticated user returns nothing
scoped to another account's or another child's notes, and excludes soft-deleted notes
— mirrors `01_notes_isolation.sql`'s pattern per §6.1.

**Contract**: Follows the fixture-before-role-switch skeleton in
`context/foundation/test-plan.md` §6.1.

#### 2. Unit tests

**File**: `tests/unit/date-range-parse.test.ts` (new)

**Intent**: Table-driven against pinned instants, covering both 2026 Europe/Warsaw DST
transitions for any week/month boundary, per §6.2's established pattern.

#### 3. Integration test suite 3

**File**: `tests/integration/notes-search.test.ts` (new), declares `SEARCH_FIXTURE`
in `tests/integration/fixtures.ts` under id-space `3` (the next free slot per §6.3)

**Intent**: Seeds notes with precomputed fixture embeddings (never a real OpenAI call
in CI — the embedding client is stubbed/injected so the test controls the vector
directly), asserting: a semantically-near note is returned for a differently-worded
question; a date-bound question returns every matching note in range and none outside
it, with the expected set taken from the fixture, never from re-running
`search_notes` itself (the oracle-problem anti-pattern `notes-read-boundaries.test.ts`
already avoids); an embedding-call failure still returns full-text matches.

#### 4. Gate and runbook updates

**File**: `scripts/gate-scope.mjs`, `context/deployment/deploy-plan.md`

**Intent**: Re-derive `EXPECTED.eslintFiles` per §6.2/§6.4/§6.5 for every new linted
file this plan adds. Update the deploy runbook's "LLM API key (FR-006, NL-query)" row
(`deploy-plan.md:182`) from "odłożone" to the real `wrangler secret put OPENAI_API_KEY`
step, and remove it from the out-of-scope list at `deploy-plan.md:201`.

#### 5. Cookbook note

**File**: `context/foundation/test-plan.md` §6 (new `6.7` subsection, or appended to
`6.6`'s per-phase notes)

**Intent**: One short note recording that id-space `3` is now taken
(`notes-search.test.ts`) and pointing to this change as the reference for "a test that
stubs an external AI call rather than hitting it live" — the next person adding an
AI-dependent test needs this pattern once test-plan's own Phase 4 opens.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit`, `npm run test:int`, `npm run test:db` all pass
- `npm run gates` passes end to end (lint, typecheck, scope, routes, drift, build,
  build-output)

#### Manual Verification:

- Re-read `deploy-plan.md`'s updated secrets table and confirm it matches what was
  actually configured before the next real deploy

---

## Testing Strategy

### Unit Tests:

- Date-range parser: every recognized phrase category, both DST transition boundaries,
  an unrecognized phrase returning `null`

### Integration Tests:

- Cross-account and cross-child isolation for `search_notes` (extends the existing
  `fixtures.ts` harness, id-space 3)
- Date-bound completeness: a seeded set straddling both edges of a window, expected
  set taken from the fixture
- Degraded-mode fallback when the embedding client returns `null`

### Manual Testing Steps:

1. Ask a question using a different word than any existing note and confirm the
   semantically matching note(s) appear
2. Ask a question naming a recognized period and confirm every note in that window
   appears, and none outside it
3. Temporarily unset `OPENAI_API_KEY` and confirm search still returns full-text
   matches, visibly marked degraded
4. Run the backfill script against a local seeded database and confirm previously
   null-embedding notes become findable afterward

## Performance Considerations

Each question costs one OpenAI call (embedding) plus one Supabase RPC call — matching
the "one Supabase fetch + one LLM call" budget `infrastructure.md`'s risk register
names for staying within the Free plan's CPU/subrequest limits. No second LLM call
(the date-range parser is pure code, not an LLM extraction), keeping the question
flow inside the PRD's 10-second NFR with margin.

## Migration Notes

Existing notes (written before this ships) have `embedding is null` until Phase 4's
backfill script is run manually. They remain visible and editable throughout — nothing
in Phases 1-3 touches existing row content, and the new columns are nullable.

## References

- Related research: `context/changes/fr-006-research/research.md`
- Similar implementation: `src/lib/notes.ts`, `src/pages/children/[id].astro`,
  `src/pages/api/notes.ts`
- Isolation test pattern: `supabase/tests/01_notes_isolation.sql`
- Integration fixture harness: `tests/integration/fixtures.ts`,
  `tests/integration/notes-read-boundaries.test.ts`
- Wall-clock convention: `src/lib/wall-clock.ts`, `tests/unit/wall-clock.test.ts`
- Test-rollout context: `context/foundation/test-plan.md` §3 Phase 4 (deferred, not
  this plan), §6.1-§6.3 (patterns this plan extends)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database foundation — extensions, columns, search function

#### Automated

- [x] 1.1 `npm run test:db` passes, including a new pgTAP file asserting `search_notes` runs under `authenticated` and returns nothing for another account's notes — 2b072e1
- [x] 1.2 `npx supabase db push --dry-run` (or local `supabase start`) applies both migrations cleanly — 2b072e1

#### Manual

- [x] 1.3 `select extversion from pg_extension where extname = 'vector'` confirms a version with iterative index scan support — 2b072e1
- [x] 1.4 One real `select public.search_notes(...)` call against a seeded local database returns the expected row shape — 2b072e1

### Phase 2: Embeddings write path

#### Automated

- [x] 2.1 `npm run test:unit` and `npm run lint` pass with the new module — 5ca6708
- [x] 2.2 `EXPECTED.eslintFiles` in `scripts/gate-scope.mjs` re-derived and committed with the new files — 5ca6708

#### Manual

- [x] 2.3 Creating a note through the UI, then reading it back directly, shows a non-null `embedding` column when `OPENAI_API_KEY` is configured — 5ca6708
- [x] 2.4 Temporarily unsetting `OPENAI_API_KEY` and creating a note still succeeds, with `embedding` left `null` — 5ca6708

### Phase 3: Question UI and search orchestration

#### Automated

- [x] 3.1 `npm run test:unit` passes for the date-range parser — 588d86e
- [x] 3.2 `npm run lint` and `npx astro check` pass — 588d86e
- [x] 3.3 `npm run gate:scope` re-derived and passing — 588d86e

#### Manual

- [x] 3.4 Asking a question matching an existing note's topic (different word, same meaning) returns that note — 588d86e
- [x] 3.5 Asking a question naming a recognized period returns every note in that window, not a truncated subset — 588d86e
- [x] 3.6 Asking a question naming an unrecognized period phrase still returns ranked (non-date-bound) results rather than erroring — 588d86e
- [x] 3.7 Simulating an `OPENAI_API_KEY` failure still returns full-text matches, visibly marked as degraded — 588d86e

### Phase 4: One-time backfill script

#### Automated

- [x] 4.1 `node scripts/backfill-embeddings.mjs` exits 0 against a local seeded database with at least one pre-existing null-embedding note

#### Manual

- [x] 4.2 Reviewed existing notes for identifying content before running against the real hosted database
- [x] 4.3 After running against the hosted project, a pre-existing note becomes findable through the question UI

### Phase 5: Tests, gates, and deploy runbook

#### Automated

- [ ] 5.1 `npm run test:unit`, `npm run test:int`, `npm run test:db` all pass
- [ ] 5.2 `npm run gates` passes end to end

#### Manual

- [ ] 5.3 Re-read `deploy-plan.md`'s updated secrets table and confirm it matches what was actually configured
