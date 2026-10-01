<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: First Child Note Implementation Plan

- **Plan**: `context/changes/first-child-note/plan.md`
- **Scope**: Full plan (Phases 1–3 of 3)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-09-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 6 observations

Commits in scope: `9cbd41e` (p1), `1eb6f15` (p2), `3bcc492` (p3).

Phases 1 and 2 are fully checked off in `## Progress`. Phase 3's code-bearing criteria are checked; only 3.3 (CI green on the PR) remains `[ ]` — see F2.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

### Automated verification re-run during this review

| Criterion | Command | Result |
|---|---|---|
| 1.2 / 2.1 / 3.x | `npx astro check` | PASS — 0 errors, 0 warnings, 0 hints (40 files) |
| 1.3 / 2.2 / 3.2 | `npm run lint` | PASS — clean exit |
| 2.3 | `npm run build` | PASS — server built in 7.74s |
| 1.1 | `npx supabase db reset` | NOT RUN — local Supabase container is down; not reset unprompted |
| 3.1 | `BASE_URL=http://localhost:4321 npm run smoke` | NOT RUN — needs local Supabase + preview server |
| 3.3 | CI `ci` + `smoke` on the PR | NOT GREEN — see F2 |

Manual criteria 1.4–1.5, 2.4–2.11 and 3.4–3.6 are marked `[x]` and the diff carries observable evidence for each (RLS policy set, per-child page, two-step delete, ordering, 404 path). No rubber-stamping detected, with the exception noted in F2 for 3.4–3.6.

## Findings

### F1 — `getChild` can throw out of the page frontmatter into a bare 500

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/children/[id].astro:29`
- **Detail**: `const child = await getChild(supabase, id);` is not wrapped in try/catch, while `listNotes` nine lines below is (`:37-41`, with the `listFailed` flag the plan asked for). `getChild` is documented to throw on query failure (`src/lib/children.ts:49-51`). A transient PostgREST failure — or a deploy landing before `supabase db push` — therefore throws out of frontmatter and Astro serves a bare 500, while the identical failure one line later renders the friendly Polish "Nie udało się wczytać notatek." panel. `src/pages/dashboard.astro:15-19` sets the pattern the page only half-follows. Related and in the same fix: `[id].astro:26` maps a `createClient` null (a *configuration* failure) to 404, whereas `dashboard.astro:20-22` maps it to `listFailed` — telling a parent their child does not exist because an env var is missing.
- **Fix**: Wrap `getChild` in the same try/catch as `listNotes` and render the load-failure panel (or a 503) on a thrown error; reserve 404 for a `null` result. Map the `!supabase` branch to the same failure state rather than 404.
- **Decision**: FIXED — `getChild` wrapped in try/catch returning a Polish 503; the `!supabase` branch now returns the same 503 instead of 404; only a `null` result and a malformed id remain 404. The two 503 responses are written out inline rather than shared through a helper: every use of such a helper sits after a top-level `return`, which the Astro language server loses track of, reporting it as unused on every `astro check`. Verified: `astro check` 0/0/0, `npm run lint` clean, `npm run build` passes.

### F2 — Production was deployed from unpushed commits; CI has never run on this code

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: N/A (repository state)
- **Detail**: All three feature commits (`9cbd41e`, `1eb6f15`, `3bcc492`) are unpushed on local `master` (`git log @{u}..HEAD`). There is no PR, so criterion 3.3 ("CI `ci` and `smoke` jobs are green on the PR") cannot be true and is correctly left `[ ]`. But 3.4–3.6 are marked `[x]`, meaning the migration was pushed to hosted Supabase and the Worker deployed and manually verified — i.e. this release reached production before CI ever ran `lint` / `astro check` / `build` / the 15 new smoke steps against a fresh Supabase (`.github/workflows/ci.yml:26-56`). The smoke walk is this repo's only automated regression net; running it post-deploy inverts the plan's own Phase 3 ordering. The local re-runs above cover `lint`/`check`/`build`, but not the smoke job.
- **Fix A ⭐ Recommended**: Push `master` (CI triggers on `push: branches: [master]`, not only on PRs), confirm both jobs green, then check off 3.3.
  - Strength: The workflow already runs on push to master, so this needs no PR ceremony and closes the gap in one step; it also gets the three commits off a single machine.
  - Tradeoff: If `smoke` fails, it fails against code already live in production — you find out after the fact rather than before.
  - Confidence: HIGH — the trigger is explicit at `.github/workflows/ci.yml:3-7`.
  - Blind spot: Whether the GitHub secrets `SUPABASE_URL` / `SUPABASE_KEY` the `ci` job needs are still configured on this repo.
- **Fix B**: Run the smoke walk locally first (`npx supabase start`, `npm run build`, `npm run preview`, `BASE_URL=http://localhost:4321 npm run smoke`), then push.
  - Strength: Catches a regression on your machine before it is published, and re-validates 3.1 which this review could not re-run.
  - Tradeoff: Slower, needs Docker up; still does not exercise the CI environment itself.
  - Confidence: MEDIUM — depends on the local Supabase stack starting cleanly.
  - Blind spot: Haven't verified the local stack currently has the migration applied.
- **Decision**: FIXED via Fix A — `master` pushed (`ee7228d..3bcc492`); CI run 36623683302 completed **success** with both jobs green (`ci: success`, `smoke: success`), so the 15 new smoke steps and the cross-account isolation cases are now validated against a fresh Supabase on the exact commit that is deployed. Criterion 3.3 checked off in the plan. The ordering gap (deploy preceded CI) stands as a process note, not an open defect.

### F3 — `@typescript-eslint/no-misused-promises` disabled for every `.astro` file, outside the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: `eslint.config.js:67-71`
- **Detail**: An unplanned 5-line change turns the rule off for `**/*.astro`. The stated justification was independently reproduced: running the rule against `src/pages/children/[id].astro` aborts the whole ESLint run with `Non-null Assertion Failed: Expected node to have a parent` at `checkReturnStatement`, triggered by the top-level frontmatter `return` at `:19`, on exactly the cited `typescript-eslint@8.70.0` / `astro-eslint-parser@3.1.0`. So this is a real parser crash, not a silenced finding, and an inline `/* eslint-disable */` would *not* have helped (directives filter reported problems after the rule has already thrown). The rule was also re-run enabled against all ten other `.astro` files: zero findings, so nothing is hidden today, and `no-floating-promises` — the rule that catches the realistic frontmatter mistake — remains on via `strictTypeChecked`. Two things still count against it: the exemption is repo-wide and permanent when only one file needs it, and a lint rule switched off for a whole file type is recorded nowhere but a commit body.
- **Fix A ⭐ Recommended**: Replace the blanket disable with a file-scoped config block (`files: ["src/pages/children/**/*.astro"]`) after `astroConfig`, and record the workaround in the plan or `context/foundation/lessons.md` with a pointer to the upstream parser issue.
  - Strength: Keeps the rule live on the ten `.astro` files verified clean, shrinks the exemption to the one file that actually crashes, and puts the decision somewhere a future reader will find it.
  - Tradeoff: Every future page that 404s or redirects from frontmatter must be added to the list — though that friction is itself a useful reminder the workaround exists.
  - Confidence: HIGH — a config-block override suppresses the rule before registration, which is the mechanism that works here.
  - Blind spot: Not verified whether the upstream issue is already fixed in a newer `astro-eslint-parser`; a dependency bump may remove the need entirely.
- **Fix B**: Keep the blanket disable as-is, and only add the note to `lessons.md`.
  - Strength: No further churn; the blanket form never needs maintenance as new 404-serving pages arrive.
  - Tradeoff: Permanently removes the rule's guard from all Astro frontmatter, including files that would pass today.
  - Confidence: MEDIUM — safe now, but the exemption outlives the bug that motivated it.
  - Blind spot: Nothing will signal when the parser bug is fixed and the disable can be dropped.
- **Decision**: FIXED via Fix A — the disable moved out of `astroConfig` into a new `astroEarlyReturnConfig` block scoped to `src/pages/children/**/*.astro`, inserted after `astroConfig` in the export so the a11y rules still survive. Verified with `eslint --print-config`: the rule resolves to `2` (error) for `src/pages/dashboard.astro` and every other `.astro` file, and `0` (off) only under `src/pages/children/`. `npm run lint` passes. Also recorded as a new entry in `context/foundation/lessons.md` (file created; `Rule` and `Applies to` left as placeholders for the user).

### F4 — Per-child page hand-rolls its error banner instead of reusing `ServerError`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/children/[id].astro:57-59`
- **Detail**: `dashboard.astro:61` passes `error` into the island as `serverError`, which renders the shared `ServerError` component — a red panel with a `CircleAlert` icon. `[id].astro` instead emits a bare `<p class="… text-red-300">{error}</p>` with no icon. The plan's "the page owns error display" decision is correctly implemented and well-justified (an error here can originate from add, edit or delete), but owning the *placement* did not require abandoning the *component*, so the same concept now has two visual treatments across two pages. Also, neither panel carries `role="alert"` / `aria-live`.
- **Fix**: Render `<ServerError message={error} />` at the page level in `[id].astro`, keeping its current position above the notes list.
- **Decision**: FIXED — the hand-rolled `<p>` replaced with `<ServerError message={error} />` rendered statically (no client directive; nothing in the panel is interactive), wrapped in a `mt-6` div to keep its position above the notes list. `role="alert"` deliberately not added here — that would change `dashboard.astro` too and belongs with F9. Verified: `astro check` 0/0/0, lint clean, build passes.

### F5 — Undelete and `occurred_at` immutability are handler-only, and the smoke walk does not assert either

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260927205447_create_notes.sql:49-66`
- **Detail**: This is exactly the posture the plan predicted and accepted (Implementation Approach, point 2) — recording it because the review confirms it rather than because it is drift. `notes_update_own` pins `user_id` and `child_id` in both `using` and `with check`, but nothing pins `deleted_at`, `occurred_at` or `created_at`; a row-level policy restricts rows, not columns. The handlers are disciplined (`src/lib/notes.ts:69` writes only `{content, updated_at}`, `:88` only `{deleted_at}`, and `src/pages/api/notes/[id].ts:54` explicitly ignores a submitted `occurred_at`), so the only live guarantee is that `SUPABASE_KEY` never reaches a browser (`src/lib/supabase.ts:3`, `astro:env/server`). That is an unusual posture for a Supabase anon key and would be quietly undone by any future browser-side Supabase client. Two related gaps the plan did *not* explicitly accept: `scripts/smoke.mjs` never asserts that a raw `DELETE` is refused, and never asserts that an edit leaves `occurred_at` untouched — so the two guarantees weakest at the DB level are the two with no automated test. Separately, the `user_id … on delete cascade` to `auth.users` (`:7`) is a real path to physical destruction, reachable only out-of-band via the Auth admin API or service-role key (which this app never uses); the `child_id` cascade (`:8`) is unreachable because `children` has no delete policy and no delete route.
- **Fix A ⭐ Recommended**: Add the two missing smoke assertions now (edit leaves `occurred_at` unchanged; a direct `DELETE` is refused) and record the `auth.users` cascade in the migration's header comment. Leave the DB-level hardening for when a browser-side client is actually introduced.
  - Strength: Turns a documented assumption into a tested one at near-zero cost, and makes a future `for all` policy fail a test instead of silently granting delete.
  - Tradeoff: The underlying column-level gap stays open; you are testing the handlers, not the database.
  - Confidence: HIGH — both assertions fit the existing `bodyIncludes` / status-expectation shape the script already uses.
  - Blind spot: Asserting a refused `DELETE` may need a direct PostgREST call rather than an app route, which the zero-dependency smoke script does not currently make.
- **Fix B**: Move the guarantee into Postgres now — column-scoped grants (`revoke update on public.notes from authenticated; grant update (content, updated_at, deleted_at) …`) or a `before update` trigger rejecting `old.deleted_at is not null and new.deleted_at is null` and a changed `occurred_at`.
  - Strength: Makes "notes are never lost and never silently re-dated" true regardless of which client talks to PostgREST, exactly as the plan's own fallback suggested.
  - Tradeoff: A second migration and new SQL surface for a risk whose practical exposure is currently nil; the plan deliberately deferred this.
  - Confidence: MEDIUM — the grant approach interacts with the soft-delete write, so it needs the `deleted_at` column included and the whole path re-smoked.
  - Blind spot: Not verified how Supabase's default `authenticated` grants interact with a `revoke` on an existing table.
- **Decision**: PENDING

### F6 — Add-note form prefills device-local time while the server validates Warsaw time

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/notes/AddNoteForm.tsx:15-20`
- **Detail**: `localNow()` builds the default and `max` from the device's zone (`now.getHours()`), but `src/pages/api/notes.ts:65` validates against `warsawWallClock(...)`. For a device ahead of Warsaw the form prefills a value the server then rejects with "Data i godzina nie mogą być w przyszłości", and client-side `validate()` (`:43`) passes because it compares device-local to device-local — so the failure only appears after the round trip, and the 5-minute tolerance is nowhere near enough to absorb an hours-wide offset. This matches the plan's contract verbatim ("prefilled with the browser's current local time") and is covered by the explicit "No multi-time-zone support" exclusion, so it is a plan-level assumption surfacing, not drift. It bites a Poland-based parent travelling abroad. Two checks the agents verified as *correct* and worth not second-guessing: the 5-minute tolerance logic is sound (both operands are same-zone fixed-width strings, `Intl` handles DST), and `formatWallClock`'s slicing is separator-agnostic at index 10, so it renders correctly for both the `T` and space serializations.
- **Fix**: Have `localNow()` use `Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw", … })` — the `warsawWallClock` helper already exists in `src/lib/wall-clock.ts` — so client and server agree on the clock.
- **Decision**: PENDING

### F7 — `softDeleteNote` does not bump `updated_at`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/notes.ts:88`
- **Detail**: The soft delete stamps `deleted_at` only, while `updateNoteContent:69` bumps `updated_at`. From `updated_at` alone you cannot tell when a note was removed versus last edited — a gap in the audit trail the soft-delete design exists to preserve.
- **Fix**: Include `updated_at: new Date().toISOString()` in the `softDeleteNote` update payload.
- **Decision**: PENDING

### F8 — `CONTENT_MAX_LENGTH` duplicated across five sites, including the DB check constraint

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/notes.ts:7`, `src/pages/api/notes/[id].ts:5`, `src/components/notes/AddNoteForm.tsx:7`, `src/components/notes/NoteItem.tsx:7`, `supabase/migrations/20260927205447_create_notes.sql:9`
- **Detail**: The 2000 limit is written out five times with no shared source. `NAME_MAX_LENGTH` has the same shape at two sites, so this follows house style — but at five sites the drift risk is materially worse, and a handler/DB mismatch surfaces as an opaque PostgREST error instead of the Polish message.
- **Fix**: Export `CONTENT_MAX_LENGTH` once from `src/lib/notes.ts` and import it in the four TypeScript sites; leave the SQL check with a comment pointing at it.
- **Decision**: PENDING

### F9 — `jsx-a11y` rules never run against the `.tsx` islands

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `eslint.config.js:42-58`
- **Detail**: `eslintPluginAstro.configs["flat/jsx-a11y-recommended"]` is scoped to `**/*.astro`, and `reactConfig` (`files: ["**/*.{js,jsx,ts,tsx}"]`) does not extend jsx-a11y — so a11y linting never sees the islands, which is where all interactive UI lives. The plan's Testing Strategy explicitly expected otherwise: "`npm run lint` covers the islands, including the `jsx-a11y` rules the edit and delete controls must satisfy." It does not. Consequently nothing flagged `NoteItem.tsx:41`'s `aria-label="Treść notatki"` on the edit textarea where every other field in the repo uses a visible `<label htmlFor>` (`TextAreaField.tsx:39`, `FormField.tsx:41`), the missing `role="alert"` on the error panels, or that entering edit mode (`NoteItem.tsx:65`) never moves focus into the textarea. Pre-existing config gap, surfaced by this change.
- **Fix**: Add the jsx-a11y plugin and its recommended rules to `reactConfig` in `eslint.config.js`, then fix whatever it reports in the new islands.
- **Decision**: PENDING

### F10 — `supabase/snippets/Untitled query 234.sql` is untracked and not ignored

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `supabase/snippets/Untitled query 234.sql`
- **Detail**: A Supabase Studio scratch file (`select count(*) from public.notes;`, written during Phase 1 manual verification). Neither the root `.gitignore` nor `supabase/.gitignore` covers `snippets`, so the next `git add .` commits it, and every future Studio session will keep dirtying `git status` with more `Untitled query N.sql` files.
- **Fix**: Delete the file and add `snippets` to `supabase/.gitignore`, alongside the existing `.branches` / `.temp` entries.
- **Decision**: PENDING

## Verified correct (no finding)

Recorded so these are not re-litigated in a later review:

- **No `delete` policy** on `notes`, and the explicit `exists (select 1 from public.children c where c.id = child_id and c.user_id = (select auth.uid()))` predicate is present in the `insert` policy and in **both** `using` and `with check` of the update policy — the two load-bearing guardrails are intact and correctly phrased.
- **Open redirect / header injection**: `child_id` and `note_id` are `UUID_RE`-validated before any `Location` header is built (`api/notes.ts:32`, `api/notes/[id].ts:28,35`), and every message goes through `encodeURIComponent`. No CRLF or off-site redirect is reachable.
- **RLS coverage** for all four new queries, with `user_id` sourced from `supabase.auth.getUser()` via `src/middleware.ts:14` — a server-verified identity, not a decoded cookie claim.
- **`formatWallClock`** slicing is correct for the actual PostgREST serialization (and separator-agnostic at index 10), and the **5-minute future tolerance** compares two same-zone fixed-width strings, so the lexicographic compare is chronologically sound. Both were reproduced empirically, not inferred.
- **Partial index** matches `listNotes` column-for-column, including sort direction and the `deleted_at is null` predicate.
- **All nine "What We're NOT Doing" exclusions respected** — no edit history, no "edited" marker, no date editing, no hard delete, no notes on the dashboard, no search/pagination, no embedding columns, no multi-TZ, no generated types or unit-test framework.
- **No planned change missing.** The only true plan drift is `NoteItem.tsx` using one form with `name="intent"` submit buttons instead of the two forms the plan described — functionally equivalent and strictly better for Phase 3's id extraction, since the action is in the server-rendered markup even in view mode.
- **Smoke walk**: all 15 planned steps present and in order, with the three prescribed structural additions (`ids` store + `extract`, GET-sourced ids, `bodyOrder`). No pre-existing step was removed, reordered or weakened; the one touched existing step gained the plan's own prescribed `extract` expectation.
