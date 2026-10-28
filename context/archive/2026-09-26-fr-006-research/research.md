---
date: 2026-09-26T23:19:46+02:00
researcher: marcin.zegunia2
git_commit: 67275da704675c9bd87c01abbdda1ef74d617a59
branch: master
repository: 10xdevs_projekt
topic: "Is context/foundation/fr-006-research/libraries.md compatible with this codebase, for implementing FR-006 from the roadmap?"
tags: [research, codebase, fr-006, pgvector, workers-ai, supabase, rls, cloudflare]
status: complete
last_updated: 2026-09-26
last_updated_by: marcin.zegunia2
---

# Research: FR-006 library compatibility against the current codebase

**Date**: 2026-09-26T23:19:46+02:00
**Researcher**: marcin.zegunia2
**Git Commit**: 67275da704675c9bd87c01abbdda1ef74d617a59
**Branch**: master
**Repository**: 10xdevs_projekt

## Research Question

Review the codebase and decide whether `context/foundation/fr-006-research/libraries.md` is compatible
with it, for implementing FR-006 (`context/foundation/roadmap.md:108` — parent asks a natural-language
question about a child's notes) from the roadmap.

> Path note: the request referenced `context/changes/fr-006-research/libraries.md`. No such file exists.
> The reviewed documents are `context/foundation/fr-006-research/libraries.md` (8,938 bytes) and its
> sibling `context/foundation/fr-006-research/open-ai-documentation.md` (7,790 bytes).

## Summary

**Verdict: the recommended stack is compatible with this codebase.** Every load-bearing platform claim
in `libraries.md` that this review checked held up, including the one it presents as a blocking
compatibility gotcha. Its central architectural argument — keep the index inside Supabase so ownership
stays an RLS property rather than hand-written metadata filtering — matches the isolation decision this
repo already made and recorded (`context/archive/2026-09-23-child-profiles/plan.md:12`).

Three qualifications, none of which changes the recommendation:

1. **One sequencing blocker, outside the document's scope.** FR-006 embeds notes; there is no notes
   table. `supabase/migrations/` contains exactly one migration, `20260923221601_create_children.sql`,
   and `context/changes/first-child-note/` holds only a `change.md` with `status: new`
   (`context/changes/first-child-note/change.md:4`). S-02 must ship first. `libraries.md` does not claim
   otherwise — it is scoped to M-2 — but nothing in it can be implemented today.
2. **Two factual corrections** (`rrf_k`, and the GitHub issue citation) and **one overstated claim**
   (that it answers open roadmap question 3). Details in *Corrections*.
3. **Four integration gaps the document does not cover**, all specific to this repo rather than to the
   libraries: an RLS-bypass trap in the exact Supabase guide it cites, a CI job that cannot exercise a
   Workers AI endpoint at all, an undeclared `zod` dependency, and a deploy-runbook row that assumes the
   OpenAI path. Details in *Gaps*.

The sharpest single risk is **not** a library-compatibility problem. It is that Supabase's published
hybrid-search example calls the RPC with the **service-role key**, which carries `BYPASSRLS` and
therefore defeats per-user isolation regardless of the function's security mode. Copying that example
verbatim would silently break both the PRD guardrail *"A child's notes are only visible to the logged-in
account"* (`context/foundation/prd.md:38`) and the isolation boundary this repo relies on.

## Detailed Findings

### Confirmed compatible — the search/store layer

| `libraries.md` claim | Verdict | Evidence |
| --- | --- | --- |
| pgvector is a first-class Supabase extension; Postgres 17 on this project | CONFIRMED | `supabase/config.toml:36` (`major_version = 17`); linked project reports `17.6.1.166` (`supabase/.temp/postgres-version`). Enabled as `create extension vector with schema extensions;` per Supabase's pgvector guide |
| Zero new npm packages for the whole store/fusion layer | CONFIRMED | `@supabase/supabase-js` is installed at `2.116.0` and already a declared dependency (`package.json:23`); `.rpc()` needs nothing further |
| `.rpc('hybrid_search', …)` is reachable | CONFIRMED | PostgREST exposes `public` (`supabase/config.toml:13`), so a function created in `public` is callable. `max_rows = 1000` (`supabase/config.toml:18`) is far above any `match_count` at this scale |
| Generated `tsvector` column + GIN index | CONFIRMED | This is verbatim the pattern in Supabase's own hybrid-search guide (`fts tsvector generated always as (…) stored` + `create index … using gin(fts)`) |
| `pg_trgm` lands in the `extensions` schema; call `extensions.similarity(...)` or set the function's `search_path` | CONFIRMED | Supabase installs extensions into `extensions`; supabase/supabase#30503 documents exactly the "function does not exist" symptom. Note `supabase/config.toml:15` sets `extra_search_path = ["public", "extensions"]` for PostgREST requests, but that does **not** cover a function body that pins its own `search_path`, so the document's advice to schema-qualify still applies |
| pgvector iterative index scans exist for the filtered-HNSW case, from 0.8 | CONFIRMED | pgvector CHANGELOG 0.8.0 (2024-10-30) "Added support for iterative index scans"; enabled with `hnsw.iterative_scan = strict_order \| relaxed_order` (default `off`). Supabase's buildable pgvector versions reach 0.8.2 |
| Chaining `.eq()` after `.rpc()` is applied after the function's ranking and `limit`, so selective filters can return fewer rows than `match_count` | CONFIRMED, near-verbatim | Supabase's own semantic-search guide states: *"Chaining `.eq()` after `rpc()` is applied by PostgREST as an outer filter on the function's result, _after_ the function has already executed its similarity ranking and `limit` — so the vector planner can't use it, and selective filters can leave you with fewer than `match_count` rows."* The document's fix (push the filter in as a function parameter) is the documented fix |
| Moving the index to Vectorize/Upstash/Turbopuffer would turn RLS into hand-written metadata filtering | CONFIRMED as an accurate characterisation, and consistent with this repo's recorded decision (`context/archive/2026-09-23-child-profiles/plan.md:12`: *"the Supabase client runs as the user (anon key + session cookie …), so **RLS is the isolation boundary**"*) |

**Dimension headroom checks out.** pgvector stores `vector`/`halfvec` up to 16,000 dimensions but indexes
HNSW only up to 2,000 (`vector`) / 4,000 (`halfvec`). bge-m3 at 1024 dimensions (see below) sits inside
the plain `vector` HNSW limit, so no `halfvec` workaround is needed.

### Confirmed compatible — the adapter gotcha, which is stricter than stated

`libraries.md` warns that `@astrojs/cloudflare` 14.3.1 no longer exposes `Astro.locals.runtime.env` and
that bindings must be read via `import { env } from "cloudflare:workers"`. **Confirmed, and the failure
mode is harsher than "will not compile":**

- Installed adapter is `14.3.1` (`node_modules/@astrojs/cloudflare/package.json`).
- The type is exactly as the document says — `node_modules/@astrojs/cloudflare/dist/utils/cf-helpers.d.ts:1-3`:
  ```ts
  export interface Runtime {
      cfContext: ExecutionContext;
  }
  ```
  and `node_modules/@astrojs/cloudflare/types.d.ts:1-4` declares `interface Locals extends Runtime {}`, so
  `runtime` is absent from `Astro.locals` at the type level.
- Beyond not compiling, the removed property is booby-trapped to throw at request time —
  `node_modules/@astrojs/cloudflare/dist/utils/cf-helpers.js:32`:
  `"Astro.locals.runtime.env has been removed in Astro v6. Use 'import { env } from \"cloudflare:workers\"' instead."`
  (siblings at lines 37, 42, 47 cover `cf`, `caches`, `ctx`).

Two additions the document does not mention, both favourable:

- Astro's Cloudflare docs state that since adapter v13 / Astro 6, `astro dev` and `astro preview` run on
  the real `workerd` runtime, so binding access behaves the same locally as deployed. No
  `getPlatformProxy` shim is needed.
- Binding access via `cloudflare:workers` coexists with this project's `astro:env` schema. The adapter
  feeds Cloudflare's env into `astro:env` (`dist/utils/handler.js` calls `setGetEnv(createGetEnv(globalEnv))`),
  so the existing `SUPABASE_URL` / `SUPABASE_KEY` reads from `astro:env/server` (`src/lib/supabase.ts:3`)
  keep working unchanged while an `AI` binding is read from `cloudflare:workers`.

### Confirmed compatible — bge-m3, with the document's own open item upheld

| Claim | Verdict | Figure |
| --- | --- | --- |
| `@cf/baai/bge-m3` exists on Workers AI, multilingual | CONFIRMED | Cloudflare model page; described as a "Multi-Functionality, Multi-Linguality, and Multi-Granularity" model |
| 60,000-token context window | CONFIRMED | Model Info table: "Context Window: 60,000 tokens" |
| ~$0.0118 per M input tokens | CONFIRMED | Pricing page lists 1,075 neurons per M input tokens at $0.011/1,000 neurons = $0.011825. Cloudflare's rounded display figure is $0.012; the document's $0.0118 is the precise value |
| Workers AI included on the Free plan, 10,000 neurons/day | CONFIRMED | Pricing page: *"Workers AI is included in both the Free and Paid Workers plans… a total of 10,000 Neurons per day at no charge"* |
| bge-m3 specifically is not gated to Workers Paid | CONFIRMED BY OMISSION ONLY | The 2026-07-28 gating changelog names 7 specific models (kimi-k2.6, kimi-k2.7-code, glm-5.2, glm-5.3, glm-5.3-flash, deepseek-v4-flash-0731, deepseek-v4-pro-0813). `@cf/baai/bge-m3` is not among them. There is no affirmative "bge-m3 is Free-eligible" statement, so the document's own caution here was warranted |
| Free plan: 100,000 requests/day, 50 subrequests/request, 10 ms CPU | CONFIRMED (all three) | Cloudflare limits page |
| Requires `"ai": { "binding": "AI" }` in `wrangler.jsonc` | CONFIRMED | Cloudflare wrangler configuration docs; also note **one AI binding per Worker project**. `wrangler.jsonc` currently declares only `assets` and `observability` — the binding is absent and must be added |

**The document's decision to leave the output dimension open was correct.** Cloudflare's bge-m3 page
states the context window but — unlike its `bge-small-en-v1.5` (384), `bge-base-en-v1.5` (768) and
`bge-large-en-v1.5` (1,024) siblings — **omits an Output Dimensions row entirely**. 1024 is corroborated
by three independent hosts of the same open-weights model (OVHcloud, IONOS, and BAAI's own Hugging Face
card) but is not a Cloudflare-sourced number. The dimension is also **fixed, not configurable**: the
documented input schema accepts only `text` (or `query` + `contexts`) plus `truncate_inputs`, with no
`dimensions` parameter — unlike OpenAI's `text-embedding-3-*`, which `open-ai-documentation.md:61` correctly
describes as truncatable via the API parameter. Confirm with one live call reading `data[0].length` before
fixing the migration's column width.

Two operational limits the document omits: **`text` accepts at most 100 items per batch**, which shapes a
backfill loop; and the synchronous response field set for bge-m3 specifically is not in Cloudflare's own
schema (siblings document `{ shape, data, pooling }`, and `@cloudflare/workers-types` adds a
`postProcessedOutputs` field for bge-m3), so treat `{ data: number[][] }` as likely-but-unconfirmed.

## Corrections

Each assertion below is adjudicated on its own; the surrounding paragraphs in `libraries.md` remain accurate.

### 1. `rrf_k` is 50 in Supabase's guide, not 60

`libraries.md` prescribes `hybrid_search() SQL fn, RRF k=60`. Supabase's hybrid-search guide declares
`rrf_k int = 50` as the default in the function signature. 60 is the value from the original RRF paper, so
the number is defensible as a choice — but it is not the guide's default, and the document presents the
line as a summary of the guide's recipe. Pick one deliberately in the plan rather than inheriting a
mismatch.

### 2. supabase/postgres#555 is closed, and is not the Polish request

`libraries.md` states the request is *"still open as supabase/postgres#555"*. Verified directly against the
GitHub API:

- Title: **"Include ispell dictionary configuration files"** — generic ispell/hunspell dictionaries, with no
  mention of Polish. The issue body is a single link to PostgreSQL's ispell-dictionary docs page.
- Opened 2023-02-22, **closed 2026-07-17**, with a maintainer comment: *"Closing as stale — open for 3.5
  years with no follow-up demand… a meaningful multi-language hunspell collection is ~300 MB — a big ask
  for a niche feature. If there's concrete user demand, a better shape would be a mechanism for users to
  upload their own dictionary files rather than bundling them."*

**The substance of the surrounding claim survives, and on one point hardens.** Adjudicated separately:

- *"No Polish text-search config on hosted Supabase"* — **supported, on absence-based evidence.** Stock
  PostgreSQL ships ~29 built-in configurations and Polish is not among them; the Supabase full-text-search
  guide inspected for this review mentions neither Polish nor `unaccent`. No source publishes hosted
  Supabase's actual `pg_ts_config` output, so this rests on stock-Postgres behaviour plus the absence of any
  Supabase doc adding a config — not on a positive statement that Polish is unavailable.
- *"Copying `.affix`/`.dict` into the server's `tsearch_data/` is impossible on managed Postgres"* —
  **plausible inference, not documented.** It follows from hosted Supabase offering no filesystem or
  superuser access, but no Supabase page states it. The #555 closure does, however, point the same way: the
  maintainers' suggested future shape is *"a mechanism for users to upload their own dictionary files"*,
  which implies no such mechanism exists today.
- *"Ceiling is `to_tsvector('simple', …)` + `unaccent`, no stemming; «gorączka» will not match «gorączki»"* —
  **supported on the mechanism, community synthesis on the framing.** That `'simple'` performs no
  morphological stemming (tokenise + lowercase only) is a verifiable property of the configuration, so the
  inflection example holds. No Supabase doc names this combination as the recommended fallback, so treat it
  as a sound conclusion rather than a quoted recommendation.

Only the citation's status and subject are wrong; the argument it was supporting stands, and the declined
issue strengthens the document's own point that fusion matters *more* here than in an English app.

### 3. "This answers open roadmap question 3" is overstated

The verbatim CPU-time quote is accurate — Cloudflare's limits page does say *"Waiting on network requests
(such as `fetch()` calls, KV reads, or database queries) does not count toward CPU time."* But that sentence
enumerates `fetch()`, KV reads and database queries; it does **not** name the AI binding. Cloudflare's
subrequest documentation likewise enumerates what counts (`fetch()`, KV, Cache, R2, Queues, `connect()`) and
omits `env.AI`. So whether `env.AI.run()` is CPU-exempt, and whether it consumes one of the Free plan's 50
subrequests, is **undocumented in either direction**. Structurally it is an outbound HTTP call, which makes
the document's conclusion plausible — but it is an inference, not a documented fact.

Separately, `context/foundation/infrastructure.md:67` already made the more precise point this project
needs: *"an awaited `fetch()` call to an LLM API doesn't count against the CPU budget, but response
processing (parsing, templating) does"*, with the matching risk-register row at
`context/foundation/infrastructure.md:87` recommending the $5/mo Paid plan before shipping FR-006. For
FR-006-as-retrieval the per-query processing is small (one query embedding), so the risk is genuinely
reduced — but a backfill that parses up to 100 embeddings of ~1024 floats in one invocation is exactly the
shape `infrastructure.md` warns about. **Roadmap question 3 is narrowed, not closed.**

## Gaps — integration work this codebase needs that `libraries.md` does not cover

### 1. Copying Supabase's hybrid-search example verbatim would bypass RLS

This is the most consequential finding. Supabase's hybrid-search guide declares the function as
`language sql` with **no** `security` clause, which defaults to `SECURITY INVOKER` — so the function itself
is fine and RLS is structurally enforced. But the guide's accompanying Edge Function example constructs the
client as `createClient(supabaseUrl, supabaseServiceRoleKey)`, carrying its own inline caveat *"(replace
service role key with user's JWT if using Supabase auth and RLS)"*.

`service_role` holds Postgres's `BYPASSRLS` attribute, so it defeats RLS **regardless** of invoker-vs-definer.
Against this codebase that would silently break:

- the PRD guardrail at `context/foundation/prd.md:38`,
- the recorded isolation decision at `context/archive/2026-09-23-child-profiles/plan.md:12`,
- and the cross-account assertion the smoke test already enforces for children
  (`scripts/smoke.mjs`: *"second user does not see first user's child"*).

The correct path is already the one this repo uses: call the RPC through the existing
`@supabase/ssr` session client (`src/lib/supabase.ts:6-7,10`, anon key + session cookie) so PostgREST executes
as `authenticated` and `auth.uid()` resolves, and leave the function without a `SECURITY DEFINER` clause. If
the function *does* need `SECURITY DEFINER` for any reason, it must pin `set search_path = ''` and
re-implement the ownership check explicitly.

### 2. CI cannot exercise a Workers AI endpoint as the pipeline stands

Cloudflare documents that **Workers AI has no local emulation**: *"Using Workers AI always accesses your
Cloudflare account in order to run AI models and will incur usage charges even in local development."*
Every `env.AI.run()` is a real, billed remote call.

The `smoke` job in `.github/workflows/ci.yml` builds and runs `npm run preview` against a throwaway local
Supabase, with `SUPABASE_URL` / `SUPABASE_KEY` as its only injected secrets. Grepping the whole workflow for
`cloudflare`, `CF_`, `API_TOKEN` and `ACCOUNT_ID` returns nothing — **there are no Cloudflare credentials in
CI at all.** So an FR-006 route that calls `env.AI.run()` unconditionally cannot be covered by
`scripts/smoke.mjs`; it would fail or hang in CI.

The existing codebase already shows the seam to use: `createClient()` returns `null` when Supabase is
unconfigured (`src/lib/supabase.ts:6-7`) and callers degrade explicitly rather than pretending success
(`src/pages/dashboard.astro:11-22`, `listFailed`). An embedding module should follow the same shape, so the
smoke test can assert the retrieval path with a stubbed or keyword-only arm.

### 3. `zod` is a phantom dependency

`libraries.md` recommends `generateObject()` + zod for the date-range extraction arm, and
`open-ai-documentation.md:109-127` builds its structured-output example on zod. `zod@4.6.2` **is** present in
`node_modules`, but only transitively — `npm ls zod` attributes it to `@astrojs/sitemap@3.7.4`,
`astro@7.3.2` and `eslint-plugin-react-hooks@7.1.1`. It is **not** in `package.json`. Importing it from
application code would rely on an undeclared dependency that a hoisting change could remove. It must be
added explicitly. For reference, none of `ai`, `workers-ai-provider` or `openai` is installed.

### 4. Deploy runbook drift

`context/deployment/deploy-plan.md:108` lists a deferred step for an *"LLM API key (FR-006, NL-query)"* via
`wrangler secret put`. That matches the OpenAI path in `open-ai-documentation.md`, not the recommended
Workers AI path, which needs no secret and instead needs the `ai` binding added to `wrangler.jsonc` plus a
redeploy. Whichever path is chosen, that runbook row needs rewriting — and, per
`context/archive/2026-09-23-child-profiles/plan.md:221`, any new migration also needs
`npx supabase db push` before `wrangler deploy`.

## Code References

- `package.json:23` — `@supabase/supabase-js ^2.99.1` declared; `2.116.0` installed. No `ai`, `openai`, `workers-ai-provider`, or declared `zod`
- `wrangler.jsonc` — declares `assets` and `observability` only; no `ai` binding
- `astro.config.mjs:17-22` — `astro:env` schema with `SUPABASE_URL` / `SUPABASE_KEY` as optional server secrets
- `src/lib/supabase.ts:3` — secrets read from `astro:env/server`; `:7-9` — returns `null` when unconfigured
- `src/lib/children.ts:23-35` — `listChildren` applies **no** user filter; comment records that ownership is RLS-enforced. `:28` uses `.overrideTypes<Child[], { merge: false }>()`, the existing convention for typing results without generated DB types
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard", "/api/children"]`; a new FR-006 API route must be added here
- `src/env.d.ts:1-5` — `App.Locals` augmented with `user` only
- `supabase/migrations/20260923221601_create_children.sql` — the only migration; plain SQL, RLS enabled, policies using `(select auth.uid()) = user_id`. The pattern an FR-006 notes/embeddings migration should follow
- `supabase/config.toml:13` — `schemas = ["public", "graphql_public"]`; `:15` — `extra_search_path = ["public", "extensions"]`; `:18` — `max_rows = 1000`; `:36` — `major_version = 17`
- `.github/workflows/ci.yml` — `ci` job (lint / `astro check` / build) and `smoke` job (local Supabase + `npm run preview` + `npm run smoke`); no Cloudflare credentials
- `scripts/smoke.mjs` — zero-dependency HTTP walk; ends with the cross-account isolation assertion
- `node_modules/@astrojs/cloudflare/dist/utils/cf-helpers.d.ts:1-3` — `Runtime` is `{ cfContext: ExecutionContext }`
- `node_modules/@astrojs/cloudflare/dist/utils/cf-helpers.js:32` — throwing getter for the removed `runtime.env`

## Architecture Insights

- **RLS is the isolation boundary, by explicit prior decision.** Data modules take the session-scoped client
  and apply no owner filter (`src/lib/children.ts:23-35`). Any FR-006 SQL function must preserve this
  property, which is what makes Gap 1 a correctness issue rather than a style preference.
- **Two-layer verification, no unit-test framework.** Quality gates are `astro check` + ESLint plus a single
  HTTP smoke walk; there is no Vitest/Jest. Anything needing a test must be reachable over HTTP, which is
  why the `env.AI` seam matters.
- **Explicit degradation over silent emptiness.** `listFailed` in `src/pages/dashboard.astro:11-22` exists
  specifically so a query failure is never rendered as "no children"; an FR-006 search should distinguish
  "no matching notes" from "search unavailable" the same way.
- **Hand-written row types + `overrideTypes`, not `supabase gen types`** — a deliberate choice recorded at
  `context/archive/2026-09-23-child-profiles/plan.md:36`. An `.rpc()` result will be loosely typed and should
  follow the same convention rather than introducing generated types.
- **`libraries.md`'s "one embedding per note, no chunking"** fits the data model cleanly: a note is a single
  short free-text row, so FR-006's "link to the source note" is a row id, not a chunk mapping.

## Historical Context (from prior changes)

- `context/archive/2026-09-23-child-profiles/plan.md:12` — *"RLS is the isolation boundary"*. **Supported and
  still current**; directly governs the FR-006 RPC design.
- `context/archive/2026-09-23-child-profiles/plan.md:14` — the only test harness is `scripts/smoke.mjs`, run
  in CI against a fresh local Supabase, with `supabase start` applying migrations automatically.
  **Supported**, verified against `.github/workflows/ci.yml`.
- `context/archive/2026-09-23-child-profiles/plan.md:15` — the deploy runbook had no migration step.
  **Superseded**: `context/deployment/deploy-plan.md:78` now includes `npx supabase db push`, added by
  Phase 3 of that same plan (`:221`, `:316`).
- `context/archive/2026-09-23-child-profiles/plan.md:264` — *"Rollback: drop the table (no dependants until
  S-02)"*. **Still accurate**: no notes table exists yet.
- `context/foundation/roadmap.md:103-104` — open roadmap questions 2 (AI provider + privacy policy for
  children's health notes) and 3 (Cloudflare paid plan before FR-006). Question 2 is genuinely advanced by
  the Workers AI recommendation (no new data processor); question 3 is narrowed, not answered — see
  *Corrections 3*.
- `context/foundation/tech-stack.md` — `has_ai: true` and *"FR-006 … doesn't require a different
  foundation — it can be added as a fast-follow against the same Supabase-stored notes"*. **Supported** by
  this review: the recommended stack adds no new runtime dependency to the store layer.

## Related Research

- `context/foundation/fr-006-research/libraries.md` — the document under review (recommended path).
- `context/foundation/fr-006-research/open-ai-documentation.md` — sibling reference for the OpenAI
  alternative. Its self-assessment holds: it correctly notes the `cloudflare:workers` gotcha does not apply
  to an API-key path (`:164-167`), correctly identifies `OPENAI_API_KEY` as an `envField` secret matching the
  existing shape in `astro.config.mjs:17-22`, and correctly flags that choosing it reopens roadmap question 2.
  Its `dimensions`-parameter advice is sound and is the one capability bge-m3 lacks.

## Open Questions

1. **bge-m3's exact output dimension** — not published by Cloudflare. 1024 per three third-party hosts of the
   same weights. Resolve with one live `env.AI.run` reading `data[0].length` before writing the pgvector
   column. (Carried over from `libraries.md`; still open.)
2. **bge-m3's Free-plan eligibility** — supported only by absence from the 2026-07-28 gating list, never
   stated affirmatively. (Carried over; still open.)
3. **Whether `env.AI` calls count toward CPU time and the Free plan's 50-subrequest cap** — undocumented by
   Cloudflare in either direction. This is what keeps roadmap question 3 open.
4. **This project's actual pgvector version** — Supabase builds up to 0.8.2, but the version on a given
   project depends on its creation/upgrade history. Iterative index scans need ≥ 0.8.0. Check with
   `select extversion from pg_extension where extname = 'vector';` after enabling it.
5. **`rrf_k`: 50 (guide default) or 60 (RRF paper)** — a deliberate choice for the plan.
6. **Which FR-006 path to take** — Workers AI (no new vendor, roadmap question 2 stays answered) vs OpenAI
   (better-documented dimensions control, reopens question 2). Not a compatibility question; both are
   compatible with this codebase.
7. **Whether parents' questions are date-shaped or topic-shaped** — `libraries.md` notes this is only
   learnable after S-02 ships real notes. Unchanged.
