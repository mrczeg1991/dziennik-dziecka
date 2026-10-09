# Gates that actually gate — Plan Brief

> Full plan: `context/changes/testing-gates-that-gate/plan.md`
> Research: `context/changes/testing-gates-that-gate/research.md`

## What & Why

Rollout Phase 2 of `context/foundation/test-plan.md` §3 wires the four gates §5 still
marks `required after §3 Phase 2`: gate integrity (Risk #7), route-guard coverage
(Risk #2), build-output secret scan (Risk #6), and migration drift against the hosted
project (Risk #3). The goal is to make CI fail for three reasons it currently cannot —
hosted schema drifting from deployed code, a gate run that aborted rather than passed, and
a data-touching route never added to the guard list. Risks #2 and #3 are the two remaining
High × High rows, and this phase needs no test runner, which is why §3 ordered it ahead of
Phase 3.

## Starting Point

Four gates are wired and green (lint, typecheck, build, the HTTP walk, the pgTAP policy
suite from Phase 1), and none of them can detect any of these four failures. Research
found three things that change what to build: ESLint's abort case **already** fails loudly
at exit 2, while *partial* scope shrinkage is silent — 3 of 37 files linted, exit 0, no
output; all five data routes are already covered by `PROTECTED_ROUTES`, so Risk #2's value
is drift detection, not a fix; and nothing anywhere compares committed migrations against
the hosted database, which both archived plans handled with a self-ticked checkbox.

Research also concluded deploy was not wired and that GitHub branch protection is
unavailable (`403 Upgrade to GitHub Pro` on a private free-plan repo). The first half is
wrong: **Cloudflare watches `master` and builds on push** — a Git integration configured
in the Cloudflare dashboard, invisible to a repo-only read. The second half holds, and
together they relocate the gate: Cloudflare's build command publishes nothing if it exits
non-zero, so that is the blocking seat, while GitHub Actions stays advisory.

## Desired End State

Every push to `master` triggers a Cloudflare build whose command is `npm run gates`, which
runs the scope floor, route-coverage and drift checks, then builds, then scans the build
output — and ships nothing if any gate fails. `ci.yml` runs the same scripts as named
steps on every branch for fast feedback, with the heavy `smoke` job still on `master` and
PRs. §5's four rows read `required — wired`, cookbook §6.4 and §6.5 are written, and the
`lessons.md` entry that is Risk #7's cited source has its `Rule:` and `Applies to:` fields
filled instead of `<to fill in>`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Gate count | All four | Leaves no §5 row marked required with nothing behind it; §5 said four, Phase 1's handoff said three. | Plan |
| Deploy topology | Cloudflare builds `master` on push | Corrects research's "deploy is not wired" — the integration is dashboard-configured and leaves no repo trace. | User |
| Where gates block | Inside Cloudflare's build command | The only blocking server-side chokepoint available without branch protection, which the free private plan forbids. | Plan |
| Branch protection | Not pursued | Repo stays private and on the free plan; GitHub Actions stays advisory by decision. | Plan |
| Drift check placement | At deploy, plus a scheduled sweep | Blocks the merge→deploy direction and still samples the laptop-`db push` direction a merge trigger never sees. | Plan |
| Drift instrument | `supabase migration list --output-format json`, parsed | Report-only by nature, no Docker, and its exit code on divergence is unverified so it is not trusted. | Research |
| Risk #7 instrument | Floor on reported scope, not an abort detector | Aborts already exit 2; partial shrinkage is the silent case research measured at 3 of 37 files. | Research |
| Scope-floor form | Lint pinned exactly at 37, `astro check` a floor at 38 | ESLint's scope is gitignore-driven and deterministic; `@astrojs/check` applies its own ignore list, so its count can move without a code change. | Plan |
| Route-guard source | One shared JSON read by middleware and the checker | `PROTECTED_ROUTES` is not exported and no runner exists until Phase 3, so a parsed copy would be the thing that drifts. | Plan |
| Route assertion shape | Inverted — enumerate, then allowlist | Forgetting to update an allowlist fails; forgetting a check-list passes silently, which is the §2 anti-pattern. | Research |
| Risk #6 scope | Secret scan plus asset-root invariant | Closes Open Question 1, where `dist/server/.dev.vars` holds both secrets and `.assetsignore` exists only under `dist/client`. | Plan |
| `?error=` property check | Deferred | No cheap form exists today, and every first-party path already supplies a hardcoded literal. | Plan |
| CI reachability | All branches for `ci`, `master` and PRs for `smoke` | A gate-integrity check confined to `master` is the risk recursing; `smoke` starts a full Supabase stack. | Plan |
| Pinning | Runner image and all three action tags | `ubuntu-latest` migrates to Ubuntu 26 from 2026-10-19, which would move the new counts within days of them landing. | Plan |
| Smoke hardening | All three false-pass vectors fixed | A typo'd expectation key silently reduces a step to a bare status check, and the wait-loop fix is one line. | Plan |

## Scope

**In scope:** the four §5 gates as plain Node scripts composed behind `npm run gates`;
pinning `runs-on` and the action tags; extending `ci.yml`'s triggers; the three
`scripts/smoke.mjs` false-pass vectors; moving the guard list to a shared JSON; correcting
`wrangler.jsonc`'s asset directory; the Cloudflare build command and its two build
variables; and the documentation this phase owns — §5 rows, cookbook §6.4/§6.5, the §6.6
phase note, `lessons.md`, `AGENTS.md:9` and `deploy-plan.md:26`.

**Out of scope:** making the repo public or buying GitHub Pro; a GitHub Actions deploy job;
the `?error=` parameter property check; `supabase db diff` (needs Docker, so an edited
migration body stays undetected — an accepted blind spot); the data-touching-by-import
classifier and the built SSR manifest as enumeration signals; standing up a test runner
(§3 Phase 3); asserting any error string's wording; adding a second linter; re-running the
HTTP walk against production; a post-edit hook; and Fix B's column-scoped grants.

## Architecture / Approach

Four scripts under `scripts/`, each exiting non-zero with a named reason, composed by
`package.json`:

```
gates      = gates:pre && build && gates:post
gates:pre  = gate:scope && gate:routes && gate:drift
gates:post = gate:build-output        # needs dist/ to exist
```

Cloudflare's dashboard holds one value, `npm run gates`, while the logic stays in version
control — which is what makes the one piece of out-of-repo config safe. `ci.yml` calls the
same `gate:*` scripts as named steps, so a failure is attributed to a step name rather
than a shell line, with no second definition to drift. `gate:drift` is the exception: it
talks to the hosted project, so it runs only in the Cloudflare build and in a scheduled
sweep, never on every branch push.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Stabilise the ground | Pinned runner image and action SHAs; `ci` job reachable from every branch | Pinning hides a security patch; SHAs go stale with nothing automating the bump |
| 2. Gate integrity | `gate:scope` floor, plus the three smoke false-pass vectors and the `lessons.md` rule | The exact lint count needs a deliberate bump per added file, and a forgotten bump fails the phase's own gate |
| 3. Route-guard coverage | Shared route JSON, inverted coverage checker, `/api/notes/<id>` asserted anonymously | Moving `PROTECTED_ROUTES` touches the one decision point for anonymous refusal |
| 4. Secret scan and asset root | `gate:build-output`, and `wrangler.jsonc` corrected to `./dist/client` | Config precedence is still unproven; the fix is chosen to be correct under either reading |
| 5. Migration drift | `gate:drift` in the deploy path plus a scheduled CI sweep | Needs hosted credentials in two places, and an edited migration body stays invisible |
| 6. Seat and document | `npm run gates`, the Cloudflare build command, §5/§6 and the runbook | The build-command change is the only step a git revert cannot undo |

**Prerequisites:** access to the Cloudflare dashboard for the project; `SUPABASE_PROJECT_REF`
and the hosted database password, as GitHub repository secrets and as Cloudflare build
variables; both migrations confirmed applied to the hosted project (currently resting on
two self-ticked checkboxes, which is itself Risk #3).

**Estimated effort:** ~4–6 sessions across 6 phases; Phases 1 and 2 are short, Phase 5 is
the longest because it is the only one that needs live credentials.

## Open Risks & Assumptions

- **Cloudflare's build command is the whole enforcement story.** If it is changed in the
  dashboard, every gate silently reverts to advisory with no repo-visible signal. §6.6
  records this, but nothing checks it.
- **A green Cloudflare build is assumed to be the only path to production.** A manual
  `npx wrangler deploy` from the laptop still bypasses every gate; the runbook will say so.
- **The hosted schema's current state is unverified.** Nothing has been run against
  `ojhtrttucvuthgxxmpce`, so Phase 5's first run may legitimately fail — that would be the
  gate working, not a defect.
- **The exact lint count is deliberate friction that can be defused.** If the number gets
  bumped reflexively instead of reviewed, the gate stops gating while still passing.
- **`astro check`'s count may move on its own** when `@astrojs/check` changes its internal
  ignore list; the floor confines that to shrinkage, which is the direction that matters.
- **`supabase migration list` compares version strings only**, so an edited body of an
  already-applied migration is invisible. Accepted, with `db diff` named as the escalation
  if it ever matters.
- **The Ubuntu 26 migration starts 2026-10-19.** Phase 1 should land before then, or the
  Phase 2 counts get calibrated against a moving image.

## Success Criteria (Summary)

- A merge to `master` carrying any of the four defects produces a failed Cloudflare build
  and **no new deployment** — the phase's goal, demonstrated rather than asserted.
- Each of the four gates has been seen to fail once, from a named reproducible case, before
  being trusted to pass.
- A contributor can add a route or a gate by reading cookbook §6.4 and §6.5 alone, and a
  route they forget to classify fails the build rather than shipping unguarded.
