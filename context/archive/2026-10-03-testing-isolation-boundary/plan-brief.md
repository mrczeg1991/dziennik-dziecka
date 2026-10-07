# Isolation at the Enforcing Layer — Plan Brief

> Full plan: `context/changes/testing-isolation-boundary/plan.md`
> Research: `context/changes/testing-isolation-boundary/research.md`

## What & Why

Stand up the project's first database-layer test suite (pgTAP via the Supabase CLI) and
make it a CI gate. The reason is specific: because every prohibition in this schema is an
*absent* policy, **removing** a policy is loud — legitimate operations break — but
**widening** one is silent. Four of six traced widenings pass the existing HTTP walk
untouched, because the handlers filter before the policy ever gets a chance to fail.
This is §3 Phase 1 of the test plan, covering Risk #1 (a parent sees notes that are not
theirs) and Risk #4 (a note is silently changed or vanishes).

## Starting Point

Five policies across two tables are the entire security surface, and nothing tests them.
`supabase/tests/` does not exist and there is no `npm test` script; the only automated
coverage is `scripts/smoke.mjs`, 36 steps over HTTP through handler-mediated routes.
Research also found the test plan's own wording overstates what that layer enforces in
three places, and that `supabase start` cannot bind on this machine — every default
Supabase port falls inside the confirmed Windows TCP exclusion range 54274–54373.

## Desired End State

A pull request that widens any of the five policies — or adds a `notes` `delete`
policy, or any `children` `update` or `delete` policy — fails CI at a named assertion. `npm run test:db`
runs the same suite locally. §6.1 of the test plan answers "how do I add a database
policy test here?" with a reference file and a run command, and §2/§3 no longer claim
protections the schema does not provide.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Column posture (finding `F5`) | Characterize now, harden later | Keeps this a pure test phase with no migration, while the characterization assertions act as a tripwire the day column grants or a browser-side client arrive. | Plan |
| Cross-child read isolation | Name the gap, hand it to §3 Phase 3 | `notes_select_own` has no child predicate, so no policy test can prove it; the real filter is a query (`src/lib/notes.ts:28`) and belongs where a runner will already exist. | Plan |
| Local port collision | Move the port block in `config.toml` | Fixes it in the repo and survives a machine rebuild; releasing the Windows reservation needs an elevated shell and can be silently undone by a reboot. | Plan |
| Session switching | Hand-rolled `set local role` + JWT claim | Adds no third-party extension to install in two environments, in a repo that currently has zero test dependencies — paid for with a mandatory negative-control test. | Plan |
| `test-plan.md` corrections | Correct the wording in place | §1 principle 3 already makes research ground truth when the two disagree; leaving the guide asserting three unprovided protections would mislead Phase 2 planning. | Plan |
| Delete assertion shape | Zero rows affected, never `throws_ok` | The `authenticated` role **holds** the DELETE grant — only the policy is absent — so a delete raises no error and an exception assertion would fail against a correct database. | Research |
| CI CLI version | Pin to `2.117.0` | This phase makes CI depend on `supabase test db` behaviour and CLI-managed pgTAP enablement, a wider surface than `start`/`stop`. | Plan |

## Scope

**In scope:** relocating the local Supabase port block and its three references; a
`tests.authenticate_as` helper with its own sanity test; four pgTAP files covering
cross-account isolation, the grant surface, the two honest inverses, and destruction;
`npm run test:db`; a CI step at `ci.yml:43` with the CLI pinned; a deliberate-failure
run to prove the gate gates; `test-plan.md` §2/§3/§4/§5/§6.1/§6.6 and `AGENTS.md`.

**Out of scope:** any schema migration (no `revoke`/`grant`, no trigger); cross-child
read coverage; Vitest and §6.2/§6.3; any change to `scripts/smoke.mjs`; finding `F7`
(`updated_at` on soft delete); `seed.sql`; §3 Phase 2's drift, gate-integrity and
route-guard work; anything run against the linked hosted project.

## Architecture / Approach

Four pgTAP files under `supabase/tests/`, each running in its own transaction that the
CLI rolls back. Fixtures are inserted as superuser *before* switching role — `auth.users`
is not writable by `authenticated`, and the point is to read someone else's row. A shared
`helpers.inc`, included per file with psql's `\ir` so it lives inside that file's own
transaction, sets `request.jwt.claim.sub` and then `set local role authenticated`;
`00_helper_sanity.sql` proves that switch took effect, including a **positive** read,
before any denial assertion is trusted. The CI step lands at `ci.yml:43` — the one moment
the database is migrated and still empty, since the smoke walk cleans up nothing.

Where the plain-language guarantee and the database mechanism diverge, the test follows
the mechanism and a comment records the divergence. Where the policy layer does not
provide a protection the plan claimed, the suite asserts the *actual* behaviour in a file
labelled as characterization.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Make the stack startable | Relocated port block; the realized grant surface read off a running database | The grant reading contradicts three agreeing sources, which would reshape Phase 4's delete assertion |
| 2. Skeleton and negative control | `tests.authenticate_as`, `npm run test:db`, the test that proves the switch works | A silently failing role switch makes every later assertion pass against no policy at all |
| 3. Risk #1 — exposure | Cross-account denial per operation, `table_privs_are`, the two honest inverses | An assertion that passes for the wrong reason (null `auth.uid()` matches nothing either) |
| 4. Risk #4 — destruction | Zero-rows delete assertion; column posture characterized | Writing `throws_ok` and failing against a correct database |
| 5. Make it a gate | CI step at `ci.yml:43`, CLI pinned, deliberate-failure run | A step placed after the smoke walk reads a dirtied database |
| 6. Write the guide back | §6.1 filled, three corrections, `F5` decided, `AGENTS.md` updated | `context/archive/` is immutable, so `F5` must be recorded in `change.md` instead |

**Prerequisites:** Docker running for `supabase start`; the ability to edit `.env` and
`.dev.vars` locally; push access for the Phase 5 scratch branch. No hosted-project access
is needed, and none should be used.

**Estimated effort:** ~3 sessions across 6 phases — Phase 1 and Phase 2 together, Phases
3–4 together, Phases 5–6 together.

## Open Risks & Assumptions

- **The grant baseline is assumed, not yet measured on this database.** Three independent
  sources agree that `authenticated` holds DELETE, but none of them is this instance.
  Phase 1 measures it; if it differs, Phase 4's assertion shape changes.
- **The port exclusion range is dynamically assigned** and can move after a reboot or a
  Hyper-V reallocation, so the new block must be re-checked before committing.
- **The `\ir` include is the one unverified mechanism.** `pg_prove` collects by
  extension recursively, so the helper must not end in `.sql`, and anything it creates
  is rolled back unless inlined into the consuming file's transaction. Phase 2 verifies
  the include resolves before any assertion is written; the fallback is to inline the
  two `set local` statements per file and drop the helper.
- **`auth.users` fixture shape is version-sensitive.** Every fixture needs a real
  `auth.users` row (the `notes.user_id` FK), and that table is GoTrue-owned. Phase 1
  captures the minimal working insert while the stack is up; a CLI or image bump could
  move it, and the local and CI images are not verified to agree.
- **`F7` stays open** — `softDeleteNote` does not bump `updated_at` (`src/lib/notes.ts:88`).
  Same rows, different concern, deliberately not scoped here.
- **This phase reverses an explicit prior decision.** Both archived slices listed a pgTAP
  suite under *What We're NOT Doing*. The reversal is justified by evidence they did not
  have — the widening-blindness analysis — and the plan records it as a reversal.
- **The working copy is linked to the hosted project** and the fixtures write to
  `auth.users`; a stray `--linked` or `--db-url` would reach production.

## Success Criteria (Summary)

- A widened `notes_select_own` fails CI at a named assertion — demonstrated on a real
  pull request, not assumed.
- `npm run test:db` runs green locally on a machine where `supabase start` previously
  could not bind at all.
- Someone who has not read the research can add a new policy test from §6.1 alone, and
  will not write `throws_ok` for a delete.
