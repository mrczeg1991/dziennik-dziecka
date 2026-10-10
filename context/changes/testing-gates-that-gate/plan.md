# Gates that actually gate — Implementation Plan

## Overview

Wire the four quality gates that `context/foundation/test-plan.md` §5 still marks
`required after §3 Phase 2` — gate integrity (Risk #7), route-guard coverage
(Risk #2), build-output secret scan (Risk #6), and migration drift against the
hosted project (Risk #3) — as plain repo scripts composed behind one `npm run gates`
entry point that **Cloudflare's build command calls**, so a failing gate publishes
nothing. Along the way, harden the two gates that already exist but can pass without
checking, and pin the CI surfaces the new count-based assertions stand on.

## Current State Analysis

**The gates are advisory in GitHub, and blocking in Cloudflare.** Research established
that `gh api repos/mrczeg1991/dziennik-dziecka/branches/master/protection` returns
`403 "Upgrade to GitHub Pro or make this repository public"`, so required status checks
do not exist: a red `ci.yml` stops no merge. What research could not see — because a
Cloudflare Git integration is configured in the Cloudflare dashboard and leaves no
trace in the repo — is that **Cloudflare watches `master` and builds on every push to
it**. That makes merge and deploy causally connected after all, and it relocates the
only available blocking chokepoint: Cloudflare's build command, which publishes nothing
if it exits non-zero. GitHub Actions remains fast feedback; Cloudflare's build is the gate.

This also dates two documents. `context/deployment/deploy-plan.md:26` justifies manual
deploy with _"`git remote -v` w repo jest puste"_ — `origin` exists now
(`https://github.com/mrczeg1991/dziennik-dziecka.git`). And research's Risk #3 finding
("deploy is not wired, this is definitive") is correct about `.github/` and
`package.json` and wrong about the system.

**Risk #7 is the opposite of what §2 assumed.** Measured: an ESLint internal rule throw
exits `2` with an `Oops! Something went wrong!` banner, and every total-empty-scope
condition also exits `2`. Those already fail the gate. What is silent is _partial_
shrinkage — `npx eslint . --ignore-pattern "src/**" -f json` examined **3 files instead
of 37, exit 0, zero bytes of human-visible output**. One extra `.gitignore` line takes
the lint gate green over 8% of the codebase. The instrument is therefore a **floor on
reported scope**, not an abort detector.

**Risk #2 has no live exposure; its value is drift detection.** All five data-touching
routes are covered by `PROTECTED_ROUTES` (`src/middleware.ts:6`) today. Two constraints
rule out the obvious designs: the list is a module-local `const` with **no `export`**,
and all three data endpoints self-guard (`src/pages/api/children.ts:31-34`,
`src/pages/api/notes.ts:19-22`, `src/pages/api/notes/[id].ts:17-20`), so a black-box
`302 → /auth/signin` proves _something_ refused, not that the middleware did. Both data
pages, by contrast, rely solely on the middleware (`src/pages/dashboard.astro:7`;
`src/pages/children/[id].astro:27-28`). The prefix list does not nest — `"/children"`
does not match `/api/children`, which is why `:6` carries both — and `startsWith`
over-matches in the other direction, so protection is accidental both ways.

**Risk #6 is structurally sound with one open hole.** Secrets cannot reach the client
bundle by construction: `astro:env/server` is a virtual module Astro refuses to resolve
in a client bundle, so a client-reachable import is a build failure, not a leak.
Measured against the build on disk, `grep -rlF` for either secret value over
`dist/client` returns **zero hits**. Note content cannot be in build output either —
`output: "server"`, no `prerender`, and `find dist -name "*.html"` returns zero files.
The hole is a config contradiction: `wrangler.jsonc:7-11` declares
`"directory": "./dist"` while the generated `dist/server/wrangler.json` declares
`"directory": "../client"`. `dist/server/.dev.vars` holds both secret values in
plaintext, and `.assetsignore` exists **only** at `dist/client/.assetsignore` (confirmed:
it lists `_worker.js`, `_routes.json`, `wrangler.json`, `.dev.vars`). If `./dist` ever
governs, both secrets are fetchable at `/server/.dev.vars`.

**Nothing detects a committed-but-unapplied migration.** The `smoke` job runs
`supabase start` (`ci.yml:41`), which applies every file in `supabase/migrations/` to a
fresh container, so repo-vs-database agreement is true by construction — the walk's
green describes a database built from the repo seconds earlier, not the hosted one. The
failure mode is **HTTP 200**: with `notes` missing, `src/lib/notes.ts:34-35` throws,
`src/pages/children/[id].astro:43-47` catches into `listFailed`, and the page returns
200 with a Polish "could not load" banner, which `scripts/smoke.mjs` accepts. Both
archived plans tick "Migration pushed to the hosted Supabase project" as a **manual
checkbox** (`child-profiles/plan.md:316`; `first-child-note/plan.md:370,474`). There is
no mechanism — that is Risk #3.

**Three surfaces the gates stand on are unpinned.** `runs-on: ubuntu-latest` carried a
live annotation that it _"will migrate to Ubuntu 26 beginning October 19, 2026"_ — ten
days out — and `actions/setup-node@v4` already forced a Node 24 move. The Supabase CLI
version is pinned (`2.117.0`) but `supabase/setup-cli@v1` is not.

**`ci.yml` cannot see most of the repo.** `ci.yml:3-7` triggers only on
`push: branches: [master]` and `pull_request: branches: [master]`.
`origin/feature/notes-dashboard` has no open PR and has therefore never run CI. A
gate-integrity check that lives only in `ci.yml` inherits that blindness — a check
meant to catch a gate that examined nothing, itself never running, is the risk recursing.

**`npm run smoke` — the gate that asserts the most — has three false-pass vectors.**
The expectation conjunction at `scripts/smoke.mjs:287-293` tests each key with
`=== undefined ||`, so writing `bodyInclude` for `bodyIncludes` short-circuits true and
the step still prints `PASS`. `failed` starts at 0 (`:276`) and the summary at
`:306-307` prints "All smoke steps passed" over an empty loop, so zero steps exits 0.
And `ci.yml:57`'s wait loop has no `|| exit 1`, so an unreachable preview server is
caught only by downstream accident.

## Desired End State

Every push to `master` triggers a Cloudflare build whose command is `npm run gates`.
That command runs the scope floor, the route-coverage check and the migration-drift
check, then builds, then scans the build output — and publishes nothing if any of them
fails. `ci.yml` runs the same scripts as named steps on every branch for fast feedback,
with the heavy `smoke` job still confined to `master` and PRs into it. The four §5 rows
read `required — wired`, cookbook §6.4 and §6.5 are written, and `lessons.md`'s ESLint
entry has its `Rule:` and `Applies to:` fields filled.

**How to verify:** `npm run gates` passes locally on a clean tree. Then, for each gate,
reproduce its failure once — shrink the lint scope, add an unlisted route, drop a
`.assetsignore` entry, point the drift check at a project missing a migration — and
confirm `npm run gates` exits non-zero and names which gate failed.

### Key Discoveries:

- **Cloudflare builds independently of `ci.yml`** — a red CI run and a successful deploy
  can come from the same commit. The build command is the only blocking seat available
  without branch protection.
- **ESLint's examined-file count is only reachable through the JSON formatter.**
  `npx eslint . -f json` emits one object per examined file; the array length is the
  number. Confirmed live at **37**, exit 0, zero messages. `--debug` and `--stats` do
  not give it.
- **`astro check` prints its count already** — `Result (38 files):`, confirmed live.
  The 38-vs-37 delta is real and must not be conflated: `tsconfig.json:3` includes
  `.astro/types.d.ts`, which `astro check` counts and ESLint skips because `.gitignore:5`
  ignores `.astro/`.
- **A floor never flaps upward.** Because the `astro check` assertion is `>= 38`, adding
  files cannot break it — only the exact lint count needs a deliberate bump. Research
  warned the `astro check` number can move for reasons unrelated to the codebase
  (`@astrojs/check` applies its own ignore list, not the raw `tsconfig` file set); a
  floor confines that to the one direction that matters.
- **`supabase migration list` takes `--output-format json`** (confirmed in 2.117.0
  `--help`), plus `--project-ref` and `--password, -p`. It compares the 14-digit version
  prefixes in `supabase/migrations/*.sql` against the remote `schema_migrations` table
  and is report-only by nature. Whether it exits non-zero on divergence is unverified, so
  the gate parses output rather than trusting the exit code.
- **`resolveJsonModule: true`** comes from `astro/tsconfigs/base.json`, so a shared
  `.json` module imports cleanly from `src/middleware.ts` and parses with
  `readFileSync` in a zero-dependency Node script — one list, two readers, no runner.
- **The enumeration root matters.** Globbing `src/pages/**` rather than walking the repo
  sidesteps `.claude/worktrees/isolation-boundary-p2`, which holds a second full checkout
  of the application including `src/pages/` files that do not exist on `master`.
- **`pgTAP` plan counts are self-detecting** — `finish()` emits
  `# Looks like you planned N tests but ran M` and TAP-fails, which `pg_prove`
  propagates. The database suite needs no scope floor.

## What We're NOT Doing

- **Not making the repo public and not buying GitHub Pro.** Branch protection stays
  unavailable and GitHub Actions stays advisory, by decision. The block lives in
  Cloudflare's build command. §3's goal sentence is met there, not in GitHub.
- **Not adding a deploy job to GitHub Actions.** Cloudflare's Git integration already
  owns deploy; duplicating it would create two deploy paths.
- **Not building the `?error=` parameter property check.** Research found
  `src/components/auth/ServerError.tsx:7-15` renders the query parameter verbatim and
  that the invariant worth asserting is "the server never puts an error-derived value
  there" — a lint-able property with no cheap form today. Every first-party path already
  supplies a hardcoded Polish literal, and an attacker-supplied value is self-inflicted
  text injection, not a secret leak. Deferred.
- **Not using `supabase db diff`.** It is the only candidate that catches a dashboard
  hand-edit or an edited migration body, but it needs a Docker shadow database, which the
  Cloudflare build environment does not have. **Accepted blind spot:** editing the body of
  an already-applied migration stays undetected. `git log` shows no such edit has ever
  happened here.
- **Not using `supabase db push --dry-run`** for the drift report — it would hand the
  build environment production write credentials to produce a read-only answer.
- **Not using the data-touching-by-import classifier.** Research found every data route
  imports `@/lib/children` or `@/lib/notes` and that this is exact today, but it is a
  convention, not a boundary — a route calling `supabase.from("children")` inline is
  invisible to it. The inverted allowlist supersedes it and fails closed instead.
- **Not using the built SSR manifest for enumeration.** It is authoritative, but it costs
  a build, needs a content-hashed filename globbed, and is un-versioned Astro internals.
- **Not standing up a test runner.** That is §3 Phase 3. Every check here is a plain Node
  script or a CI assertion, which is why §3 ordered this phase first.
- **Not asserting the literal wording of any error string**, and not adding a second
  linter to catch the first one's failure — both named anti-patterns in `change.md`.
- **Not re-running the HTTP walk against production.** Its write-path assertions would
  create rows in the single real user's database with no cleanup.
- **Not wiring a post-edit hook.** §5 marks it recommended-local and no rollout phase
  owns it.
- **Not revisiting Fix B** (column-scoped grants or a `before update` trigger). It stays
  deferred per §6.6, and `supabase/tests/03_notes_destruction.sql` assertions 3 and 4
  remain its tripwire.

## Implementation Approach

The gates are **plain Node scripts under `scripts/`**, each exiting non-zero with a named
reason, composed by `package.json` scripts. That choice follows the `scripts/smoke.mjs`
precedent — zero dependencies, no runner, reviewable in the repo — and it is what makes
seating them in Cloudflare's dashboard build command safe: the dashboard holds one value
(`npm run gates`), while the logic stays in version control.

Composition has to respect one ordering fact: the build-output scan needs `dist/` to
exist, and everything else should run before a build is paid for. So:

```
gates      = gates:pre && build && gates:post
gates:pre  = gate:scope && gate:routes && gate:drift
gates:post = gate:build-output
```

`ci.yml` calls the individual `gate:*` scripts as **named steps** rather than the
composite, so a failure is attributed to a step name instead of a shell line — the same
logic, invoked twice, with no second definition to drift. `gate:drift` is the exception:
it talks to the hosted project, so it runs only in the Cloudflare build and in a
scheduled sweep, never on every branch push.

Phase order is cost × signal with one dependency inverted to the front: the count
assertions are calibrated numbers, so the runner image and action tags are pinned
**first**, before anything is measured against them. Phase 6 is last because a gate must
be green before it is allowed to block a deploy.

## Critical Implementation Details

**Each phase that adds a lintable file must bump the expected lint count in the same
commit.** `scripts/**/*.mjs` is linted (`eslint.config.js` `scriptsConfig`), so every
gate script this plan adds moves the number: 37 today, and +1 per `.mjs` file added. The
bump is the designed friction — it is the review moment where someone confirms the new
file is meant to be in scope — but a phase that adds a script and forgets the bump will
fail its own gate. Re-derive with `npx eslint . -f json` and read the array length; never
guess the delta. A `.json` file does not move the lint count (no config block targets it)
but may move the `astro check` count, which is why that one is a floor.

**`npm run gates` must not become the thing `ci.yml` runs for the build.** The `ci` job's
build step passes `SUPABASE_URL`/`SUPABASE_KEY` (`ci.yml:23-25`); research established
those are ceremonial — `astro.config.mjs:19-20` declares both `optional: true` and the
build resolves them at runtime through `_internalGetSecret`, with
`dist/server/wrangler.json` carrying `"vars":{}`. Leave that step as it is; do not
"fix" it into `npm run gates` and do not add an assertion that the build consumed them.

**The drift gate must not trust an exit code.** Research could not determine whether
`supabase migration list` exits non-zero on divergence without connecting to the hosted
project. Parse `--output-format json` and decide from the parsed sets. Pass `--yes` so a
prompt cannot hang a build.

## Phase 1: Stabilise the ground the gates stand on

### Overview

Pin the runner image and the three action tags, and make `ci.yml` observe every branch
for its cheap job. Both are prerequisites, not cleanup: the Ubuntu 26 migration begins
2026-10-19 and would move tool behaviour underneath the Phase 2 counts within days of
them landing, and a gate-integrity check confined to `master` would not have observed
`origin/feature/notes-dashboard` at all.

### Changes Required:

#### 1. Pin the CI execution surface

**File**: `.github/workflows/ci.yml`

**Intent**: Replace `ubuntu-latest` with an explicit image on both jobs, and pin
`actions/checkout`, `actions/setup-node` and `supabase/setup-cli` to commit SHAs, so the
counts Phase 2 calibrates cannot move for reasons outside the repository. Phase 1 of the
rollout pinned only the Supabase CLI and said so deliberately; this closes the rest.

**Contract**: `runs-on: ubuntu-24.04` on both the `ci` and `smoke` jobs
(`:11`, `:28`). Each `uses:` line becomes `owner/repo@<40-char-sha> # vN` — the trailing
comment carries the human-readable version so the pin stays legible. The
`supabase/setup-cli` `version: 2.117.0` input is unchanged.

#### 2. Make the cheap gate reachable from every branch

**File**: `.github/workflows/ci.yml`

**Intent**: Extend the trigger list so the `ci` job runs on any branch, while the
`smoke` job — which starts a full Supabase stack — stays on `master` and PRs into it.
A gate-integrity check inherits its workflow's reachability, so this is what gives
Phase 2 somewhere to run.

**Contract**: `on.push.branches` becomes `["**"]` and `on.pull_request.branches` stays
`[master]`; the `smoke` job gains
`if: github.ref == 'refs/heads/master' || github.event_name == 'pull_request'`. A comment
above the `if` states why the two scopes differ, so the asymmetry is not read as a
mistake and quietly "fixed".

### Success Criteria:

#### Automated Verification:

- Workflow file parses and both jobs run: push a branch and confirm the `ci` job executes
- No `ubuntu-latest` or floating action tag remains: `grep -nE "ubuntu-latest|@v[0-9]+$" .github/workflows/ci.yml` returns nothing
- Existing gates still pass on the pinned image: `npm run lint`, `npx astro check`, `npm run build`

#### Manual Verification:

- A push to a non-`master` branch shows the `ci` job running and the `smoke` job skipped
- A PR into `master` shows both jobs running
- Each pinned SHA resolves to the tag named in its trailing comment

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful before proceeding to the next phase.

---

## Phase 2: Gate integrity — a floor on reported scope

### Overview

Build the Risk #7 gate as a floor on how much each tool reported examining, and close the
three ways `npm run smoke` can pass without checking. This is the cheapest gate with the
highest signal and it has no preconditions, which is why it leads.

### Changes Required:

#### 1. The scope floor

**File**: `scripts/gate-scope.mjs` (new)

**Intent**: Run each scope-reporting gate, read the count it reports, and fail when the
count falls below what the repository expects — catching the silent case where a tool
examined a fraction of the codebase and exited 0 with no output.

**Contract**: Exits 0 or non-zero with a message naming the gate, the expected value and
the observed one. Expectations live in one `EXPECTED` object at the top of the file, each
with a comment giving the command that re-derives it:

```js
const EXPECTED = {
  // npx eslint . -f json  → array length. Exact: ESLint's scope is .gitignore-driven
  // and deterministic, so any movement is a deliberate change to what is linted.
  eslintFiles: { mode: "exact", value: 37 },
  // npx astro check → "Result (N files):". Floor, not exact: @astrojs/check applies its
  // own ignore list rather than the raw tsconfig file set, so N can move without a code
  // change. A floor confines that to the one direction that matters — shrinkage.
  astroCheckFiles: { mode: "floor", value: 38 },
};
```

ESLint's count comes from `npx eslint . -f json` parsed as JSON, array length — not from
`--debug` or `--stats`, neither of which reports it. `astro check`'s comes from parsing
`Result (N files):` out of stdout. A run that produces no parseable count is a failure,
not a pass.

#### 2. Expose the gate as a script

**File**: `package.json`

**Intent**: Give the gate a name CI steps and the composite can both call.

**Contract**: `"gate:scope": "node scripts/gate-scope.mjs"`.

#### 3. Close the smoke walk's false-pass vectors

**File**: `scripts/smoke.mjs`

**Intent**: Make a typo'd expectation key and an empty step list both fail, so the gate
that asserts the most cannot report a pass it did not earn.

**Contract**: Three changes. (a) Validate every expectation object's keys against the
known set — `status`, `location`, `bodyIncludes`, `bodyExcludes`, `bodyOrder`, `extract` —
and fail the run on an unknown key, because the conjunction at `:287-293` treats an
unknown key as satisfied. (b) Assert `steps.length` is at least the current count before
the loop, so the empty-array path at `:276`/`:306-307` cannot print success. (c) Report
the asserted step total in the summary line, so the number is visible rather than inferred.

#### 4. Give the wait loop a failure path

**File**: `.github/workflows/ci.yml`

**Intent**: Make an unreachable preview server fail the step it belongs to rather than
being caught by a downstream accident.

**Contract**: The `seq 1 60` loop at `:57` gains an explicit failure branch so the step
exits non-zero when the server never answers, instead of falling through to
`npm run smoke`.

#### 5. Wire the gate into CI

**File**: `.github/workflows/ci.yml`

**Intent**: Run the scope floor as its own named step in the `ci` job, after the tools
whose scope it checks.

**Contract**: A `- run: npm run gate:scope` step placed after `npx astro check` (`:21`).

#### 6. Close out the lessons entry this risk came from

**File**: `context/foundation/lessons.md`

**Intent**: Fill the `Rule:` and `Applies to:` fields, which are still `<to fill in>` on
the entry that is Risk #7's cited source. Research reproduced the abort live and settled
the exit code at 2, so the entry can now state a rule instead of a symptom.

**Contract**: `Rule:` states the scoped-override pattern and its inverse obligation — a
glob that is too narrow aborts the whole run loudly, while one that is too wide silently
disables the rule on real code, so entries are removed when the early return goes away.
`Applies to:` names `.astro` frontmatter with a top-level `return` under
`astro-eslint-parser`. No other field changes; this completes an existing entry rather
than adding one.

### Success Criteria:

#### Automated Verification:

- Gate passes on a clean tree: `npm run gate:scope`
- Lint count expectation matches reality: `npx eslint . -f json` array length equals the `EXPECTED.eslintFiles` value (38 after this phase's script is added)
- `astro check` still clears the floor: `npx astro check` reports at least 38 files
- Smoke walk still passes end to end in CI (`smoke` job green on a PR)
- Lint and typecheck pass: `npm run lint`, `npx astro check`

#### Manual Verification:

- Shrinking the lint scope fails the gate: `npx eslint . --ignore-pattern "src/**" -f json` reports 3 files, and `gate:scope` run against that scope exits non-zero
- An ESLint internal rule throw still fails loudly rather than being mistaken for shrinkage (re-enable `no-misused-promises` from the CLI with `--rule` and confirm exit 2 with the `Oops!` banner)
- A typo'd expectation key in `scripts/smoke.mjs` now fails the run instead of printing `PASS`
- Emptying the `steps` array fails the run instead of printing "All smoke steps passed"
- `context/foundation/lessons.md` has no `<to fill in>` remaining

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful before proceeding to the next phase.

---

## Phase 3: Route-guard coverage

### Overview

Make a data-touching route added after this test was written fail the build rather than
ship unguarded. The assertion is **inverted**: enumerate the routes that exist, then
require every one of them that is not on an explicit public allowlist to be covered by
the guard. Forgetting to update the allowlist fails; forgetting to update a check-list
would pass silently, which is the §2 anti-pattern.

### Changes Required:

#### 1. One list, two readers

**File**: `src/lib/protected-routes.json` (new)

**Intent**: Move the guard list out of a module-local `const` into a shared data file so
the checker reads the list the middleware actually uses, rather than a copy of it. The
public allowlist lives in the same file, because it is the one surface that must be
edited deliberately and both halves belong under the same review.

**Contract**: `{ "protected": [...], "public": [...] }`. `protected` carries today's four
prefixes from `src/middleware.ts:6` unchanged — `/dashboard`, `/children`,
`/api/children`, `/api/notes`. `public` carries the seven routes research classified as
public by design: `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`, and the
three `/api/auth/*` endpoints. JSON admits no comments, so the invariant is documented at
the import site and in cookbook §6.4.

#### 2. Middleware reads the shared list

**File**: `src/middleware.ts`

**Intent**: Replace the inline `const` with an import of the shared file, keeping the
matching behaviour byte-for-byte identical.

**Contract**: `PROTECTED_ROUTES` is sourced from the JSON import; the `startsWith`
predicate at `:25-29` is unchanged. The comment at `:4-5` explaining that `"/children"`
covers `/children/<id>` stays, since the nesting behaviour is what the prefix list
depends on.

#### 3. The coverage checker

**File**: `scripts/gate-routes.mjs` (new)

**Intent**: Enumerate the routes that exist from the filesystem — the artifact a new
route is created as, so it cannot be forgotten — and assert the guard list covers every
one that is not explicitly public.

**Contract**: Exits non-zero naming the offending route and which assertion it broke.
Enumeration globs `src/pages/**/*.{astro,ts}` and maps to route paths by Astro's
convention, stripping the extension and `index`. Rooting at `src/pages` is deliberate:
a repo-wide walk would enumerate phantom routes from
`.claude/worktrees/isolation-boundary-p2`, a second full checkout holding `src/pages/`
files that do not exist on `master`. Four assertions:

1. Every enumerated route is either matched by a `protected` prefix or listed in `public`
   — an unclassified route is a failure. This is the drift detector.
2. No `public` entry is shadowed by a `protected` prefix, which would make it
   unreachable anonymously.
3. Every `protected` prefix matches at least one enumerated route — a prefix matching
   nothing is stale, and `startsWith` over-matching means a stale prefix silently widens
   (research's example: `"/children"` would also protect `/children-export`).
4. Every `public` entry corresponds to a route that exists.

This runs without a server and without a build, which is what lets it sit in the
pre-build half of the composite.

#### 4. Assert the refusal over HTTP, from the same list

**File**: `scripts/smoke.mjs`

**Intent**: The static checker proves the list covers the route; this proves the app
refuses. Generate the anonymous assertions from the shared JSON instead of the four
hardcoded paths at `:78-98`, which is how `/api/notes/<id>` — the edit and soft-delete
endpoint, never exercised anonymously today — gets covered.

**Contract**: The anonymous block derives one assertion per `protected` prefix plus one
concrete path per data route, each expecting `302` to `/auth/signin`; `/` keeps its `200`.
These run before the first signup, where the existing block already sits, because the
walk's later steps hold a session. The step-count floor added in Phase 2 moves with the
new steps.

#### 5. Expose and wire the gate

**Files**: `package.json`, `.github/workflows/ci.yml`

**Intent**: Name the gate and run it in CI.

**Contract**: `"gate:routes": "node scripts/gate-routes.mjs"`, and a
`- run: npm run gate:routes` step in the `ci` job. The expected lint count in
`scripts/gate-scope.mjs` is bumped for the new `.mjs` file in the same commit.

#### 6. Reconcile the hard rule with reality

**File**: `AGENTS.md`

**Intent**: `AGENTS.md:9` says "add its path to `PROTECTED_ROUTES` … don't gate auth ad
hoc inside a page", yet all three data endpoints do gate ad hoc — and two of them need
`user.id` for their insert regardless (`api/children.ts:60`, `api/notes.ts:69`), so the
rule as written cannot be followed literally for endpoints. Point the rule at the new
file and state the endpoint exception, so the next agent does not "fix" a self-guard.

**Contract**: The hard rule names `src/lib/protected-routes.json` as the single source of
truth, states that a new route must be classified there or the gate fails, and notes that
an endpoint may additionally self-guard when it needs the user id — redundantly, not
instead.

### Success Criteria:

#### Automated Verification:

- Gate passes on a clean tree: `npm run gate:routes`
- Middleware behaviour unchanged: `npm run build` succeeds and `npx astro check` passes
- Lint passes with the bumped count: `npm run lint` then `npm run gate:scope`
- Smoke walk passes with the generated anonymous assertions (`smoke` job green on a PR)
- `/api/notes/<id>` is asserted anonymously: `grep -n "api/notes/" scripts/smoke.mjs` shows an anonymous step

#### Manual Verification:

- Adding an empty `src/pages/api/measurements.ts` fails `gate:routes` as unclassified, and keeps failing until it is classified — confirming the drift case research found has no middleware protection, since there is no `/api` prefix
- Removing `/api/children` from the `protected` list fails `gate:routes`
- Adding a stale prefix such as `/api/export` fails the necessity assertion
- A signed-out request to `/api/notes/<id>` redirects to `/auth/signin` against a live server

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful before proceeding to the next phase.

---

## Phase 4: Build-output secret scan and asset-root invariant

### Overview

Keep secrets out of what Cloudflare serves, and settle the config contradiction that is
the only path by which they could actually be served. The scan is pure regression
protection — research measured zero hits today — while the asset-root assertion closes a
real hole.

### Changes Required:

#### 1. Scan what gets served

**File**: `scripts/gate-build-output.mjs` (new)

**Intent**: Assert no secret value reaches the client bundle, and assert the invariants
that keep the server-side build artifacts out of the served asset root.

**Contract**: Runs after `npm run build`; exits non-zero naming the file and the pattern
matched. Two groups of assertions.

_Secret scan over the resolved asset root:_ no occurrence of the `SUPABASE_URL` or
`SUPABASE_KEY` values when they are present in the environment, and no JWT-shaped string
(`eyJ[A-Za-z0-9_-]{10,}`) or bare `SUPABASE_URL`/`SUPABASE_KEY` identifier. The scan is
scoped to secrets only: note content cannot be in build output — `output: "server"`, no
`prerender` export anywhere, and `find dist -name "*.html"` returns zero files — so
pairing the two, as §2 does, makes half the check vacuous. Record that correction in §6.

_Asset-root invariant:_ the effective asset directory resolves to `dist/client`;
`dist/client/.assetsignore` exists and lists both `.dev.vars` and `wrangler.json`; and no
`.dev.vars`, `wrangler.json` or `_worker.js` sits unignored beneath the resolved root.
A missing or unreadable `.assetsignore` is a failure, not a skip.

#### 2. Remove the contradiction rather than reason about it

**File**: `wrangler.jsonc`

**Intent**: `wrangler.jsonc:7-11` says `"directory": "./dist"` while the generated
`dist/server/wrangler.json` says `"../client"`. Research could not establish which
governs. Setting the checked-in value to the correct directory makes the question moot:
if the generated config governs, the checked-in value is unused and harmless; if the
checked-in value governs, it is now right. `./dist` is wrong under both readings, because
`dist/server/.dev.vars` holds both secret values in plaintext and `.assetsignore` exists
only under `dist/client`.

**Contract**: `assets.directory` becomes `"./dist/client"`. `binding`,
`not_found_handling` and every other key are unchanged.

#### 3. Expose and wire the gate

**Files**: `package.json`, `.github/workflows/ci.yml`

**Intent**: Name the gate and run it after the build in both jobs that build.

**Contract**: `"gate:build-output": "node scripts/gate-build-output.mjs"`, with a
`- run: npm run gate:build-output` step after `npm run build` in the `ci` job and after
`npm run build` in the `smoke` job (`:53`), where real Supabase values are in the
environment and the scan therefore has concrete strings to look for. The expected lint
count is bumped in the same commit.

### Success Criteria:

#### Automated Verification:

- Gate passes against a fresh build: `npm run build && npm run gate:build-output`
- Secrets absent from the client bundle: `grep -rlE "eyJ[A-Za-z0-9_-]{10,}|SUPABASE_URL|SUPABASE_KEY" dist/client` returns nothing
- No server artifact under the served root: `ls dist/client/.dev.vars dist/client/wrangler.json` fails
- Lint passes with the bumped count: `npm run lint` then `npm run gate:scope`
- Build still succeeds with the corrected asset directory: `npm run build`

#### Manual Verification:

- `npx wrangler deploy --dry-run --outdir <tmp>` confirms which asset directory Wrangler resolves, settling research's Open Question 1 — and the gate passes either way
- Copying `dist/server/.dev.vars` into `dist/client/` fails the gate
- Removing the `.dev.vars` line from `dist/client/.assetsignore` fails the gate
- `curl` against the deployed Worker for `/server/.dev.vars` and `/.dev.vars` returns no secret content

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful before proceeding to the next phase.

---

## Phase 5: Migration drift at deploy, plus a scheduled sweep

### Overview

Make a merge unable to produce a deployed app whose expected schema is absent from the
hosted database, and report divergence rather than letting the parent discover it at the
moment of capture. Two copies of one check: one in the deploy path, where it blocks; one
on a schedule, because drift is bidirectional and a merge trigger samples at the wrong
times — the hosted-project link lives in the gitignored
`supabase/.temp/linked-project.json`, so a laptop `supabase db push` can advance the
hosted database with no merge involved.

### Changes Required:

#### 1. The drift checker

**File**: `scripts/gate-migration-drift.mjs` (new)

**Intent**: Compare the migration versions committed to the repository against those
applied to the hosted project, fail when the repository is ahead (the direction that
breaks a deploy), and report when the hosted project is ahead (the direction a laptop
push creates).

**Contract**: Exits non-zero listing the version strings in each direction. Local
versions come from the 14-digit prefixes of `supabase/migrations/*.sql` — today
`20260923221601_create_children.sql` and `20260927205447_create_notes.sql`. Remote
versions come from `supabase migration list --linked --output-format json --yes`, parsed;
the exit code is **not** consulted, because whether the CLI exits non-zero on divergence
is unverified. Credentials come from environment variables this project defines —
`SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD`, passed through `--project-ref` and
`--password` — rather than from CLI-specific variable names research could only infer.
Absent credentials are a **failure** in the deploy path, not a skip: a drift gate that
silently no-ops when a secret is missing is Risk #7 wearing Risk #3's clothes.

Two directions, two severities: repo-ahead is a hard failure, because the deployed code
would expect a table that is not there (research's measured symptom: HTTP 200 with a
Polish "could not load" banner, which the smoke walk accepts). Remote-ahead is also a
failure, but its message says so explicitly, since the fix is to commit the migration
rather than to push.

#### 2. Expose the gate

**File**: `package.json`

**Intent**: Name the gate for both the composite and the scheduled job.

**Contract**: `"gate:drift": "node scripts/gate-migration-drift.mjs"`. It is deliberately
absent from the per-push `ci` job — it talks to the hosted project, so running it on
every branch push would both need credentials everywhere and hammer the project.

#### 3. The scheduled sweep

**File**: `.github/workflows/ci.yml`

**Intent**: Sample the direction a merge trigger cannot see, on a fixed cadence.

**Contract**: `on.schedule` gains a daily cron, and a third job `drift` runs
`npm run gate:drift` under `if: github.event_name == 'schedule'` with
`SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD` from repository secrets. It needs
neither Docker nor the local stack, so it checks out, installs, and runs — no
`supabase start`. This job is advisory by nature; the blocking copy is the one in the
Cloudflare build.

#### 4. Correct and extend the deploy runbook

**File**: `context/deployment/deploy-plan.md`

**Intent**: The runbook's stated reason for manual deploy is factually stale — `:26` says
`git remote -v` is empty, and `origin` exists now — and the runbook predates the
Cloudflare Git integration entirely. Record what actually happens, so the next reader does
not re-derive it from the dashboard.

**Contract**: The gap-table entry at `:26` is corrected to state that `origin` exists and
Cloudflare builds `master` on push. A section documents the build command as the blocking
gate and names `npm run gates`. The manual `supabase db push` step at `:67-81` gains a
note that `gate:drift` now enforces the ordering it previously only documented. The
rollback note at `:110-117` keeps its existing caveat that rollback does not revert
migrations — unchanged, and now the reason the drift gate fails loudly in that state.

### Success Criteria:

#### Automated Verification:

- Gate passes against the hosted project with both migrations applied: `npm run gate:drift`
- Missing credentials fail rather than skip: running `gate:drift` with `SUPABASE_PROJECT_REF` unset exits non-zero
- Lint passes with the bumped count: `npm run lint` then `npm run gate:scope`
- The scheduled job's YAML is valid and the job appears in the Actions UI with a schedule trigger

#### Manual Verification:

- A locally added migration file that is not applied remotely fails the gate with a repo-ahead message
- The gate's verdict is parsed from JSON, not inferred from an exit code — confirmed by running against a diverged state and observing the CLI's own exit code separately
- The first scheduled run completes green and its log shows both migration versions compared
- `context/deployment/deploy-plan.md` no longer claims the remote is empty

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful before proceeding to the next phase.

---

## Phase 6: Seat the gates and update the quality contract

### Overview

Compose the four gates into one command, point Cloudflare's build at it so a failing gate
publishes nothing, and bring the test plan's own documents in line with what now exists.
Last, because a gate must be green before it is allowed to block a deploy.

### Changes Required:

#### 1. Compose the entry point

**File**: `package.json`

**Intent**: Give the Cloudflare dashboard exactly one value to hold, with the ordering the
gates require, so the logic stays in version control.

**Contract**: Three scripts. `"gates:pre": "npm run gate:scope && npm run gate:routes && npm run gate:drift"`,
`"gates:post": "npm run gate:build-output"`, and
`"gates": "npm run gates:pre && npm run build && npm run gates:post"`. The ordering is
load-bearing: `gate:build-output` needs `dist/` to exist, and everything else runs before
a build is paid for.

#### 2. Point the deploy at it

**File**: none — Cloudflare dashboard (manual)

**Intent**: Replace the project's build command with `npm run gates`, which is what makes
every gate in this phase blocking rather than advisory. `SUPABASE_PROJECT_REF` and
`SUPABASE_DB_PASSWORD` must exist as build-environment variables there, or `gate:drift`
fails the build by design.

**Contract**: Build command `npm run gates`; build output directory unchanged. This is
the one piece of configuration outside the repo, which is why the scripts it calls are in
the repo and why `deploy-plan.md` now records the value. Note the previous build command
before changing it — this change cannot be reverted with a git revert.

#### 3. Flip the quality gates table

**File**: `context/foundation/test-plan.md`

**Intent**: Four §5 rows read `required after §3 Phase 2`; they are wired now. Two of
them also have the wrong "Where", since research corrected the placement.

**Contract**: §5 rows for gate-integrity, route-guard coverage and build-output secret
scan become `required — wired`, with "Where" naming CI plus the Cloudflare build command.
The migration-drift row becomes `required — wired` with "Where" reading the Cloudflare
build command plus a scheduled CI sweep, replacing "between merge and deploy" — a slot
that research showed did not exist in the form §5 assumed. §4's
`build-output assertion — none yet — see §3 Phase 2` row is updated to name
`scripts/gate-build-output.mjs`.

#### 4. Write the cookbook entries this phase owns

**File**: `context/foundation/test-plan.md`

**Intent**: §6.4 and §6.5 are `TBD — see §3 Phase 2`. They become the canonical answer to
"how do I add a test for a new route?" and "how do I assert a gate actually ran?", which
is what `/10x-tdd` reads in the next lesson.

**Contract**: §6.4 gives location, naming and the reference check for route coverage:
classify every new route in `src/lib/protected-routes.json`, the inverted assertion and
why a positive check-list is forbidden, the `src/pages/**` enumeration root and the
`.claude/worktrees/` reason for it, and `npm run gate:routes` as the run command. §6.5
gives the scope-floor pattern: exact for a deterministic scope, floor for a tool that
applies its own ignore list, the JSON-formatter detail for ESLint, the obligation to
re-derive rather than guess a count when adding a file, and `npm run gate:scope`. Both
sections state the §2 corrections research established — that the abort case already
fails loudly and partial shrinkage is the silent one, and that pairing the secret scan
with note content makes half the check vacuous.

#### 5. Record the phase note

**File**: `context/foundation/test-plan.md`

**Intent**: §6.6 carries one note per rollout phase. Phase 1's note recorded that
deny-by-default makes removal loud and widening silent; this phase's inverts it.

**Contract**: A §6.6 entry stating that at the gate layer total failure is loud and
partial shrinkage is silent, so the instrument is a quantity assertion rather than an
assertion at the enforcing layer; that three hand-maintained lists existed and the pattern
adopted is enumerate-then-invert against a small explicit allowlist; and that GitHub
Actions is advisory on this plan while Cloudflare's build command is the blocking seat —
with the note that if the repository ever becomes public or moves to a paid plan, branch
protection should be turned on and this asymmetry revisited.

### Success Criteria:

#### Automated Verification:

- The composite passes on a clean tree: `npm run gates`
- Each gate is individually runnable: `npm run gate:scope`, `npm run gate:routes`, `npm run gate:drift`, `npm run gate:build-output`
- No `TBD — see §3 Phase 2` remains: `grep -n "see §3 Phase 2" context/foundation/test-plan.md` returns nothing
- No `required after §3 Phase 2` remains in §5: `grep -n "required after §3 Phase 2" context/foundation/test-plan.md` returns nothing
- Full gate set green in CI on a PR into `master` (both jobs)

#### Manual Verification:

- A Cloudflare build triggered by a push to `master` runs `npm run gates` and its log shows all four gates
- A deliberately broken gate merged to `master` produces a failed Cloudflare build and no new deployment — the assertion that this phase's goal is actually met
- The deployed app still works after a green gated build: sign in, add a child, add a note
- §6.4 and §6.5 are specific enough that a new route could be added by following them without reading this plan

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful. This is the final phase — on confirmation, mark §3 Phase 2 `complete`.

---

## Testing Strategy

This phase builds gates rather than tests, so the strategy is inverted: every gate must
be shown to fail before it is trusted to pass.

### Gate failure reproduction:

Each gate has a named failure case in its phase's Manual Verification, and each is
non-destructive and reversible:

- **Scope floor** — `npx eslint . --ignore-pattern "src/**"`, which research measured at 3 of 37 files, exit 0, no output
- **Route coverage** — add an empty `src/pages/api/measurements.ts`; it falls outside both the `children` and `notes` prefixes, so it receives no middleware protection, which is the concrete refutation of "it lives under the API prefix so it is protected"
- **Build output** — copy `dist/server/.dev.vars` into `dist/client/`, or drop its `.assetsignore` line
- **Migration drift** — add a local migration file with no remote counterpart

### Integration:

- `npm run gates` end to end on a clean tree, then once per gate with that gate's failure case injected
- A PR into `master` exercising both CI jobs with all gate steps present
- One push to `master` producing a Cloudflare build that runs the composite

### Manual Testing Steps:

1. Push a non-`master` branch; confirm the `ci` job runs and `smoke` is skipped
2. Run `npm run gates` locally on a clean tree; confirm it passes and names each gate
3. Inject each of the four failure cases above in turn; confirm a non-zero exit naming the right gate, then revert
4. Merge a green branch to `master`; confirm the Cloudflare build runs `npm run gates` and deploys
5. Merge a branch with one gate deliberately failing; confirm the build fails and no new deployment appears
6. Sign in to the deployed app, add a child and a note, and confirm the note reads back

## Performance Considerations

`npm run gates` sits in the deploy path, so its cost is paid on every push to `master`.
Three of the four gates are cheap: `gate:scope` re-runs ESLint and `astro check`, which
the build would not otherwise pay for in the Cloudflare environment; `gate:routes` is a
filesystem glob; `gate:build-output` is a grep over `dist/client`. `gate:drift` makes one
network round trip to the hosted project. The composite roughly doubles the Cloudflare
build's work by adding a lint and typecheck pass to it — acceptable for a solo project,
and it is precisely that duplication which makes the gate blocking rather than advisory.

Extending the `ci` job to every branch adds a short job per scratch push; the expensive
`smoke` job, which starts a full Supabase stack, deliberately stays on `master` and PRs.

## Migration Notes

No data migration. Three pieces of state move:

- `PROTECTED_ROUTES` moves from `src/middleware.ts:6` into
  `src/lib/protected-routes.json` with its values unchanged, so middleware behaviour is
  byte-for-byte identical; `AGENTS.md:9` is updated in the same phase so the hard rule
  points at the new location.
- `wrangler.jsonc`'s `assets.directory` changes from `./dist` to `./dist/client`. Safe
  under both readings of the config-precedence question, and strictly safer than the
  current value.
- Cloudflare's build command changes to `npm run gates`, and two build-environment
  variables are added there. This is the only change outside the repository and the only
  one that cannot be reverted with a git revert.

## References

- Related research: `context/changes/testing-gates-that-gate/research.md`
- Change identity and Phase 1 carry-forward: `context/changes/testing-gates-that-gate/change.md`
- Quality contract: `context/foundation/test-plan.md` §2 (risks), §3 (rollout), §5 (gates), §6.4–§6.6 (cookbook)
- Phase 1 of the rollout: `context/archive/2026-10-03-testing-isolation-boundary/plan.md:118-120` (the three checks deferred here), `:571` (the pinning handoff)
- ESLint abort entry: `context/foundation/lessons.md`
- Deploy runbook: `context/deployment/deploy-plan.md:26` (stale justification), `:67-88` (the manual sequence)
- Guard list and matcher: `src/middleware.ts:6,25-29`
- Endpoint self-guards: `src/pages/api/children.ts:31-34`, `src/pages/api/notes.ts:19-22`, `src/pages/api/notes/[id].ts:17-20`
- Middleware-only pages: `src/pages/dashboard.astro:7`, `src/pages/children/[id].astro:27-28`
- Smoke walk false-pass vectors: `scripts/smoke.mjs:78-98`, `:276`, `:287-293`, `:306-307`
- CI surface: `.github/workflows/ci.yml:3-7` (triggers), `:11,28` (runner), `:13,14,35` (actions), `:23-25` (ceremonial secrets), `:57` (wait loop)
- Asset-root contradiction: `wrangler.jsonc:7-11` vs `dist/server/wrangler.json`; `dist/client/.assetsignore`
- ESLint scoped override: `eslint.config.js:73-84` (the abort mitigation), `:94,96` (ignores)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Stabilise the ground the gates stand on

#### Automated

- [x] 1.1 Workflow file parses and both jobs run: push a branch and confirm the `ci` job executes — eef7119
- [x] 1.2 No `ubuntu-latest` or floating action tag remains — eef7119
- [x] 1.3 Existing gates still pass on the pinned image: `npm run lint`, `npx astro check`, `npm run build` — eef7119

#### Manual

- [x] 1.4 A push to a non-`master` branch shows the `ci` job running and the `smoke` job skipped
- [x] 1.5 A PR into `master` shows both jobs running
- [x] 1.6 Each pinned SHA resolves to the tag named in its trailing comment

### Phase 2: Gate integrity — a floor on reported scope

#### Automated

- [x] 2.1 Gate passes on a clean tree: `npm run gate:scope`
- [x] 2.2 Lint count expectation matches reality: `npx eslint . -f json` array length equals the `EXPECTED.eslintFiles` value
- [x] 2.3 `astro check` still clears the floor: at least 38 files
- [ ] 2.4 Smoke walk still passes end to end in CI
- [x] 2.5 Lint and typecheck pass: `npm run lint`, `npx astro check`

#### Manual

- [x] 2.6 Shrinking the lint scope fails the gate
- [x] 2.7 An ESLint internal rule throw still fails loudly rather than being mistaken for shrinkage
- [x] 2.8 A typo'd expectation key in `scripts/smoke.mjs` now fails the run instead of printing `PASS`
- [x] 2.9 Emptying the `steps` array fails the run instead of printing "All smoke steps passed"
- [x] 2.10 `context/foundation/lessons.md` has no `<to fill in>` remaining

### Phase 3: Route-guard coverage

#### Automated

- [ ] 3.1 Gate passes on a clean tree: `npm run gate:routes`
- [ ] 3.2 Middleware behaviour unchanged: `npm run build` succeeds and `npx astro check` passes
- [ ] 3.3 Lint passes with the bumped count: `npm run lint` then `npm run gate:scope`
- [ ] 3.4 Smoke walk passes with the generated anonymous assertions
- [ ] 3.5 `/api/notes/<id>` is asserted anonymously in `scripts/smoke.mjs`

#### Manual

- [ ] 3.6 Adding an empty `src/pages/api/measurements.ts` fails `gate:routes` as unclassified
- [ ] 3.7 Removing `/api/children` from the `protected` list fails `gate:routes`
- [ ] 3.8 Adding a stale prefix such as `/api/export` fails the necessity assertion
- [ ] 3.9 A signed-out request to `/api/notes/<id>` redirects to `/auth/signin` against a live server

### Phase 4: Build-output secret scan and asset-root invariant

#### Automated

- [ ] 4.1 Gate passes against a fresh build: `npm run build && npm run gate:build-output`
- [ ] 4.2 Secrets absent from the client bundle
- [ ] 4.3 No server artifact under the served root
- [ ] 4.4 Lint passes with the bumped count: `npm run lint` then `npm run gate:scope`
- [ ] 4.5 Build still succeeds with the corrected asset directory: `npm run build`

#### Manual

- [ ] 4.6 `npx wrangler deploy --dry-run --outdir <tmp>` confirms which asset directory Wrangler resolves, settling research's Open Question 1
- [ ] 4.7 Copying `dist/server/.dev.vars` into `dist/client/` fails the gate
- [ ] 4.8 Removing the `.dev.vars` line from `dist/client/.assetsignore` fails the gate
- [ ] 4.9 `curl` against the deployed Worker for `/server/.dev.vars` and `/.dev.vars` returns no secret content

### Phase 5: Migration drift at deploy, plus a scheduled sweep

#### Automated

- [ ] 5.1 Gate passes against the hosted project with both migrations applied: `npm run gate:drift`
- [ ] 5.2 Missing credentials fail rather than skip
- [ ] 5.3 Lint passes with the bumped count: `npm run lint` then `npm run gate:scope`
- [ ] 5.4 The scheduled job's YAML is valid and the job appears with a schedule trigger

#### Manual

- [ ] 5.5 A locally added migration file not applied remotely fails the gate with a repo-ahead message
- [ ] 5.6 The gate's verdict is parsed from JSON, not inferred from an exit code
- [ ] 5.7 The first scheduled run completes green and its log shows both migration versions compared
- [ ] 5.8 `context/deployment/deploy-plan.md` no longer claims the remote is empty

### Phase 6: Seat the gates and update the quality contract

#### Automated

- [ ] 6.1 The composite passes on a clean tree: `npm run gates`
- [ ] 6.2 Each gate is individually runnable
- [ ] 6.3 No `TBD — see §3 Phase 2` remains in `context/foundation/test-plan.md`
- [ ] 6.4 No `required after §3 Phase 2` remains in §5
- [ ] 6.5 Full gate set green in CI on a PR into `master`

#### Manual

- [ ] 6.6 A Cloudflare build triggered by a push to `master` runs `npm run gates` and its log shows all four gates
- [ ] 6.7 A deliberately broken gate merged to `master` produces a failed Cloudflare build and no new deployment
- [ ] 6.8 The deployed app still works after a green gated build: sign in, add a child, add a note
- [ ] 6.9 §6.4 and §6.5 are specific enough to add a new route by following them alone
