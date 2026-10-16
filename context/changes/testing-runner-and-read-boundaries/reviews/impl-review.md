<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: A Runner, and the Read Boundaries Nothing Can Reach Today

- **Plan**: context/changes/testing-runner-and-read-boundaries/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Evidence

- Local (2026-10-16): `npm run test:unit` 35/35 passed · `npm run lint` clean · `npx astro check` 48 files, 0 errors · `npm run gate:scope` 47 exact / 48 floor / 35 floor, all pass. `grep -c "TBD — see §3 Phase 3"` → 0; §3 row 3 reads `complete`.
- Not re-run locally (no local Supabase stack running): `npm run test:int`, `npm run smoke`, `npm run gates`. Taken from CI run 38856329922 at HEAD `d659618` (green on both jobs): `test:unit` 35 passed; `gate:scope` all three floors PASS; `Run integration tests` 2 files passed; `All 38 smoke steps passed`. The `Workers Builds: dziennik-dziecka` check (Cloudflare, runs `npm run gates` including `gate:drift`) is green on `62a30c6`, `d9339ef` and `d659618`.
- Plan drift: every planned item MATCH. The vitest config uses the plan's pre-approved fallback (`defineConfig` + `@` alias); the reason is recorded in `vitest.config.ts:1-11` and §4. Nothing on the "What We're NOT Doing" list was violated.
- Extra (unplanned) changes: `62a30c6` (drift gate requires `SUPABASE_ACCESS_TOKEN`) and `c37f01e` (`workflow_dispatch` for the drift sweep). Both are described in the plan's Phase 4 verification note as a same-day follow-up. The code is benign; see F2 for the documentation it left stale.
- Behaviour preservation checked: `isFutureWallClock` is semantically identical to the old inline comparison, and `scripts/lib/wall-clock.mjs` matches `src/lib/wall-clock.ts`. There is no `service_role` reference under `src/`, and fixture deletes are limited to the reserved prefix.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Vitest would collect tests from `.claude/worktrees/`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: vitest.config.ts:16-28
- **Detail**: The config sets no `include`, `exclude` or `dir`. Vitest does not read `.gitignore`, and its CLI filters (`vitest run tests/unit`) match path substrings. `.claude/worktrees/isolation-boundary-p2` is a full second checkout, on branch `testing-isolation-boundary-p2` at `9618607`. If that checkout ever contains a `tests/` directory, `gate:scope`'s `unitTestsPassed` floor would count its tests too, which hides a shrinking suite: the silent direction §6.6 warns about. `test:int` would also run a second copy of the integration suites in parallel against the same fixture ids. Latent today, because the worktree has no `tests/`. `scripts/gate-routes.mjs:20-22` already guards against this exact worktree for routes.
- **Fix**: Add `exclude: [...configDefaults.exclude, ".claude/**"]` (importing `configDefaults` from `vitest/config`) to `test` in `vitest.config.ts`, with a one-line comment pointing to the same reason given in `gate-routes.mjs`.
- **Decision**: FIXED — `exclude: [...configDefaults.exclude, ".claude/**"]` added with comment; `npm run test:unit` 35/35, eslint clean.

### F2 — `SUPABASE_ACCESS_TOKEN` is required by `gate:drift` but undocumented

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/deployment/deploy-plan.md:91, :147, :164, :178; context/foundation/test-plan.md:779
- **Detail**: `62a30c6` made `gate:drift` fail without `SUPABASE_ACCESS_TOKEN` (`scripts/gate-migration-drift.mjs:34`), and `ci.yml:151` passes it. The deploy plan's Cloudflare build-variables table, its GitHub secrets list, its secrets cheat-sheet, and test-plan §6.6 ("Absent credentials fail…") still name only `SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD`. The Cloudflare build has passed since `62a30c6`, so the token is evidently set there; this is a documentation gap, not a broken deploy. Anyone re-provisioning from the docs would end up with a deploy that fails at the credentials check.
- **Fix**: Add a `SUPABASE_ACCESS_TOKEN` row (Cloudflare build variable as a secret, plus a GitHub repo secret) to both deploy-plan tables and the GitHub list, and name it in the test-plan §6.6:779 sentence.
- **Decision**: FIXED — deploy-plan.md (requirement sentence, Cloudflare build-variables table, GitHub secrets list, secrets cheat-sheet) and test-plan.md §6.6 now name `SUPABASE_ACCESS_TOKEN`.

### F3 — Parallel integration files are kept apart only by convention

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/integration/fixtures.ts:180-188; vitest.config.ts
- **Detail**: `fileParallelism` is at its default (on). The two suites avoid racing only because they use disjoint id ranges (`…00001…` / `…00002…`) and distinct emails, an allocation rule documented in §6.3. `assertReserved` checks the shared `f1c70000-0000-0000-0000-` prefix, not the suite's own range. A third suite that reused a range would therefore produce intermittent, order-dependent failures instead of a clear error. There is no race today.
- **Fix**: Run integration files serially: `--no-file-parallelism` on the `test:int` script. With two small files the cost is negligible, and this removes the class of failure rather than documenting around it.
- **Decision**: FIXED — `test:int` now `vitest run tests/integration --no-file-parallelism`; §6.3 run command and fixture-contract point 4 updated. Flag accepted by vitest (run reached the suite's `requireEnv` throw); not re-run against a database locally (no stack up), CI's `smoke` job will exercise it.

### F4 — Two Phase 4 manual criteria are ticked but not observed as written

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/testing-runner-and-read-boundaries/plan.md:1059-1060
- **Detail**: 4.5's PR-into-`master` path was never watched run; only a direct push was. 4.6's premise (that the first teardown finds nothing to remove) does not match how the fixtures work. Both gaps are disclosed honestly in the verification notes at :695-711, so this is not rubber-stamping. But the `[x]` in Progress alone reads as fully observed.
- **Fix**: Append "(see verification note)" to the 4.5 and 4.6 Progress lines, so a reader of the checklist alone is pointed to the caveat.
- **Decision**: FIXED — "(see verification note)" appended after the SHA on Progress items 4.5 and 4.6; step titles unchanged.
