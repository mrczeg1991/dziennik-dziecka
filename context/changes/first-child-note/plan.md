# First Child Note Implementation Plan

## Overview

Roadmap slice S-02 (`context/foundation/roadmap.md:103`) and PRD `US-01` / `FR-004` / `FR-005`: a signed-in parent opens one of their children, saves an arbitrary free-text note with a date/time they can backdate, and immediately sees it on that child's notes list, newest event first. The note survives logout, is visible only to the owning account, and can be corrected (text edit) or removed from the list (soft delete) without any row ever being physically destroyed.

This is the roadmap's North Star — the smallest end-to-end flow that proves the product works — and it is also the prerequisite that unblocks FR-006 in the next milestone (`context/changes/fr-006-research/research.md:42`).

## Current State Analysis

S-01 shipped the first data table and established every pattern this slice reuses:

- **Auth and route protection work.** `src/middleware.ts:6` populates `context.locals.user` and redirects unauthenticated requests for `PROTECTED_ROUTES` (`src/middleware.ts:4`, currently `["/dashboard", "/api/children"]`) to `/auth/signin`.
- **One migration exists.** `supabase/migrations/20260923221601_create_children.sql` creates `children` with RLS enabled and `select` + `insert` policies only, both keyed on `(select auth.uid()) = user_id`. There are no `update` or `delete` policies, which is what keeps a child row from being overwritten.
- **Data modules take the session client and apply no owner filter.** `src/lib/children.ts:23` lists children with ordering only; the comment at `:19` records that ownership is RLS-enforced. Row types are hand-written and applied with `.overrideTypes<T[], { merge: false }>()` (`src/lib/children.ts:28`) rather than `supabase gen types`.
- **Writes go through an Astro API route driven by a plain HTML form.** `src/pages/api/children.ts:28` reads `formData()`, validates, inserts, and redirects to `/dashboard` or `/dashboard?error=<message>`.
- **Islands do optimistic client validation over a real form POST.** `src/components/children/AddChildForm.tsx:58` posts to `/api/children`; `:29` uses `useSyncExternalStore` so a browser-local date never renders on the server and causes a hydration mismatch.
- **A failed read is never rendered as "empty".** `src/pages/dashboard.astro:11` keeps a `listFailed` flag distinct from `children.length === 0`.
- **The only test harness is `scripts/smoke.mjs`** — a zero-dependency HTTP walk ending in a cross-account isolation assertion (`scripts/smoke.mjs:91`). CI runs it against a fresh local Supabase, which applies migrations automatically (`.github/workflows/ci.yml:39`). There is no unit-test framework, so anything verified must be reachable over HTTP.

What is missing: there is no `notes` table, and there is no per-child page at all. `src/pages/` holds only `index`, `dashboard` and `auth/*`, and `src/pages/dashboard.astro:49` renders each child as inert text with no link. So this slice has to introduce navigation into a child, not just a form.

## Desired End State

A signed-in parent on "Moje dzieci" clicks a child and lands on `/children/<id>`. There they write a note, optionally change its date/time to an earlier moment (the field is prefilled with now), and save. The note appears on that child's list ordered newest event first, showing its wall-clock date and time. The parent can edit a note's text in place, or remove it from the list in two clicks. Everything survives sign-out and sign-in. A second account opening the same URL gets a 404, sees none of these notes, and cannot edit or delete them by id.

Verified by: the extended `npm run smoke` walk passing in CI against real RLS, plus a manual pass on the deployed Worker with two real accounts.

### Key Discoveries:

- `src/lib/children.ts:23` — data modules apply **no** owner filter; RLS is the isolation boundary. Any new read follows this, and any new SQL must preserve the property.
- `supabase/migrations/20260923221601_create_children.sql:14` — the policy idiom is `(select auth.uid()) = user_id`, scoped `to authenticated`; absent policies are the mechanism that forbids an operation.
- `src/pages/dashboard.astro:24` — dates are formatted by **string slicing, deliberately not through `Date`**, to avoid a time-zone shift. `src/pages/api/children.ts:9` documents the same problem from the server side: Workers run in UTC while the parent is in Poland.
- `scripts/smoke.mjs:9` — per-run unique names, so an isolation assertion cannot pass by accident on leftover data.
- `context/deployment/deploy-plan.md:78` — every new migration needs `npx supabase db push` before `wrangler deploy`, or the deployed code hits a table that does not exist.
- `context/changes/fr-006-research/research.md:295` — FR-006 will embed one vector per note row, so "link to the source note" is a row id. This slice's note id is that anchor; the embedding column belongs to M-2's own migration.

## What We're NOT Doing

- **No edit history or versioning.** An edit overwrites the note text; the previous text is not retained. `updated_at` records that an edit happened.
- **No "edited" marker in the UI.** Explicitly declined — the list shows no badge or hint that a note was changed.
- **No editing of a note's date/time.** Edit covers the note text only; a note saved against the wrong moment stays there.
- **No hard delete and no undelete UI.** Soft-deleted rows stay in the table and are only reachable through SQL.
- **No notes on the dashboard.** The dashboard stays an index of children.
- **No search, filtering, pagination, or natural-language questions.** FR-006 is parked to M-2 (`context/foundation/roadmap.md:143`).
- **No embedding, `tsvector` or `pg_trgm` columns.** M-2 adds its own migration; adding them now would be schema we cannot exercise.
- **No multi-time-zone support.** See Migration Notes.
- **No attachments, tags, or structured fields.** `FR-004` is deliberately free text.
- **No generated database types, no pgTAP, no unit-test framework, no CI auto-deploy.** All carried over from S-01's exclusions.

## Implementation Approach

The same five seams as S-01, in the same order: migration first so the isolation boundary exists before anything can depend on it, then the data module, then the endpoints, the island and the page, and finally the HTTP-level verification.

Three things differ from S-01 and drive the design:

1. **Two ownership facts, not one.** A note belongs to an account *and* to a child. `user_id` carries RLS as before, but the `insert`/`update` `with check` also requires the `child_id` to be one of the caller's own children. So a forged `child_id` cannot attach a note to another parent's child even if the route handler is bypassed.
2. **Mutation exists, destruction does not.** Edit is an `update`; delete is an `update` that stamps `deleted_at`. The table therefore gets `select` + `insert` + `update` policies and **no `delete` policy at all**, so "notes are never lost" is enforced by Postgres: no privilege exists that can destroy a row. The two narrower rules — an edit changes only the text, and `deleted_at` is never cleared — are *not* covered by that, because a row-level policy restricts which **rows** an update may touch, not which **columns**. Those stay handler-level guarantees. Practical exposure is nil: `SUPABASE_KEY` is a server-only secret (`src/lib/supabase.ts:3` reads it from `astro:env/server`), so no browser can reach PostgREST directly. If that ever changes, column-level grants (`revoke update … ` then `grant update (content, updated_at, deleted_at)`) are the fix.
3. **Two timestamps with different jobs.** `occurred_at` is the parent's wall clock for when the thing happened (backdatable, the sort key). `created_at` / `updated_at` are server instants recording when the row was written. They are never conflated.

## Critical Implementation Details

**Wall-clock time, deliberately without a time zone.** `occurred_at` is `timestamp` (no time zone) holding exactly the `YYYY-MM-DDTHH:mm` the parent typed, rendered back by string slicing. A `datetime-local` input submits a wall clock with no offset, so converting it to an instant would require wall-clock-to-UTC math in a DST-sensitive zone on a Worker that runs in UTC — the inverse direction of the problem `src/pages/api/children.ts:9` already works around. Storing the wall clock verbatim makes the round trip exact and makes "newest first" mean what the parent sees. The one direction the server does need — what the wall clock in Poland is right now, for future-date validation — is the easy direction and is available from `Intl`.

**`Intl` is available, and the future check needs slack.** Cloudflare documents that the Workers runtime supports all standard built-ins from the current Chrome stable release, excluding only `eval`, `new Function` and several `WebAssembly` entries, so `Intl.DateTimeFormat` with `timeZone: "Europe/Warsaw"` works server-side. The same page records that **`Date.now()` returns the time of the last I/O and does not advance during execution**. Combined with a device clock that can run a minute or two fast, comparing a submitted `occurred_at` against an exact server "now" would reject a note the parent just saved at the current minute. The future check therefore allows a 5-minute tolerance.

**Ordering tiebreak.** Two notes can carry the same `occurred_at` (both backdated to the same minute). Sort `occurred_at desc, created_at desc` so the order is stable and the more recently written of the two comes first. A tiebreak falling out of row order would not be a decision anyone made.

---

## Phase 1: Data layer

### Overview

Create the `notes` table with its RLS policies and a typed data module. Nothing in the UI depends on this yet, so the phase is verifiable on its own against local Supabase.

### Changes Required:

#### 1. Notes migration

**File**: `supabase/migrations/<timestamp>_create_notes.sql` (generate with `npx supabase migration new create_notes`)

**Intent**: Create the notes table so a note is owned by an account, attached to one of that account's children, soft-deletable, and never physically removable through the app's client.

**Contract**:

- Columns: `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users(id) on delete cascade`, `child_id uuid not null references public.children(id) on delete cascade`, `content text not null check (char_length(btrim(content)) between 1 and 2000)`, `occurred_at timestamp not null`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`, `deleted_at timestamptz null`.
- Partial index matching the list query: `(child_id, occurred_at desc, created_at desc) where deleted_at is null`.
- RLS enabled, `to authenticated`, three policies and no more: `notes_select_own` (`select`), `notes_insert_own` (`insert`), `notes_update_own` (`update`). **No `delete` policy** — its absence is the guardrail.
- The `insert` and `update` checks both require the child to belong to the caller. The explicit `c.user_id = (select auth.uid())` predicate is what makes this sufficient — keep it. (`children`'s own RLS policy also applies inside the subquery, but that is a redundant second layer, not the mechanism; do not later remove the predicate as duplication.)

```sql
create policy "notes_insert_own"
  on public.notes
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.children c
      where c.id = child_id and c.user_id = (select auth.uid())
    )
  );
```

- `notes_update_own` repeats that expression in both `using` and `with check`, so an edit can neither reassign a note to another account nor move it to another child.

#### 2. Notes data module

**File**: `src/lib/notes.ts`

**Intent**: Wrap the four note operations with hand-written row types, following the `src/lib/children.ts` conventions — session client in, no owner filter, `.overrideTypes` for the read, throw on a read failure and return the error on a write.

**Contract**:

- `export interface Note { id: string; content: string; occurred_at: string; created_at: string; updated_at: string }`
- `listNotes(supabase, childId): Promise<Note[]>` — filters by `child_id`, then by `deleted_at is null`, orders `occurred_at` descending then `created_at` descending, throws on error (never returns an empty list to signal failure). The `child_id` filter is not optional and RLS does not supply it: policies scope rows to the **account**, not to one child, so omitting it lists every note the parent owns on every child's page.
- `createNote(supabase, userId, { childId, content, occurredAt }): Promise<PostgrestError | null>`.
- `updateNoteContent(supabase, noteId, content): Promise<{ error: PostgrestError | null; found: boolean }>` — sets `content` and `updated_at`, matching only rows where `deleted_at` is null so a soft-deleted note cannot be edited back into view; `found` reports whether a row matched, so a foreign, missing or already-deleted id is distinguishable from a database failure.
- `softDeleteNote(supabase, noteId): Promise<{ error: PostgrestError | null; found: boolean }>` — sets `deleted_at`, matching only rows where `deleted_at` is currently null so a repeated delete is idempotent rather than re-stamping.

Both mutations rely on RLS for scoping and take no `userId`.

#### 3. Single-child lookup

**File**: `src/lib/children.ts`

**Intent**: The per-child page needs to resolve one child by id, and needs "not mine" and "does not exist" to be the same answer so the page cannot leak whether an id exists.

**Contract**: `getChild(supabase, childId): Promise<Child | null>` — selects the same columns as `listChildren`, uses `maybeSingle()`, returns `null` when RLS filters the row out, throws on a query failure.

#### 4. Wall-clock helpers

**File**: `src/lib/wall-clock.ts`

**Intent**: One place for the two wall-clock operations the route and the page both need, so the string-slicing convention is not re-implemented per caller.

**Contract**:

- `WALL_CLOCK_RE` — matches `YYYY-MM-DDTHH:mm` (the `datetime-local` submission shape).
- `warsawWallClock(at: Date = new Date()): string` — the wall clock in Poland for a given instant, as `YYYY-MM-DDTHH:mm`, comparable lexicographically against a submitted value. Taking the instant as a parameter is what lets the caller apply the 5-minute tolerance. The `sv-SE` locale is the trick that yields ISO-ordered parts directly:

```ts
// "2026-09-27 21:05" -> "2026-09-27T21:05"
const parts = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Warsaw",
  dateStyle: "short",
  timeStyle: "short",
}).format(at);
return parts.replace(" ", "T");
```

- `formatWallClock(value): string` — `"YYYY-MM-DDTHH:mm[:ss]"` to `"dd.mm.rrrr, HH:mm"` by slicing, never constructing a `Date`.

### Success Criteria:

#### Automated Verification:

- Migration applies from scratch: `npx supabase db reset`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- In local Studio as one account, inserting a note whose `child_id` belongs to a second account is rejected by the policy
- `delete from public.notes` as an authenticated user affects no rows, because no `delete` policy exists

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Per-child page and note flow

### Overview

Everything the parent touches: navigation from the dashboard into a child, the add-note form, the notes list, in-place edit and two-step delete, and the three endpoints behind them.

### Changes Required:

#### 1. Create-note endpoint

**File**: `src/pages/api/notes.ts`

**Intent**: Validate and insert one note, redirecting back to the child's page the same way `src/pages/api/children.ts` redirects back to the dashboard.

**Contract**:

- `POST`, form-encoded: `child_id`, `content`, `occurred_at`.
- Unauthenticated: redirect `/auth/signin`.
- Child resolved with `getChild`; missing or not the caller's → redirect `/dashboard?error=<message>` (never a child-specific URL, so a probe learns nothing).
- `content` trimmed, required, at most 2000 characters.
- `occurred_at` must match `WALL_CLOCK_RE` and must not be later than `warsawWallClock(new Date(Date.now() + 5 * 60_000))`; a plain string comparison suffices. The 5-minute tolerance is required, not cosmetic — see Critical Implementation Details.
- A missing or empty `occurred_at` defaults to `warsawWallClock()`, the save moment. This is what keeps the form usable with JavaScript disabled, where the island's client-side default never renders.
- Success: redirect `/children/<child_id>`. Failure: redirect `/children/<child_id>?error=<message>`.
- All user-facing messages in Polish, matching the S-01 route.

#### 2. Edit and delete endpoint

**File**: `src/pages/api/notes/[id].ts`

**Intent**: Handle both mutations on one note behind a single form-friendly POST, since HTML forms cannot issue PUT or DELETE.

**Contract**:

- `POST /api/notes/<id>`, form-encoded: `intent` (`"save"` or `"delete"`), `child_id` (for the redirect target), and `content` when `intent=save`.
- `intent=save`: same content validation as create, then `updateNoteContent`. `occurred_at` is ignored if submitted — edit does not change the note's date/time.
- `intent=delete`: `softDeleteNote`.
- `found: false` from either (a foreign, missing or already-deleted id) redirects to `/dashboard?error=<message>` rather than reporting anything about the id.
- Unknown `intent`: redirect `/dashboard?error=<message>`.
- Success: redirect `/children/<child_id>`.

#### 3. Route protection

**File**: `src/middleware.ts`

**Intent**: The new page and endpoints must reject anonymous requests like the existing ones.

**Contract**: `PROTECTED_ROUTES` gains `"/children"` and `"/api/notes"`. The existing `startsWith` matching covers `/children/<id>` and `/api/notes/<id>`.

#### 4. Per-child page

**File**: `src/pages/children/[id].astro`

**Intent**: Render one child with their notes and the add-note form; make an unknown or foreign id indistinguishable from a nonexistent page.

**Contract**:

- Reads `Astro.params.id`; `getChild` returning `null` → `new Response(null, { status: 404 })`.
- Lists notes via `listNotes`, keeping a `listFailed` flag separate from an empty list, exactly as `src/pages/dashboard.astro:11` does.
- Renders the child's name as the heading, a back link to `/dashboard`, the add-note form, and each note as a row showing `formatWallClock(note.occurred_at)` and the content. No indication of whether a note was edited.
- **The page owns error display**: `?error=` renders as a banner above the notes list, not inside the add-note form. Unlike `dashboard.astro`, an error here can originate from add, edit or delete, so attaching it to the add form would point at the wrong control.
- Empty state and load-failure state both in Polish, distinct from each other.
- Hydration: the add-note form is `client:load`; each note row is `client:visible`, since nothing in a row is interactive until the parent clicks "Edytuj" or "Usuń".
- Reuses `Layout.astro` and the existing dashboard styling.

#### 5. Add-note island

**File**: `src/components/notes/AddNoteForm.tsx`

**Intent**: A textarea plus a date/time field prefilled with the browser's current local time, with the same optimistic client validation and hydration-safe default as `AddChildForm`.

**Contract**:

- Props: `childId: string`. No `serverError` prop — the page owns error display.
- Posts `POST` to `/api/notes` with hidden `child_id`. Works without JavaScript: the date/time field submits empty and the endpoint defaults it to the save moment.
- `datetime-local` input, value defaulting to the browser's local now via the `useSyncExternalStore` pattern at `src/components/children/AddChildForm.tsx:29` (undefined on the server so the UTC-rendered markup cannot mismatch), `max` set to the same value.
- Client-side checks mirror the server: content non-empty and at most 2000 characters, `occurred_at` not in the future.
- Reuses `SubmitButton` from `src/components/auth/`, and `FormField` for the `datetime-local` field only — see the next change for the note body.

#### 6. Multi-line field component

**File**: `src/components/auth/TextAreaField.tsx`

**Intent**: The note body needs a multi-line control, and no component in the repo can render one — `FormField` hardcodes `<input>` (`src/components/auth/FormField.tsx:46`) with no multiline escape hatch, and there is no `<textarea>` anywhere in `src/`.

**Contract**: Mirrors `FormField`'s props and markup (`id`, `name`, `label`, `value`, `onChange`, `placeholder`, `error`, `maxLength`, optional `icon`, `rows`) but renders a `<textarea>`. Drop or reposition `FormField`'s absolutely-centred icon and `pl-10` padding, which assume a single-line control. Keeps the same label, error and focus-ring styling so the two fields look like one form.

#### 7. Note row island

**File**: `src/components/notes/NoteItem.tsx`

**Intent**: Give each note its view / edit / confirm-delete states without a native browser dialog.

**Contract**:

- Props: `note: Note`, `childId: string`.
- View: formatted `occurred_at`, the content, and "Edytuj" / "Usuń" controls.
- Edit: textarea prefilled with the current content, posting `intent=save` to `/api/notes/<id>`; "Anuluj" returns to view without a request.
- Delete: two-step inline — "Usuń" swaps in a "Potwierdź usunięcie" / "Anuluj" pair; confirming posts `intent=delete`. No `confirm()` or `alert()`.
- The date/time is display-only in every state.
- Both forms carry `action="/api/notes/<note id>"`, which is also where the smoke test reads the note id from — see Phase 3.

#### 8. Dashboard links into children

**File**: `src/pages/dashboard.astro`

**Intent**: Make each listed child the entry point to its notes; today the row is inert text.

**Contract**: The child name becomes an `<a href={`/children/${child.id}`}>`, keeping the existing row layout and the birth-date annotation.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- From "Moje dzieci", clicking a child opens their page; saving a note with the prefilled time shows it immediately
- A note backdated three days appears in date order among older notes, not at the top of the list
- Two notes backdated to the same minute keep a stable order, most recently written first
- Editing a note's text updates the list with no "edited" marker anywhere
- Deleting takes two clicks and the note disappears from the list
- Sign out, sign in, reopen the child: every surviving note is still there with its original date and time
- A future date/time and an empty note are both rejected with a Polish message
- `/children/<random-uuid>` returns 404

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Verification and deploy

### Overview

Lock the flow, the ordering rule and the cross-account boundary into the CI smoke walk, and make sure production gets the migration before the code that needs it.

### Changes Required:

#### 1. Smoke test

**File**: `scripts/smoke.mjs`

**Intent**: Extend the existing HTTP walk to cover the note flow end to end, including the isolation cases that RLS is responsible for, staying zero-dependency.

**Contract**:

- Per-run unique note bodies, following the `childName` pattern at `scripts/smoke.mjs:9`, so no assertion can pass on leftover data.
- **Three structural additions are required before any new step can work** — the script as written cannot express them:
  - *Ids must be captured across steps.* `scripts/smoke.mjs:99` assigns each result to a loop-local `const actual` and discards it; the only state shared between steps is the cookie jar. Add a module-level store (e.g. `const ids = {}`) plus an `extract` expectation the loop applies, such as `{ extract: [/\/children\/([0-9a-f-]{36})/, "child"] }`. Step runners are thunks evaluated inside the loop, so a later `` () => request(`/children/${ids.child}`) `` resolves after the capture with no further restructuring.
  - *Ids can only come from a GET.* `scripts/smoke.mjs:30` sets `redirect: "manual"`, so the body of a 302 POST response is empty. Both the child id and the note id are read from a follow-up `GET`.
  - *The markup must carry both ids.* The child id arrives via the `/children/<uuid>` link added to the dashboard (Phase 2, change 8); the note id via each row's form `action="/api/notes/<uuid>"` (Phase 2, change 7). No extra markup attribute is needed, but neither id may be dropped from the rendered HTML without breaking this phase.
- Ordering needs one new expectation kind: `bodyOrder: [first, second]`, checked as `indexOf(first) > -1 && indexOf(first) < indexOf(second)`, with a matching failure line beside `scripts/smoke.mjs:109-110`.
- New steps, in order, with user A signed in:
  1. Anonymous `POST /api/notes` → `302 /auth/signin`; anonymous `GET /children/<id>` → `302 /auth/signin`.
  2. `POST /api/notes` with content and an `occurred_at` of now → `302 /children/<id>`.
  3. `GET /children/<id>` → `200`, body includes the note text, and the note id is captured from the row's form action.
  4. `POST /api/notes` with an empty content → `302 /children/<id>?error=`.
  5. `POST /api/notes` with content longer than 2000 characters → `302 /children/<id>?error=`.
  6. `POST /api/notes` with an `occurred_at` a year in the future → `302 /children/<id>?error=`.
  7. A second note backdated three days, then `GET /children/<id>` → `200` with `bodyOrder: [now-note text, backdated text]` (the ordering assertion).
  8. `POST /api/notes/<note-id>` with `intent=save` and new content → `302 /children/<id>`; the list shows the new text and not the old.
  9. `POST /api/notes/<note-id>` with an unrecognised `intent` → `302 /dashboard?error=`.
  10. `POST /api/notes/<note-id>` with `intent=delete` → `302 /children/<id>`; the list no longer includes that text.
  11. After sign-out, user B signs in and `GET /children/<A's child id>` → `404`.
  12. User B `POST /api/notes` against A's `child_id` → `302 /dashboard?error=`.
  13. User B `POST /api/notes/<A's surviving note id>` with `intent=save` → `302 /dashboard?error=`.
  14. User B `POST /api/notes/<A's surviving note id>` with `intent=delete` → `302 /dashboard?error=`.
  15. A signs back in and `GET /children/<id>` → `200` with the surviving note present and its text unchanged, proving B's attempts changed nothing.
- Every existing step and its expectations stay unchanged.

#### 2. Deploy runbook

**File**: `context/deployment/deploy-plan.md`

**Intent**: The runbook's migration step already exists (`:78`); it names the `children` table as its example and should also name `notes`, so the reader of section 6 sees this release has a migration.

**Contract**: Update the parenthetical example in section 6 to mention the `notes` table alongside `children`. The standing instruction that every migration needs `db push` before deploying dependent code stays as written.

#### 3. README correction

**File**: `README.md`

**Intent**: Line 115 still claims "No database tables or migrations are required — this project uses Supabase Auth's built-in `auth.users` table only." That went stale when S-01 shipped and actively misleads anyone setting up locally, who must now apply migrations.

**Contract**: Replace that sentence with a pointer that `supabase/migrations/` holds the schema and that `npx supabase start` (or `db reset`) applies it locally.

### Success Criteria:

#### Automated Verification:

- Smoke passes locally against `npm run preview` with local Supabase: `BASE_URL=http://localhost:4321 npm run smoke`
- Linting passes: `npm run lint`
- CI `ci` and `smoke` jobs are green on the PR

#### Manual Verification:

- Migration pushed to the hosted Supabase project (`npx supabase db push`) before `wrangler deploy`
- On the deployed Worker, a real account adds, edits and deletes a note and the list behaves as it does locally
- With two real accounts on production, the second sees a 404 on the first's child URL and none of its notes

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

There is no unit-test framework in this repo and this slice does not introduce one; verification is the two existing layers.

### Static checks:

- `npx astro check` covers the hand-written `Note` type against every call site.
- `npm run lint` covers the islands, including the `jsx-a11y` rules the edit and delete controls must satisfy.

### Integration (HTTP smoke walk):

- Create, list, edit, soft delete, and persistence across sign-out.
- Validation: empty content, over-length content, future `occurred_at`, unknown `intent`.
- Ordering: a backdated note sorts by `occurred_at`, not by insert time.
- Isolation: anonymous rejection on page and endpoints; the second account gets 404 on the page, cannot post a note to the first account's child, and cannot delete the first account's note by id.

### Manual testing steps:

1. Sign in, open a child from "Moje dzieci", save a note with the prefilled date/time.
2. Save a second note backdated three days; confirm it appears below the first, in date order.
3. Save a third note backdated to the same minute as the second; confirm the newer of the two comes first and the order is stable across refreshes.
4. Edit the first note's text; confirm the list shows the new text and no "edited" marker.
5. Delete a note in two clicks; confirm it leaves the list and does not return after a refresh.
6. Sign out and back in; confirm the surviving notes and their dates are unchanged.
7. Try a future date/time and an empty note; confirm both are rejected in Polish.
8. Open `/children/<random-uuid>`; confirm 404.
9. From a second account, open the first account's child URL; confirm 404 and no note text anywhere.

## Performance Considerations

At the PRD's scale (`users: small`, one parent, two children) there is nothing to optimize. The partial index `(child_id, occurred_at desc, created_at desc) where deleted_at is null` exactly matches the only list query, so it stays an index scan as notes accumulate. Reads are unpaginated by decision; if a single child ever passes a few hundred notes, pagination is the follow-up, not an index change.

## Migration Notes

There is no existing data to migrate — `notes` is a new table.

Two forward-looking notes:

- **Soft-deleted rows persist.** Every read must filter `deleted_at is null`. When M-2 adds embeddings, a soft-deleted note must also drop out of search results, which is the same filter in a different query.
- **`occurred_at` is a wall clock with no zone,** on the assumption that the app stays single-user in Poland. If that ever stops holding, the migration path is: add `occurred_at_tz timestamptz`, backfill with `occurred_at at time zone 'Europe/Warsaw'`, then switch reads over. Nothing in this slice blocks that.

## References

- Roadmap slice: `context/foundation/roadmap.md:103` (S-02), milestone M-1
- PRD: `context/foundation/prd.md` — `US-01`, `FR-004`, `FR-005`, Guardrails
- Prior slice this mirrors: `context/archive/2026-09-23-child-profiles/plan.md`
- Downstream consumer: `context/changes/fr-006-research/research.md:42` (FR-006 is blocked on this table)
- Similar implementation: `src/pages/api/children.ts:28`, `src/lib/children.ts:23`, `src/components/children/AddChildForm.tsx:58`, `src/pages/dashboard.astro:11`
- Deploy runbook: `context/deployment/deploy-plan.md:60` (section 6)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer

#### Automated

- [x] 1.1 Migration applies from scratch: `npx supabase db reset` — 9cbd41e
- [x] 1.2 Type checking passes: `npx astro check` — 9cbd41e
- [x] 1.3 Linting passes: `npm run lint` — 9cbd41e

#### Manual

- [x] 1.4 In local Studio as one account, inserting a note whose `child_id` belongs to a second account is rejected by the policy — 9cbd41e
- [x] 1.5 `delete from public.notes` as an authenticated user affects no rows, because no `delete` policy exists — 9cbd41e

### Phase 2: Per-child page and note flow

#### Automated

- [x] 2.1 Type checking passes: `npx astro check` — 1eb6f15
- [x] 2.2 Linting passes: `npm run lint` — 1eb6f15
- [x] 2.3 Production build succeeds: `npm run build` — 1eb6f15

#### Manual

- [x] 2.4 From "Moje dzieci", clicking a child opens their page; saving a note with the prefilled time shows it immediately — 1eb6f15
- [x] 2.5 A note backdated three days appears in date order among older notes, not at the top of the list — 1eb6f15
- [x] 2.6 Two notes backdated to the same minute keep a stable order, most recently written first — 1eb6f15
- [x] 2.7 Editing a note's text updates the list with no "edited" marker anywhere — 1eb6f15
- [x] 2.8 Deleting takes two clicks and the note disappears from the list — 1eb6f15
- [x] 2.9 Sign out, sign in, reopen the child: every surviving note is still there with its original date and time — 1eb6f15
- [x] 2.10 A future date/time and an empty note are both rejected with a Polish message — 1eb6f15
- [x] 2.11 `/children/<random-uuid>` returns 404 — 1eb6f15

### Phase 3: Verification and deploy

#### Automated

- [x] 3.1 Smoke passes locally against `npm run preview` with local Supabase: `BASE_URL=http://localhost:4321 npm run smoke`
- [x] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 CI `ci` and `smoke` jobs are green on the PR

#### Manual

- [x] 3.4 Migration pushed to the hosted Supabase project (`npx supabase db push`) before `wrangler deploy`
- [x] 3.5 On the deployed Worker, a real account adds, edits and deletes a note and the list behaves as it does locally
- [x] 3.6 With two real accounts on production, the second sees a 404 on the first's child URL and none of its notes
