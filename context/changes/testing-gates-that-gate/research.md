---
date: 2026-10-09T22:18:18+02:00
researcher: marcin.zegunia2
git_commit: e7367fde351c4d41944a9f9394138e6739f239e7
branch: master
repository: 10xdevs_projekt
topic: "Test plan §3 Phase 2 — grounding Risks #2, #3, #6, #7 for the four gates that do not exist yet"
tags: [research, codebase, test-plan-phase-2, ci, gates, route-guard, migration-drift, secrets, eslint]
status: partial
last_updated: 2026-10-09
last_updated_by: marcin.zegunia2
---

# Research: Gates that actually gate (test plan §3 Phase 2)

**Date**: 2026-10-09T22:18:18+02:00
**Researcher**: marcin.zegunia2
**Git Commit**: e7367fde351c4d41944a9f9394138e6739f239e7
**Branch**: master
**Repository**: 10xdevs_projekt

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md` §3 ("Gates that actually
gate") against current code. For each of Risks #2, #3, #6 and #7, establish the real
failure path, verify or correct the §2 Risk Response Guidance, locate existing
coverage, and identify the cheapest useful test layer — so `/10x-plan` can design the
four gates §5 still marks `required after §3 Phase 2` without rediscovery.

`status: partial` — see [Open Questions](#open-questions). Seven items could not be
settled read-only; three of them materially shape gate design and are flagged as
blocking.

## Summary

**The phase's framing survives, but two of its four gates have no slot to occupy, and
the phase's headline premise is wrong in a way that changes what to build.**

Four findings dominate everything below.

1. **No gate in this repository can block anything today.**
   `gh api repos/mrczeg1991/dziennik-dziecka/branches/master/protection` returns
   `403 "Upgrade to GitHub Pro or make this repository public to enable this feature."`
   and `gh repo view` reports `isPrivate: true`. On a private repo on the free plan,
   required status checks are unavailable. Every gate this phase wires is **advisory**:
   a red `ci.yml` does not stop a merge, a push, or a deploy. §3's goal sentence
   ("Make CI fail for the three reasons it currently cannot") is achievable; the
   implied conclusion — that bad code therefore cannot ship — is not, until branch
   protection exists. This is a precondition, not a detail, and it is the single most
   consequential thing `/10x-plan` must decide about.

2. **Risk #7's danger is the opposite of what the plan assumes.** §2 says the
   behaviour to prove is "a lint or typecheck run that aborted, skipped, or matched
   zero files fails the gate instead of passing it." Measured: **those cases already
   fail loudly.** ESLint exits `2` with an `Oops! Something went wrong!` banner on an
   internal rule throw, and exits `2` on every total-empty-scope condition. What is
   silent is **partial** shrinkage: `npx eslint . --ignore-pattern "src/**" -f json`
   examined **3 files instead of 37, exit 0, zero bytes of human-visible output**. One
   extra `.gitignore` line and the lint gate goes green having checked 8% of the
   codebase. The gate to build is therefore a **floor on reported scope**, not an
   abort detector.

3. **Risk #3's gate has nowhere to sit, because deploy is not wired.** `.github/`
   contains exactly one file. There is no `deploy` script, and no `wrangler deploy`
   outside documentation. Deploy is a manual laptop sequence
   (`context/deployment/deploy-plan.md:67-88`): `supabase db push` → `npm run build` →
   `npx wrangler deploy`. §5 places the migration-drift check "between merge and
   deploy"; merge and deploy are not causally connected, so there is no between.

4. **Risk #2 has no live exposure — its value is drift detection.** All five
   data-touching routes are currently covered by `PROTECTED_ROUTES`
   (`src/middleware.ts:6`). The gap is that the only enumeration of anonymous-access
   checks is four hardcoded paths in `scripts/smoke.mjs`, and `/api/notes/<id>` — the
   edit/soft-delete endpoint — is **not among them**.

Risk #6 is the one risk currently in good structural shape: secrets cannot reach the
client bundle by construction (a client-reachable `astro:env/server` import is a build
failure, not a leak), and all four `catch` sites in `src/` are bare `catch {`, so no
error `cause` has an identifier to travel through. Its residual exposure is a config
contradiction about which directory is publicly served — see
[Open Question 1](#1-blocking--which-directory-does-wrangler-actually-serve).

### Verdict on each §2 response-guidance row

| Risk | §2 guidance | Verdict |
|---|---|---|
| #2 | "a test that enumerates route files and asserts each data-touching one is covered by the guard" | **Correct in shape, under-specified.** Enumeration works (two independent signals agree 12/12). But the assertion must be *inverted* — see Risk #2 below — and `PROTECTED_ROUTES` is not importable. |
| #3 | "a migration-drift check against the linked project, plus one authenticated read after deploy" | **Correct in substance, wrong in placement.** No deploy step exists to sit before/after. Also needs to be *scheduled*, not push-triggered. |
| #6 | "a scan of the build output for known secret values, plus a test on the error-response shape" | **Half vacuous.** The scan earns its keep for secrets, not for note content (nothing is prerendered; `find dist -name "*.html"` → zero files). The error-shape test should assert a structural property, not a string. |
| #7 | "an assertion in CI on the reported file or check count" | **Correct, and better than the risk statement it serves.** The count is the right instrument; the stated failure mode (abort) is already loud. |

## Detailed Findings

### Risk #2 — route-guard coverage

**Route inventory: 12 project routes, 5 touching parent data.** Verified from the
filesystem and independently from the built SSR manifest (12 `"origin":"project"`
entries, 1:1 match).

| Route | Path | Parent data | Covered by `PROTECTED_ROUTES`? |
|---|---|---|---|
| `src/pages/dashboard.astro` | `/dashboard` | reads (`listChildren` at `:16`) | yes — `"/dashboard"` |
| `src/pages/children/[id].astro` | `/children/<id>` | reads (`getChild` `:42`, `listNotes` `:57`) | yes — `"/children"` |
| `src/pages/api/children.ts` | `/api/children` | writes (`createChild` `:60`) | yes — `"/api/children"` |
| `src/pages/api/notes.ts` | `/api/notes` | reads + writes (`getChild` `:38`, `createNote` `:69`) | yes — `"/api/notes"` |
| `src/pages/api/notes/[id].ts` | `/api/notes/<id>` | writes (`updateNoteContent` `:55`, `softDeleteNote` `:66`) | yes — `"/api/notes"` prefix |

The remaining seven are public by design: `/`, `/auth/signin`, `/auth/signup`,
`/auth/confirm-email`, and the three `/api/auth/*` endpoints. There is no
`src/pages/404.astro`, no `getStaticPaths`, no `prerender` export, and no
`injectRoute`/`redirects` in `astro.config.mjs:10-22`. All six `.ts` endpoints export
only `POST`.

**Zero uncovered data routes today.** The test's value is drift detection, not a fix.

**The prefix list does not nest, and that is the drift mechanic.** `"/children"` does
*not* match `/api/children` — which is exactly why `src/middleware.ts:6` must carry
both entries separately. There is no `"/api"` entry, so any new endpoint outside the
`children`/`notes` prefixes (`/api/measurements`, `/api/export`) receives **no**
middleware protection. This refutes the §2 "must challenge" assumption ("it lives
under the API prefix so it is protected") concretely rather than rhetorically.
Conversely `startsWith` over-matches: `"/children"` would also protect
`/children-export`. Protection is accidental in both directions, so a green assertion
on one path proves nothing about the list's correctness.

**Two constraints that rule out the obvious test designs.**

- `PROTECTED_ROUTES` at `src/middleware.ts:6` is a module-local `const` with **no
  `export`**. A unit test cannot import it to assert prefix coverage.
- A black-box HTTP assertion cannot substitute, because **all three data endpoints
  self-guard** independently of the middleware: `src/pages/api/children.ts:31-34`,
  `src/pages/api/notes.ts:19-22`, `src/pages/api/notes/[id].ts:17-20`. A `302 →
  /auth/signin` proves *something* refused, not that the middleware did. Note the
  asymmetry: both data **pages** rely solely on the middleware —
  `src/pages/dashboard.astro:7` reads `Astro.locals.user` and never checks it, and
  `src/pages/children/[id].astro` has no `locals.user` reference at all, stating the
  reliance in a comment at `:27-28`.

**Enumeration signals, strongest first.** The §2 anti-pattern (a hand-maintained path
list) is avoidable; three independent signals exist.

1. **Filesystem glob** `src/pages/**/*.{astro,ts}` plus Astro's routing convention —
   12/12 identical to the manifest for this repo. Cheapest, needs no build, and is the
   very artifact a new route is created as, so it cannot be forgotten. Misses:
   integration-injected SSR routes (none today), `[...rest]` params, and **which HTTP
   verbs** a route exports — the test must additionally parse `export const GET|POST`.
   Must exclude `.claude/worktrees/**` (see Architecture Insights).
2. **Built SSR manifest** `dist/server/chunks/entrypoints_*.mjs` — authoritative, it is
   literally what the router matches, and `"origin"` separates project routes from
   injected ones. Costs: requires a build, content-hashed filename must be globbed, and
   it is un-versioned Astro internals. Supported equivalents with the same data:
   `astro/app`'s `App`, or an `astro:routes:resolved` integration hook.
3. **Data-touching classification by static import** — every data route imports
   `@/lib/children` or `@/lib/notes`, and all table access is confined to those two
   modules (`src/lib/children.ts:25,43,63`; `src/lib/notes.ts:26,51,68,87`); a grep for
   `.from(` across `src/` hits nothing else. Exact today, but a **convention, not a
   boundary** — a new route calling `supabase.from("children")` inline is invisible to
   it.

**The assertion must be inverted to fail closed.** Enumerate routes via signal 1 or 2,
then assert that **every enumerated route not on a small explicit `PUBLIC_ROUTES`
allowlist (`/`, `/auth/*`, `/api/auth/*`) refuses an anonymous request.** Forgetting to
update that allowlist fails the test; forgetting to update a check-list passes
silently. This is the only form that satisfies §2's anti-pattern constraint — a
positive "check these paths" list reproduces the failure being guarded against.

**Existing coverage, and its hole.** `scripts/smoke.mjs` asserts exactly four
anonymous paths, hardcoded before the first signup: `/` → 200 (`:78`), `/dashboard` →
302 (`:79`), `POST /api/children` → 302 (`:81-84`), `POST /api/notes` → 302
(`:85-93`), `GET /children/<uuid>` → 302 (`:94-98`). **`/api/notes/<id>` is never
exercised anonymously** — only signed-in (`:185`, `:199`, `:207`) — despite being the
destructive route. A new unprotected route at any other path stays green.

### Risk #3 — migration drift

**Deploy is not wired. This is definitive.**

- `find .github -mindepth 1` → `.github/workflows` and `.github/workflows/ci.yml`.
  Nothing else: no second workflow, no composite action, no `environments`.
- `ci.yml` has no deploy job and no Cloudflare credentials; its jobs end at
  `npm run build` (`:22`) and `supabase stop --no-backup` (`:60`).
- `package.json` scripts contain no `deploy`.
- `README.md:146-162` is the whole deploy story: build, then `npx wrangler deploy`,
  with secrets set via the Cloudflare dashboard or `npx wrangler secret put`.
- `context/foundation/roadmap.md:64` states it outright — *"wdrożenie ręczne wg
  runbooka, bez automatu po merge"* — and `:134` parks auto-deploy.

Consequence: §5's "between merge and deploy" has no slot. The reachable gate shapes
are (a) a CI job that **reports** divergence on push/PR, (b) a local preflight the
human runs before `wrangler deploy`, or (c) wire an automated deploy first and gate
that. `/10x-plan` must pick one explicitly.

**Nothing today detects a committed-but-unapplied migration.** The `ci` job never
touches a database. The `smoke` job runs `supabase start` (`ci.yml:41`), which applies
every file in `supabase/migrations/` to a fresh container — so repo-vs-database
agreement is **true by construction**. The smoke walk's green describes a database
built from the repo thirty seconds earlier, not the hosted one. `ci.yml:43-45`
already comments that the policy-test step's position is load-bearing *for row
counts*; the same reasoning applies to schema and nobody drew it.

**The failure mode is HTTP 200, which defeats the obvious workaround.** With `notes`
missing, `src/lib/notes.ts:34-35` throws, `src/pages/children/[id].astro:43-47`
catches into `listFailed`, and the page returns **200** with a Polish "could not load"
banner. `/dashboard` is unaffected and returns 200 with the child list. With
`children` missing, `src/pages/dashboard.astro:15-19` degrades to 200-with-banner and
`src/pages/children/[id].astro:28-35` returns 503. Since `scripts/smoke.mjs` asserts
status codes and redirect targets, 200-with-banner satisfies it — the only assertions
that would catch drift are the write-path ones (`:118`, `:123`, `:142`), which create
rows in the single real user's production database with no cleanup. That is the
mechanical reason §2's anti-pattern ("re-running the whole HTTP walk against
production") is both insufficient *and* destructive.

**The `ci` job's secrets are ceremonial.** `astro.config.mjs:19-20` declares both
values `context: "server", access: "secret", optional: true`, and the build does not
read them: `dist/server/chunks/server_57RHfXas.mjs:118-133` resolves them at runtime
through `_internalGetSecret`, and `dist/server/wrangler.json` has `"vars":{}`. So
`ci.yml:23-25` passing `secrets.SUPABASE_URL`/`SUPABASE_KEY` to `npm run build` has no
effect on the outcome — the `ci` job would go green with both unset or pointing at a
dead project. §2's second "must challenge" assumption ("the build succeeded, so
configuration is fine") is false **by construction**, not merely unreliable.

Because `optional: true`, a missing secret surfaces as `src/lib/supabase.ts:6-8`
returning `null` → `src/middleware.ts:16-18` setting `locals.user = null` → every
protected route 302s to `/auth/signin`, i.e. the app looks like "nobody is logged in".
The only signal is the Polish banner from `src/lib/config-status.ts:14,19` rendered by
`src/layouts/Layout.astro:22-35`, at HTTP 200.
`context/deployment/deploy-plan.md:23` already records this trap.

**Candidate mechanisms (Supabase CLI 2.117.0, `--help` read only, nothing executed
against the hosted project).**

| Command | Compares | Credentials | Report-only? |
|---|---|---|---|
| `supabase migration list` | 14-digit versions in `supabase/migrations/*.sql` vs the remote `schema_migrations` table | link, or `--project-ref` + db password | yes, by nature — **best candidate** |
| `supabase db push --dry-run` | same question, via the apply path | full write-capable credentials | flag exists (confirmed in `--help`), but hands CI production write access to produce a report |
| `supabase db diff --linked` | **actual schema** via a Docker shadow DB — the only one that catches a dashboard hand-edit or an edited migration body | `--linked`/`--db-url` + Docker | prints to stdout when `-f` is omitted; slow and heavyweight |
| `supabase db query --linked` | arbitrary read via the Management API — no Docker, needs only a personal access token | `--linked` (whether `--project-ref` alone suffices is unverified) | cheapest shape, unverified |

**Version comparison has a blind spot worth recording:** the 14-digit prefix *is* the
version stored remotely, so comparison is version-string vs version-string.
**Editing the body of an already-applied migration is invisible to `migration list`.**
`git log -- supabase/migrations/20260927205447_create_notes.sql` returns exactly one
commit (`9cbd41e`), so no such edit has occurred here, but only `db diff` would catch
one.

**Drift is bidirectional and badly sampled by a push trigger.** The hosted-project
link lives in the gitignored `supabase/.temp/linked-project.json`, so a developer can
run `supabase db push` from their laptop and advance the hosted database ahead of
anything CI ever saw — with no merge involved. A detector that runs only on push/PR to
`master` samples at the wrong times. A `schedule:` run comparing versions and failing
loudly is the shape that covers this topology; a push-triggered run is a useful second
sample, not a sufficient one.

### Risk #6 — secrets and note content in client output

**Across `src/` (the inspected path), exactly two modules read the schema'd env, both
from `astro:env/server`:** `src/lib/supabase.ts:3` (used `:6`, `:9`) and
`src/lib/config-status.ts:1` (used `:14`). Established by grepping `src/` for
`astro:env|SUPABASE_URL|SUPABASE_KEY|import.meta.env|process.env|PUBLIC_`. Outside
`src/`, `scripts/smoke.mjs:4` reads `process.env.BASE_URL` (never bundled) and
`astro.config.mjs:19-20` is the schema declaration itself.

Every importer of `@/lib/supabase` found in that same `src/` sweep is a server-only
module: `src/middleware.ts:2`, the six `src/pages/api/**` routes,
`src/pages/children/[id].astro:6`, `src/pages/dashboard.astro:4`, and
`src/lib/children.ts:2` (**`import type` only** — erased). This is the observed set
for `src/`, not a proof that no other importer can exist.

**The guarantee is structural, not conventional — and the §2 reasoning should be
upgraded.** §2's "must challenge" note says a value becomes client-visible by being
*used* in a client-reachable path, not by where it was read. That is correct as
reasoning, but here a second and stronger mechanism applies: `astro:env/server` is a
**virtual module Astro refuses to resolve in a client bundle**, so a client-reachable
import is a **build failure**, not a silent leak. The five `client:*` islands
(`auth/signin.astro:14`, `auth/signup.astro:14`, `dashboard.astro:61`,
`children/[id].astro:74` and `:95`) reach `@/lib` only via `utils.ts`,
`wall-clock.ts`, and a type-only `import type { Note }` at
`src/components/notes/NoteItem.tsx:3`. The entire island → `supabase.ts` path is
type-only and has no runtime edge.

Measured against the build on disk, not inferred: `grep -rlF` for either secret value
over `dist/client` → **zero hits**; `grep -rlE "SUPABASE_URL|SUPABASE_KEY|eyJ[A-Za-z0-9_-]{10,}"`
over `dist/client` → **zero**; `grep -rlE "astro:env|getSecret"` over `dist/client` →
**zero**. The only hit for either value anywhere under `dist/` is
`dist/server/.dev.vars`.

**Note content cannot be in build output.** `grep -rn "prerender" src astro.config.mjs`
→ zero hits, `astro.config.mjs:11` is `output: "server"`, and `find dist -name "*.html"`
→ **zero HTML files**. Every route is server-rendered per request, and every query runs
through a client built from the request (`src/lib/supabase.ts:5`), so no build-time
fetch is even possible. A note body *is* serialized into the per-request
`astro-island` props (`children/[id].astro:95` → `NoteItem.tsx:54`), which is correct
behaviour for the owner. **The build-output scan is therefore close to vacuous for note
content and earns its keep only for secrets** — a correction to §2's guidance, which
pairs them as one check.

**Error surfaces leak nothing, and the reason is structural.** All four `catch` sites
in `src/` are **bare `catch {`** — they do not bind the error, so no `cause`, message
or stack has an identifier to travel through: `src/pages/api/notes.ts:39`,
`src/pages/children/[id].astro:43` and `:58`, `src/pages/dashboard.astro:17`. A
repo-wide grep for `.cause`, `.stack`, `JSON.stringify(error`, `String(error)`,
`*.message` across `src/` returns **only three comment lines** and zero code hits.
`src/lib/auth-errors.ts:8-22` maps `error.code` only, through a fixed record of 13
Polish strings, and logs `code` and `status` only (`:26-36`). Every API error path
returns a hardcoded Polish literal; `createChild`/`createNote`'s `PostgrestError` is
tested and discarded (`api/children.ts:60-63`, `api/notes.ts:70-72`,
`api/notes/[id].ts:55-58`, `:66-69`). No island performs a `fetch` — zero `fetch(` in
`src/components/**`; every mutation is a native `<form method="POST">` — so no island
ever sees a server error object.

**But the provable invariant is not "the banner is friendly."**
`src/components/auth/ServerError.tsx:7-15` renders whatever is in
`Astro.url.searchParams.get("error")`. On every first-party path that comes from a
hardcoded literal, so the §2 assumption holds — but the banner is not *structurally*
constrained, and an attacker-supplied `?error=` renders verbatim (React escapes it, so
this is self-inflicted text injection / phishing, not XSS and not a secret leak). The
assertion worth building is **"the server never puts a value derived from an error
object into that parameter"**, which is a lint-able property, not a string match.
§2's anti-pattern ("asserting the literal current wording") is correct and this is how
to avoid it.

**`config-status.ts` publishes one bit, intentionally.**
`Boolean(SUPABASE_URL && SUPABASE_KEY)` at `:14` collapses both values before they
leave the module; `message` is a static constant. It does expose "is Supabase
configured" to every unauthenticated visitor on every page, since `Layout.astro` wraps
all routes. That is a deliberate operator signal, low severity. The testable property
is the inverse: that the banner text is a constant and never interpolates a config
value.

### Risk #7 — gate integrity

**The headline inversion, measured.**

| Condition | ESLint exit | Visible output |
|---|---|---|
| clean run, 37 files | 0 | **nothing** (44 bytes, all npm banner) |
| internal rule throw | **2** | `Oops! Something went wrong!` + full stack |
| `--ignore-pattern "**"` (total empty scope) | **2** | "all of the files … are ignored" |
| no files match pattern | **2** | "No files matching the pattern … were found" |
| **`--ignore-pattern "src/**"` → 3 of 37 files** | **0** | **nothing** |

The abort case was reproduced live and non-destructively by re-enabling the rule from
the CLI (`--rule` merges last in flat config, overriding
`eslint.config.js:81-84`) without editing a file:

```
Error: Non-null Assertion Failed: Expected node to have a parent.
Occurred while linting .../src/pages/children/[id].astro:24
Rule: "@typescript-eslint/no-misused-promises"
exit=2
```

Line 24 is `return new Response(null, { status: 404 });`. This confirms
`context/foundation/lessons.md` and settles the exit code: **ESLint exits 2, so the
abort already fails the gate.** Exit-code taxonomy observed: `0` clean, `1` lint
problems, `2` crash **or** empty scope (ESLint conflates the two, so distinguishing
them needs message parsing, not the exit code).

**Therefore the gate is a floor on scope.** `eslint .` examines **37** files; the flag
that reports this is the **JSON formatter** (`-f json` emits one object per examined
file — count the array), not `--debug` or `--stats`. 37 = 34 lintable files under
`src/` (35 minus `src/styles/global.css`) + `astro.config.mjs` + `eslint.config.js` +
`scripts/smoke.mjs`. No lintable file in the working tree is missed today.

**Per-gate count availability:**

| Gate | Count on success? | Assertable? |
|---|---|---|
| `npm run lint` | no — prints nothing | **yes**, via `-f json` array length (37) |
| `npx astro check` | **yes** — prints `Result (38 files):` | **yes**, parse the number |
| `npm run build` | pages, not files | likely — **not observed** (build not run) |
| `supabase test db` | yes (`Files=N, Tests=N`) | yes — **not observed** (local stack down) |
| `npm run smoke` | **no total** — only per-step `PASS` lines (`scripts/smoke.mjs:306`) | not today; needs a code change |

**The 38-vs-37 delta is real and must not be conflated.** `tsconfig.json:3` includes
`.astro/types.d.ts`, which `astro check` counts and ESLint skips because
`.gitignore:5` ignores `.astro/`. Both numbers are correct; a gate must pin each
separately.

**The `astroEarlyReturnConfig` glob is exactly right today, and its failure modes are
asymmetric.** Complete inventory of all 8 `.astro` files under `src/`, frontmatter read
in full:

| File | Top-level `return` in frontmatter | Covered by `src/pages/children/**/*.astro` |
|---|---|---|
| `src/pages/children/[id].astro` | **yes — 4** (`:24`, `:31`, `:44`, `:50`) | yes |
| `src/pages/dashboard.astro` | no — `:27`'s return is inside `function formatBirthDate` opened at `:25` | n/a |
| `index.astro`, `auth/signin.astro`, `auth/signup.astro`, `auth/confirm-email.astro`, `layouts/Layout.astro`, `components/Banner.astro` | no | n/a |

Zero drift, zero slack. **But the drift directions differ, and only one needs a gate.**
A glob that is too *narrow* — the next page serving a 404 from frontmatter, outside
`src/pages/children/**` — aborts the whole lint run at exit 2, i.e. **loudly**. A glob
that is too *wide* — a `children/` page that loses its early return, or the
`astro-eslint-parser` defect being fixed and the block never removed — silently
disables `no-misused-promises` on real code at exit 0 with no output. The check worth
building is that **no file is in the glob unnecessarily**, which is the inverse of the
instinct the comment at `eslint.config.js:79-80` encodes.

**`npm run smoke` has three false-pass vectors**, in descending severity:

1. **A typo'd expectation key is silently vacuous.** The conjunction at
   `scripts/smoke.mjs:287-293` tests each expectation with `=== undefined ||`. Writing
   `bodyInclude` instead of `bodyIncludes` short-circuits true and the step still
   prints `PASS`. Nothing validates the expectation object's keys. A step can be
   reduced to a bare status check with no visible change.
2. **Zero steps exits 0 with "All smoke steps passed."** `failed` starts at 0
   (`:276`), the loop over the literal 35-step array (`:77-274`) simply does not
   execute, and `:306-307` prints success. Nothing asserts `steps.length`.
3. **The CI wait loop has no failure path.** `ci.yml:57` is
   `for i in $(seq 1 60); do curl -sf ... && break; sleep 1; done` with no `|| exit 1`.
   If the preview server never starts the loop expires and `npm run smoke` runs anyway
   — though this one fails loudly *by luck*, since every `fetch` would reject and a
   top-level-await rejection exits non-zero.

Credit where due: a silently-skipped step is **not** representable — the loop iterates
a literal array, and the `extract` mechanism at `:281-285` sets `extracted = false`
when a capture regex misses, forcing a FAIL. Per-run unique identifiers keyed on
`Date.now()` (`:5-16`) mean no assertion can pass on a row left by an earlier run; the
stale-data false pass is designed out, and the comments at `:9` and `:11` say so.

**`supabase test db` plan counts are all correct and self-detecting.** Verified by
counting assertion calls: `00_helper_sanity.sql:21` `plan(4)` / 4 `is(`;
`01_notes_isolation.sql:20` `plan(12)` / 7 `is(` + 3 `throws_ok(` + 2
`table_privs_are(` (`:210`, `:218`); `02_notes_characterization.sql:25` `plan(2)` / 2;
`03_notes_destruction.sql:60` `plan(4)` / 4. Each file ends `select * from finish();`,
and pgTAP's `finish()` emits `# Looks like you planned N tests but ran M` and TAP-fails
on mismatch, which pg_prove propagates. **A `plan(N)` drift cannot pass.** The `.inc`
extension on `helpers.inc` correctly keeps it out of the `*.sql` discovery glob — but
that also means discovery is extension-driven, so an `.inc`/`.sql` typo on a new test
silently shrinks the suite.

**Gate reachability — and the risk eating its own tail.** `ci.yml:3-7` triggers only on
`push: branches: [master]` and `pull_request: branches: [master]`. No CI runs for: any
push to a non-`master` branch with no open PR into `master` (**`origin/feature/notes-dashboard`
is in exactly this state right now**), any PR whose base is not `master`, or the
local-only worktree branch. A gate-integrity check that lives *only* in `ci.yml`
inherits `ci.yml`'s reachability — it would not have observed that branch. Since the
whole point of Risk #7 is catching a gate that checked nothing, **a gate-integrity
check that itself never runs is the risk recursing.** It belongs inside `npm run lint`'s
own invocation, or as a step in both CI jobs, not in a separate workflow with its own
trigger list.

**The local hook is live but is not the same gate.** `core.hooksPath` is now
`.husky/_` (set 2026-10-07, commit `ff5882c`; it was inert before that because
`package.json` had no `prepare` script). `.husky/pre-commit` runs `npx lint-staged`,
which passes **explicit staged paths** — so the hook never lints the whole tree and
cannot catch a file that fell out of scope. When no staged file matches a pattern,
lint-staged skips that task entirely: no ESLint invocation, no output, exit 0.

**Warning-level annotations are free.** Both jobs of the last green run
(`37679261140`) carried `The process '/usr/bin/git' failed with exit code 128`,
originating in `actions/checkout`'s *Post job cleanup*, with zero effect on either
job's conclusion. A gate-integrity check cannot be built on "the run had no warnings."

**Three moving surfaces the gates sit on**, with live evidence from that same run:
`actions/checkout@v4` and `actions/setup-node@v4` (annotation: *"Node.js 20 is
deprecated … forced to run on Node.js 24"*), `supabase/setup-cli@v1` (the action tag
is unpinned even though the CLI version is pinned to `2.117.0`), and
`runs-on: ubuntu-latest` (annotation: *"will migrate to Ubuntu 26 beginning October 19,
2026"* — **10 days from this research date**). Phase 1 pinned only the CLI and said so
deliberately.

## Code References

- `src/middleware.ts:6` — `PROTECTED_ROUTES`, module-local `const`, **not exported**
- `src/middleware.ts:25-29` — `startsWith` prefix match; the sole decision point for anonymous refusal, 302 to `/auth/signin`
- `src/middleware.ts:12-14` — `await supabase.auth.getUser()` with no try/catch; the one unguarded error path
- `src/pages/api/children.ts:31-34`, `src/pages/api/notes.ts:19-22`, `src/pages/api/notes/[id].ts:17-20` — endpoint self-guards that make a black-box 302 ambiguous
- `src/pages/dashboard.astro:7`, `src/pages/children/[id].astro:27-28` — pages relying solely on the middleware
- `src/lib/supabase.ts:3,5,6-8` — the only runtime `astro:env/server` read; request-scoped client; `null` on missing secrets
- `src/lib/config-status.ts:14,19` — both secrets collapsed to one boolean
- `src/lib/auth-errors.ts:8-22,26-36` — `error.code`-only mapping; logs code and status only
- `src/pages/api/notes.ts:39`, `src/pages/children/[id].astro:43,58`, `src/pages/dashboard.astro:17` — all four `catch` sites, all bare `catch {`
- `src/components/auth/ServerError.tsx:7-15` — renders the `?error=` query param verbatim
- `eslint.config.js:94,96` — `includeIgnoreFile(.gitignore)` plus `.claude/**`
- `eslint.config.js:73-84` — the `no-misused-promises` abort and its hand-maintained glob mitigation
- `scripts/smoke.mjs:78-98` — the four hardcoded anonymous assertions
- `scripts/smoke.mjs:287-293` — `=== undefined ||` expectation conjunction (the vacuous-key vector)
- `scripts/smoke.mjs:306-307` — summary with no step total
- `.github/workflows/ci.yml:3-7` — trigger list; `:23-25` ceremonial build secrets; `:41-47` migrate-then-test ordering; `:57` wait loop with no failure path
- `wrangler.jsonc:7-11` vs `dist/server/wrangler.json` — the asset-directory contradiction (Open Question 1)
- `context/deployment/deploy-plan.md:67-88` — the manual runbook; `:23` the silently-ignored-secret trap; `:110-117` rollback does not revert migrations
- `tsconfig.json:3-4` — `include` pulls `.astro/types.d.ts` (the 38 vs 37 delta); `exclude: ["dist"]` overrides TS defaults

## Architecture Insights

**Deny-by-default repeats at the CI layer, with the opposite signature.** Phase 1
established that in the schema every prohibition is an *absent* policy, so removal is
loud and widening is silent (`context/foundation/test-plan.md` §6.6). The gate layer
inverts it: total failure is loud (ESLint exit 2) and *partial* shrinkage is silent.
Both phases are about the same class of defect — a protection that stops applying
without anything going red — but the instrument differs. Phase 1 needed an assertion
at the enforcing layer; Phase 2 needs a **quantity** assertion, because the gates
report scope but nobody reads it.

**Three hand-maintained lists already exist, and each is the §2 anti-pattern in
miniature.** `PROTECTED_ROUTES` (`src/middleware.ts:6`), the four anonymous paths in
`scripts/smoke.mjs:78-98`, and the `astroEarlyReturnConfig` glob
(`eslint.config.js:82`). Each is correct today; each drifts by omission; none has a
mechanism. The pattern worth establishing in this phase is **enumerate-then-invert**:
derive the population from a signal that cannot be forgotten (the filesystem, the
route manifest, the formatter's own output), and assert against a small explicit
allowlist of exceptions.

**`.claude/worktrees/` contains a second full checkout of the application.**
`git worktree list` shows `.claude/worktrees/isolation-boundary-p2` on branch
`testing-isolation-boundary-p2`, holding `src/pages/children/[id].astro`,
`src/pages/dashboard.astro`, `src/components/Topbar.astro` and others — including files
that do not exist on `master`. It is correctly excluded from linting
(`eslint.config.js:96`), but the comment at `:95` describes it as "vendored AI-toolkit
skills/scripts," which is no longer accurate: it is a path under which arbitrary
unlinted application source can live. **Any filesystem-glob-based route enumeration
must exclude `.claude/worktrees/**` or it will enumerate phantom routes.**

**`AGENTS.md:9` and the endpoints disagree.** The hard rule says "add its path to
`PROTECTED_ROUTES` … don't gate auth ad hoc inside a page," yet all three data
endpoints gate ad hoc. Two of the three need `user.id` for their insert regardless
(`api/children.ts:60`, `api/notes.ts:69`), so the rule as written cannot be followed
literally for endpoints — only `api/notes/[id].ts:17-20` is a pure redundant guard.
Worth reconciling in whatever rules update this phase produces.

## Historical Context (from prior changes)

- `context/archive/2026-10-03-testing-isolation-boundary/plan.md:118-120` — Phase 1
  explicitly deferred **three** checks here: "Not wiring the migration-drift check, the
  gate-integrity check, or the route-guard coverage test. Those are §3 Phase 2." The
  **build-output secret scan is not in that list**, though §5 marks it
  `required after §3 Phase 2`. *Supported* as to the three named; the fourth gate's
  assignment comes from §5 alone, so this phase's scope is four gates by §5 and three
  by Phase 1's handoff — a real discrepancy for `/10x-plan`.
- `context/archive/2026-10-03-testing-isolation-boundary/plan.md:571` — "§3 Phase 2
  owns gate integrity generally; this pin is scoped to the dependency this phase
  introduces." *Supported.* The general pinning question is this phase's, and the
  Ubuntu 26 migration gives it a date.
- `context/archive/2026-10-03-testing-isolation-boundary/research.md:490-493` — Phase 1
  Open Question 5 asked whether the CI CLI should be pinned and concluded "Phase 2 owns
  gate integrity, so this may belong there." *Supported*; partially acted on (CLI
  pinned, action tags and runner image not).
- `context/archive/2026-09-23-child-profiles/plan.md:15` — "The deploy runbook … has no
  step that applies DB migrations to the hosted Supabase project." *Contradicted as of
  today* — `deploy-plan.md:67-81` now carries the `link` + `db push` step, added by that
  very change (`:221`). The surrounding claim that nothing automates it remains
  *supported*.
- `context/archive/2026-09-26-first-child-note/plan.md:35` — "every new migration needs
  `npx supabase db push` before `wrangler deploy`, or the deployed code hits a table
  that does not exist." *Supported*, and this research establishes the precise symptom:
  HTTP 200 with a degraded banner, not an error status.
- Both archived plans tick "Migration pushed to the hosted Supabase project" as a
  **manual checkbox** (`child-profiles/plan.md:316` — `ee7228d`;
  `first-child-note/plan.md:370,474` — `3bcc492`). The ordering rule is documented prose
  plus a self-attested tick. There is no mechanism, which is exactly Risk #3.
- `context/deployment/deploy-plan.md:26` justifies manual deploy with "`git remote -v` w
  repo jest puste". *Contradicted* — `origin` now exists
  (`https://github.com/mrczeg1991/dziennik-dziecka.git`). The stated reason for not
  automating no longer holds, which strengthens option (c) for Risk #3's gate.
- `context/foundation/lessons.md:7-8` — the ESLint abort entry is *supported* and now
  reproduced with an exit code (2). Its second claim, that `astro check` mis-reports a
  `const` as unused after a top-level return, is *documented but not re-observed here*;
  it is mitigated in source by duplication (`src/pages/children/[id].astro:17-19`), not
  by config. The entry's `Rule:` and `Applies to:` fields are still `<to fill in>`.

## Related Research

- `context/archive/2026-10-03-testing-isolation-boundary/research.md` — Phase 1's
  grounding of the policy layer (Risks #1, #4). Its §Open Questions 5 is the direct
  ancestor of this phase's pinning question.
- `context/changes/fr-006-research/research.md` — FR-006 library compatibility; no
  overlap with these four risks (checked).

## Open Questions

Seven items could not be settled read-only. The first three are **blocking** for gate
design; the rest are bounded caveats.

### 1. BLOCKING — which directory does Wrangler actually serve?

Two configs disagree, and I verified both byte-for-byte:

- `wrangler.jsonc:7-11` (checked in): `"assets": { "binding": "ASSETS", "directory": "./dist", "not_found_handling": "404-page" }`
- `dist/server/wrangler.json` (generated): `"assets": { "binding": "ASSETS", "directory": "../client", ... }`, `"main": "entry.mjs"`

`.wrangler/deploy/config.json` contains
`{"configPath":"..\\..\\dist\\server\\wrangler.json", ...}`, which is Wrangler's
build-output config-redirect mechanism and strong evidence the **generated** config
governs. Against that: the official Astro Cloudflare SSR snippet also shows
`"directory": "./dist"`, and the adapter's own rewrite of `assets.directory` to
`../client` (`node_modules/@astrojs/cloudflare/dist/index.js:461-466`) sits **inside
`if (_config.base !== "/")`** at `:447` — and this project sets no `base`, so that
block does not run. Something else therefore produced `../client`, and I did not
identify what.

**Why it matters:** `dist/server/.dev.vars` exists and holds both secret values in
plaintext (confirmed; 207 bytes, dated 2026-10-05). `.assetsignore` — which lists
`.dev.vars` — exists **only** at `dist/client/.assetsignore`, so it protects the asset
root only under the `../client` interpretation. If `./dist` ever governs, both secrets
are fetchable at `/server/.dev.vars`. Also note `.wrangler/` is gitignored, so the
redirect file is build-generated and not guaranteed present in a fresh checkout.

**Resolve by** one `wrangler dev`/`wrangler deploy --dry-run --outdir` inspection, or
by confirming the redirect's precedence in Wrangler's docs. **A cheap gate exists
regardless:** assert the effective asset root resolves to `dist/client`, and that no
`.dev.vars` or `wrangler.json` sits under it.

### 2. BLOCKING — does `astro check` report green on zero files?

Inferred, not observed: a zero-file project would print `Result (0 files): - 0 errors`
and exit 0. An empty-project probe went interactive asking to install
`@astrojs/check` and was aborted rather than install. This is the gate **most likely**
to report green having checked nothing, and also the easiest to gate since it already
prints the number. Its behaviour on a parser crash is likewise unobserved.

Related and unresolved: `tsconfig.json:4` sets `"exclude": ["dist"]`, overriding
TypeScript's default exclude list, which combined with `"include": ["**/*"]` should
pull in `node_modules/**` and `.claude/worktrees/**` — yet `astro check` reported only
38 files. So `@astrojs/check` applies its own ignore list rather than the raw tsconfig
file set. **If that internal list ever changes, the 38 moves for reasons unrelated to
the codebase**, which would make a naive count assertion flap. Pin the number only
after settling this.

### 3. BLOCKING — does the Supabase CLI preserve pg_prove's non-zero exit on zero discovered test files?

`supabase test db` globs `supabase/tests/*.sql`. pg_prove with no input exits non-zero,
but whether the CLI wrapper propagates that is unverified — the local stack was down
(`LegacyStatusDbNotRunningError`, Docker off) and was deliberately not started. This is
the **single most likely remaining false pass** in the existing gate set, and it is
cheap to settle once the stack is up.

### 4. Exit codes of the drift candidates on divergence

Whether `supabase migration list` or `db push --dry-run` exit non-zero when local and
remote differ cannot be determined without connecting to the hosted project. A gate
must not assume it — parse `--output-format json` instead. Also unresolved: the
`db push --help` text says vault secrets from `config.toml` are updated *before*
migrations unless `--skip-vault`, and whether `--dry-run` suppresses that write is
ambiguous. Pair with `--skip-vault` defensively. The non-interactive credential env var
names (`SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD`) were inferred from the flag
set, not read from the 2.117.0 help text.

### 5. The 500 body on the one unguarded error path

`src/middleware.ts:12-14` calls `await supabase.auth.getUser()` with no try/catch, and
`src/lib/children.ts:31,50` / `src/lib/notes.ts:35` deliberately `throw` the raw
`PostgrestError`. There is no `src/pages/500.astro` or any error page, so that
response body is produced by the Cloudflare adapter, not by application code.
Production Astro is believed to withhold the stack (dev-only overlay) but this was not
proven. It is the only place where "an error body the parent sees" is not provably a
constant — a natural target for one e2e assertion: force a DB outage, assert the body
contains no `PostgrestError`, no `at ` stack frames, and no `supabase.co` host.

### 6. Current hosted schema state is unknown and unknowable from here

Whether both migrations are actually applied to `ojhtrttucvuthgxxmpce` rests entirely
on two self-ticked checkboxes (`ee7228d`, `3bcc492`). Nothing was run against the
hosted project. Treat "production has the schema" as **unverified** — and note that
this is itself an instance of Risk #3 rather than a research gap.

### 7. Not observed

`npm run build`'s output shape and page count (build not run, per scope). `astro sync`
failure modes (`ci.yml:19`) — it generates the `.astro/types.d.ts` that `astro check`
counts, so a silent partial sync is an untested path to a wrong-but-plausible file
count. GitHub Actions run history beyond the two runs from 2026-10-07, Cloudflare
deployment history, and the actual Worker secret names in Cloudflare.

### Scope decision for `/10x-plan`

Not a research gap, but the decision this research forces: **§5 assigns four gates to
this phase; Phase 1's handoff named three; and none of the four can block anything
until branch protection exists.** Four gates, two of which need a structural
precondition (a deploy step; a paid plan or a public repo), is a large phase. The
cost × signal ordering suggested by the evidence is: Risk #7's scope floor (cheapest,
highest signal, no preconditions) → Risk #2's inverted route-coverage test (cheap, one
blocker: export `PROTECTED_ROUTES` or extract the matcher) → Risk #6's build-output
scan plus the asset-root invariant (cheap, resolves Open Question 1) → Risk #3's drift
check (needs a placement decision and credentials). That ordering is a hypothesis for
`/10x-plan` to weigh, not a conclusion.
