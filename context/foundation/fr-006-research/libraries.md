---
project: dziennik-dziecka
researched_at: 2026-09-26
scope: FR-006 — natural-language question over a child's notes
roadmap_ref: "Parked: FR-006 (next milestone, M-2)"
answers_roadmap_questions: [2, 3]
status: research
recommended_stack:
  embeddings: "@cf/baai/bge-m3 via Workers AI binding (env.AI.run)"
  store: "pgvector in Supabase Postgres (HNSW)"
  keyword_arm: "tsvector('simple') + unaccent + GIN"
  fusion: "hybrid_search() SQL function, RRF, called via supabase.rpc()"
new_npm_dependencies: "none required (optional: ai + workers-ai-provider)"
sources:
  - https://supabase.com/docs/guides/ai/hybrid-search
  - https://developers.cloudflare.com/workers-ai/models/bge-m3/
  - https://developers.cloudflare.com/workers/platform/limits/
  - https://ai-sdk.dev/docs/ai-sdk-core/embeddings
  - https://arxiv.org/html/2405.10138v2
  - https://arxiv.org/html/2402.13350v1
  - https://arxiv.org/pdf/2609.12913v1
  - https://github.com/supabase/postgres/issues/555
---

## Scope note

FR-006 as the PRD defines it returns **a list of matching notes with their dates and links to the source
entry** — explicitly *not* a synthesized summary (that is a PRD Non-Goal). So this is a **retrieval**
problem, not a RAG-answer problem, which shrinks the library surface considerably.

The notes are in Polish. That is the single biggest constraint on model choice, and the reason the
keyword arm alone is not sufficient.

## Layer 1 — Search store: no new runtime dependency

| Option | Fit with this stack |
| --- | --- |
| **pgvector** (`vector` / `halfvec`, HNSW, `<=>` / `<#>`) | Yes. First-class Supabase extension (`create extension vector`); Postgres 17 per `supabase/config.toml`. Notes stay in the table RLS already protects. |
| **Postgres FTS** (`tsvector` generated column + GIN) | Partly. **No Polish text-search config on hosted Supabase** — every published recipe copies `.affix`/`.dict` into the server's `tsearch_data/`, impossible on managed Postgres; the request is still open as supabase/postgres#555. Ceiling: `to_tsvector('simple', …)` + `unaccent`, i.e. **no stemming** ("gorączka" will not match "gorączki"). |
| **pg_trgm** | Yes — useful third arm for typos and inflection near-misses. Gotcha: Supabase installs it into the `extensions` schema, so call `extensions.similarity(...)` or set the function's `search_path`. |
| **Hybrid RRF** (Supabase hybrid-search guide) | Yes. One SQL function, invoked with `supabase.rpc('hybrid_search', …)`. `@supabase/supabase-js` ^2.99 is already a dependency — **zero new npm packages for this whole layer**. |
| Cloudflare Vectorize / Upstash Vector / Turbopuffer | Not recommended. They move the index outside Supabase, so "only the owner sees the notes" stops being RLS and becomes hand-written metadata filtering — a direct risk to a PRD protective rule. |

Two correctness details to carry into the plan:

1. Push the `child_id` / owner filter **into** the SQL function. Chaining `.eq()` after `.rpc()` is applied
   by PostgREST *after* the function has already ranked and applied its `limit`, so the vector planner
   cannot use it and selective filters silently return fewer rows than `match_count`.
2. pgvector >= 0.8 iterative index scans exist for exactly that filtered-HNSW case.

## Layer 2 — Embeddings: the actual decision

### 1. Cloudflare Workers AI — `@cf/baai/bge-m3` (no npm dependency) — RECOMMENDED

```js
const { data } = await env.AI.run("@cf/baai/bge-m3", { text: [noteBody] });
```

- Explicitly multi-lingual, 60,000-token context window, ~$0.0118 per M input tokens.
- 10,000 neurons/day free allocation, included on the Workers **Free** plan.
- Requires `"ai": { "binding": "AI" }` in `wrangler.jsonc`.
- Verify the output dimension on the model page before fixing the pgvector column width — the docs page
  consulted did not state it.

**This answers open roadmap question 3.** Cloudflare documents that *"waiting on network requests (such as
fetch() calls, KV reads, or database queries) does not count toward CPU time"*. Inference runs off-Worker,
so the Free plan's 10 ms CPU limit is **not** a blocker for embedding or LLM calls; it only bites if
inference runs *inside* the Worker (see transformers.js below). Free-plan ceilings that do apply:
100,000 requests/day, 50 subrequests per request.

**It is also the cleanest answer to open roadmap question 2** (privacy policy vs. notes about children's
health): no new data processor beyond the existing host. Note that Cloudflare has begun gating some
resource-intensive models to Workers Paid — confirm bge-m3's plan requirement before relying on Free.

### 2. Vercel AI SDK (`ai` package) + a provider — provider-swappable

`embed()` / `embedMany()` against:

- `@ai-sdk/openai` — `text-embedding-3-small` / `-large`, dimensions reducible (Supabase's own example uses 512)
- `@ai-sdk/cohere` — `embed-multilingual-v3.0` (1024) or `-light-v3.0` (384)
- `@ai-sdk/google` — `gemini-embedding-001`
- `workers-ai-provider` — Workers AI behind the same interface (`createWorkersAI({ binding: env.AI })`)

Worth adopting mainly if the answer to roadmap question 2 could change later — then it is a one-line swap.

Bonus, and independent of embeddings: **`generateObject()` + zod** is the right tool for turning
*"jak często Jaś miał gorączkę w lipcu?"* into a structured `{ childId, dateFrom, dateTo, terms }` filter.
That is what makes the "with dates" half of FR-006 sharp, and it needs no vector search at all.

### 3. `openai` npm directly

Works on the Workers fetch runtime, least abstraction, and is what the Supabase hybrid-search guide shows.

### 4. transformers.js (`@huggingface/transformers`) — do not run in the Worker

64 MiB bundle / 128 MB memory / CPU limits make in-Worker inference a non-starter. Viable only in a build
step or a Supabase Edge Function. Supabase Edge Functions' built-in `gte-small` session is free but
**English-only**, so it is the wrong tool for Polish notes.

### 5. Polish-specialised models — the escape hatch if retrieval quality disappoints

HF weights, so they need a host (HF Inference, Replicate, own container), not just an API key:

- **PolDense** (OPI-PIB, 17M–1B, ModernBERT/ettin-based) — current PIRB state of the art. The paper reports
  the 32M/68M variants already matching BGE-M3, Jina-v5 and Arctic-Embed-2.0, and PolDense-1B beating
  BGE-Multilingual-Gemma2 (9B) and Qwen3-Embedding-8B.
- **mmlw-\*** and **stella-pl-retrieval** (sdadas), **silver-retriever-base-v1**, **multilingual-e5-large**,
  **EuroDense-435M** (best sub-1B multilingual, leads 7 of 9 languages).

Benchmark context that justifies the hybrid design: on PIRB, multilingual-e5-large scored 57.3 NDCG@10, and
adding a sparse arm (BM25 or SPLADE hybrid) gained **+1 to +8 points** over dense-only, with the largest
gains for the smaller dense models. Since this project's keyword arm is handicapped by the missing Polish
stemmer, fusion matters more here than in an English app, not less.

### Reranking (optional, later)

Cohere `rerank-multilingual-v3`, or the `polish-reranker-*` models from sdadas. PIRB's top configurations are
two-stage (retriever + reranker), but this is over-engineering for one parent's notes at MVP scale.

## Compatibility gotcha specific to the installed versions

`@astrojs/cloudflare` **14.3.1** (verified in `node_modules/@astrojs/cloudflare/dist/utils/cf-helpers.d.ts`)
no longer exposes `Astro.locals.runtime.env` — the `Runtime` type is now just `{ cfContext: ExecutionContext }`.
Bindings must be read as:

```ts
import { env } from "cloudflare:workers";
```

Any FR-006 plan that reaches for `Astro.locals.runtime.env.AI` will not compile against this adapter version.

## Recommended default for M-2

```
bge-m3 via env.AI.run (Workers AI binding)   -> embeddings, no new dep, no new vendor
pgvector vector(<dim>) + HNSW in Supabase    -> semantic arm, RLS-protected
tsvector('simple') + unaccent + GIN          -> keyword arm (accept: no Polish stemming)
hybrid_search() SQL fn, RRF k=60, via .rpc() -> fusion, one round trip
```

Optional single npm addition: `ai` + `workers-ai-provider`, if the provider should be swappable from day one.

**Free win:** notes are short, so **one embedding per note, no chunking**. That makes FR-006's "link to the
source note" an exact row id rather than a chunk-to-note mapping problem.

## Open items this research does NOT settle

- bge-m3's exact output dimension (needed before writing the pgvector column) and its Workers Free-plan
  eligibility — check the model page at implementation time.
- Whether the parent's questions in practice lean date/range-shaped (favouring `generateObject` filters) or
  topic-shaped (favouring embeddings). Cheap to learn only after S-02 ships real notes.
- Retrieval quality of bge-m3 on this specific Polish corpus. PIRB numbers are a proxy, not a measurement on
  children's-health shorthand.
