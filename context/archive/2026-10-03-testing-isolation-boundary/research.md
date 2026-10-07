---
date: 2026-10-03T21:53:51+02:00
researcher: marcin.zegunia2
git_commit: c14bd6eeb7733a6b7f6f3886a5f11617e1bfca6f
branch: master
repository: 10xdevs_projekt
topic: "Test plan §3 Phase 1 — what the database policies actually enforce for notes isolation and note destruction, and how to test that layer"
tags: [research, codebase, test-plan-phase-1, rls, pgtap, supabase, notes, isolation]
status: complete
last_updated: 2026-10-03
last_updated_by: marcin.zegunia2
---

# Research: Isolation at the enforcing layer (test plan §3 Phase 1)

**Date**: 2026-10-03T21:53:51+02:00
**Researcher**: marcin.zegunia2
**Git Commit**: c14bd6eeb7733a6b7f6f3886a5f11617e1bfca6f
**Branch**: master
**Repository**: 10xdevs_projekt

## Research Question

Ground the four context items `context/foundation/test-plan.md:65` (Risk #1) and
`:68` (Risk #4) require before Phase 1 can be planned:

1. Which policies exist per table and per operation.
2. What the notes insert and update checks require about child ownership.
3. Whether soft-deleted rows are excluded at the policy level or only in a query.
4. Whether any request path uses a key other than the parent's session.

Plus, for Risk #4: which operations have policies and which do not; which columns
each handler writes on edit and on delete; whether any grant allows a wider column
set; how a read failure is distinguished from an empty result.

## Summary

**The policy layer enforces less than the Phase 1 goal line claims, and the gap is
by prior decision, not by defect.** `context/foundation/test-plan.md:81` states the
phase will prove the policies are "what keeps one account's **and one child's**
notes from everyone else, and that no privilege exists to destroy a note row".
Against the two migrations that constitute the entire schema, exactly one of those
three clauses is a policy property:

| Phase 1 clause | Enforced at the policy layer? | Where it actually lives |
|---|---|---|
| one **account's** notes kept from other accounts | **Yes** | `notes_select_own`, `notes_insert_own`, `notes_update_own` (`supabase/migrations/20260927205447_create_notes.sql:26-66`) |
| one **child's** notes kept from the parent's other child, on read | **No** | `listNotes`' own `.eq("child_id", childId)` (`src/lib/notes.ts:28`) |
| no privilege exists to **destroy** a note row | **Partly — the wording inverts the mechanism** | the DELETE *grant* exists; no DELETE *policy* does, so a delete matches zero rows and raises no error |

Three consequences for the plan, each a scope correction rather than a detail:

1. **Cross-child isolation inside one account cannot be proven by a policy test**,
   because `notes_select_own` carries no child predicate — it is
   `using ((select auth.uid()) = user_id)` and nothing else
   (`supabase/migrations/20260927205447_create_notes.sql:26-30`). This is a recorded
   decision, stated in the code itself: "the `child_id` filter is not optional and
   RLS does not supply it: policies scope rows to the account, not to one child"
   (`src/lib/notes.ts:20-21`, repeating
   `context/archive/2026-09-26-first-child-note/plan.md:117`). The honest
   policy-layer assertion is the inverse of the goal line: one session **can** read
   both of its children's notes, and per-child separation is a query property. The
   child-ownership half that *is* in the policies belongs to `insert` and `update`
   only (`...create_notes.sql:41-45`, `:53-66`).
2. **Cross-child inside one account is covered by nothing today.** The HTTP walk
   never creates a second child: account A issues exactly one successful
   `POST /api/children` (`scripts/smoke.mjs:117`), and the `ids` object only ever
   holds `child`, `note`, `survivor` (`scripts/smoke.mjs:24`, `:123`, `:142`,
   `:218`). So the one filter standing between child 1 and child 2
   (`src/lib/notes.ts:28`) has no test at any layer — and a pgTAP test cannot be
   the one that covers it.
3. **"No privilege exists to destroy a note row" is true in effect and wrong in
   mechanism.** The `authenticated` role *does* hold DELETE on `public.notes`: the
   image that builds this project's database runs
   `alter default privileges in schema public grant all on tables to postgres, anon,
   authenticated, service_role`
   (`public.ecr.aws/supabase/postgres:17.6.1.166`,
   `/docker-entrypoint-initdb.d/init-scripts/00000000000000-initial-schema.sql:40`,
   with the `supabase_admin` equivalent at `:51-55`), and neither migration revokes
   anything (both files read in full; 24 and 66 lines). What is absent is any DELETE
   *policy*. Per Supabase's own documentation, "a missing grant returns a permission
   error … whereas a policy that matches no rows returns an empty result". So a
   delete attempt **succeeds, affecting zero rows** — it does not raise `42501`.
   S-02 recorded exactly this observation when it checked by hand:
   "`delete from public.notes` as an authenticated user affects no rows, because no
   `delete` policy exists" (`context/archive/2026-09-26-first-child-note/plan.md:166`).
   **A `throws_ok` assertion here would be testing the wrong failure and would fail
   against a correct database.** The correct assertion is zero rows affected plus
   the row still present.

Separately: **the existing HTTP walk is blind to a widened notes policy**, which is
the finding that justifies Phase 1 at all (details in
[What the HTTP walk cannot see](#what-the-http-walk-cannot-see)). And **Phase 1 is
the decision point for an open review finding** — `F5` in
`context/archive/2026-09-26-first-child-note/reviews/impl-review.md:105-116` is
still `Decision: PENDING` and names the same two gaps.

Tooling is feasible: pgTAP 1.3.3 ships in the pinned Postgres image, and CI already
has a migrated database running at the exact point a test step would attach. One
machine-local blocker (port 54322 is inside a Windows reserved range) stands in the
way of running the suite locally, and does not affect CI.

## Detailed Findings

### The complete policy surface (question 1)

`supabase/migrations/` contains exactly two files, and they are the whole schema —
no triggers and no SQL functions exist in either (both read in full):

| Table | Operation | Policy | Predicate | Anchor |
|---|---|---|---|---|
| `children` | select | `children_select_own` | `(select auth.uid()) = user_id` | `20260923221601_create_children.sql:14-18` |
| `children` | insert | `children_insert_own` | `(select auth.uid()) = user_id` | `:20-24` |
| `children` | update | **none** | — | absent from `:1-24` |
| `children` | delete | **none** | — | absent from `:1-24` |
| `notes` | select | `notes_select_own` | `(select auth.uid()) = user_id` — **account only** | `20260927205447_create_notes.sql:26-30` |
| `notes` | insert | `notes_insert_own` | `user_id` match **and** child-ownership `exists` | `:35-45` |
| `notes` | update | `notes_update_own` | same predicate in `using` **and** `with check` | `:49-66` |
| `notes` | delete | **none** | — | absent from `:1-66` |

Five policies across two tables. RLS is enabled on both
(`...create_children.sql:12`, `...create_notes.sql:22`), and every policy is scoped
`to authenticated`.

**"No update policy" is a `children`-only property and must not be generalized** —
`notes` has one. Both are intentional: `children` has no edit surface
(`context/archive/2026-09-23-child-profiles/plan.md:32`), `notes` has edit and soft
delete in scope (`context/archive/2026-09-26-first-child-note/plan-brief.md:25`).

### What the insert and update checks require about child ownership (question 2)

Both carry the same `exists` subquery against `public.children`:

```sql
exists (select 1 from public.children c
        where c.id = child_id and c.user_id = (select auth.uid()))
```

- `notes_insert_own` — `...create_notes.sql:41-45`.
- `notes_update_own` — in **both** `using` (`:53-59`) and `with check` (`:60-66`),
  which is what makes an edit unable to reassign a note to another account or move
  it to another child (the migration states this at `:47-48`).
- The explicit `c.user_id = (select auth.uid())` predicate is load-bearing and
  carries a do-not-remove instruction in the migration itself (`:32-34`) and in
  `context/archive/2026-09-26-first-child-note/plan.md:90`: `children`'s own RLS
  inside the subquery is "a redundant second layer, not the mechanism".

So child ownership **is** a policy property for writes, and is not one for reads.
That asymmetry is the shape Phase 1 has to test around.

### Soft delete is excluded in the query only (question 3)

`deleted_at` appears nowhere in any policy predicate. Its only appearances in SQL
are the column definition (`...create_notes.sql:13`) and the **partial index**
predicate `where deleted_at is null` (`:18-20`) — an index predicate, not a row
filter. Exclusion is applied by the application, at three sites:

- read: `.is("deleted_at", null)` — `src/lib/notes.ts:29`
- edit: `.is("deleted_at", null)` — `src/lib/notes.ts:71`
- soft delete: `.is("deleted_at", null)` — `src/lib/notes.ts:90` (makes a repeat
  delete idempotent rather than re-stamping)

**Therefore the Risk #1 proof statement "a soft-deleted note is not returned even to
its own owner" (`context/foundation/test-plan.md:65`) is not a policy property and
cannot be proven by a pgTAP policy test.** At the policy layer a soft-deleted row
*is* returned to its owner. That clause belongs to the integration layer the plan
schedules in §3 Phase 3.

### Column scope on update is unrestricted at the database (Risk #4)

`notes_update_own` restricts which **rows** an update may touch, not which
**columns**. No column-level grant narrows it — the migrations contain no
`revoke`/`grant` statements at all, so the blanket `grant all` from the image
bootstrap stands. Consequences, at the policy layer only:

- an authenticated parent **can** set `deleted_at` back to `null` on their own row
  (an un-delete), and **can** change `occurred_at` or `created_at`;
- nothing at the database prevents it; the guarantee is handler discipline.

The handlers are in fact disciplined, and write narrow payloads:

| Operation | Exact payload | Row predicate | Anchor |
|---|---|---|---|
| create note | `{user_id, child_id, content, occurred_at}` | — | `src/lib/notes.ts:50-52` |
| edit note | `{content, updated_at}` | `.eq("id")` + `.is("deleted_at", null)` | `src/lib/notes.ts:67-72` |
| soft delete | `{deleted_at}` | `.eq("id")` + `.is("deleted_at", null)` | `src/lib/notes.ts:86-91` |

- The edit payload contains **nothing beyond `content` and `updated_at`**; the
  handler does not even read a submitted `occurred_at`
  (`src/pages/api/notes/[id].ts:54`).
- **`deleted_at` is never written to `null` anywhere.** All seven occurrences of
  `deleted_at` in `src/` were inspected: `src/lib/notes.ts:29`, `:57` (comment),
  `:71`, `:78-79` (comments), `:88`, `:90`. The only write is the timestamp at `:88`.
  No route exposes an un-delete; `src/pages/api/notes/[id].ts` accepts only
  `intent === "save"` and `intent === "delete"`.
- **`user_id` and `child_id` never appear in an update payload** — only in the two
  inserts (`src/lib/notes.ts:52`, `src/lib/children.ts:63`).
- **Soft delete does not bump `updated_at`**, and no trigger supplies it (neither
  migration defines any). This is open review finding `F7`
  (`context/archive/2026-09-26-first-child-note/reviews/impl-review.md:128-136`,
  `Decision: PENDING`).

One nuance the §6 cookbook wording must respect: **a row *can* be physically
destroyed**, via `notes.user_id references auth.users (id) on delete cascade`
(`...create_notes.sql:7`). That path is reachable only out-of-band through the Auth
admin API or a service-role key, which this app never uses (`impl-review.md:105`).
A test must not claim "a note row can never be destroyed" without that condition.

### Both write paths filter by `id` alone, which makes the update policy load-bearing

`updateNoteContent` and `softDeleteNote` match on `.eq("id", noteId)` plus
`.is("deleted_at", null)` and **no `user_id` and no `child_id`**
(`src/lib/notes.ts:70`, `:89`). The `child_id` the form posts is validated as a UUID
and then used only to build redirect URLs (`src/pages/api/notes/[id].ts:33-40`,
stated in the comment at `:10-11`). So for edit and delete, cross-account isolation
rests **entirely** on `notes_update_own` — there is no handler filter behind it.
That is the strongest argument in this research for testing the update policy
directly.

### Every request path uses the parent's own session (question 4)

**Answer: no path uses any other key.** There is exactly one client factory —
`createServerClient(SUPABASE_URL, SUPABASE_KEY, { cookies })` from `@supabase/ssr`
(`src/lib/supabase.ts:9`, returning `null` when either value is missing at `:6-8`) —
consumed by nine call sites (`src/middleware.ts:9`;
`src/pages/api/auth/{signin,signout,signup}.ts:9`, `:5`, `:9`;
`src/pages/api/children.ts:55`; `src/pages/api/notes.ts:24`;
`src/pages/api/notes/[id].ts:22`; `src/pages/dashboard.astro:13`;
`src/pages/children/[id].astro:29`). `SUPABASE_KEY` is declared a server-only secret
(`astro.config.mjs:19-20`) and `.env.example:2` carries an `anon`-role JWT, so
privilege comes from the session cookie, not the key.

Evidence of absence, patterns run across `src/`, `astro.config.mjs`, `wrangler.jsonc`
and `.env.example` (excluding `node_modules` and `dist`): zero matches for
`service_role|SERVICE_ROLE|serviceRole`, zero for `createBrowserClient`, zero for
`locals.supabase` (`src/env.d.ts:2-4` declares `Locals` as `{ user: User | null }`),
and `.from("` appears on seven lines, all inside `src/lib/children.ts` and
`src/lib/notes.ts`. `src/components/` and `src/layouts/` contain no Supabase or
`fetch(` calls — all client mutation goes through plain HTML forms
(`src/components/notes/AddNoteForm.tsx:61`, `src/components/notes/NoteItem.tsx:29-31`).

This confirms the prior decision that RLS is the real boundary
(`context/archive/2026-09-23-child-profiles/plan.md:12`) is still true of the code
as it stands, and it is the precondition that makes the unrestricted update columns
tolerable (`context/archive/2026-09-26-first-child-note/plan.md:58`).

**Test-design consequence:** `supabase test db` connects as a superuser, and
`service_role` carries `BYPASSRLS` (`...initial-schema.sql:31`). A policy test must
therefore switch role explicitly — `set local role authenticated` plus a
`request.jwt.claim.sub`, or `tests.authenticate_as()` from `supabase-test-helpers`.
Without that switch the assertions do not exercise RLS at all.

### A read failure is already distinguished from an empty result (Risk #4)

Nothing to fix here, and it is not a policy-layer property. The data modules throw
rather than returning `[]` (`src/lib/notes.ts:34-36`, `src/lib/children.ts:30-33`,
`:49-52`), and both list surfaces carry a separate `listFailed` boolean whose branch
is checked **before** the zero-length branch:

- `src/pages/children/[id].astro:53-60` (the comment at `:53` states the rule: "A
  failed query must never be shown as 'no notes'"), rendered at `:84-89`.
- `src/pages/dashboard.astro:11-22`, rendered at `:39-44`.
- In write paths, a thrown read and a `null`/`found === false` result produce
  different messages (`src/pages/api/notes.ts:37-44`;
  `src/pages/api/notes/[id].ts:56-61`, `:67-72`).

So "a failed read renders as a failure, never as 'no notes'" is true in this
inspected code today — and untested. Locking it belongs to §3 Phase 3, not Phase 1.

### What the HTTP walk cannot see

`scripts/smoke.mjs` is 307 lines with zero imports. Its expectations are evaluated by
one inline boolean at `scripts/smoke.mjs:287-293`; counting expectation keys across
the steps array (`:77-274`) gives **36 steps and 76 assertions** — `status` 36,
`location` 26, `bodyIncludes` 6, `bodyExcludes` 4, `bodyOrder` 1, `extract` 3 (counts
reproduced independently). This reconciles with `context/foundation/test-plan.md:118`
("roughly 38 assertions"), which appears to have counted steps rather than keys; the
§4 row is approximately right about scale, and the step count is 36.

Cross-account coverage exists and is real: five steps
(`scripts/smoke.mjs:234-238`, `:239`, `:240-248`, `:249-257`, `:258-262`) plus an
after-the-fact confirmation as account A (`:269-273`).

**What it is blind to is a *widened* policy, which is the mutation a security test
must catch.** Traced per policy:

| Mutation | Caught by the walk? | Why |
|---|---|---|
| `notes_select_own` → `using (true)` | **No** | `listNotes` applies its own `.eq("child_id", childId)` (`src/lib/notes.ts:28`), and the only notes page is already gated by `getChild` (`src/pages/children/[id].astro:42`), which depends on `children_select_own`. No step ever reads a notes list under a session that can open the owning child page but should not see those rows. |
| child-ownership `exists` removed from `notes_insert_own` | **No** | the handler short-circuits first: `getChild` returns `null` for a foreign child and the route returns `toDashboard("Nie znaleziono dziecka")` (`src/pages/api/notes.ts:38`, `:42-44`), so `createNote` is never reached with a foreign `child_id` and the policy's `with check` is never the thing that fails. |
| child-ownership `exists` removed from `notes_update_own` (keeping the `user_id` half) | **No** | handlers never write `child_id`, and the `user_id` half still blocks account B, so the observable result is unchanged. |
| `notes_update_own` → fully permissive `using` | **Yes, incidentally** | B's edit would then match, and `src/pages/api/notes/[id].ts:62`/`:73` would redirect to `/children/<child>` instead of `/dashboard?error=`. But the assertion carries no evidence about the mechanism: `location` is matched with `startsWith` (`scripts/smoke.mjs:289`) and `/dashboard?error=` is also emitted for "note not found" (`src/pages/api/notes/[id].ts:60`, `:72`), so the step cannot distinguish "RLS blocked the row" from "the id matched nothing". |
| `children_select_own` → `using (true)` | **Yes** | B's `GET /children/<A's child>` would return 200 instead of the asserted 404 (`scripts/smoke.mjs:239`). |
| any permissive `children` update/delete policy added | **No** | no step and no route issues an update or delete against `children` (`src/pages/api/children.ts` exports only `POST`). |

Note also that outright **removal** of `notes_select_own` or `notes_insert_own` *is*
caught, but only incidentally — legitimate operations break, so the walk fails for
the wrong reason. Deny-by-default means removal is loud; widening is silent. Phase 1
exists to cover the silent half.

Soft delete: the walk asserts a soft-deleted note is absent from the next read
(`bodyExcludes: noteEdited` at `scripts/smoke.mjs:216`, guarded against a false pass
by `bodyIncludes: noteBackdated` at `:215`). It never reaches a soft-deleted note
directly by id — and cannot, because neither notes route exports a `GET`
(`src/pages/api/notes.ts`, `src/pages/api/notes/[id].ts` are POST-only), so the only
notes read surface is `src/pages/children/[id].astro:57`.

Fixture mechanics worth reusing or avoiding: the walk creates two throwaway accounts
per run with a `runId = Date.now()` suffix (`scripts/smoke.mjs:5-7`), suffixes every
fixture name so a stale row cannot satisfy the isolation check (`:9-16`), scrapes ids
out of rendered markup because a POST answers 302 with an empty body (`:123`, `:142`,
`:218`), and **performs no cleanup at all** — every run leaves two auth users, one
child and two notes behind (loop ends `:304`, exit `:307`). pgTAP does not inherit
that problem: each test file runs in its own transaction and is rolled back.

### Tooling feasibility

| Fact | Value | Source |
|---|---|---|
| pgTAP in the pinned image | **1.3.3, present** (`default_version = '1.3.3'`, `superuser = false`) | `pgtap.control` under `/nix/store/...-pgtap-1.3.3/share/postgresql/extension/` in `public.ecr.aws/supabase/postgres:17.6.1.166`; the image is Nix-based, so `/usr/share/postgresql` does not exist |
| how the CLI enables it | runs `create extension if not exists pgtap with schema extensions`, and drops it afterwards unless it pre-existed | Supabase CLI `test-db.handler.ts` (Context7, checked 2026-10-03) |
| test discovery | defaults to `<workdir>/supabase/tests`, `pg_prove --ext .pg --ext .sql -r` | Supabase CLI `legacy-test-db.pg-prove-args.ts` (Context7, checked 2026-10-03) |
| isolation per file | each test runs in its own transaction and is rolled back regardless of outcome | `supabase test db` docs (Context7, checked 2026-10-03) |
| prerequisite | `supabase start` must be running | same |
| installed CLI | **2.117.0** (declared `^2.23.4`) | `package.json:52`, `package-lock.json:9396` |
| CLI in CI | `supabase/setup-cli@v1` with `version: latest` — **unpinned, drifts from the lockfile** | `.github/workflows/ci.yml:35-37` |
| `supabase/tests/` | **does not exist**; no test directory anywhere in the repo | inspected `find supabase -type d` |
| seeding | `[db.seed] enabled = true` pointing at `./seed.sql`, **which does not exist** — configured but inert | `supabase/config.toml:62`, `:65` |
| pgTAP references in repo | exactly one, and it is prose | `context/foundation/test-plan.md:116` |
| local Postgres | major version 17 (image `17.6.1.166`) | `supabase/config.toml:36` |
| email confirmation (local) | `enable_confirmations = false`, `enable_signup = true` | `supabase/config.toml:209`, `:169` |
| rate limit to respect | `sign_in_sign_ups = 30` per 5 minutes | `supabase/config.toml:190` |

**CI attachment point.** `.github/workflows/ci.yml` is the only workflow (55 lines,
two jobs, no `needs:` between them). The insertion point is **`ci.yml:43`, inside
the `smoke` job** — immediately after `Start local Supabase` ends at `:42` and before
`Configure secrets for build and preview` at `:43`. At that point: the CLI is already
installed (`:35-37`), the database is already up and migrated (`supabase start` at
`:41`, whose `-x` exclusion list does not exclude Postgres), and the database holds
**zero rows and zero `auth.users`** — the only point in the job where it is
migrated-but-untouched. A step added later (after `:48` or `:53`) would see rows the
smoke walk created. The `ci` job is not viable: no CLI, no database.

Two shape notes that follow from the same reading: migrations reach the CI database
only as a side effect of `supabase start` — there is no `supabase db reset`,
`migration up`, `db push` or `test db` anywhere in the repo — and no npm script
invokes the `supabase` binary (there is no `test` script at all, so `npm test`
currently fails).

**Local blocker on this machine.** `supabase start` fails:
`ports are not available: … listen tcp 0.0.0.0:54322: bind`. The cause is confirmed,
not inferred: `netsh interface ipv4 show excludedportrange protocol=tcp` lists the
reserved range **54274–54373**, which contains `supabase/config.toml:29`'s
`port = 54322`. The command exits 0 while the stack does not start, so a wrapper must
not treat exit status as success. CI (`ubuntu-latest`) is unaffected. Resolving it is
a plan decision — change `[db] port`, or release the Windows reservation — and it
blocks the local half of the §5 gate ("database policy tests — local + CI"), not CI.

**Linked remote project.** `supabase/.temp/linked-project.json` shows this working
copy linked to the hosted project `dziennik-dziecka` (ref `ojhtrttucvuthgxxmpce`,
eu-west-2). `supabase/.temp` is gitignored (`supabase/.gitignore:3`), so a fresh CI
checkout has no link and `supabase start` there is unambiguously local. Locally,
however, a stray `--linked` or `--db-url` would reach production — relevant because
pgTAP fixtures insert into `auth.users`.

## Code References

- `supabase/migrations/20260923221601_create_children.sql:12-24` — RLS on, two policies on `children` (select, insert); no update, no delete
- `supabase/migrations/20260927205447_create_notes.sql:18-20` — partial index carrying the only `deleted_at is null` predicate in SQL
- `supabase/migrations/20260927205447_create_notes.sql:26-30` — `notes_select_own`: account-scoped, no child predicate
- `supabase/migrations/20260927205447_create_notes.sql:35-45` — `notes_insert_own`: `user_id` match + child-ownership `exists`
- `supabase/migrations/20260927205447_create_notes.sql:49-66` — `notes_update_own`: same predicate in `using` and `with check`
- `supabase/migrations/20260927205447_create_notes.sql:7` — `user_id … on delete cascade` to `auth.users`: the one real physical-destruction path
- `src/lib/notes.ts:20-21` — the code's own statement that RLS does not supply the child filter
- `src/lib/notes.ts:25-32` — `listNotes` filter chain: `.eq("child_id")`, `.is("deleted_at", null)`, two `.order`s, no `.limit`
- `src/lib/notes.ts:67-72` — edit writes `{content, updated_at}`, matched by `id` only
- `src/lib/notes.ts:86-91` — soft delete writes `{deleted_at}` only, matched by `id` only
- `src/lib/supabase.ts:3-21` — the single client factory: anon key from `astro:env/server` + cookie session
- `src/middleware.ts:6` — `PROTECTED_ROUTES = ["/dashboard", "/children", "/api/children", "/api/notes"]`, `startsWith` matching
- `src/pages/api/notes.ts:37-44` — the `getChild` short-circuit that hides `notes_insert_own` from the HTTP walk
- `src/pages/api/notes/[id].ts:33-40` — posted `child_id` used for redirects only, never as a write predicate
- `src/pages/children/[id].astro:53-60`, `:84-89` — `listFailed` set and rendered ahead of the empty-list branch
- `scripts/smoke.mjs:287-293` — the single inline boolean that evaluates all 76 assertions
- `.github/workflows/ci.yml:39-42` — `Start local Supabase`; `:43` is the attachment point for a policy-test step
- `supabase/config.toml:29` — `port = 54322`, inside the machine's reserved range 54274–54373

## Architecture Insights

- **Deny by default makes removal loud and widening silent.** Every prohibition in
  this schema is expressed as an absent policy. An absent policy breaks legitimate
  operations when removed, so the HTTP walk notices; a *widened* predicate changes
  nothing a handler-mediated walk can observe. A policy-layer test is the only thing
  that can see the second case.
- **Two boundaries, not one, and they sit at different layers.** Account isolation is
  a policy property; per-child separation is a query property. The codebase states
  this deliberately (`src/lib/notes.ts:20-21`). Any test that claims to prove "one
  child's notes" at the database layer is asserting something the schema does not
  implement.
- **Row-level policies cannot express column scope.** "An edit changes only the text"
  and "`deleted_at` is never cleared" are handler guarantees whose only backstop is
  that `SUPABASE_KEY` never reaches a browser (`src/lib/supabase.ts:3`,
  `astro.config.mjs:19-20`). The remedy, if wanted, is column-level grants —
  already drafted as Fix B in `impl-review.md:111`.
- **Grants and policies answer different questions, and the failure modes differ.**
  Grant missing → `42501`. Policy matching no rows → empty result, no error. Phase 1's
  assertions must be written against the second shape for delete.
- **The handlers' narrowness is what makes the current posture safe, and also what
  makes the HTTP walk a poor isolation test** — the walk keeps passing through the
  handler's own filters, which is precisely the "wrong layer" anti-pattern recorded
  at `context/foundation/test-plan.md:65`.

## Historical Context (from prior changes)

- `context/archive/2026-09-23-child-profiles/plan.md:12` — "The Supabase client runs
  as the user … so **RLS is the isolation boundary**." **Supported and still current**
  (verified against all nine client call sites; no service-role path exists).
- `context/archive/2026-09-23-child-profiles/plan.md:37` — "A DB-level RLS test suite
  (pgTAP). Isolation is verified through the smoke test." — listed under *What We're
  NOT Doing*, and carried forward by S-02
  (`context/archive/2026-09-26-first-child-note/plan.md:49`). **Phase 1 reverses this
  explicit prior rejection.** The reversal is justified by evidence those slices did
  not have (the widening-blindness table above), but the plan should record it as a
  reversal rather than a new idea.
- `context/archive/2026-09-26-first-child-note/plan.md:58` — "no privilege exists that
  can destroy a row", with the column-scope caveat stated in the same paragraph.
  **Partially contradicted on mechanism**: the DELETE grant exists; the absent policy
  is what yields zero rows. The same plan's `:166` records the accurate observable
  ("affects no rows"), so the slice's *verification* was right and its *phrasing* was
  loose. Carry the `:166` phrasing into §6, not the `:58` phrasing.
- `context/archive/2026-09-26-first-child-note/plan.md:117` — "policies scope rows to
  the **account**, not to one child". **Supported**, and the decisive input for the
  Phase 1 scope correction.
- `context/archive/2026-09-26-first-child-note/reviews/impl-review.md:105-116` —
  finding `F5`, `Decision: PENDING`, names exactly the two gaps Phase 1 targets:
  "`scripts/smoke.mjs` never asserts that a raw `DELETE` is refused, and never asserts
  that an edit leaves `occurred_at` untouched — so the two guarantees weakest at the DB
  level are the two with no automated test." Fix A (add smoke assertions, defer
  hardening) and Fix B (`revoke update … grant update (content, updated_at,
  deleted_at)`) are both still unchosen. **Phase 1 is where F5 gets decided.** Note
  `impl-review.md:110` already anticipated the layer problem: "Asserting a refused
  `DELETE` may need a direct PostgREST call rather than an app route, which the
  zero-dependency smoke script does not currently make" — pgTAP resolves that.
- `context/archive/2026-09-26-first-child-note/reviews/impl-review.md:128-136` —
  finding `F7`, `Decision: PENDING`: `softDeleteNote` does not bump `updated_at`.
  Touches the same rows; **confirmed still true in code** (`src/lib/notes.ts:88`, and
  no trigger exists). Out of Phase 1's stated scope — flagging, not scoping.
- `context/foundation/roadmap.md:87` (S-03 Risk) — "wyniki nie mogą przeciekać ani
  między kontami, ani między dziećmi tego samego konta — **zakres per dziecko jest tu
  pomocą, nie zabezpieczeniem**." **Supported and now precisely explained**: per-child
  scoping is a query, so for search it will be a new query needing its own coverage.
  S-03 is `ready` and is the only pending slice that adds a migration
  (`roadmap.md:71`), which is why `test-plan.md:93` wants the pattern to exist before
  S-03, not after.
- `context/changes/fr-006-research/research.md:54-58` — Supabase's hybrid-search
  example calls the RPC with the **service-role key**, which carries `BYPASSRLS` and
  would defeat isolation. **Supported and still current**, and directly relevant here:
  a pgTAP suite that asserts isolation under the `authenticated` role is exactly the
  gate that would catch such a regression when S-03 lands. Note that document is
  stale on other counts (it predates S-02 and describes `notes` as not existing,
  `:42-45`, `:267`) — those specific claims are superseded; its RLS conclusions are not.

## Related Research

- `context/changes/fr-006-research/research.md` — FR-006 library compatibility;
  `status: complete`, `last_updated: 2026-09-26`. Its RLS/service-role findings remain
  current; several of its codebase counts predate S-02 (see above).

## Open Questions

1. **The realized grants on `public.children` and `public.notes` were not read from a
   running instance of this project's database.** The claim that `authenticated` holds
   `select, insert, update, delete` on both rests on the image's bootstrap SQL
   (`...initial-schema.sql:40`, `:51-55`), Supabase's documented default, and S-02's
   recorded manual check (`plan.md:166`) — three independent sources that agree, but
   none of them this database. Verification is one query once the stack runs:
   `select grantee, privilege_type from information_schema.role_table_grants where
   table_name in ('notes','children') and grantee in ('anon','authenticated');`
   — and pgTAP can assert it permanently with `table_privs_are`. Worth doing as
   Phase 1's first step, because it decides whether a `revoke` belongs in the phase.
2. **Does Phase 1 characterize the current column posture, or change it?** Asserting
   "a soft delete cannot be un-stamped" requires Fix B's column grants
   (`impl-review.md:111`); without them, the honest test records that the policy
   permits it. This is a genuine scope choice for `/10x-plan`, and it decides `F5`.
3. **Where does the cross-child read boundary get its test?** It cannot be Phase 1.
   The candidates are an integration test in §3 Phase 3 against `listNotes`, or a
   route-level test; nothing covers it today at any layer.
4. **How is the local port collision resolved** — change `supabase/config.toml:29`
   (touching `.env`, the smoke flow and AGENTS.md) or release the Windows reservation?
   Until one is chosen, the §5 gate's "local" half cannot run on this machine.
5. **Should the CI CLI be pinned** to the lockfile's 2.117.0 instead of `latest`
   (`ci.yml:37`)? A policy-test gate makes CI depend on CLI behaviour (`supabase test
   db`, pgTAP enablement), where an unpinned install is a wider surface than it is for
   `start`/`stop` alone. Phase 2 owns gate integrity, so this may belong there.

### Not applicable

- **Prose-vs-JSON pass** — no structured facts file was requested, so no JSON
  companion exists to cross-check.
