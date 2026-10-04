---
change_id: testing-isolation-boundary
title: Testing isolation boundary
status: implementing
created: 2026-10-03
updated: 2026-10-04
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Phase 1 — local stack and grant baseline (2026-10-04)

#### Port move: skipped, not needed

The plan's premise had expired. `netsh interface ipv4 show excludedportrange
protocol=tcp` now reports **no exclusion between 50159 and 56816** — the
54274–54373 range the plan recorded has been reassigned, so every default port
this project declares is free. `supabase start` completed on the declared
defaults and `supabase status` + `docker ps` confirm Kong `54321`, db `54322`,
Studio `54323`, mailpit `54324`, analytics `54327`.

Changes #1–#3 (config.toml, `.env.example`, `README.md`, `.env`, `.dev.vars`)
were therefore **not applied** — they would have churned the documented setup
for a constraint that no longer exists, and buy no durability: the exclusion
list is dynamically assigned, so 54420–54429 is no safer after the next reboot
than 54321 is today. If `supabase start` ever fails with
`listen tcp 0.0.0.0:54322: bind` again, re-read `netsh` and move the block then.

Container name for all `docker exec` below: `supabase_db_10x-astro-starter`.
Engine: PostgreSQL 17.6; `pgtap` 1.3.3 is **available but not installed** — the
CLI creates and drops it around each `supabase test db` run, as the plan assumed.

#### Grant baseline — research Open Question 1, settled

```
select grantee, table_name, privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name in ('notes','children')
  and grantee in ('anon','authenticated') order by grantee, table_name, privilege_type;
```

Both `anon` and `authenticated` hold **all seven** privileges on **both** tables
(28 rows: 2 grantees × 2 tables × 7):

`DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`

This is a **superset** of the expected `SELECT, INSERT, UPDATE, DELETE` — the
image bootstrap's `grant all` is literal, and neither migration revokes anything.

Two consequences:

- **Phase 4 is confirmed, not revisited.** `authenticated` _does_ hold DELETE, so
  the delete assertion shape is the one the plan specifies: zero rows affected
  plus the row still present, never `throws_ok`.
- **Phase 3 must list all seven.** `table_privs_are` for `authenticated` on
  `public.notes` and `public.children` takes the seven-element array above, not
  the four from the plan's prose. A four-element list would fail against a
  correct database. `anon` holds the same seven, which is worth its own line in
  the comment: the policies, not the grants, are what keep an anonymous caller out.

#### Fixture shape

`auth.users` has exactly three NOT NULL columns and only one without a default:

| column         | type    | default |
| -------------- | ------- | ------- |
| `id`           | uuid    | _none_  |
| `is_sso_user`  | boolean | `false` |
| `is_anonymous` | boolean | `false` |

So the minimal insert Phase 2 consumes is:

```sql
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
```

Confirmed twice with different uuids (`1111…` and `2222…`), both `INSERT 0 1`,
and confirmed to carry the full fixture chain — `public.children` then
`public.notes` via their FKs — inside a transaction that rolled back clean.

**Column names differ from the plan's prose.** `public.children` is
`(id, user_id, name, birth_date, created_at)` — the column is **`name`**, not
`first_name`, and `birth_date` is nullable. `public.notes` is
`(id, user_id, child_id, content, occurred_at, created_at, updated_at, deleted_at)`;
`occurred_at` is `timestamp without time zone` and NOT NULL with no default, so
every note fixture must supply it. Working fixture:

```sql
insert into public.children (id, user_id, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '1111…', 'Child A');
insert into public.notes (user_id, child_id, content, occurred_at)
values ('1111…', 'aaaaaaaa-0000-0000-0000-000000000001', 'note A', now());
```

#### The local database is not empty — assertions must be fixture-scoped

Pre-run counts on this machine: **9 `auth.users`, 7 `children`, 13 `notes`
(4 soft-deleted)**, left behind by earlier `scripts/smoke.mjs` runs, which
perform no cleanup; `supabase start` restored them from backup.

This does not affect CI — at `ci.yml:43` the database is migrated and holds zero
rows, which is why the policy-test step goes there — but it does constrain the
suite: **no assertion may rest on an absolute count over a whole table.** Every
count must be scoped to the fixture rows (by `id`, `user_id` or `child_id`).
`00_helper_sanity.sql` assertion 3 in particular ("under A, `select count(*) from
public.notes` returns A's note") must be written as a filtered count, or it will
pass or fail by accident locally.

Baseline for Phase 2's rollback check: `select count(*) from public.notes` = **13**.

#### The role-switch mechanism, confirmed live (de-risks Phase 2)

Verifying the grant reading required exercising the exact mechanism Phase 2's
helper is built on, so the result is recorded here rather than rediscovered:

```sql
set local role authenticated;
set local request.jwt.claim.sub = '<uuid>';
```

is **sufficient** on this engine — `current_user` becomes `authenticated` and
`(select auth.uid())` returns the uuid. The JSON `request.jwt.claims` form was
**not** needed for `auth.uid()` to resolve. Phase 2's helper should still set
both (the plan's contract), but the sanity check's assertion 2 will pass on the
`claim.sub` form alone.

The same transaction confirmed Phase 4's delete shape against the live database,
under the owner's own session with a resolving `auth.uid()`:

| step                                             | result                           |
| ------------------------------------------------ | -------------------------------- |
| `select` the owner's own note                    | 1 row — visible                  |
| `delete from public.notes where id = <own note>` | `DELETE 0` — **no error raised** |
| `select` the same note again                     | 1 row — **still present**        |

Grant held + RLS enabled + no DELETE policy = the statement runs, matches zero
rows, raises nothing. This is why `throws_ok` / `42501` would be the wrong
assertion and would fail against a correct database.

#### Soft delete vs. physical delete — two mechanisms, opposite assertions

Worth stating plainly because conflating them is what produced three of the
wrong claims in `test-plan.md`, and because the two require **opposite**
assertions in the suite.

**The UI never issues a DELETE.** `src/pages/api/notes/[id].ts` is a `POST`
route dispatching on `intent` (`:14`, `:66`); the delete intent calls
`softDeleteNote` (`src/lib/notes.ts:86-91`), which performs an **`UPDATE`**
stamping `deleted_at`. The row stays in the table — this local database holds 4
such rows out of 13. Invisibility comes from the query filter
`.is("deleted_at", null)` in `listNotes` (`:29`), `updateNoteContent` (`:71`)
and `softDeleteNote` itself (`:90`, which is what makes a repeated delete
idempotent rather than re-stamping the date).

**That invisibility is a query property, not a policy property.** `deleted_at`
appears in no RLS predicate — only in a partial index, and an index predicate is
not a row filter. Under the policy layer an owner **does** see their own
soft-deleted row. Confirmed live: 4 soft-deleted rows are visible to a superuser
and nothing in the five policies filters them.

**The physical-delete guarantee is a separate question**, and it is the one
Risk #4 names: if a real `DELETE` ever reaches the database — a compromised
handler, a new code path, a direct client call — it matches zero rows and
raises nothing, because no DELETE policy exists. The only genuine physical
destruction path is `on delete cascade` from `auth.users`
(`create_notes.sql:7`), reachable only by deleting the account through the Auth
admin API or a `service_role` key, which this app does not use.

Consequence for the suite:

| assertion                              | correct shape                                   | file                                               |
| -------------------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| owner sees their own soft-deleted note | `UPDATE` succeeds, row still returned under RLS | `02_notes_characterization.sql` (characterization) |
| physical `DELETE` by the owner         | zero rows affected **and** row still present    | `03_notes_destruction.sql` (guarantee)             |
| physical `DELETE`                      | ~~`throws_ok` / `42501`~~                       | **wrong** — would fail against a correct database  |

#### Decision: soft delete stays — test-plan.md adapted to it (user, 2026-10-04)

The user confirmed the soft-delete mechanism is to be **kept**, and asked that the
test plan be adapted to it rather than the mechanism changed. This matches the
plan's existing design — no migration ships, `src/lib/notes.ts` is untouched, and
the suite characterizes the current posture (see _What We're NOT Doing_).

Two of **Phase 6 change #2**'s corrections were therefore **pulled forward into
Phase 1** and are already applied to `context/foundation/test-plan.md`. Phase 6
should not redo them:

- `:65` Risk #1 — the soft-delete clause no longer reads as a policy-layer
  guarantee. It now says the filter lives one layer up at `src/lib/notes.ts:29`
  rather than in any policy. The _Likely cheapest layer_ cell splits accordingly:
  policy tests for the cross-account half, an integration test for the
  soft-delete filter and per-child scoping, "neither of which is a policy property".
- `:83` §3 Phase 3 — now explicitly owns the two read boundaries the policy layer
  structurally cannot reach (own soft-deleted note stays out of the list; one
  child's notes stay out of the other's), and its _Risks covered_ gains
  `#1 (soft-delete and cross-child halves)`.

Still outstanding for Phase 6: the `:81` §3 Phase 1 Goal rewrite (drop "and one
child's", restate destruction as the mechanism), §6.1, §4/§5 rows, §6.6, and `F5`.

**Finding for Phase 6's gate 6.1.** `context/foundation/test-plan.md` does **not**
pass `npx prettier --check` at `HEAD` — it never did. A `prettier --write` on it
reformats ~60 unrelated table lines (61 insertions / 60 deletions) on top of the
intended edit. Phase 1 therefore left formatting alone and changed exactly two
lines. Phase 6 must decide deliberately between a one-off whole-file format pass
(landed as its own commit, so the correction diff stays readable) and scoping
gate 6.1 to "no _new_ violations". Do not discover this mid-phase.

### Phase 2 — suite skeleton and negative control (2026-10-04)

Implemented on branch `testing-isolation-boundary-p2` in the worktree
`.claude/worktrees/isolation-boundary-p2`, so that S-05 could proceed in
parallel. **Both worktrees share one local Supabase stack** — `project_id` is
committed in `config.toml`, so they resolve to the same containers and the same
database. `supabase test db` is safe under that sharing (per-file transaction,
rolled back), but a `supabase db reset` or `supabase stop` from either window
hits the other. Coordinate before resetting.

#### `\ir` resolves — no fallback needed

A one-line probe confirmed `\ir helpers.inc` resolves under `supabase test db`
before any assertion was written, so the plan's fallback (inlining the two
`set local` statements per file and dropping the helper) was not needed.
`pg_prove` collected `Files=1` with `helpers.inc` present in the directory,
confirming the `.inc` extension excludes it from discovery.

#### The connecting role is NOT a superuser — it holds BYPASSRLS

The plan's Key Discoveries said "`supabase test db` connects as a superuser".
Measured from inside a test file, that is wrong in its attribute and right in
its conclusion:

| property                        | value      |
| ------------------------------- | ---------- |
| `current_user` / `session_user` | `postgres` |
| `is_superuser`                  | `off`      |
| `rolsuper`                      | `false`    |
| **`rolbypassrls`**              | **`true`** |
| `auth.uid()`                    | `null`     |

So the vacuous-pass hazard is real, but it comes from **BYPASSRLS**, not from
superuser status. `00_helper_sanity.sql` assertion 1 therefore pins
`rolbypassrls = true` rather than `is_superuser = on`: bypassing row security is
the property that actually makes an un-switched assertion meaningless, and if a
future image drops BYPASSRLS from `postgres`, fixture setup and the
between-session switching in 01_/02_/03_ change character — assertion 1 is where
that surfaces.

Consequence for later phases: `tests.clear_authentication()` returns to
`postgres`, which can still write fixtures _because of_ BYPASSRLS, not because
it is a superuser. Do not describe it as "back to superuser".

#### The break-check was stronger than the gate asked

Gate 2.2 only required assertion 2 to fail. Commenting out
`set_config('role', 'authenticated', true)` reddened **two** assertions:

- **2** — `have: postgres|…000a` vs `want: authenticated|…000a`. The compound
  `is()` named exactly which half broke: the claim was set, the role was not.
- **4** — `have: 1, want: 0`. B's note became **visible**, because `postgres`
  with BYPASSRLS is subject to no policy.

That second failure is the control earning its place: it demonstrates live that
without the role switch, assertion 4 would have passed having tested nothing —
Risk #7 exactly. The helper was restored from the index via
`git checkout -- supabase/tests/helpers.inc`; the break was never staged.

#### Open item for Phase 3: `clear_authentication` has no test

`helpers.inc` defines two functions; `00_helper_sanity.sql` exercises only
`authenticate_as`. The plan fixes the sanity file at four assertions and gate 2.1
says "all four", so no fifth was added. But §6.1 is going to publish the rule
"the role switch has its own test, and any new helper function needs one too",
and `clear_authentication` currently violates it.

Phase 3 resolves this one of two ways, deliberately: its multi-user fixtures
need superuser→A→setup→B transitions and will _use_ the function, which is
coverage in practice; or add a dedicated assertion. Do not let it ship untested
by default.

#### Worktree setup gotcha (not caused by this change)

A fresh git worktree has no `node_modules` and no `.astro/`. `npm`/`npx` resolve
binaries by walking up to the main checkout, so they appear to work — but
`npm run lint` reports **25 phantom errors** (`no-unsafe-*`, "type that cannot be
resolved") purely because `.astro/types.d.ts` is absent. `npx astro sync`
generates it and lint returns clean. Run it first in any worktree; do not read
those 25 errors as a regression. Also note `npx prettier` is slow on first
invocation in a worktree (cold resolution) — it can exceed a 120s timeout
without anything being wrong.
