# Child Profiles Implementation Plan

## Overview

Roadmap slice S-01 (FR-001–FR-003). This adds the app's first data table, `children`. Each profile is owned by the signed-in account and isolated with Postgres RLS. The starter `/dashboard` becomes a Polish "Moje dzieci" page where a logged-in parent adds a child (name + optional birth date) and sees a list of only their own children. Sign-in and logged-in visits to `/` land there. This slice also sets the owner-only data rule that S-02 (notes) will reuse.

## Current State Analysis

- Auth is complete and smoke-tested: sign-up/sign-in/sign-out endpoints (`src/pages/api/auth/*.ts`). The middleware resolves `locals.user` and guards `PROTECTED_ROUTES = ["/dashboard"]` (`src/middleware.ts:4`).
- Sign-in redirects to `/` (the starter Welcome page), not the dashboard (`src/pages/api/auth/signin.ts`, final `context.redirect("/")`).
- `/dashboard` is a starter placeholder showing the email and a sign-out button (`src/pages/dashboard.astro`).
- There is no data layer yet: `supabase/` contains only `config.toml` (no `migrations/`, no `seed.sql`). The Supabase client runs as the user (anon key + session cookie via `@supabase/ssr`, `src/lib/supabase.ts`), so **RLS is the isolation boundary**.
- The mutation pattern is an HTML form POST to an Astro API route, which redirects back with `?error=<message>` on failure. React islands add client-side validation (`src/components/auth/SignInForm.tsx`) using the shared `FormField`, `ServerError` and `SubmitButton` components.
- The only test harness is `scripts/smoke.mjs` (zero-dep HTTP walk). CI runs it against a fresh local Supabase (`.github/workflows/ci.yml`, `smoke` job), and `supabase start` applies `supabase/migrations/*` automatically.
- The deploy runbook (`context/deployment/deploy-plan.md`) covers secrets and `wrangler deploy` but has no step that applies DB migrations to the hosted Supabase project.
- Existing UI copy is English. The PRD user and roadmap are Polish.

## Desired End State

A parent signs up and signs in, then lands on `/dashboard` titled "Moje dzieci". With no children yet, the page shows an empty-state message and an add form. When the parent submits a name (and optionally a birth date), they are redirected back and see the child in the list. The list is ordered oldest-added first and shows each child's name and birth date if set. Invalid input returns to the page with a Polish error message. A second account never sees the first account's children, whether through the page or through direct PostgREST queries (RLS). An anonymous POST to the create endpoint is redirected to sign-in. The smoke test checks all of this in CI.

### Key Discoveries:

- `src/middleware.ts:4`: pages get protected by adding their path to `PROTECTED_ROUTES` (AGENTS.md hard rule). Prefix matching is `startsWith`.
- `src/pages/api/auth/signin.ts`: the success redirect target is `/`. `scripts/smoke.mjs` asserts `location: "/"` for the "signin accepts correct password" step, so the two must change together.
- `src/components/auth/FormField.tsx`: requires an `icon` and supports any `type`, so `type="date"` works without changing the component.
- `supabase/config.toml`: `auth.email.enable_confirmations = false` locally, so smoke sign-ups sign in immediately. `db.seed.sql_paths = ["./seed.sql"]` points at a missing file, which is harmless (warning only).
- `scripts/smoke.mjs` `request()` returns only `{status, location}`, so assertions about visible children need the response body.

## What We're NOT Doing

- Editing or deleting child profiles (no UPDATE/DELETE RLS policies, so both are denied by default). This also avoids any "silent overwrite" path.
- A per-child page (`/children/[id]`) or anything note-related. That belongs to S-02.
- A uniqueness constraint on child names. Duplicates are allowed.
- Translating the existing auth screens or changing `<html lang>` in `Layout.astro`. Only the new UI is Polish.
- Generated Supabase DB types (`supabase gen types`). A hand-written `Child` type is enough for one table.
- A DB-level RLS test suite (pgTAP). Isolation is verified through the smoke test.
- Automated migration deploys from CI (still parked in the roadmap).

## Implementation Approach

Build bottom-up. First the migration with RLS, verified locally. Then a thin `src/lib/children.ts` data module that both the page and the endpoint use. Then the endpoint and the page, following the existing form-POST pattern, plus the landing redirects. Last, the smoke test extension and the runbook step. Every Supabase query runs under the user's session, so correctness depends on the RLS policies, not on filters in the app. The app still sets `user_id` explicitly on insert so an insert fails clearly instead of relying on a column default.

## Critical Implementation Details

**Birth-date "future" check vs. time zones**: Workers run in UTC while the parent is in Poland (UTC+1/+2). Between local midnight and 01:00/02:00, "today" in Poland is already "tomorrow" in UTC. Server validation should reject only dates **more than one day after** the server's UTC date. The client `max` attribute uses the browser's local date. Do not use a DB `CHECK (birth_date <= current_date)`: it isn't immutable-safe, and it has the same time-zone problem.

**Smoke-test order**: the isolation check needs user A's child name to be unique per run (e.g. `Smoke-Dziecko-${Date.now()}`), and user B must be a fresh account signed in *after* user A signs out. Otherwise the cookie jar still holds A's session.

## Phase 1: Data layer

### Overview

Create the `children` table with owner-only RLS and a typed data-access module.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<YYYYMMDDHHMMSS>_create_children.sql` (create via `npx supabase migration new create_children`)

**Intent**: Introduce the first application table, owned by an auth user and readable/insertable only by that user.

**Contract**: table `public.children`:
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `name text not null` with `check (char_length(btrim(name)) between 1 and 100)`
- `birth_date date null`
- `created_at timestamptz not null default now()`
- index on `(user_id, created_at)`
- `alter table ... enable row level security`
- policy `select` to `authenticated` using `(select auth.uid()) = user_id`
- policy `insert` to `authenticated` with check `(select auth.uid()) = user_id`
- No update/delete policies, and no grants to `anon` beyond Supabase defaults (RLS denies them).

#### 2. Children data module

**File**: `src/lib/children.ts`

**Intent**: One place for the `Child` shape and the two queries, so the page, the endpoint and later S-02 share them.

**Contract**:
- `export interface Child { id: string; name: string; birth_date: string | null; created_at: string }`
- `listChildren(supabase): Promise<Child[]>`: selects `id, name, birth_date, created_at`, ordered by `created_at` ascending, relying on RLS (no user filter needed). Throws/returns an error on a query failure rather than an empty list.
- `createChild(supabase, userId, { name, birthDate })`: inserts one row with an explicit `user_id` and returns the error, if any.
- `supabase` is the return type of `createClient` (non-null). Type results so the type-checked ESLint rules pass (no `any` leaks).

### Success Criteria:

#### Automated Verification:

- Migration applies on a clean DB: `npx supabase db reset`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification:

- In Supabase Studio (local), `public.children` shows RLS enabled with exactly two policies (select, insert)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Children page and flow

### Overview

Wire the create endpoint, rebuild `/dashboard` as the Polish children list + add form, and send logged-in users there.

### Changes Required:

#### 1. Create endpoint

**File**: `src/pages/api/children.ts`

**Intent**: Handle the add-child form POST with server-side validation, mirroring the auth endpoints' redirect-with-error pattern.

**Contract**: `POST /api/children`, form fields `name` (required) and `birth_date` (optional, `YYYY-MM-DD`).
- Trim `name`. Reject if empty or longer than 100 characters.
- Reject `birth_date` if it is not a valid calendar date or is more than 1 day after the server's UTC today.
- On a validation or DB error, `302` to `/dashboard?error=<encoded Polish message>`. On success, `302` to `/dashboard`.
- If Supabase isn't configured, use the same error redirect as the auth endpoints.
- Uses `context.locals.user.id` as `user_id`.

#### 2. Route protection

**File**: `src/middleware.ts`

**Intent**: Anonymous requests must never reach the create endpoint.

**Contract**: `PROTECTED_ROUTES` becomes `["/dashboard", "/api/children"]`. Anonymous requests get `302` to `/auth/signin`.

#### 3. Add-child form island

**File**: `src/components/children/AddChildForm.tsx`

**Intent**: Client-side validated form, following the `SignInForm` structure and reusing `FormField`, `ServerError` and `SubmitButton`.

**Contract**:
- Props: `{ serverError?: string | null }`.
- Posts to `/api/children`.
- Fields: `name` (label "Imię", required, max 100) and `birth_date` (label "Data urodzenia (opcjonalnie)", `type="date"`, `max` = browser-local today).
- Polish validation messages. Submit text "Dodaj dziecko", pending text "Dodawanie...".
- Lucide icons for the fields (e.g. `User`, `Calendar`).

#### 4. Dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the starter placeholder with the children list and the add form, keeping the existing visual style and the sign-out button.

**Contract**:
- `Layout` title "Moje dzieci". Heading "Moje dzieci". Keep the user email and the sign-out form.
- Server-side `listChildren`. Render each child's name and, if set, the birth date formatted `dd.mm.rrrr`.
- Empty state: "Nie dodano jeszcze żadnego dziecka."
- If the list query fails, show an error message instead of the empty state, so a failure is never mistaken for "no children".
- `<AddChildForm serverError={Astro.url.searchParams.get("error")} client:load />`.

#### 5. Landing redirects

**Files**: `src/pages/api/auth/signin.ts`, `src/pages/index.astro`

**Intent**: A logged-in parent goes straight to their children instead of the starter Welcome page.

**Contract**:
- `signin.ts` redirects to `/dashboard` on success.
- `index.astro` returns `Astro.redirect("/dashboard")` when `Astro.locals.user` is set. Anonymous visitors still see the Welcome page.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`

#### Manual Verification:

- After sign-in, the browser lands on `/dashboard` showing "Moje dzieci" and the empty state
- Adding "Ola" with no birth date, then "Jaś" with a birth date, shows both in that order; the date renders as `dd.mm.rrrr`
- Submitting an empty name shows a Polish client-side error; bypassing it (e.g. devtools) shows the Polish server error banner
- Visiting `/` while logged in redirects to `/dashboard`; visiting `/` while logged out shows the Welcome page

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Verification and deploy

### Overview

Lock the behaviour into the CI smoke test (including cross-account isolation) and make sure production gets the migration.

### Changes Required:

#### 1. Smoke test

**File**: `scripts/smoke.mjs`

**Intent**: Extend the HTTP walk to cover child creation, validation, anonymous rejection and isolation between two accounts, staying zero-dependency.

**Contract**:
- `request()` also returns the response `body` text.
- Expectations may include `bodyIncludes` / `bodyExcludes` strings.
- The existing "signin accepts correct password" step expects `location: "/dashboard"`.
- New steps (user A is the existing smoke user):
  1. Anonymous `POST /api/children` gets `302 /auth/signin` (before sign-in).
  2. After A signs in, `POST /api/children` with a unique name gets `302 /dashboard`.
  3. `GET /dashboard` returns `200` and the body includes the name.
  4. `POST /api/children` with an empty name gets `302 /dashboard?error=`.
  5. After sign-out, a second fresh user B signs up and signs in.
  6. `GET /dashboard` as B returns `200` and the body does **not** include A's child name.
- The existing sign-out/redirect-after-sign-out steps stay.

#### 2. Deploy runbook

**File**: `context/deployment/deploy-plan.md`

**Intent**: Production needs the `children` table before the new code is deployed. Otherwise `/dashboard` errors.

**Contract**: A new step before `wrangler deploy`: `npx supabase link --project-ref <ref>` (once), then `npx supabase db push`. Include a note that every future migration needs this step before deploying the code that depends on it.

### Success Criteria:

#### Automated Verification:

- Smoke passes locally against `npm run preview` with local Supabase: `BASE_URL=http://localhost:4321 npm run smoke`
- Lint passes: `npm run lint`
- CI `ci` and `smoke` jobs are green on the PR

#### Manual Verification:

- Migration pushed to the hosted Supabase project and the deployed app shows "Moje dzieci" after sign-in
- With two real accounts on production, each sees only its own children

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- None. The repo has no unit test runner, and adding one is out of scope for this slice.

### Integration Tests:

- `scripts/smoke.mjs` (CI `smoke` job, real local Supabase + RLS): create, list, validation error, anonymous rejection, cross-account isolation.

### Manual Testing Steps:

1. Sign up and sign in: land on `/dashboard` with the empty state.
2. Add "Ola" (no date) and "Jaś" (with date): both are listed in insertion order.
3. Submit an empty or 101-character name: a Polish error is shown and nothing is inserted.
4. Sign out, sign in as a different account: the list is empty.
5. Sign out, then POST `/api/children` anonymously (e.g. curl): redirected to sign-in.

## Performance Considerations

Negligible. There are one or two children per account, and the `(user_id, created_at)` index covers the list query.

## Migration Notes

This is the first migration in the repo. Locally and in CI it applies automatically via `supabase start` / `supabase db reset`. In production it must be pushed with `supabase db push` before `wrangler deploy` (Phase 3 runbook step). There is no existing data to migrate. Rollback: drop the table (no dependants until S-02).

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-01, `child-profiles`)
- PRD: `context/foundation/prd.md` (FR-001–FR-003, Guardrails, Access Control)
- Form-POST + island pattern: `src/pages/api/auth/signin.ts`, `src/components/auth/SignInForm.tsx`
- Route protection: `src/middleware.ts:4`
- Smoke harness: `scripts/smoke.mjs`, `.github/workflows/ci.yml`
- Deploy runbook: `context/deployment/deploy-plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer

#### Automated

- [x] 1.1 Migration applies on a clean DB: `npx supabase db reset` — a36287c
- [x] 1.2 Lint passes: `npm run lint` — a36287c
- [x] 1.3 Type check passes: `npx astro check` — a36287c

#### Manual

- [x] 1.4 In Supabase Studio (local), `public.children` shows RLS enabled with exactly two policies (select, insert) — a36287c

### Phase 2: Children page and flow

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 04f0c4e
- [x] 2.2 Type check passes: `npx astro check` — 04f0c4e
- [x] 2.3 Build passes: `npm run build` — 04f0c4e

#### Manual

- [x] 2.4 After sign-in, the browser lands on `/dashboard` showing "Moje dzieci" and the empty state — 04f0c4e
- [x] 2.5 Adding "Ola" with no birth date, then "Jaś" with a birth date, shows both in that order; the date renders as `dd.mm.rrrr` — 04f0c4e
- [x] 2.6 Submitting an empty name shows a Polish client-side error; bypassing it (e.g. devtools) shows the Polish server error banner — 04f0c4e
- [x] 2.7 Visiting `/` while logged in redirects to `/dashboard`; visiting `/` while logged out shows the Welcome page — 04f0c4e

### Phase 3: Verification and deploy

#### Automated

- [x] 3.1 Smoke passes locally against `npm run preview` with local Supabase: `BASE_URL=http://localhost:4321 npm run smoke`
- [x] 3.2 Lint passes: `npm run lint`
- [ ] 3.3 CI `ci` and `smoke` jobs are green on the PR

#### Manual

- [x] 3.4 Migration pushed to the hosted Supabase project and the deployed app shows "Moje dzieci" after sign-in
- [x] 3.5 With two real accounts on production, each sees only its own children
