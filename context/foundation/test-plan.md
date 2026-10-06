# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-10-06

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
| 1   | Isolation at the enforcing layer                     | Prove the database policies — not the handlers — are what keeps one account's notes from everyone else, and that no `delete` policy exists, so a delete affects no rows                                                                                                                                                                                          | #1, #4                                                                      | database policy tests                              | implementing | `context/changes/testing-isolation-boundary/` |
| 2   | Gates that actually gate                             | Make CI fail for the three reasons it currently cannot: hosted schema drifting from deployed code, a gate run that aborted rather than passed, and a data-touching route never added to the guard list                                                                                                                                                           | #2, #3, #6, #7                                                              | gates, route-coverage test, build-output assertion | not started  | —                                             |
| 3   | A runner, and the boundaries nothing can reach today | Stand up a test runner, then prove a period-bounded read returns every note inside the window and none outside it, with the boundary resolved in the parent's wall clock — and cover the two read boundaries the policy layer structurally cannot: a parent's own soft-deleted note stays out of their list, and one child's notes stay out of the other child's | #5 (window half), #4 (column half), #1 (soft-delete and cross-child halves) | unit + integration                                 | not started  | —                                             |
| 4   | Search answer completeness                           | Prove a "how often" or "in July" answer is complete within its range once ranking exists                                                                                                                                                                                                                                                                         | #5 (ranking half)                                                           | integration                                        | not started  | —                                             |

**Order rationale.** Phase 1 goes first because it covers the top-stated
fear, a PRD guardrail, and the layer that currently has no coverage at all —
and because the pattern must exist before roadmap slice S-03 adds its own
migration, not after. Phase 2 takes the two remaining High × High risks and
needs no runner, so it does not wait on Phase 3. Phase 3 is scored lower but
is the phase that makes §6 answerable for everyday tests; do not defer it
indefinitely. Phase 4 cannot start before roadmap slice S-03 ships — there is
no search to test — and is the first row to cut if the 2026-11-04 deadline
bites.

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
| unit + integration                              | none yet — see §3 Phase 3                                     | —                        | Vitest configured through `getViteConfig()` from `astro/config`; a node test environment rather than a browser one is required from Astro 6 onward, and this project is on Astro 7. checked: 2026-10-02                                                                                                                                                                                                                                      |
| database policy tests                           | pgTAP via the Supabase CLI                                    | pgTAP 1.3.3, CLI 2.117.0 | Files under `supabase/tests/`, run with `npm run test:db`. Session switching is a hand-rolled helper — `tests.authenticate_as` in `supabase/tests/helpers.inc`, included per file with `\ir`. `supabase-test-helpers` was **not** adopted: it would add an install step in both the local and the CI environment to replace ~20 lines, and a session helper needs a test of its own either way (`00_helper_sanity.sql`). checked: 2026-10-06 |
| component rendering (`.astro`)                  | none yet — low priority                                       | —                        | Astro's container API renders a component to a string outside a build; React islands need their renderer loaded explicitly. Deliberately unscheduled: §7 excludes most of the budget this would serve. checked: 2026-10-02                                                                                                                                                                                                                   |
| end-to-end over HTTP                            | `scripts/smoke.mjs` (in-repo, zero dependencies)              | n/a                      | 307 lines, roughly 38 assertions, already covering anonymous guards, the full note lifecycle, ordering, and a cross-account isolation sweep. **Keep it; do not replace it.** It is the only thing currently asserting anything.                                                                                                                                                                                                              |
| browser-level e2e                               | not adopted                                                   | —                        | Promote to a real browser driver only when a test needs hydration or client-side validation an HTTP walk cannot reach. Not yet justified.                                                                                                                                                                                                                                                                                                    |
| accessibility                                   | `eslint-plugin-jsx-a11y`                                      | 6.10.2                   | Already installed and running inside the lint gate. No separate runtime accessibility layer is scheduled.                                                                                                                                                                                                                                                                                                                                    |
| build-output assertion                          | none yet — see §3 Phase 2                                     | —                        | A scan of the build output for secret values needs no framework.                                                                                                                                                                                                                                                                                                                                                                             |
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
| gate-integrity check                             | CI                                               | required after §3 Phase 2 | Risk #7 — a gate that aborted or matched zero files reported as a pass       |
| route-guard coverage                             | CI                                               | required after §3 Phase 2 | Risk #2 — a data-touching route never added to the guard list                |
| build-output secret scan                         | CI                                               | required after §3 Phase 2 | Risk #6 — a secret or note body reaching the client bundle                   |
| migration-drift check against the linked project | between merge and deploy                         | required after §3 Phase 2 | Risk #3 — deployed code expecting a schema the hosted database does not have |
| unit + integration                               | local + CI                                       | required after §3 Phase 3 | Risk #5, #4 — boundary and column-scope logic no HTTP test can reach         |

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

- TBD — see §3 Phase 3, for the wall-clock boundary-conversion pattern.

### 6.3 Adding an integration test

- TBD — see §3 Phase 3, for the date-window completeness pattern: every note
  inside the range, none outside, expected set taken from the fixture rather
  than from the query under test.

### 6.4 Adding a test for a new route or endpoint

- TBD — see §3 Phase 2, for the guard-list coverage pattern, which must fail
  when a new data-touching route exists rather than when someone remembers to
  add it to a list.
- Until then, the reference for endpoint behaviour over HTTP is the existing
  walk at `scripts/smoke.mjs`, run with `npm run smoke` against a live server.

### 6.5 Adding a CI gate-integrity check

- TBD — see §3 Phase 2, for asserting that a gate actually examined files
  rather than exiting zero after aborting.

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

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-10-02
- Stack versions last verified: 2026-10-02
- AI-native tool references last verified: 2026-10-02

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
