# Child Profiles — Plan Brief

> Full plan: `context/changes/child-profiles/plan.md`

## What & Why

Roadmap slice S-01 (FR-001–FR-003): a logged-in parent can add a child profile and see a list of their own children, replacing the empty starter dashboard. This is the app's first data table, and it sets the owner-only data rule ("a child's data is visible only to the logged-in account") that S-02 notes will reuse.

## Starting Point

Supabase sign-up/sign-in/sign-out already works and is smoke-tested in CI. `/dashboard` is a starter placeholder, sign-in lands on the starter Welcome page (`/`), and there are no migrations or app tables yet.

## Desired End State

After sign-in, the parent lands on `/dashboard` ("Moje dzieci"). They can add a child with a name and an optional birth date and immediately see it in a list ordered oldest-added first. Another account never sees those children, and CI checks that.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Profile fields | Name (required, 1–100 chars) + optional birth date | Birth date is cheap now and gives age context for notes/NL queries later. |
| Location | Rebuild `/dashboard`; sign-in and logged-in `/` redirect there | Reuses the already-protected route and matches the roadmap outcome. |
| Ordering / duplicates | `created_at` ascending; duplicate names allowed | Stable order and no blocking of legitimate same-name cases. |
| Isolation mechanism | Postgres RLS (select/insert only, owner = `auth.uid()`) | The client runs as the user, so RLS is the real boundary; missing update/delete policies keep data from being overwritten. |
| Isolation verification | Extend `scripts/smoke.mjs` with a second user | Runs in existing CI against real RLS with zero new dependencies. |
| UI language | Polish for new UI; auth screens untouched | Matches the actual user without expanding scope. |
| Birth-date validation | Reject only dates more than 1 day after the server's UTC date | Avoids false rejections from the UTC vs. Poland time-zone gap. |

## Scope

**In scope:**
- `children` table migration with RLS
- `src/lib/children.ts` data module
- `POST /api/children` + middleware protection
- `AddChildForm` island and rebuilt `/dashboard`
- Sign-in and `/` redirects
- Smoke test extension
- Runbook migration step

**Out of scope:**
- Edit/delete profiles
- Per-child page and notes (S-02)
- Name uniqueness
- Translating auth screens
- Generated DB types
- pgTAP tests
- CI auto-deploy of migrations

## Architecture / Approach

This follows the existing pattern: an HTML form posts to an Astro API route, which validates, inserts via the user-session Supabase client and redirects back to `/dashboard` (with `?error=` on failure). `/dashboard` renders the list server-side via `listChildren`, and RLS scopes every query to the owner. The migration lives in `supabase/migrations/`. CI applies it automatically; production gets it through `supabase db push` before `wrangler deploy`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | `children` table + RLS + typed data module | A wrong RLS policy would leak data across accounts |
| 2. Children page and flow | Endpoint, form, list page, landing redirects | Sign-in redirect change breaks the existing smoke assertion (fixed in Phase 3) |
| 3. Verification and deploy | Smoke checks for create, validation and isolation; runbook step | Forgetting `db push` before deploy breaks production `/dashboard` |

**Prerequisites:** Docker + Supabase CLI for local `supabase start` / `db reset`; access to the hosted Supabase project for `db push`.
**Estimated effort:** ~1–2 after-hours sessions across 3 phases.

## Open Risks & Assumptions

- No edit/delete means a mistyped name stays until a later slice adds editing. Accepted for the MVP.
- CI smoke runs only on PRs/pushes, so between Phase 2 and Phase 3 the existing smoke sign-in assertion (`/`) is knowingly out of date.

## Success Criteria (Summary)

- A parent signs in, adds a child, and sees it listed on "Moje dzieci".
- A second account sees none of the first account's children, and the CI smoke test checks this.
- Production runs the same schema after the documented migration step.
