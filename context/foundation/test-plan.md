# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-10-15

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression. One corollary matters here more than usual: this project
   already has a CI-enforced HTTP walk, so the cheapest _new_ signal is
   often found **below** it, not above.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `scripts/`,
`supabase/` — excluding `node_modules`, `dist`, `.astro`, `.wrangler`,
`public`, `context`. 10 commits in the last 30 days: thin, but above the
insufficient-history threshold. Churn concentrates on auth surfaces, not on
notes.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                          | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A parent sees notes that are not theirs — another account's, or their _other_ child's                                                            | High   | High       | PRD §Success Criteria (Guardrails), §Access Control; interview Q1, Q4; roadmap S-03 Risk ("zakres per dziecko jest tu pomocą, nie zabezpieczeniem"); `context/archive/2026-09-23-child-profiles/plan.md` (row security is the isolation boundary, data modules apply no owner filter)                                            |
| 2   | A page or endpoint that reads or writes a parent's data answers a visitor who is not signed in                                                   | High   | High       | AGENTS.md hard rule (route protection is opt-in per path); interview Q3; hot-spot dirs `src/components/auth/` — 8 commits/30d, `src/pages/auth/` — 5, `src/pages/api/auth/` — 4                                                                                                                                                  |
| 3   | Every gate passes in CI and the deployed app is broken for its only user                                                                         | High   | High       | interview Q2; `.github/workflows/ci.yml` (the smoke job runs against a freshly migrated _local_ database); `context/archive/2026-09-23-child-profiles/plan.md` and `context/archive/2026-09-26-first-child-note/plan.md` (the runbook needs a migration step before deploy); roadmap §Baseline (model access not yet configured) |
| 4   | A note the parent saved is silently changed, or vanishes from the list                                                                           | High   | Medium     | PRD §Success Criteria (Guardrails), §Non-Goals (no export, so no recovery copy exists); `context/archive/2026-09-26-first-child-note/plan.md` (column-scope rules on edit and soft delete are handler-level, not policy-enforced); hot-spot dir `src/lib/` — 7 commits/30d                                                       |
| 5   | A period question ("how often", "in July") returns an incomplete or mis-bounded set of notes, and the parent repeats the wrong count to a doctor | High   | Medium     | PRD FR-006, §Business Logic, §Non-Functional Requirements; roadmap S-03 Outcome and Risk (a period question needs a hard date cut-off and completeness in range); both archived slice plans (wall-clock vs UTC handling)                                                                                                         |
| 6   | A secret, or a note's contents, escapes into the browser bundle or an error body                                                                 | High   | Medium     | roadmap §Milestone ("Dane wysyłane do modelu", plus the one check still open) and §Baseline (model access not yet configured); `context/foundation/tech-stack.md` (`has_ai: true`); PRD §Access Control                                                                                                                          |
| 7   | A quality gate reports green having checked nothing                                                                                              | Medium | Medium     | `context/foundation/lessons.md` (a rule throwing aborts the entire lint run; an inline disable does not help, because directives filter after the throw); hot-spot dir `src/pages/children/` — 2 commits/30d                                                                                                                     |

Risk #3 is the one High × High row that no test can fully own: part of it is a
deploy-ordering and configuration property, not a code property. It is kept
in the map because a cheap gate covers the schema-drift half; the rest
belongs to the deploy runbook.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                                                                                                                                | Must challenge                                                                                                                                                                                                                                                                                | Context `/10x-research` must ground                                                                                                                                                                                                                                         | Likely cheapest layer                                                                                                                                                                           | Anti-pattern to avoid                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1   | A signed-in parent querying directly for a note that belongs to another account — or to their _other_ child — gets nothing back at the boundary, not filtered out later; and — one layer up, where the filter actually lives (`src/lib/notes.ts:29`) rather than in any policy — a soft-deleted note is not returned even to its own owner | "the handler filters by child, so scope is safe" — the handler is not the boundary; "the HTTP walk's cross-account steps pass, so isolation holds" — that proves the handler path, which a new read can bypass; "row security is enabled" is not the same as "a policy covers this operation" | which policies exist per table and per operation; what the notes insert and update checks require about child ownership; whether soft-deleted rows are excluded at the policy level or only in a query; whether any request path uses a key other than the parent's session | database-level policy tests run by the Supabase CLI for the cross-account half; an integration test for the soft-delete filter and for per-child scoping, neither of which is a policy property | asserting isolation through the HTTP handler — wrong layer, and it still passes if the policy is dropped; testing cross-_account_ only and skipping cross-_child inside one account_, which is the half the roadmap warns scoping does not protect   |
| #2   | Every page and endpoint that touches a parent's data refuses an anonymous request — _including one added after the test was written_                                                                                                                                                                                                       | "it lives under the API prefix so it is protected" — protection is opt-in per path, not implied by location; "the HTTP walk already covers anonymous access" — it covers the paths enumerated when it was written                                                                             | how the guard list is matched (prefix or exact); which paths are in it today; which route files exist; whether any handler checks the session independently of the guard                                                                                                    | a test that enumerates route files and asserts each data-touching one is covered by the guard                                                                                                   | a hand-maintained list of paths to check — it drifts the moment someone adds a route, which is the exact failure being guarded against                                                                                                               |
| #3   | A merge cannot produce a deployed app whose expected schema is absent from the hosted database, and divergence is reported rather than discovered by the parent at the moment of capture                                                                                                                                                   | "the HTTP walk passed, so the app works" — it ran against a freshly migrated local database, the one environment where drift is impossible by construction; "the build succeeded, so configuration is fine"                                                                                   | which migrations are applied where; the real ordering in the deploy runbook; which secrets the build and the runtime each require; what the host reports when a secret is missing                                                                                           | a migration-drift check against the linked project, plus one authenticated read after deploy                                                                                                    | re-running the whole HTTP walk against production — slow, writes real data, and still misses drift; treating a green build as a parity check                                                                                                         |
| #4   | No privilege exists that can destroy a note row; an edit changes nothing but the note's text; a soft delete cannot be un-stamped, or stamped on someone else's row; and a failed read renders as a failure, never as "no notes"                                                                                                            | "there is no delete policy, so notes cannot be lost" — true for destroying rows, false for over-writing columns, which no row-level policy restricts; "the island validated it, so the server received valid input"; "the list is empty, so the parent has no notes"                          | which operations have policies and which do not; which columns each handler actually writes on edit and on delete; whether any grant allows a wider column set; how a read failure is distinguished from an empty result                                                    | policy tests for the absent-privilege half; a handler-level integration test for the column-scope half                                                                                          | a snapshot of the rendered list — it passes while the underlying row was over-written; asserting the handler's own validation constant instead of the behaviour it produces                                                                          |
| #5   | A question bounded to a period returns _every_ note whose event time falls inside it and none outside it, with the boundary resolved in the parent's wall clock                                                                                                                                                                            | "the N most similar notes answer 'how often'" — a ranking returns a plausible subset, and a wrong count reads as authoritative to a doctor; "the server's today is the parent's today"                                                                                                        | how event time is stored and compared; where wall-clock-to-boundary conversion happens; what the existing index orders by; whether the read applies a limit                                                                                                                 | unit tests on the boundary conversion, plus an integration test over a seeded set that straddles both edges of the window                                                                       | deriving the expected set by running the same query the code runs — the oracle problem; the expected count must come from the fixture, which is independent of the implementation; testing only mid-window notes and never the two boundary instants |
| #6   | No secret value and no note body appears in the built client output, and an error shown to the parent carries a message without its cause                                                                                                                                                                                                  | "it is read from the server-only environment module, so it cannot reach the client" — a value becomes client-visible by being _used_ in a client-reachable path, not by where it was read; "the error banner only shows a friendly message"                                                   | which environment values exist and which are server-only by declaration; what the configuration-status and error surfaces render; what the build emits                                                                                                                      | a scan of the build output for known secret values, plus a test on the error-response shape                                                                                                     | asserting the literal current wording of an error string — breaks on a reword, catches nothing; scanning source instead of build output                                                                                                              |
| #7   | A lint or typecheck run that aborted, skipped, or matched zero files fails the gate instead of passing it                                                                                                                                                                                                                                  | "exit code zero means the files were checked" — the recorded incident is a rule throwing and taking the whole run down with it                                                                                                                                                                | what each gate command does on an internal error; whether it reports a file or check count; which configuration scopes a file out                                                                                                                                           | an assertion in CI on the reported file or check count                                                                                                                                          | adding a second linter to catch the first one's failure; relying on exit codes alone                                                                                                                                                                 |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                           | Goal (one line)                                                                                                                                                                                                                                                                                                                                                  | Risks covered                                                               | Test types                                         | Status       | Change folder                                 |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------- | ------------ | --------------------------------------------- |
| 1   | Isolation at the enforcing layer                     | Prove the database policies — not the handlers — are what keeps one account's notes from everyone else, and that no `delete` policy exists, so a delete affects no rows                                                                                                                                                                                          | #1, #4                                                                      | database policy tests                              | complete     | `context/changes/testing-isolation-boundary/` |
| 2   | Gates that actually gate                             | Make CI fail for the three reasons it currently cannot: hosted schema drifting from deployed code, a gate run that aborted rather than passed, and a data-touching route never added to the guard list                                                                                                                                                           | #2, #3, #6, #7                                                              | gates, route-coverage test, build-output assertion | complete     | `context/changes/testing-gates-that-gate/`     |
| 3   | A runner, and the boundaries nothing can reach today | Stand up a test runner and the wall-clock boundary conversion a period question will depend on, then cover the three read boundaries that live in the query layer rather than in a database policy: a parent's own soft-deleted note stays out of their list, one child's notes stay out of the other child's, and an edit writes no column but the note's text | #5 (conversion half), #4 (column half), #1 (soft-delete and cross-child halves) | unit + integration                                 | complete     | `context/changes/testing-runner-and-read-boundaries/` |
| 4   | Search answer completeness                           | Prove a "how often" or "in July" answer is complete within its range once ranking exists                                                                                                                                                                                                                                                                         | #5 (ranking half)                                                           | integration                                        | not started  | —                                             |

**Order rationale.** Phase 1 goes first because it covers the top-stated
fear, a PRD guardrail, and the layer that currently has no coverage at all —
and because the pattern must exist before roadmap slice S-03 adds its own
migration, not after. Phase 2 takes the two remaining High × High risks and
needs no runner, so it does not wait on Phase 3. Phase 3 is scored lower but
is the phase that makes §6 answerable for everyday tests; do not defer it
indefinitely. Phase 4 cannot start before roadmap slice S-03 ships — there is
no search to test — and is the first row to cut if the 2026-11-04 deadline
bites. The window half of Risk #5 — a period-bounded read returning every
note inside the window and none outside it — left this row and moved to
roadmap slice S-03: the read it would test does not exist in production code
today, S-03 is the slice that builds it, and a completeness test belongs to
the slice that owns the query rather than to a phase that would have to invent
a subject for it.

**Status vocabulary** (fixed — parser literals):

| Value           | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| `not started`   | No change folder for this rollout phase yet.                        |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched`    | `research.md` exists in the change folder.                          |
| `planned`       | `plan.md` exists with a `## Progress` section.                      |
| `implementing`  | Progress section has at least one `[x]` and at least one `[ ]`.     |
| `complete`      | Progress section is fully `[x]`.                                    |

## 4. Stack

The classic test base for this project. AI-native tools carry a `checked:`
date so future readers can see which lines need re-verification. Tool names
are examples of the category, not endorsements.

| Layer                                           | Tool                                                          | Version                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration                              | Vitest, configured by hand rather than through Astro          | vitest 5.0.4, Vite 8.3.0 | `getViteConfig()` from `astro/config` does **not** work here: it loads `astro.config.mjs` with `adapter: cloudflare()`, whose Vite plugins hand the run to a **workerd** runner regardless of `test.environment` — `ReferenceError: module is not defined` before a test loads. Shipped instead: `defineConfig` from `vitest/config` in `vitest.config.ts`, `environment: "node"` (required from Astro 6 onward; this project is on Astro 7), plus an explicit `@` alias mirroring `tsconfig.json`. Run with `npm run test:unit`, `npm run test:int`, or `npm test`. checked: 2026-10-15 |
| database policy tests                           | pgTAP via the Supabase CLI                                    | pgTAP 1.3.3, CLI 2.117.0 | Files under `supabase/tests/`, run with `npm run test:db`. Session switching is a hand-rolled helper — `tests.authenticate_as` in `supabase/tests/helpers.inc`, included per file with `\ir`. `supabase-test-helpers` was **not** adopted: it would add an install step in both the local and the CI environment to replace ~20 lines, and a session helper needs a test of its own either way (`00_helper_sanity.sql`). checked: 2026-10-06 |
| component rendering (`.astro`)                  | none yet — low priority                                       | —                        | Astro's container API renders a component to a string outside a build; React islands need their renderer loaded explicitly. Deliberately unscheduled: §7 excludes most of the budget this would serve. checked: 2026-10-02                                                                                                                                                                                                                   |
| end-to-end over HTTP                            | `scripts/smoke.mjs` (in-repo, zero dependencies)              | n/a                      | 307 lines, roughly 38 assertions, already covering anonymous guards, the full note lifecycle, ordering, and a cross-account isolation sweep. **Keep it; do not replace it.** It is the only thing currently asserting anything.                                                                                                                                                                                                              |
| browser-level e2e                               | not adopted                                                   | —                        | Promote to a real browser driver only when a test needs hydration or client-side validation an HTTP walk cannot reach. Not yet justified.                                                                                                                                                                                                                                                                                                    |
| accessibility                                   | `eslint-plugin-jsx-a11y`                                      | 6.10.2                   | Already installed and running inside the lint gate. No separate runtime accessibility layer is scheduled.                                                                                                                                                                                                                                                                                                                                    |
| build-output assertion                          | `scripts/gate-build-output.mjs` (in-repo, zero dependencies)  | n/a                      | Run with `npm run gate:build-output` after a build. Scans the resolved asset root for secret values, JWT-shaped strings and the secret identifiers, and asserts the asset-root invariants (`dist/client` in both wrangler configs, `.assetsignore` present and listing all four server artifacts). Needed no framework, as predicted. checked: 2026-10-10 |
| (optional) AI-native — answer relevance judge   | model-as-judge over search answers — checked: 2026-10-02      | n/a                      | **When NOT to use:** never for the completeness or count half of a period question — that half has a deterministic oracle in the fixture, and a judge turns a provable fact into a probabilistic one. Also not as a CI gate at this scale: a non-deterministic gate on a solo project costs more trust than it buys. Gated on §3 Phase 4.                                                                                                    |
| (optional) AI-native — multimodal screen review | vision review of one screen — checked: 2026-10-02             | n/a                      | **When NOT to use:** not for the landing and identity slice or any copy or layout change — §7 excludes that budget — and never as a substitute for the accessibility linting already installed. Selective and manual; not a gate.                                                                                                                                                                                                            |
| (optional) AI-native — exploratory agent pass   | browser automation available in-session — checked: 2026-10-02 | n/a                      | **When NOT to use:** not for Risk #2. Guard-list coverage has a cheaper deterministic test that also catches _future_ routes, which an exploratory pass cannot.                                                                                                                                                                                                                                                                              |

**Stack grounding tools (current session):**

- Docs: Context7 — verified the Astro test-runner setup path, the required test environment for Astro 6+, the container API for rendering `.astro` components, and the Supabase CLI policy-testing workflow with its helper extension; checked: 2026-10-02
- Search: Exa.ai — available, not needed; official documentation answered both stack questions directly; checked: 2026-10-02
- Runtime/browser: browser automation available in-session — recorded in §4 as a possible exploratory layer, not adopted for any gate; checked: 2026-10-02
- Provider/platform: none — no GitHub, Cloudflare, or Supabase platform server is exposed in this session, so the migration-drift and post-deploy checks in §3 Phase 2 must be grounded against the local CLI and the deploy runbook rather than queried from the platform; checked: 2026-10-02

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate                                             | Where                                            | Required?                 | Catches                                                                      |
| ------------------------------------------------ | ------------------------------------------------ | ------------------------- | ---------------------------------------------------------------------------- |
| lint + typecheck                                 | local + CI (`ci` job)                            | required — wired          | syntactic and type drift                                                     |
| build                                            | CI (both jobs)                                   | required — wired          | configuration and adapter breakage                                           |
| end-to-end HTTP walk on critical flows           | CI (`smoke` job, against a fresh local database) | required — wired          | broken critical user paths, cross-account exposure over HTTP                 |
| database policy tests                            | local + CI (`smoke` job)                         | required — wired          | Risk #1, #4 — exposure and destruction at the layer that enforces them       |
| gate-integrity check                             | CI (`ci` job) + Cloudflare build command         | required — wired          | Risk #7 — a gate that aborted or matched zero files reported as a pass       |
| route-guard coverage                             | CI (`ci` job) + Cloudflare build command         | required — wired          | Risk #2 — a data-touching route never added to the guard list                |
| build-output secret scan                         | CI (both jobs) + Cloudflare build command        | required — wired          | Risk #6 — a secret reaching the client bundle (note bodies cannot: see §6.4) |
| migration-drift check against the linked project | Cloudflare build command + scheduled CI sweep    | required — wired          | Risk #3 — deployed code expecting a schema the hosted database does not have |
| unit + integration                               | local + CI                                       | required — wired          | Risk #5, #4 — boundary and column-scope logic no HTTP test can reach         |

**That last row is wired asymmetrically, and only half of it can block a
deploy.** The unit suite is in the blocking seat: `gate:scope` floors the number
of passing unit tests and refuses to report a count at all from a failing run,
and `gate:scope` runs inside `npm run gates`, which Cloudflare's build command
calls — a non-zero exit there publishes nothing. The integration suite needs a
migrated database, which that seat does not have, so it runs only in CI's
`smoke` job, and GitHub Actions is advisory on this repository (see §6.6: no
branch protection, so a red run stops no merge). So unit tests can stop a
deploy; integration tests cannot, and will not until branch protection exists or
a database is reachable from the build command.

A post-edit hook in the local agent loop is **recommended, not required**,
and is never a substitute for a CI gate. No rollout phase above wires it;
hook configuration is owned outside this plan, so it is deliberately absent
from the table rather than listed aspirationally.

Deterministic visual diffing and multimodal visual review are both left out
of this table on purpose — see §7.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a database policy test

Delivered by §3 Phase 1 (`context/changes/testing-isolation-boundary/`).

**Location and naming.** One subject per file under `supabase/tests/`, named
`NN_subject.sql`. `00_` is reserved for `00_helper_sanity.sql`, the suite's
negative control — nothing else belongs at that number. Shared SQL takes the
`.inc` extension (`helpers.inc`) so `pg_prove` does not collect it as a test:
discovery is by extension and recursive, so an extension it does not match is the
only reliable exclusion.

**Run it** with `npm run test:db` (`supabase test db`), against a running local
stack (`supabase start`). Each file runs in its own transaction and is rolled
back, so fixtures never survive a file, let alone a run.

**Skeleton.** The ordering is load-bearing:

```sql
begin;
\ir helpers.inc           -- include-relative: resolved against this file's directory
select plan(<n>);

-- Fixtures FIRST, before any role switch.
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a');
insert into public.children (id, user_id, name) values (...);
insert into public.notes (id, user_id, child_id, content, occurred_at) values (...);

select tests.authenticate_as('00000000-0000-0000-0000-00000000000a');
-- assertions
select * from finish();
rollback;
```

**Fixtures go in before the switch, always.** They are inserted as the connecting
role, `postgres` — not a superuser on this image, but it holds `BYPASSRLS`, which
is the property that matters. Two reasons: `auth.users` is not writable by
`authenticated`, and the point is usually to read _someone else's_ row, which the
policies would stop you creating under the target role in the first place.

**The minimal `auth.users` insert is `id` alone** — that table's other NOT NULL
columns carry defaults. `public.children` needs `name` (not `first_name`);
`public.notes` needs `occurred_at` (NOT NULL, no default).

**`tests.authenticate_as(uuid)` sets the claim AND the role**, because the two fail
differently and both failures are silent: role without claim leaves `auth.uid()`
null, so `notes_select_own` matches nothing and every "cannot see B's row"
assertion passes for the wrong reason; claim without role leaves the session
bypassing row security, so no policy is exercised at all.
`tests.clear_authentication()` returns to the connecting identity when a file needs
to set up a second user's fixtures mid-test.

**Scope every count to a fixture id.** A bare `count(*) from public.notes` reads
whatever earlier `npm run smoke` runs left behind — the smoke walk performs no
cleanup — so it would pass or fail by accident. CI sees an empty database; a
developer's machine does not.

**Reference file:** `supabase/tests/01_notes_isolation.sql`.

Three rules this rollout phase earned:

1. **Assert the mechanism, not the plain-language guarantee.** For a delete that no
   policy permits, the correct assertion is _zero rows affected and the row still
   present_ — never `throws_ok`, never a `42501` check. `authenticated` **holds**
   the DELETE privilege; what is absent is the policy, so the statement runs,
   matches nothing, and raises nothing. A `throws_ok` there would fail against a
   correct database. Where the guard is a `with check` violation instead, `42501`
   _is_ the right assertion. The two shapes are not interchangeable.
2. **A characterization test belongs in a file labelled as such, never beside a
   guarantee.** In `01_notes_isolation.sql` a red assertion means isolation broke.
   In `02_notes_characterization.sql` a red assertion means behaviour changed —
   information, not necessarily a defect, and the response is to decide whether the
   change was intended, not to "fix" the code back. A file that must mix both
   (`03_notes_destruction.sql`) labels each half in its header.
3. **The role switch has its own test, and so does any helper you add.** That is
   `00_helper_sanity.sql`: it proves the switch took, and that a _positive_ read
   works under the claim, before any denial assertion is trusted. Without it a
   silently-failing switch leaves every other file green against no policy
   whatsoever — Risk #7, a gate reporting green having checked nothing.

### 6.2 Adding a unit test

Delivered by §3 Phase 3 (`context/changes/testing-runner-and-read-boundaries/`).

**Location and naming.** One subject per file under `tests/unit/`, named
`<subject>.test.ts` after the module it covers — `wall-clock.test.ts` covers
`src/lib/wall-clock.ts`. Import `describe`, `expect` and `it` **explicitly from
`vitest`** rather than relying on Vitest globals: that is what keeps
`eslint.config.js` free of a `globals` entry for this directory, and it keeps
`strictTypeChecked` holding real type information for the matchers. Reach into
the application with the `@` alias, which resolves to `src/` — `@/lib/wall-clock`
is `src/lib/wall-clock.ts` — and which `vitest.config.ts` mirrors from
`tsconfig.json`; a script under `scripts/` has no alias and is imported by
relative path (`../../scripts/lib/wall-clock.mjs` from `tests/unit/`).

**Run it** with `npm run test:unit` (`vitest run tests/unit`), or one file with
`npx vitest run tests/unit/<subject>.test.ts` while you iterate. Before
committing, run `npm run lint` and `npx astro check` as well — both read
`tests/` and both feed counters in `npm run gate:scope`. No database, no
server, no build — which is why this is the half of §5's last row that sits in
the blocking seat.

**Reference test:** `tests/unit/wall-clock.test.ts`.

**Pin the instant; never read the real clock.** That is the pattern worth
copying and it is the whole reason the file is table-driven. `INSTANTS` holds
nine fixed UTC instants, each paired with the Poland wall clock it must
produce, and **every expectation is derived from the zone's UTC offset at that
instant rather than from running the function** — the same oracle discipline
§2 demands of Risk #5. A test that called `new Date()` unpinned would pass or
fail by the day it ran. The cases that earn their place are the boundaries:
both Europe/Warsaw DST transitions of 2026 — 2026-03-29 spring-forward, where
02:00 local never happens, and 2026-10-25 fall-back, where it happens twice —
the transition instant itself and the instants bracketing it on either side,
plus a year boundary where `+01:00` carries the local date into the next year.
`isFutureWallClock` injects `now` for the same reason, so its tolerance edges
are expressed relative to a pinned instant rather than guessed.

**Label a characterization as one, here too.** The assertion that two distinct
instants in the repeated fall-back hour map to the _same_ wall clock is a
characterization of the bare-wall-clock trade-off, not a correctness
guarantee — exactly the distinction §6.1 rule 2 draws for the policy suite. If
a future change starts storing an offset, that assertion should fail, and the
response is to decide whether the change was intended, not to "fix" it green.

**Adding or removing a test file means bumping `EXPECTED.eslintFiles` in
`scripts/gate-scope.mjs` in the same commit** — the obligation §6.4 already
carries for a new route, now carried by this directory too. That counter and no
other, **when the change is additive**: `EXPECTED` holds three, and the two
floors are meant to be left alone when a file arrives. Removing a file is the
other direction and touches two — `eslintFiles` because it is exact, and
`unitTestsPassed` because the tests that went away took its floor out from under
it. Re-derive both then.

| Counter             | Mode  | Adding a test file                                   | Re-derive with                                            |
| ------------------- | ----- | ---------------------------------------------------- | --------------------------------------------------------- |
| `eslintFiles`       | exact | **must bump** — a `.test.ts` file is a linted file   | `npx eslint . -f json` → array length (below)             |
| `astroCheckFiles`   | floor | leave it — a floor is allowed to sit under the count | `npx astro check` → the `Result (N files):` line           |
| `unitTestsPassed`   | floor | **leave it** — see below                             | `npx vitest run tests/unit --reporter=json --outputFile=<path>` → `numPassedTests` in that file (the JSON reporter writes no count to stdout) |

The one that trips people up is `unitTestsPassed`. It is a **floor**
deliberately, not an exact count: `gate-scope.mjs` says why in its own comment —
tests are added far more often than removed, and an exact count "would make
every new test a two-file commit for no gain". So **adding tests does not
require touching it**, and leaving it at a number below the current suite size
is the intended state, not drift. Raise it only when you want the floor to
protect a larger suite. What *does* fail there is the shrinking direction: a
deleted or renamed file, or a test turned `.skip` or `.todo`.

Never guess a delta — add the file first, then run the command in the table
against the tree you are about to commit and read the number off it
(§6.5 has the full procedure and the failure output each counter prints). For
`eslintFiles` that means counting the array, which neither shell does for you.
PowerShell:

```powershell
(npx eslint . -f json | ConvertFrom-Json).Count
```

bash:

```bash
npx eslint . -f json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).length))'
```

Both print the number to put in `EXPECTED.eslintFiles`. ESLint exits non-zero
when it finds a lint problem and still prints usable JSON, so a non-zero exit
here is not a reason to distrust the count. Then **run `npm run gate:scope`
before you commit** — it is the only thing that confirms the number you just
hand-edited, and it is cheap. Leaving it to CI means finding out from a red
build that you typed 48 instead of 49.

The test floor exists because the dangerous direction is the silent one: a
suite that ran 3 tests instead of 35 exits 0 and looks exactly like a green
run. Two details of it are load-bearing and worth knowing before you touch it.
It floors `numPassedTests`, **not** `numTotalTests` — a `describe.skip` leaves
the total unchanged while passing drops, so a total-floor would gate over
nothing. And of the three counters it is the only one that **does** consult its
command's exit code — `eslintFiles` and `astroCheckFiles` deliberately ignore
theirs, because a lint or type error should fail at `npm run lint`, not here —
since nothing else inside `npm run gates` runs the unit suite: a failing run
reports no count rather than a count, and no count is a failure. The JSON
report it reads is written to `.vitest/json/gate-scope.json`, inside a
directory `.gitignore` already excludes.

### 6.3 Adding an integration test

Delivered by §3 Phase 3 (`context/changes/testing-runner-and-read-boundaries/`).

**Location and naming.** One subject per file under `tests/integration/`, named
`<subject>.test.ts` after the boundary it covers, not after the module —
`notes-read-boundaries.test.ts`, `notes-edit-scope.test.ts`. The shared harness
is `tests/integration/fixtures.ts`, which carries no `.test.ts` suffix and so
is never collected as a suite. Imports follow §6.2: explicit `vitest` imports —
`beforeAll` and `afterAll` as well as `describe`, `expect` and `it`, since this
directory's lifecycle needs them — the `@` alias into `src/`, and
`./fixtures` for the harness, which sits beside the test file.

**Prerequisites.** `npm ci`, Docker running (the local stack is containers; on
Windows that means Docker Desktop started, and `supabase start` fails with a CLI
error rather than a test failure if it is not), the stack up, and three
environment values. The Supabase CLI is a devDependency, not a global install —
`npx supabase start` is the portable form, and the bare `supabase` written below
works only where it is on `PATH`.

`supabase start` is sufficient on its own — it applies every file in
`supabase/migrations/` to the container as it comes up, so there is no separate
migrate or `db reset` step, and the suite needs no seed data (it brings its
own). The three values come from `supabase status -o env`, which emits them
under _different_ names, so a mapping is needed:

```
SUPABASE_URL                <- API_URL
SUPABASE_ANON_KEY           <- ANON_KEY
SUPABASE_SERVICE_ROLE_KEY   <- SERVICE_ROLE_KEY
```

Nothing reads a dotfile for these — the harness reads `process.env` directly,
and `.env` is the application's own file, not the suite's. Re-run whichever
recipe you use after any `supabase stop` / `supabase start`, because that
reissues the keys. The PowerShell one sets them for the **shell session**, so a
stale value will outlive the restart; the bash one sets them per command, so a
second `npm run test:int` on its own lands in `requireEnv`'s throw. PowerShell:

```powershell
$map = @{ API_URL = 'SUPABASE_URL'; ANON_KEY = 'SUPABASE_ANON_KEY'
          SERVICE_ROLE_KEY = 'SUPABASE_SERVICE_ROLE_KEY' }
supabase status -o env | ForEach-Object {
  if ($_ -match '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)="(.*)"$') {
    Set-Item "env:$($map[$Matches[1]])" $Matches[2]
  }
}
npm run test:int
```

The match is not decoration: `supabase status -o env` double-quotes every
value, so a naive split assigns `"http://127.0.0.1:54321"` *including* the
quotes and the suite fails on a malformed URL. `ConvertFrom-StringData` has the
same problem, and also treats backslashes as escapes.

bash, which is what CI does (`.github/workflows/ci.yml`):

```bash
supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' > supabase.env
source supabase.env   # bash strips the quotes on the way in
SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" npm run test:int
rm supabase.env   # a failing suite skips this line; delete it by hand
```

These are the local stack's well-known development keys, not secrets — §6.6
records that this repository has no repository secrets at all.

**Absent credentials fail; they do not skip.** `requireEnv` throws with that
mapping in the message. A suite that silently no-ops when the stack is down
reports green having asserted nothing — Risk #7 wearing Risk #1's clothes, and
the same reasoning §6.6 records for `gate:drift`.

**Run it** with `npm run test:int` (`vitest run tests/integration
--no-file-parallelism`), or one
file with `npx vitest run tests/integration/<subject>.test.ts`, with those
three values set.

**A new file here carries §6.2's gate obligation too**, with one difference: a
`.test.ts` file under `tests/integration/` is a linted file, so
`EXPECTED.eslintFiles` in `scripts/gate-scope.mjs` must be bumped in the same
commit exactly as for a unit test. `EXPECTED.unitTestsPassed` is untouched —
its command is `vitest run tests/unit`, which never sees this directory. That
is also why no counter floors the integration suite: the gate runs where no
database exists.

**The rule this directory exists to enforce:** _the expected set comes from the
fixture, never from re-running the query under test._ That is §2's named
anti-pattern for Risk #5 — a test that asks the subject what the answer is
agrees with it by construction. Every expectation in this directory names
fixture ids declared in `fixtures.ts`.

**The fixture contract**, all four parts load-bearing:

1. **Reserved ids, not generated uuids.** Every id starts with
   `f1c70000-0000-0000-0000-` (`FIXTURE_ID_PREFIX`), so a row is identifiable
   as a fixture by looking at it and the whole delete surface is auditable from
   one file. The harness's own `assertReserved` throws **before** any seed or
   delete if any id — the user's included — lacks the prefix, which makes that
   surface enforced rather than reviewed. `seedFixture` and `teardownFixture`
   call it themselves; a suite author never does.
2. **Teardown deletes by id, runs on both sides of the seed, and never
   truncates.** `.in("id", …)` with the fixture's own note ids and child ids,
   then `auth.admin.deleteUser(fixture.userId)` — all three, so nothing is left
   holding the fixture's email. A 404 from the user delete is treated as a
   completed teardown, not a failure, which is what makes the call safe to
   repeat. "Both sides" means `teardownFixture` runs **before** the seed as well
   as after it, so a dirty database or a previously failed run cannot decide a
   run's outcome. No predicate here is wide enough to reach a row a human
   created.
3. **Two clients.** `serviceClient()` seeds, deletes, and — in the one test
   whose subject is which columns an update wrote — reads a complete row back;
   `signInAsFixtureUser(fixture)` returns a fresh anon client **signed in as
   the fixture user**, and that is the one every query under test runs on, with
   RLS live exactly as a request from the browser sees it. Running the query
   under test on the service client would exercise it with every policy
   switched off.
4. **Two disjoint id spaces and two fixture users**, so the two suites cannot
   delete each other's rows. `test:int` also runs files one at a time
   (`--no-file-parallelism`): `assertReserved` checks only the shared prefix,
   not a suite's own range, so without that flag a new suite that reused a range
   would race another file and fail intermittently.

**Three functions are the whole harness API**, all three `async`, so every call
is awaited. A suite uses them in this order:

```ts
import type { SupabaseServerClient } from "@/lib/children";

let authenticated: SupabaseServerClient;   // what signInAsFixtureUser returns

beforeAll(async () => {
  await teardownFixture(MY_FIXTURE);   // first, so a dirty database cannot decide the outcome
  await seedFixture(MY_FIXTURE);
  authenticated = await signInAsFixtureUser(MY_FIXTURE);
});

afterAll(async () => {
  await teardownFixture(MY_FIXTURE);
});
```

`seedFixture` creates the fixture's auth user itself, through
`auth.admin.createUser` with the reserved id passed explicitly — the users are
not something you provision by hand, and they do not survive a run.
`signInAsFixtureUser` returns a fresh client each call rather than a cached one,
because signing in mutates a client's auth state.

**Starting a third suite: claim an id space, then declare the fixture.** The
space is the fifth digit of the last uuid group — `…-0000`**`1`**`…` is the
read-boundaries suite and `…-0000`**`2`**`…` is the edit-scope one, so a third
takes `3`. Both declarations go in `fixtures.ts` beside the existing two, so
that every id this directory can delete still sits in one file:

```ts
export const MY_SUITE_IDS = {
  user: `${FIXTURE_ID_PREFIX}000030000001`,
  child: `${FIXTURE_ID_PREFIX}0000300000c1`,
  note: `${FIXTURE_ID_PREFIX}00003000c101`,
};

export const MY_SUITE_FIXTURE: Fixture = {
  email: "my-suite.fixture@example.com",   // <suite>.fixture@example.com
  password: FIXTURE_PASSWORD,              // one shared constant; the file scopes it
  userId: MY_SUITE_IDS.user,               // the reserved id seeding passes to createUser
  children: [{ id: MY_SUITE_IDS.child, name: "Fixture child" }],
  notes: [
    {
      id: MY_SUITE_IDS.note,
      childId: MY_SUITE_IDS.child,
      occurredAt: "2026-05-01T10:00",      // a bare wall clock: occurred_at has no zone
      content: "…",
      deleted: false,                      // optional; true seeds it soft-deleted
    },
  ],
};
```

`userId` is a field of `Fixture`, not an extra: it is the id `seedFixture`
passes to `createUser` and the one `teardownFixture` deletes, and
`assertReserved` checks it along with every child and note id. Only `children`
and `notes` exist as seedable tables — a fixture cannot seed anything else
without the harness growing a case for it.

**Reference test:** `tests/integration/notes-read-boundaries.test.ts` — the
soft-delete exclusion and cross-child scoping that `listNotes` owns and no
policy does. It asserts on **ids, not counts**: a count passes while the wrong
row is returned, which is exactly what a missing `child_id` filter produces.
`tests/integration/notes-edit-scope.test.ts` is the **enumerate-then-invert**
variant for column-scope assertions: it reads the complete row with
`select("*")`, subtracts a two-name allowlist (`content` and `updated_at`), and
diffs the rest — so a column added to `notes` later is covered the moment it
exists, and widening the allowlist becomes the deliberate review moment. It
carries a guard that the row really does carry the allowlisted columns, so a
rename cannot make the subtraction vacuous.

**Where it runs.** Only in CI's `smoke` job, inside the window where the local
stack is up — between the database policy tests and the secret configuration
for build and preview. Neither this suite nor the policy tests _require_ an
empty database; both sit in that window anyway so that a failure is about the
code under test and not about residue, and so neither is skipped when a later
step fails (`.github/workflows/ci.yml` says the same thing at the step). §5's
paragraph on its last row records why only the unit half reaches a blocking
seat; do not read that as this suite being optional.

**The date-window completeness pattern is not here, and that is deliberate.**
It lands with roadmap slice **S-03** (`note-search-by-meaning`), which owns the
period-bounded read: no such read exists in production code today, and
`roadmap.md`'s S-03 Risk line already records that the completeness test
belongs to the slice that builds the query — with the expected set taken from
the fixture, never from the same query under test.

### 6.4 Adding a test for a new route or endpoint

Delivered by §3 Phase 2 (`context/changes/testing-gates-that-gate/`).

**You do not add a test. You classify the route, and the existing gate covers it.**
That is the whole point of the pattern: a new route under `src/pages/` must appear
in `src/lib/protected-routes.json` under either `protected` or `public`, or
`npm run gate:routes` fails. No *test* is required of you.

**One thing else is, and it is not in this section's gate.** A route file is a
linted file, so adding one grows ESLint's examined count and `EXPECTED.eslintFiles`
in `scripts/gate-scope.mjs` must be bumped in the same commit. Measured 2026-10-11
by following this section alone: `gate:routes` went green and `gate:scope` then
failed at 42-vs-41 — green on the gate this section names, red on the gate it does
not, and only on the deploy path. Re-derive the number per §6.5; never guess the
delta.

**Location and naming.** `src/lib/protected-routes.json` holds both halves:
`protected` is the list of path prefixes `src/middleware.ts` matches with
`startsWith`; `public` is the explicit allowlist of routes reachable anonymously.
The middleware **imports** this file — it is one list with two readers, not a copy,
so the checker cannot drift from what the app enforces. Do not add a prefix to
`middleware.ts`; it reads the JSON.

**Run it** with `npm run gate:routes`. No server, no build, no runner — it is a
filesystem glob plus set comparison, which is why it sits in the pre-build half of
`npm run gates`.

**The assertion is inverted, and that is the load-bearing decision.** A positive
check-list — "these paths must redirect" — keeps passing the moment someone adds a
route and forgets the list, which is *the exact failure being guarded against*
(§2 Risk #2's named anti-pattern). So the gate enumerates the routes that **exist**
and requires each to be classified. Forgetting fails; there is no way to forget
quietly. **Never replace this with a list of paths to check.**

**Four assertions**, each failing with the offending route named:

1. Every enumerated route is matched by a `protected` prefix or listed in `public`.
   This is the drift detector.
2. No `public` entry is shadowed by a `protected` prefix — that would make it
   unreachable anonymously. (Reproduced: adding a `/auth` prefix locks the parent
   out of signing in, and the gate names all three affected pages.)
3. Every `protected` prefix matches at least one route that exists. A stale prefix
   silently *widens*, because `startsWith` over-matches: a left-behind `/children`
   would also protect a future `/children-export`.
4. Every `public` entry has a file behind it.

Assertion 3 is also what stops the gate passing vacuously: with zero routes
enumerated, every prefix matches nothing, so an empty enumeration produces failures
rather than silence.

**Enumerate from `src/pages`, never the repo root.** `.claude/worktrees/` holds a
second full checkout of the application, including `src/pages/` files that do not
exist on `master`. A repo-wide walk reports those as phantom routes.

**Prefixes do not nest both ways.** `/children` does not match `/api/children`,
which is why both appear in `protected`. Check the matching direction before
assuming one prefix covers another.

**An endpoint may self-guard in addition, never instead.** `api/children.ts`,
`api/notes.ts` and `api/notes/[id].ts` each check the session, because they need
`user.id` for their own query. That is redundancy, not the boundary, and
`AGENTS.md` now says so — do not "fix" it away. It has a consequence for testing:
a black-box `302 → /auth/signin` on a POST proves *something* refused, not that the
middleware did.

**To prove refusal over HTTP**, the anonymous block in `scripts/smoke.mjs` is
*generated* from the same JSON, so a prefix added there is asserted over HTTP for
free. Those steps use **GET**, deliberately: every endpoint under `src/pages/api`
exports `POST` only, so a GET answering `302` can only be the middleware — without
it the request would 404 or 405, never redirect. That is what makes the assertion
attribute the refusal to the right layer.

**Reference files:** `scripts/gate-routes.mjs`, `src/lib/protected-routes.json`.

### 6.5 Adding a CI gate-integrity check

Delivered by §3 Phase 2 (`context/changes/testing-gates-that-gate/`).

**§2 had this risk backwards, and the correction is the pattern.** Risk #7 was
written against the recorded incident — a rule throwing and aborting the whole lint
run — on the assumption that an abort could be mistaken for a pass. Measured: it
cannot. An ESLint internal rule throw exits **2** with an `Oops! Something went
wrong!` banner, and every total-empty-scope condition also exits 2. CI already fails
on those unaided.

What is silent is **partial shrinkage**. `npx eslint . --ignore-pattern "src/**" -f json`
examined 3 files of 37, exit 0, zero bytes of human-visible output. One extra
`.gitignore` line takes the lint gate green over most of the codebase. Reproduced
during this phase: with `src/` gitignored, `npm run lint` exits **0** having examined
4 files of 38.

So the instrument is **a floor on reported scope, not an abort detector**. Build
that, not a second linter watching the first (§2's named anti-pattern).

**Location and naming.** `scripts/gate-scope.mjs`, one `EXPECTED` object at the top,
one entry per scope-reporting tool, each carrying the command that re-derives it.
**Run it** with `npm run gate:scope`.

**Two modes, and picking the wrong one breaks the gate:**

- **`exact`** for a deterministic scope. ESLint's is `.gitignore`-driven and
  reproducible, so any movement is a deliberate change to what is linted. The
  friction is the feature: a phase that adds a linted file must bump the number in
  the same commit, which is the review moment where someone confirms the file is
  meant to be in scope.
- **`floor`** for a tool that applies its own ignore list. `@astrojs/check` does not
  use the raw `tsconfig` file set, so its count can move without a code change. A
  floor confines that to the one direction that matters — shrinkage. This was
  vindicated immediately: the `astro check` count moved 38 → 39 → 40 → 41 → 42 as
  this phase added scripts. Had it been `exact`, the phase would have failed its own
  gate on the first run.

**Getting the count out of the tool is the fiddly part.** ESLint reports its
examined-file count **only** through the JSON formatter — `npx eslint . -f json`
emits one object per examined file, so the array length is the number. Neither
`--debug` nor `--stats` gives it. `astro check` prints `Result (N files):` on stdout,
uncoloured while every other line is coloured, so it is matched raw.

**Do not consult the exit code.** ESLint exit 1 means "found lint problems", which
`npm run lint` owns; the count is still reported. Read the payload, not the status.

**A run that reports no count is a failure, not a pass.** This is the rule that
keeps the gate from becoming the thing it guards against. Reproduced: with
`eslint.config.js` made invalid, the gate reports `no parseable JSON (exit 2)` and
fails rather than skipping that check.

**Re-derive, never guess the delta.** Run the command and read the number. Over this
phase the eslint count went 37 → 38 → 39 → 40 → 41, and the `.json` file added in
§6.4 moved the `astro check` count but *not* the eslint count, because no config
block targets `.json`. A guessed `+1` would have been wrong at least once.

**The same discipline applies to any quantity assertion.** `scripts/smoke.mjs`
carries `EXPECTED_STEPS`, because `failed` starts at 0 and the summary printed "All
smoke steps passed" over an empty loop — zero steps exited 0. It also validates every
expectation object's keys against the known set, because the conjunction tests each
with `=== undefined ||`, so a typo'd `bodyInclude` asserted nothing and still printed
`PASS`. Both were live false-pass vectors, not hypotheticals.

**pgTAP needs no floor.** `finish()` emits `# Looks like you planned N tests but ran M`
and TAP-fails, which `pg_prove` propagates. The plan count is self-detecting.

**Reference file:** `scripts/gate-scope.mjs`.

### 6.6 Per-rollout-phase notes

**§3 Phase 1 — deny-by-default makes removal loud and widening silent.** Every
prohibition in this schema is an _absent_ policy rather than a restrictive one.
That asymmetry is the whole reason a policy test and an HTTP walk are not
substitutes for each other: _removing_ a policy is loud, because legitimate
operations start failing and `scripts/smoke.mjs` catches it immediately; _widening_
one is silent, because the handler filters first and the policy is never the thing
that fails. Four of the six widenings traced during this phase were invisible to
the HTTP walk — `notes_select_own → using (true)`, dropping the child-ownership
`exists` from either `notes_insert_own` or `notes_update_own`, and adding any
permissive `children` update or delete policy. Each now has a named assertion.

**§3 Phase 2 — at the gate layer the asymmetry inverts: total failure is loud,
partial shrinkage is silent.** Phase 1's note records that in the schema, _removing_
a policy is loud and _widening_ one is silent. One layer up, in the tooling, it runs
the other way. A gate that dies completely is unmissable — exit 2, a banner, CI red.
A gate that quietly examined 4 files instead of 38 exits 0 and prints nothing. The
consequence for instrument design: **assert a quantity, not the enforcing layer's
behaviour.** You cannot ask ESLint "did you really check?"; you can ask "how many did
you report?" and refuse an answer below the floor. §6.5 has the detail.

**Three hand-maintained lists existed, and the pattern adopted is
enumerate-then-invert against a small explicit allowlist.** The guard prefixes in
`middleware.ts`, the four anonymous paths hardcoded in the smoke walk, and the
implicit set of "routes we remembered". Each would drift the moment someone added a
route — the failure being guarded against. All three now derive from one file
(`src/lib/protected-routes.json`), and the assertion runs from the filesystem
inward: enumerate what exists, require it to be classified. The allowlist is the one
surface that must be edited deliberately, which is exactly where the review moment
belongs.

**GitHub Actions is advisory on this plan; Cloudflare's build command is the
blocking seat.** `gh api repos/.../branches/master/protection` returns
`403 "Upgrade to GitHub Pro or make this repository public"`, so required status
checks do not exist and a red CI run stops no merge. What research could not see is
that a Cloudflare Git integration watches `master` and builds on every push, and a
build command exiting non-zero publishes nothing. So the gates are seated in
`npm run gates`, which that build command calls; CI runs the same scripts as named
steps for fast feedback. **If the repository ever becomes public or moves to a paid
plan, turn on branch protection and revisit this asymmetry** — the duplication exists
only because the cheaper seat is unavailable.

**Two §2 assumptions were corrected by measurement, not argument.** Risk #7's
direction (above). And Risk #6 pairs "no secret value" with "no note body" in the
build output — that second half is **vacuous** here: `output: "server"`, no
`prerender` export anywhere, and the build emits zero `.html` files, so no note
content can be baked in. The gate is scoped to secrets only; asserting the other
half would be ceremony that reads as coverage.

**The asset-root hole was never live, and the fix is still correct.** `wrangler.jsonc`
declared `"directory": "./dist"` while the generated `dist/server/wrangler.json`
declared `"../client"`, and `dist/server/.dev.vars` holds both secrets in plaintext —
so if the checked-in value governed, both were fetchable at `/server/.dev.vars`.
Settled empirically: with the two configs deliberately disagreeing,
`wrangler deploy --dry-run` still read `dist/client`, and `curl` against the live
Worker returns 404 with no secret content for `/server/.dev.vars`, `/.dev.vars`,
`/server/wrangler.json` and `/wrangler.json`. **The generated config governs.** The
checked-in value was corrected anyway, because it costs nothing and removes the
question rather than answering it for one Wrangler version.

**Absent credentials fail, they do not skip.** `gate:drift` exits non-zero when
`SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` or `SUPABASE_ACCESS_TOKEN` is missing. A drift gate that
silently no-ops on a missing secret is Risk #7 wearing Risk #3's clothes — it would
report green from the deploy path while checking nothing. The same reasoning put a
`NOTE` line on the build-output gate's exact-value scan, which immediately earned
itself: in the `ci` job it reported that no secret was in the environment, revealing
that this repository has **no repository secrets at all** and that `ci.yml`'s
long-standing `SUPABASE_URL`/`SUPABASE_KEY` build env has always been ceremonial.

**`F5` — Decision: Fix A, database half deferred.** Recorded in full at
`context/changes/testing-isolation-boundary/change.md` (§Notes), because
`AGENTS.md` makes `context/archive/` immutable and the finding's own file cannot be
updated. In short: Fix A's two proposed smoke assertions are superseded by
`supabase/tests/03_notes_destruction.sql`, which reaches the mechanism the smoke
script cannot — asserting a refused `DELETE` needs a direct PostgREST call the
zero-dependency walk does not make, and pgTAP makes it natively. Fix B
(column-scoped grants, or a `before update` trigger) stays deferred; its practical
exposure is nil while `SUPABASE_KEY` is a server-only secret. **Tripwire:**
assertions 3 and 4 of that file are expected to flip to failures the day Fix B
lands. That failure is the intended signal that the guarantee moved into Postgres —
update the file then, do not weaken the hardening to keep it green.

**Phase 2 closed with one criterion unmeasured.** Row 5.7 of
`context/changes/testing-gates-that-gate/plan.md` — the first green run of the
scheduled `drift` job — was left open, not ticked. The cron (`23 5 * * *`) had not
fired when the phase closed, and the scheduled sweep is treated as standing
monitoring rather than a completion criterion. Worth knowing for any future
cron-backed phase: a criterion that waits on a schedule can never be green at the
moment its phase closes, so either the phase closes with it open or the phase waits
a day. Everything else in that phase was measured, including the one that matters
most — a deliberately broken gate failed the Cloudflare build and published no new
Worker version at all (plan row 6.7).

**§3 Phase 3 — half the row had no subject, and finding that out was the phase's
first result.** The row promised the wall-clock conversion _and_ a period-bounded
read returning every note inside a window and none outside it. The conversion
exists (`src/lib/wall-clock.ts`); the window does not. `listNotes` carries
`.eq("child_id", …)`, `.is("deleted_at", null)` and two `.order()` calls, and no
`.gte()`/`.lte()` anywhere — there is no date-bounded read in production code to
test. The choice was between inventing a subject for the test and handing the test
to the slice that builds the subject. It went to roadmap **S-03**
(`note-search-by-meaning`), and `roadmap.md`'s S-03 Risk line now carries the
obligation in writing, including the fixture-oracle rule. **A test written against a
query invented for it asserts the test author's design, not the product's** — the
honest move is to move the test, not to lower it.

**Phase 1's characterization file is what made this phase's scope unambiguous.**
`supabase/tests/02_notes_characterization.sql` had already recorded, as assertions
rather than prose, that `notes_select_own` carries no child predicate and that
`deleted_at` appears in no policy predicate — so the two read protections provably
live one layer up. This phase did not have to re-derive that, argue about it, or
guess which layer to assert at: the file named the gap and named the layer. **That is
an argument for writing characterization tests rather than deleting them when they
"only document current behaviour."** A characterization is how one phase hands the
next phase a boundary it can trust.

**Three implementations of `warsawWallClock` existed; two were duplicates and one
was a deliberate semantic difference, and the test set is what tells them apart.**
`src/lib/wall-clock.ts` and `scripts/lib/wall-clock.mjs` are the duplicates —
`scripts/smoke.mjs` runs under bare `node` with no bundler and no TypeScript step,
so it cannot import the source module, and it now imports the shared `.mjs` copy
instead of hand-copying the logic. A parity block in `tests/unit/wall-clock.test.ts`
holds both to the _same_ nine instants, so drift in either copy, including across a
DST transition, stops them agreeing. The third is `localNow()` in
`src/components/notes/AddNoteForm.tsx:15-20`, which reads the **device** zone, not
Europe/Warsaw. That one is not drift and must not be "unified" — see §7. The
distinguishing instrument is the same in both cases: one shared instant set. Two
functions that must agree are asserted equal over it; a function that must _not_ be
assumed to agree is simply absent from it.

**Only the unit half reached the blocking seat, because the seat has no database.**
`gate:scope` now floors passing unit tests and runs inside `npm run gates`, which
Cloudflare's build command calls — so a shrinking or failing unit suite publishes
nothing. The integration suite needs a migrated Postgres, which that build
environment does not have, so it runs only in CI's `smoke` job — and the Phase 2
note above records that GitHub Actions is advisory on this repository, so a red
`smoke` job stops no merge. Stated plainly: **this phase
delivered two suites and one gate.** That is not a defect of the suites; it is the
same seat asymmetry Phase 2 documented, met by a different kind of test. It changes
if branch protection becomes available or a database becomes reachable from the
build command — not before.

### 6.7 Testing an AI-dependent query without mocking the AI call

Delivered by §3 Phase 5 (`context/changes/note-search-by-meaning/`), which
closes out the rollout this guide opened.

**Id-space `3` is now taken.** `tests/integration/fixtures.ts`'s
`SEARCH_FIXTURE` (`SEARCH_IDS`, prefix `…-0000`**`3`**`…`) backs
`tests/integration/notes-search.test.ts`. §6.3's "Starting a third suite"
example is this fixture, verbatim — a fourth suite claims digit `4`.

**The pattern, for the next AI-dependent test.** This codebase has no
`vi.mock` anywhere (§6.6 already noted this for secrets; it holds for AI
calls too), so a suite that needs `search_notes` to rank by vector similarity
cannot fake `embedText`. Instead it seeds a precomputed, synthetic embedding
— a one-hot vector, never a real OpenAI response — directly into
`notes.embedding`, and calls the SQL function under test,
`public.search_notes(...)`, through `.rpc()` rather than through the
TypeScript orchestration wrapper (`src/lib/search.ts`) that would otherwise
need a live AI client. Cosine similarity of a vector with itself is `1.0`,
which trivially clears `search_notes`'s similarity threshold regardless of
how that default is later tuned — so the test controls inclusion by the
parameter under test (a date window, in this suite's case), not by hoping a
real embedding happens to rank the right way. The next person adding an
AI-dependent test, once §3 Phase 4 of this guide's own rollout opens, should
follow this same shape: seed the synthetic vector, call the SQL function
directly, never mock the client.

**Why `src/lib/search.ts` could not be imported directly here.** It calls
`embedText` (`src/lib/embeddings.ts`), which imports `OPENAI_API_KEY` from
`"astro:env/server"` — a virtual module that does not resolve under plain
Vitest. `vitest.config.ts`'s own top comment says "Nothing under `tests/`
imports `astro:env/server`"; that line is made slightly stale by this
addition; it remains literally true only because this suite deliberately
avoided doing so, calling `search_notes` through `.rpc()` instead.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout. Future contributors should respect
these unless the underlying assumption changes.

- **The landing and product-identity slice** — product copy, the browser tab
  title, the document language, and deleting unused template files. A glance
  or one screenshot is the test; an automated assertion on copy breaks on
  every reword. Re-evaluate if the landing page starts carrying behaviour
  rather than text. (Source: Phase 2 interview Q5.)
- **UI snapshot and visual-regression tests** — the starter's visual theme
  churns, and the roadmap already treats it as a separate matter from product
  behaviour. Re-evaluate if a rendering regression ever reaches the parent.
  (Source: Phase 2 interview Q5.)
- **Edit history and undelete behaviour** — neither exists. An edit overwrites
  the text with no version retained, and there is no undelete surface. Nothing
  to test until one is built. (Source:
  `context/archive/2026-09-26-first-child-note/plan.md`.)
- **Anything in PRD §Non-Goals or roadmap §Parked** — generated text
  summaries, data import and export, a shared parent account, and questions
  spanning both children at once. These are absent by decision, not by
  oversight. (Source: PRD §Non-Goals; roadmap §Parked.)
- **Password recovery** — the PRD records this counter-argument as considered
  and rejected; no recovery path exists to break. Re-evaluate only if one is
  added. (Source: PRD FR-001.)
- **Multi-time-zone behaviour, and search accuracy tuning beyond a first real
  measurement** — a single parent in a single zone, and the roadmap parks
  further accuracy work as over-engineering at two-children scale.
  Re-evaluate if a second zone or a second household appears, or if the
  accuracy delivered by roadmap slice S-03 proves genuinely too low on real
  notes. (Source: `context/archive/2026-09-26-first-child-note/plan.md`;
  roadmap §Parked.)
- **The divergence between the browser's zone and the server's** — `localNow()`
  in `src/components/notes/AddNoteForm.tsx:15-20` builds its default moment,
  and runs its future check, against the **device's** zone, while the server
  resolves the same things against Europe/Warsaw (`warsawWallClock`,
  `isFutureWallClock`). That is a deliberate semantic difference, not drift: a
  `datetime-local` field is read in the device's own clock, so prefilling it
  with anything else would show the parent a moment that is not their "now".
  For one parent in one zone the two coincide, so nothing diverges today. It is
  recorded here because a future reader will otherwise file it as a bug and
  "unify" the three implementations, collapsing the one that is meant to differ.
  Re-evaluate the moment a second zone appears — the same trigger the
  multi-time-zone entry above already names. (Source: §3 Phase 3.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-10-02 (§4 build-output row and §5 gate rows updated 2026-10-10 by §3 Phase 2; §4 unit + integration row and §5 unit + integration row updated 2026-10-15 by §3 Phase 3)
- Stack versions last verified: 2026-10-02
- AI-native tool references last verified: 2026-10-02

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
