---
project: dziennik-dziecka
researched_at: 2026-09-18
recommended_platform: Cloudflare Workers (Astro + static assets)
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript/JavaScript
  framework: Astro 7 (@astrojs/cloudflare ^14.3.1)
  runtime: Cloudflare Workers (workerd, nodejs_compat)
---

## Recommendation

**Deploy on Cloudflare Workers.** The project is already scaffolded for it — `wrangler.jsonc` targets a Workers deployment with static assets, `@astrojs/cloudflare` is already a dependency, and the developer confirmed existing Cloudflare familiarity. It scored a clean pass on all five agent-friendliness criteria, costs $0 at the project's expected traffic (100k requests/day free, versus this MVP's low single-user volume), and directly matches the "minimize cost" and "single region is fine" answers from the interview — Cloudflare's edge network is a strict superset of "single region," so there's no tradeoff to accept there.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| Cloudflare | Pass | Pass | Pass | Pass | Pass | 5 Pass |
| Vercel | Pass | Pass | Pass | Pass | Partial (MCP in public beta) | 4 Pass / 1 Partial |
| Netlify | Partial (rollback is UI-only) | Pass | Pass | Partial | Partial (MCP shipped, no GA/beta label found) | 2 Pass / 3 Partial |
| Railway | Partial (no CLI rollback to arbitrary deploy) | Pass | Pass | Partial | Pass | 3 Pass / 2 Partial |
| Render | Partial (no CLI rollback) | Pass | Pass | Partial | Pass (infra MCP; docs-search MCP is experimental) | 3 Pass / 2 Partial |
| Fly.io | Partial (no CLI rollback command) | Partial (requires authoring a Dockerfile) | Pass | Partial | Partial (MCP exists, early-stage/unlabeled) | 1 Pass / 4 Partial |

**Notes per platform:**

- **Cloudflare** — `wrangler deploy` / `wrangler rollback` / `wrangler tail` cover the full operational loop from the CLI. Fully managed (TLS, routing, scaling automatic). Docs are published as `llms.txt` and via content-negotiated markdown. Official remote MCP servers are GA. Free tier covers this project's traffic with wide margin.
- **Vercel** — Equally strong CLI/docs/deploy story (`vercel --prod`, `vercel rollback`, `vercel logs`). MCP (`mcp.vercel.com`) is public beta, not GA. Hobby tier is restricted to non-commercial use; a paid project needs Pro at $20/mo, which cuts against the cost-minimization priority.
- **Netlify** — Deploys and log tailing are solid CLI operations, but rollback is a dashboard "Publish Deploy" action, not a CLI subcommand. Docs are excellent (every page has a `.md` twin, plus `llms.txt`). MCP server is shipped but its maturity label is unclear from the docs.
- **Railway** — No Dockerfile needed (Railpack auto-detects Node/Astro). MCP server is GA and full-featured. No free tier since 2023 — minimum realistic spend is the $5/mo Hobby plan, which conflicts with the cost-minimization priority even though usage would likely stay within the included credit.
- **Render** — Similar profile to Railway: managed runtime, GA MCP server, but CLI has no rollback command. Free tier exists but spins down after 15 minutes of inactivity with a ~1-minute cold start on wake — a poor fit for an app used to jot down a quick note in the moment.
- **Fly.io** — The most capable platform for persistent connections and multi-region, but that capability isn't needed here (no WebSockets/background jobs). Requires hand-authoring a Dockerfile since there's no native Astro buildpack, and community reports note `fly launch`'s Astro 5 Dockerfile auto-generation is currently broken — real extra setup burden for a 1-week solo build. No free tier (minimum ~$2–20/mo depending on configuration) and no dedicated rollback CLI command.

### Shortlisted Platforms

#### 1. Cloudflare Workers + Pages (Recommended)

Wins outright on the scoring matrix and on every soft-weighted interview answer: cheapest option ($0 at this traffic), matches the developer's existing Cloudflare familiarity, and the project is already scaffolded against it (`wrangler.jsonc`, `@astrojs/cloudflare` adapter already in `package.json`). No migration cost — the recommendation is "keep going," not "switch."

#### 2. Vercel

The strongest alternative if Cloudflare's CPU-time model or Node-compat edge cases (see cross-check below) become a real blocker. Excellent CLI, docs, and deploy-rollback story. Its main gaps versus Cloudflare are a beta-stage MCP server and a licensing wrinkle (Hobby tier is non-commercial-use only, so a real deployment likely needs the $20/mo Pro tier).

#### 3. Netlify

A reasonable fallback with a mature Astro adapter and likely-free hosting under its new credit-based pricing (April 2026). Weaker than Cloudflare and Vercel on operational determinism — rollback isn't scriptable via CLI, which matters more for agent-driven maintenance than for a solo human developer, but is worth flagging.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. CPU-time billing is measured in *active* CPU milliseconds, not wall-clock time — a mental model most Node-background developers don't have. The free tier caps at 10ms; JSON-parsing or templating a longer LLM response for the natural-language query feature (FR-006) could silently exceed it.
2. Cloudflare Pages is, per community commentary, in a "slow strategic convergence" toward plain Workers — not formally deprecated, but new capabilities increasingly ship Workers-first, so a Pages-shaped mental model of the platform could go stale.
3. Node compatibility (`nodejs_compat`) is broad but not total. A Supabase client dependency, or any package with native bindings or unusual CommonJS patterns, can break silently on `workerd` — and "works locally, fails on deploy" debugging eats into a 1-week solo timeline.
4. Astro 7's `astro dev`/`astro preview` run on the real `workerd` runtime rather than Node. This catches incompatibilities earlier, which is good, but a developer expecting Node-like local dev may misdiagnose a runtime incompatibility as an Astro bug.
5. No persistent connections without Durable Objects. Irrelevant today (no WebSockets needed per the interview), but if a future iteration of the NL-query feature wants to stream LLM tokens to the UI, retrofitting that is a bigger lift on Cloudflare than on Fly.io or Railway.

### Pre-Mortem — How This Could Fail

The solo parent shipped the notes app to Cloudflare in their one free week, riding the deploy target the starter template had already wired up. Weeks later, they sat down to add the natural-language query feature — the app's real differentiator. It worked locally, but deployed calls to the Supabase client threw cryptic errors: a dependency assumed a Node `crypto` behavior that workerd's compat layer didn't fully cover, and it wasn't caught until production because local dev used a slightly different compat surface. Debugging ate two after-hours evenings. Once fixed, the LLM-backed endpoint occasionally returned a vague CPU-limit error under real use, because parsing a longer response pushed past the free tier's CPU budget — something the developer hadn't realized was measured in active milliseconds, not seconds. By deadline, the core loop worked, but the flagship feature felt flaky, and it shipped anyway with known intermittent failures.

### Unknown Unknowns

- CPU time ≠ wall-clock time: an awaited `fetch()` call to an LLM API doesn't count against the CPU budget, but response processing (parsing, templating) does — and that distinction is easy to miss.
- The `nodejs_compat` flag's behavior is tied to the wrangler `compatibility_date` in config. This project's is already pinned (`2026-05-08`, with `nodejs_compat` explicitly listed in `compatibility_flags`), which avoids the "silently changes behavior on a new deploy" trap — but it's a value worth remembering not to delete or blindly bump.
- Free-tier Workers have a 50-subrequest-per-invocation cap. Relevant if FR-006 ever chains Supabase fetch + LLM call + a follow-up enrichment call without tracking the count.
- Cloudflare Pages' roadmap ambiguity (see Devil's Advocate #2) isn't documented anywhere as a formal deprecation — it's inferred from community commentary, not an official signal, so it's easy to miss entirely if only official docs are consulted.
- This project's adapter (`@astrojs/cloudflare` v14) already targets the unified Workers-with-static-assets model, not the older separate Pages product — the `deployment_target: cloudflare-pages` label recorded in `tech-stack.md` is a naming holdover, not a sign the project is on a different (older) deployment path than what's described here.

**User decision**: proceed with Cloudflare Workers, risks noted above and captured in the risk register below.

## Operational Story

- **Preview deploys**: Not yet wired — no CI/CD workflow exists in the repo (out of scope for both the bootstrapper and this skill). When GitHub Actions is set up per the `auto-deploy-on-merge` hint in `tech-stack.md`, Cloudflare Workers Builds can generate a preview URL per PR; until then, previewing means running `npx astro build && npx wrangler dev --remote` locally.
- **Secrets**: Supabase URL/anon key and any LLM API key should be set as Worker secrets via `npx wrangler secret put <NAME>` (never committed to `wrangler.jsonc`, which is version-controlled). For CI, a Cloudflare API token goes in GitHub Actions Secrets, scoped to Workers edit permissions only.
- **Rollback**: `npx wrangler deployments list` shows recent deploys; `npx wrangler rollback [deployment-id]` reverts in seconds. Note this only reverts the Worker code/assets — a Supabase schema migration does not auto-rollback and needs manual reconciliation if a bad deploy shipped a breaking migration.
- **Approval**: Routine code deploys can run unattended once CI is wired up (matches the `auto-deploy-on-merge` hint — low risk for a single-user MVP with no production traffic to protect). A human should look before: rotating the Cloudflare API token or Supabase service-role key, and any Supabase migration that drops or alters a column.
- **Logs**: `npx wrangler tail` streams live production logs (read-only, safe for an agent to run). `npx wrangler deployments list` plus the Cloudflare dashboard cover build/deploy history.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| CPU-time budget exceeded while processing an LLM response for the NL-query feature (FR-006) | Devil's Advocate / Unknown Unknowns | M | M | Upgrade to the $5/mo Workers Paid plan (30s CPU limit, 20x free tier's headroom) before shipping FR-006, or keep response post-processing minimal. |
| A dependency (e.g. Supabase client, or a future npm package) breaks silently under `workerd`'s Node compatibility layer | Devil's Advocate / Pre-Mortem | M | M | Test any new dependency against `astro dev`/`wrangler dev` early — don't wait until the week before the deadline to discover an incompatibility. |
| Cloudflare Pages' product direction is ambiguous (community-reported "convergence" toward Workers, not officially documented) | Devil's Advocate / Unknown Unknowns | L | L | No action needed now — this project already targets the unified Workers-with-assets model, not the older Pages product, so it isn't exposed to this risk. |
| `nodejs_compat` behavior is tied to the `compatibility_date` pinned in `wrangler.jsonc` | Unknown Unknowns | L | M | Already mitigated: the date (`2026-05-08`) is pinned and `nodejs_compat` is explicitly listed in `compatibility_flags`. Don't delete this line when editing the config. |
| Free-tier 50-subrequest-per-invocation cap is hit by a future multi-hop request chain | Unknown Unknowns | L | L | Keep FR-006's request chain to one Supabase fetch + one LLM call; revisit if a future feature adds more hops. |
| Retrofitting token-by-token LLM streaming later requires Durable Objects, a bigger lift than on Fly.io/Railway | Devil's Advocate | L | M | Out of scope for this MVP (FR-006 returns a list of matching notes, not a streamed summary, per the PRD's Non-Goals). Revisit only if a future version adds streaming. |
| Astro 7's local dev running on real `workerd` (not Node) surprises a developer expecting Node-like local behavior | Unknown Unknowns | L | L | Read the `@astrojs/cloudflare` adapter changelog before bumping Astro major versions; treat a local dev failure as a possible runtime-compat issue, not only an Astro bug. |

## Getting Started

The project is already scaffolded for this platform — these steps activate what's already configured, not a from-scratch setup.

1. Confirm the Cloudflare config is intact: `wrangler.jsonc` already pins `compatibility_date: 2026-05-08` with `nodejs_compat` enabled, and targets Workers-with-static-assets (`main: "@astrojs/cloudflare/entrypoints/server"`, `assets.directory: "./dist"`) — no changes needed unless bumping Astro/adapter major versions.
2. Authenticate the CLI: `npx wrangler login`.
3. Set Supabase secrets (do not put these in `wrangler.jsonc`): `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_ANON_KEY` (add any LLM API key the same way once FR-006 is built).
4. Build and deploy: `npm run build && npx wrangler deploy`.
5. Verify with a live log stream during the first real request: `npx wrangler tail`.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (the `auto-deploy-on-merge` GitHub Actions flow recorded in `tech-stack.md` is not yet wired up in this repo)
- Production-scale architecture (multi-region, HA, DR)
