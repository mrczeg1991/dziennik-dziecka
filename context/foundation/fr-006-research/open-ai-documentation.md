---
project: dziennik-dziecka
fetched_at: 2026-09-26
scope: OpenAI API surface needed for FR-006 (natural-language question over a child's notes)
sibling_doc: context/foundation/fr-006-research/libraries.md
status: reference
source: Context7 MCP — /websites/developers_openai_api (endpoints), /websites/developers_openai (TypeScript SDK reference)
relation_to_recommendation: "Alternative to the recommended @cf/baai/bge-m3-via-Workers-AI path; documented so both options can be compared in the M-2 plan."
reopens_roadmap_question: 2
api_surface:
  embeddings: "POST /embeddings — openai.embeddings.create()"
  structured_output: "openai.responses.parse() with zodTextFormat, or responses.create() with strict json_schema"
npm_dependencies: "openai (+ zod for the structured-output helper)"
---

## Why this document exists

`libraries.md` recommends `@cf/baai/bge-m3` through the Workers AI binding (no new vendor, no API
key). This file captures the OpenAI equivalent so the M-2 plan can weigh both without re-researching.
Choosing this path reopens **open roadmap question 2**: notes about children's health would leave for a
third-party processor, which the Workers AI option avoided by keeping inference with the existing host.

All facts below come from the official docs fetched via Context7 on 2026-09-26.

## 1. Runtime support — the compatibility question first

From the TypeScript SDK reference (*FAQ > Requirements*), supported runtimes explicitly include
**Cloudflare Workers** and Vercel Edge Runtime (alongside Node.js 22/24 LTS, Deno >= 1.28, Bun >= 1.0,
Nitro >= 2.6). TypeScript >= 4.9. Browser use is disabled by default and requires
`dangerouslyAllowBrowser: true` — irrelevant here, the calls belong in an Astro API route.

So `openai` npm works on this project's deploy target without `nodejs_compat` workarounds.

Client options worth setting in a Worker:

```ts
const client = new OpenAI({
  maxRetries: 2,        // default 2; retries connection/timeout/409/429/5xx with exponential backoff
  fetchOptions: { /* RequestInit */ },
});
```

`maxRetries` is also settable per request. Note retries consume Workers subrequests (50 per request on
the Free plan).

## 2. Embeddings — the semantic arm

`POST /embeddings` request body, per the API reference:

| Field | Required | Notes |
| --- | --- | --- |
| `input` | yes | string, array of strings, array of tokens, or array of token arrays |
| `model` | yes | e.g. `text-embedding-3-small` |
| `dimensions` | no | number of dimensions the output embeddings should have |
| `encoding_format` | no | `float` or `base64` |
| `user` | no | end-user identifier |

Limits: **8,192 tokens per individual input**, **300,000 tokens total per request** across all inputs.

Default vector lengths: **1536** for `text-embedding-3-small`, **3072** for `text-embedding-3-large`.
The guide states embeddings can be shortened via the `dimensions` parameter without losing their
concept-representing properties — `text-embedding-3-large` cut to 256 dimensions still outperforms an
unshortened `ada-002` at 1536.

> Caveat straight from the guide: **if dimensions are truncated manually after generation instead of via
> the API parameter, the resulting shortened vector must be L2 normalized.** Use the parameter.

```js
import OpenAI from "openai";
const openai = new OpenAI();

const embedding = await openai.embeddings.create({
  model: "text-embedding-3-small",
  input: "Your text string goes here",
  encoding_format: "float",
});
```

Response shape:

```json
{
  "object": "list",
  "data": [{ "object": "embedding", "embedding": [0.0023064255, -0.009327292, "..."], "index": 0 }],
  "model": "text-embedding-3-small",
  "usage": { "prompt_tokens": 8, "total_tokens": 8 }
}
```

Two implementation details that matter for this project's schema:

- Pass `dimensions` so the vector matches the pgvector column width exactly (e.g. `dimensions: 1024` to
  keep the column width from the bge-m3 plan and stay swappable).
- Use the **array form of `input`** for the one-off backfill of notes written before FR-006 shipped;
  `data[i].index` maps each result back to the input order.
- OpenAI embeddings are normalized, so the Supabase guide's `<#>` (negative inner product) with a
  `vector_ip_ops` HNSW index is valid and faster than cosine distance.

## 3. Structured outputs — the "with dates" arm

This is what turns *"jak często Jaś miał gorączkę w lipcu?"* into filters. FR-006 requires dates and links
to source notes, so extracting a date range and a child reference before searching does real work here —
and needs no embeddings at all.

SDK helper path (zod), returning typed output:

```ts
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

const openai = new OpenAI();

const NoteQuery = z.object({
  childName: z.string().nullable(),
  dateFrom: z.string().nullable(),
  dateTo: z.string().nullable(),
  terms: z.array(z.string()),
});

const response = await openai.responses.parse({
  model: "gpt-5.6",
  input: [
    { role: "system", content: "Wyciągnij filtry z pytania rodzica o notatki o dziecku." },
    { role: "user", content: question },
  ],
  text: { format: zodTextFormat(NoteQuery, "note_query") },
});

const filters = response.output_parsed; // typed
```

Raw JSON-schema path on `responses.create`, where the docs stress `strict: true`, **every** property listed
in `required`, and `additionalProperties: false`:

```js
text: {
  format: {
    type: "json_schema",
    name: "note_query",
    strict: true,
    schema: {
      type: "object",
      properties: { /* ... */ },
      required: [ /* every property */ ],
      additionalProperties: false,
    },
  },
}
```

Docs examples use model ids from the current catalog (`gpt-5.6`, `gpt-6-astra` in the quickstart) — confirm
the model id at implementation time rather than copying these verbatim.

## 4. Cookbook caveat

An official OpenAI x Supabase pgvector semantic-search cookbook exists at
`cookbook/examples/vector_databases/supabase/`, but its readme is now marked **"This recipe is archived and
may reference outdated models or APIs."** Use Supabase's own hybrid-search guide for the SQL side (see
`libraries.md`) and these docs for the OpenAI side.

## 5. What changes in this project if this path is chosen

1. **Secret, not binding.** Add `OPENAI_API_KEY` to the `env.schema` in `astro.config.mjs`, same shape as
   the existing Supabase secrets: `envField.string({ context: "server", access: "secret" })`. This path uses
   an API key, so the `import { env } from "cloudflare:workers"` binding access documented in
   `libraries.md` is not needed — that gotcha applies only to the Workers AI path.
2. **Pin `dimensions`** to the pgvector column width, and prefer `<#>` / `vector_ip_ops` since the vectors
   are normalized.
3. **Roadmap question 2 reopens.** Health notes about children would be sent to OpenAI. Decide and record
   the answer before implementing; the Workers AI path exists specifically to avoid this question.
4. Polish-language quality is unmeasured on this route: PL-MTEB explicitly excluded closed API models such
   as `text-embedding-3-small` from its evaluation for budget reasons, so there is no benchmark number for
   Polish retrieval to compare against the bge-m3 / PolDense figures in `libraries.md`.

## Fetched doc URLs

- https://developers.openai.com/api/docs/guides/embeddings
- https://developers.openai.com/api/docs/api-reference/embeddings/create
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/reference/typescript
- https://developers.openai.com/docs/quickstart
- https://developers.openai.com/cookbook/examples/vector_databases/supabase/readme (archived)
