# First Child Note — Plan Brief

> Full plan: `context/changes/first-child-note/plan.md`

## What & Why

Roadmap slice S-02 (PRD `US-01`, `FR-004`, `FR-005`): a signed-in parent saves an arbitrary free-text note about one of their children, with a date/time they can backdate, and sees it on that child's notes list. This is the roadmap's North Star — the smallest end-to-end flow that proves the product works — and it is the prerequisite that unblocks FR-006 (natural-language questions) in the next milestone.

## Starting Point

S-01 shipped the `children` table, the dashboard listing them, and the whole pattern this slice repeats: migration with RLS, a data module that applies no owner filter, an HTML form posting to an Astro API route, a React island for validation, and one HTTP smoke walk as the only test harness. What does not exist: a `notes` table, and any per-child page — `src/pages/dashboard.astro:49` renders each child as inert text with no link.

## Desired End State

The parent clicks a child on "Moje dzieci" and lands on `/children/<id>`, where they write a note, optionally set its date/time back to when the thing actually happened, and see it appear on a list ordered newest event first. They can fix a note's text in place, or remove it from the list in two clicks. Notes survive sign-out. A second account opening the same URL gets a 404 and cannot reach, edit or delete those notes by id.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Note date/time | Backdatable, prefilled with now, stored separately from `created_at` | The PRD's driving scenario is reconstructing history ("a symptom noticed yesterday"), and a separate column keeps the write-time audit trail intact. |
| List ordering | Newest event first, by the note's own date/time | The list reads as a timeline, which is how a parent scans it before a doctor's visit; a backdated note lands in date order, not at the top. |
| Ordering tiebreak | `occurred_at` desc, then `created_at` desc | Two notes backdated to the same minute need a stable order that someone actually chose. |
| Location | Per-child page at `/children/<id>` | Gives every note a URL that FR-006's "link to the source note" can target later, and keeps the dashboard as an index. |
| Edit / delete | Both in scope | User decision: a mistyped note should be fixable without waiting for a later slice. |
| Guardrail mechanics | Edit overwrites the text and stamps `updated_at`; delete is soft (`deleted_at`) | Nothing changes without an explicit action and no row is ever destroyed, so "notes are never lost" holds. |
| Edited marker | None in the UI | Explicitly declined — `updated_at` is a database record only. |
| Destruction | No SQL `delete` policy at all | Makes the guardrail a property of Postgres rather than of the route handler. |
| Child ownership | Enforced in the RLS `with check`, not only in the route | A forged `child_id` cannot attach a note to another parent's child even if the handler is bypassed. |
| `occurred_at` type | `timestamp` with no time zone — the wall clock as typed | Avoids DST-sensitive wall-clock-to-UTC math on a UTC Worker and makes the round trip exact; follows the existing "never go through `Date`" convention. |
| Text limit | 1–2000 characters, DB check constraint | Mirrors the `children.name` constraint pattern; free text still, just bounded. |

## Scope

**In scope:**
- `notes` migration with RLS (`select` / `insert` / `update` only) and a child-ownership check
- `src/lib/notes.ts`, `getChild` in `src/lib/children.ts`, `src/lib/wall-clock.ts`
- `POST /api/notes` and `POST /api/notes/[id]` (`intent=save|delete`)
- `/children/[id].astro`, `AddNoteForm`, `NoteItem`, a new `TextAreaField` (no multi-line field exists yet), dashboard child links, middleware protection
- Smoke walk extension, deploy runbook and README corrections

**Out of scope:**
- Edit history / versioning, and editing a note's date/time
- Hard delete, undelete UI, any "edited" marker
- Notes on the dashboard; search, filtering, pagination
- FR-006 embeddings, `tsvector`, `pg_trgm` (M-2's own migration)
- Multi-time-zone support, attachments, tags, generated DB types, unit-test framework

## Architecture / Approach

The five S-01 seams in the same order: migration → data module → API routes → island → page, then HTTP verification. A note carries two ownership facts (`user_id` for RLS, `child_id` checked against the caller's own children in the policy) and two kinds of time (`occurred_at`, the parent's backdatable wall clock and the sort key; `created_at` / `updated_at`, server instants). Mutation exists but destruction does not: edit is an `update`, delete is an `update` stamping `deleted_at`, and the table has no `delete` policy.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | `notes` table + policies, `src/lib/notes.ts`, `getChild`, wall-clock helpers | A wrong `with check` would let a note attach to another account's child |
| 2. Per-child page and flow | Endpoints, page with 404 on foreign ids, add form, edit / two-step delete, dashboard links | The `datetime-local` value is a wall clock with no offset — mishandling it shifts every note's time |
| 3. Verification and deploy | Smoke steps for create, ordering, edit, soft delete, isolation; runbook + README fixes | Forgetting `supabase db push` before `wrangler deploy` breaks the deployed page |

**Prerequisites:** S-01 shipped (done, archived). Docker + Supabase CLI for `supabase start` / `db reset`; access to the hosted Supabase project for `db push`.
**Estimated effort:** ~2 after-hours sessions across 3 phases — slightly more than S-01 because of the edit/delete surface and the ordering assertion.

## Open Risks & Assumptions

- **Single time zone assumed.** `occurred_at` is a bare wall clock, correct only while the parent stays in Poland; the migration path (add `timestamptz`, backfill `at time zone 'Europe/Warsaw'`) is recorded in the plan.
- **Edited text is not recoverable.** By decision, an edit overwrites; only the fact of an edit survives, in `updated_at`.
- **The update policy restricts rows, not columns.** Deletion is impossible at database level (no `delete` policy), but "an edit changes only the text" and "`deleted_at` is never cleared" are route-level guarantees. Exposure is nil while `SUPABASE_KEY` stays a server-only secret; column-level grants are the fix if that changes.
- **Soft-deleted rows accumulate** and must be filtered on every read, including FR-006's future search queries.
- **A note's date/time cannot be corrected** — only its text. A note saved against the wrong moment needs a delete and a re-add.
- **The ordering assertion needs a new smoke capability** (comparing positions in the response body), the first expectation in that script that is not a simple include/exclude.

## Success Criteria (Summary)

- A parent adds a note about a child — including one backdated to yesterday — and sees it in date order on that child's page, still there after signing out and back in.
- The parent can fix a note's text and remove a note from the list, with no note row ever physically deleted.
- A second account gets a 404 on the first's child URL, sees none of its notes, and cannot edit or delete them by id — asserted in CI against real RLS.
