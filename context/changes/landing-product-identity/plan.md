# Landing Product Identity Implementation Plan

## Overview

Roadmap slice S-05. A parent entering the site currently meets the 10x Astro Starter: an
English hero describing the template, three cards about its technical features, a browser
tab reading "10x Astro Starter", English sign-in and sign-up forms, and a link to the
template's own repository in the config-error banner. This plan replaces that entry
surface with the product — "Dziennik dziecka", in Polish — and removes the starter
leftovers that reference-verification showed to be removable.

## Current State Analysis

From `context/changes/landing-product-identity/research.md` at commit `dfabc29`:

- `src/pages/index.astro` is 8 lines: it renders `Welcome.astro` inside `Layout` and
  passes no `title`. Of the 6 `<Layout>` call sites in `src/`, it is the only one that
  omits `title`, so it is the one page showing the starter default from
  `src/layouts/Layout.astro:10`.
- `src/components/Welcome.astro` holds 10 user-visible English strings — the h1
  (`:23`), the tagline (`:26`), the two CTAs (`:33,39`) and the three template cards
  (`:62,64,85,87,107,109`).
- `src/middleware.ts:21-23` redirects `/` to `/dashboard` for a signed-in user, so the
  landing page is reached **only by signed-out visitors**.
- `src/layouts/Layout.astro:14` hardcodes `<html lang="en">` and it is the only `lang`
  assignment in `src/` — wrong for `dashboard.astro` and `children/[id].astro`, which
  already shipped in Polish.
- `src/lib/config-status.ts:16` carries the upstream template's repo URL, rendered as a
  user-visible link at `src/layouts/Layout.astro:28` whenever Supabase env vars are
  missing.
- English remains in `Welcome.astro`, `Topbar.astro` (5 strings), the chrome of
  `auth/signin.astro` and `auth/signup.astro`, `auth/confirm-email.astro` (6 strings),
  `SignInForm.tsx`, `SignUpForm.tsx`, and the `PasswordToggle.tsx:14` aria-labels.
- There is no i18n layer; every string is an inline literal.
- `src/components/ui/LibBadge.astro` is the only starter file with no reference anywhere
  in the tracked tree. `public/template.png` has exactly one, `README.md:3`.

## Desired End State

A signed-out parent opening `/` sees a Polish page naming "Dziennik dziecka", one
sentence saying what it is for, and buttons to log in or register. The browser tab says
"Dziennik dziecka". Logging in and registering happen entirely in Polish, through to the
page that follows registration. The document declares `lang="pl"`. No file remains in the
repository that exists only because the project was built on a starter and that nothing
references.

Verify by: starting the dev server, opening `/` signed out, reading the tab title and the
page, walking sign-up → confirm-email and sign-in → dashboard, and confirming
`npm run lint`, `npx astro check`, `npm run build` and `npm run smoke` all pass.

### Key Discoveries:

- `src/components/Welcome.astro:29-41` holds the **only** anonymous entry points to the
  app. Whatever replaces it must keep a route to `/auth/signin`, or `/` becomes a dead end.
- `bg-cosmic` is defined at `src/styles/global.css:113` and used by 6 files — `Welcome.astro:5`
  plus `auth/confirm-email.astro:22`, `auth/signin.astro:9`, `auth/signup.astro:9`,
  `children/[id].astro:64` and `dashboard.astro:32`. Deleting Welcome must not touch it.
- `src/components/Topbar.astro` is imported only by `Welcome.astro:2,18`. Its signed-in
  branch (`:7-19`) is unreachable from `/` because of the middleware redirect.
- `src/components/auth/` is shared form infrastructure, not auth-only: `FormField.tsx`,
  `SubmitButton.tsx` and `ServerError.tsx` take all text as props and are consumed by the
  already-Polish `AddChildForm.tsx` and `AddNoteForm.tsx`. Translating them is neither
  needed nor safe.
- Page markup lives in the page in this repo — `dashboard.astro:32+` and
  `children/[id].astro:64+` both inline their own markup rather than delegating to a
  component.
- `context/foundation/test-plan.md:202-206` places this exact slice in §7 "What We
  Deliberately Don't Test". No new test is to be written.
- `scripts/smoke.mjs:78` asserts only that `/` returns 200; `:221,263` assert that
  sign-out redirects to `/`. Copy changes do not touch either.

## What We're NOT Doing

- **Not touching the cosmic visual theme.** Dark background, light orbs and star field
  stay, by the explicit roadmap decision at `context/foundation/roadmap.md:113`. The screen
  stops *saying* "starter template"; it still *looks* like one. A retheme is a separate change.
- **Not renaming `supabase/config.toml:5`.** The `project_id` drives local Docker container
  names, and `context/changes/testing-isolation-boundary/change.md:32` pins
  `supabase_db_10x-astro-starter` as the container that change's commands target. It is not
  user-facing, and that change is mid-implementation.
- **Not renaming `package.json:2`.** It never reaches the browser, and renaming it churns
  `package-lock.json` for no user-visible gain.
- **Not replacing `public/favicon.png`.** The roadmap outcome does not name the favicon, and
  it is a visual asset like the theme. It stays linked at `Layout.astro:18`.
- **Not deleting `public/.assetsignore`.** No reference exists in the tracked tree, but it is
  a Cloudflare Workers-assets convention file read by Wrangler, not by import. Deleting it is
  a deploy risk with no upside for this slice.
- **Not deleting `CLAUDE.md.scaffold`.** It is a provenance record referenced by
  `context/changes/bootstrap-verification/verification.md:53-54`, not an unused artifact.
- ~~**Not translating the 5 "Supabase is not configured" sites or mapping raw Supabase
  GoTrue error text to Polish.**~~ **Reversed during Phase 2 (2026-10-04)** at the user's
  request, after a wrong-password attempt surfaced "Invalid login credentials" in the UI.
  The original objection — that a map keyed on upstream English wording breaks silently when
  Supabase rewords — does not apply to `error.code`, a stable typed union in
  `@supabase/auth-js` (supabase-js 2.116.0). Now in scope; see Phase 2 change #6.
- **Not adding a password-recovery link.** No recovery flow exists, by a decision recorded at
  `context/foundation/test-plan.md:219-221`.
- **Not introducing an i18n library or locale switching.** Polish is the only language;
  inline literals match the existing repo pattern.
- **Not writing automated tests.** `context/foundation/test-plan.md:202-206` excludes this
  slice; `:207-210` excludes snapshot and visual-regression tests.
- **Not changing the `/` → `/dashboard` redirect** at `src/middleware.ts:21-23`.

## Implementation Approach

Three phases, each independently verifiable and each a commit. Phase 1 replaces the entry
surface, Phase 2 translates the auth walk, Phase 3 clears the remaining traces. The ordering
matters in one place only: Phase 1 removes the last usage of `Topbar.astro`, so both it and
`Welcome.astro` are deleted inside Phase 1 rather than deferred to the cleanup phase —
otherwise Phase 1 would end by *creating* two unused files, which is the condition this slice
exists to remove.

Landing copy follows the agreed shape: product name, one sentence drawn from PRD §Vision
(`context/foundation/prd.md:17-21`), and the two CTAs. The three cards do not come back in
any form — one of them would have had to advertise FR-006 search, which does not exist.

Page titles follow the convention already set by `dashboard.astro:31` (`"Moje dzieci"`):
bare page names, no product suffix. The product is named by the `Layout` default, which the
landing inherits.

## Critical Implementation Details

**Deletion order within Phase 1.** Rewrite `src/pages/index.astro` first, then delete
`src/components/Welcome.astro` and `src/components/Topbar.astro`. Deleting first breaks the
import at `index.astro:2` and leaves the build red between edits. Before each deletion,
re-run `git grep -n -i "<name>" -- . ':!package-lock.json'` and confirm the only remaining
hits are prose in `context/`.

**`bg-cosmic` is not Welcome's.** The new landing markup should keep using it — it is the
shared page-background utility the five other pages use. Do not inline the starter's orb and
star-field divs into `index.astro` and do not remove the utility from
`src/styles/global.css:113`.

## Phase 1: Product identity on the entry surface

### Overview

Replace the starter landing with the product landing, name the product in the default tab
title, declare the document Polish, and delete the two components the rewrite orphans.

### Changes Required:

#### 1. The landing page

**File**: `src/pages/index.astro`

**Intent**: Render the product's entry page directly in the page file, replacing the
`<Welcome />` delegation. A signed-out parent must learn what the product is and reach
sign-in or sign-up from here; a signed-in one never arrives, because the middleware
redirects.

**Contract**: The page keeps `<Layout>` and passes **no** `title`, inheriting the new
product default. Its root element keeps the `bg-cosmic` background class, matching
`dashboard.astro:32`. Content is: an `h1` reading `Dziennik dziecka`; one sentence of
supporting copy derived from `context/foundation/prd.md:17-21` — the product records
small free-form facts about a child and finds them again when they are needed; and two
links, `/auth/signin` labelled `Zaloguj się` and `/auth/signup` labelled `Zarejestruj się`,
styled as the primary and secondary buttons currently at `Welcome.astro:29-41`. No feature
cards and no top bar.

#### 2. Document title and language

**File**: `src/layouts/Layout.astro`

**Intent**: Make the product the default name of any page that does not set its own, and
declare the document Polish so assistive technology and the browser treat the already-Polish
pages correctly.

**Contract**: `:10` — the `title` prop default becomes `"Dziennik dziecka"`. `:14` — `<html
lang="en">` becomes `<html lang="pl">`. The `title?: string` prop signature and the
`<title>{title}</title>` render at `:19` are unchanged; the five pages that pass an explicit
title keep theirs.

#### 3. Delete the orphaned starter components

**Files**: `src/components/Welcome.astro`, `src/components/Topbar.astro`

**Intent**: Both exist only to render the starter's landing. After change 1, `Welcome.astro`
has no importer and `Topbar.astro` has no importer other than Welcome. Leaving either would
replace one unused starter file with two.

**Contract**: Both files are removed. `src/styles/global.css:113` (`@utility bg-cosmic`) is
untouched — it is used by five other pages. No other file imports either component; re-verify
with `git grep` before deleting.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type and template checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- `git grep -n -i "Welcome\.astro\|Topbar" -- src/` returns no hits
- Smoke walk passes against a local preview: `npm run smoke`

#### Manual Verification:

- Signed out, `/` shows the Polish product page with no template cards, and the browser tab reads "Dziennik dziecka"
- Both landing buttons reach `/auth/signin` and `/auth/signup`
- Signed in, `/` still redirects to `/dashboard`
- Page source declares `<html lang="pl">`, and `/dashboard` still shows the title "Moje dzieci"

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase. Phase blocks use plain bullets — the corresponding
`- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Polish auth flow

### Overview

Translate every screen a parent walks through to get into the app: the two form pages, the
page registration lands on, and the two React forms with their validation messages.

### Changes Required:

#### 1. Auth page chrome

**Files**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`

**Intent**: Put the page headings, the cross-links between sign-in and sign-up, and the tab
titles into Polish, matching the bare-page-name title convention from `dashboard.astro:31`.

**Contract**: `signin.astro` — `:8` title `"Logowanie"`, `:12` h1 `Logowanie`, `:16` prompt
`Nie masz jeszcze konta?`, `:18` link text `Zarejestruj się`. `signup.astro` — `:8` title
`"Rejestracja"`, `:12` h1 `Rejestracja`, `:16` prompt `Masz już konto?`, `:18` link text
`Zaloguj się`. The `?error=` read at `:5` and the `serverError` prop passed at `:14` are
unchanged in both. No "forgot password" link is added.

#### 2. Post-registration page

**File**: `src/pages/auth/confirm-email.astro`

**Intent**: Translate both branches of the dev/prod ternary. `src/pages/api/auth/signup.ts:19`
redirects here immediately after registration, so this is the first page a new parent sees —
leaving it English would end a Polish form on an English screen.

**Contract**: The `import.meta.env.DEV` branch at `:6-18` keeps its shape — `heading`,
`description` and the link label — with Polish values in both arms. Dev arm: heading
`Konto założone`, description stating the account exists and the parent can now log in, link
label `Przejdź do logowania`. Prod arm: heading `Sprawdź skrzynkę`, description stating a
confirmation link was sent and must be clicked to activate the account, link label `Wróć do
logowania`. The heading continues to feed the `<Layout title={content.heading}>` at `:21`.
Decorative emoji at `:8,14` are unaffected.

#### 3. Sign-in form

**File**: `src/components/auth/SignInForm.tsx`

**Intent**: Translate labels, placeholders, button and client-side validation messages. The
form's structure, the shared `FormField` / `ServerError` / `SubmitButton` components and the
`serverError` prop are untouched.

**Contract**: Labels `:47` `Email` and `:60` `Hasło`; placeholders `:53` unchanged
(`you@example.com` is not English prose) and `:67` `Twoje hasło`; `:82` pending text
`Logowanie...`, `:83` button `Zaloguj się`. Validation: `:21` `Email jest wymagany`, `:23`
`Podaj poprawny adres email`, `:26` `Hasło jest wymagane`. Message wording follows the
existing Polish validation style in `AddChildForm.tsx:36-41`.

#### 4. Sign-up form

**File**: `src/components/auth/SignUpForm.tsx`

**Intent**: Same translation pass, including the live character-count hint, whose English
pluralisation does not survive a word-for-word translation.

**Contract**: Labels `:70` `Email`, `:83` `Hasło`, `:107` `Powtórz hasło`; placeholders `:90`
`Min. 6 znaków`, `:114` `Wpisz hasło ponownie`; `:129` pending text `Tworzenie konta...`,
`:130` button `Załóż konto`. Validation: `:26` `Email jest wymagany`, `:28` `Podaj poprawny
adres email`, `:32` `Hasło jest wymagane`, `:34` `Hasło musi mieć co najmniej 6 znaków`,
`:38` `Potwierdź hasło`, `:40` `Hasła nie są takie same`. The live hint at `:60-61` is
restated in a form that needs no plural branching — phrase it as a count of remaining
characters rather than an English-style singular/plural pair.

#### 6. Polish auth error text and config messages

**File**: `src/lib/auth-errors.ts` (new), `src/pages/api/auth/signin.ts`,
`src/pages/api/auth/signup.ts`, `src/pages/api/children.ts`, `src/pages/api/notes.ts`,
`src/pages/api/notes/[id].ts`

**Intent**: Stop English reaching the parent through the error panel. Supabase returns its
own messages in English, and the five `"Supabase is not configured"` literals are English
too. Added mid-phase after the original plan excluded this; see "What We're NOT Doing".

**Contract**: A new `src/lib/auth-errors.ts` exports
`authErrorMessage(error: AuthError, fallback: string): string`, keyed on `error.code` — the
stable typed union from `@supabase/auth-js`, not on `error.message`. It covers only codes
reachable from `signInWithPassword` and `signUp` with email+password; any other code returns
the caller's `fallback`, so no English escapes. `api/auth/signin.ts` and
`api/auth/signup.ts` call it with fallbacks "Nie udało się zalogować. Spróbuj ponownie."
and "Nie udało się założyć konta. Spróbuj ponownie." respectively. All five
`"Supabase is not configured"` literals become `"Aplikacja nie jest poprawnie skonfigurowana"`.
The `?error=` redirect shape and every success redirect are unchanged.

#### 5. Password visibility toggle

**File**: `src/components/auth/PasswordToggle.tsx`

**Intent**: Translate the accessible name. It is not visible text, but a screen reader
announces it, and this component is used only by the two auth forms.

**Contract**: `:14` — the `aria-label` ternary becomes `Ukryj hasło` / `Pokaż hasło`. The
`visible` prop and the icon swap are unchanged.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type and template checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Smoke walk passes unchanged, including the sign-in redirect to `/dashboard` and the sign-out redirect to `/`: `npm run smoke`
- `git grep -n "Sign in\|Sign up\|Signing in\|Creating account\|Show password\|Hide password" -- src/` returns no hits
- `git grep -n "Supabase is not configured" -- src/` returns no hits

#### Manual Verification:

- `/auth/signin` and `/auth/signup` are fully Polish, including tab titles, and the links between them work
- Submitting each form empty shows Polish validation messages
- Registering a new account lands on a Polish confirm-email page, and its link returns to sign-in
- The password eye toggle still shows and hides the password
- Signing in with correct credentials still reaches `/dashboard`
- Signing in with a wrong password shows a Polish message, not Supabase's English text

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 3: Remove the remaining starter traces

### Overview

Clear what is left: the template's repo link in the config banner, the one genuinely
unreferenced component, the template screenshot, and the README that still presents the
repository as the starter.

### Changes Required:

#### 1. Starter link in the config-error banner

**File**: `src/lib/config-status.ts`

**Intent**: Remove the user-visible link to the template's own repository. It is rendered at
`src/layouts/Layout.astro:28` whenever Supabase env vars are missing, which would show a
parent the starter's GitHub page. No product documentation page exists to point at instead,
so the link goes rather than moves.

**Contract**: Drop the `docsUrl` and `docsLabel` entries from the single `configStatuses`
item at `:12-18`. The `ConfigStatus` interface keeps both as optional (`:7-8`), and
`Layout.astro:25-33` already guards rendering on `cfg.docsUrl`, so the banner degrades to
message-only with no change in the layout. The Polish `message` at `:15` stays as it is.

#### 2. Delete the unreferenced starter component

**File**: `src/components/ui/LibBadge.astro`

**Intent**: A generic library-version badge from the starter's showcase. It is the one file
on the leftover list with no importer, no href and no config reference anywhere in the
tracked tree.

**Contract**: The file is removed. Re-verify immediately before deleting with
`git grep -n -i "libbadge" -- . ':!package-lock.json'` — the only acceptable remaining hit
is the prose line in `context/foundation/roadmap.md:60`.

#### 3. Template screenshot and README

**Files**: `public/template.png`, `README.md`, `AGENTS.md`

**Intent**: `template.png` is the starter's own screenshot, referenced only by the README
line that embeds it. The README presents the repository as the 10x Astro Starter — title,
screenshot, "starter template" description and a clone URL pointing at the upstream repo.
Rewrite it as the product's README and delete the image in the same step, so the README never
renders a broken image.

**Contract**: `public/template.png` is deleted together with `README.md:3`, which is its only
reference. `README.md` becomes the product's: `:1` title names Dziennik dziecka, `:5`
describes the product rather than a starter template, and `:26-27` point at this repository
(`https://github.com/mrczeg1991/dziennik-dziecka.git`) rather than
`przeprogramowani/10x-astro-starter`. Existing setup, scripts and local-development sections
stay accurate — verify the commands they list still match `package.json`. `:181`, which
describes a script guarding "the development of the starter itself", is reworded or dropped
to match what the script actually does in this repository.

`AGENTS.md:3` was added to this change mid-phase: its opening sentence declared the
repository to be "10x Astro Starter", which is false and misleads any agent reading it
first. It now names Dziennik dziecka. This went beyond the agreed "user-visible plus
README" scope by explicit decision, after gate 3.5 surfaced it.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type and template checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- Smoke walk passes: `npm run smoke`
- `git grep -n -i "10x.astro.starter\|przeprogramowani\|template\.png\|libbadge" -- . ':!package-lock.json' ':!context/' ':!.claude/' ':!CLAUDE.md'` returns hits only in `package.json:2` and `supabase/config.toml:5`, both deliberately out of scope. `CLAUDE.md` is excluded because its only matches are the `<!-- BEGIN/END @przeprogramowani/10x-cli -->` markers delimiting a CLI-managed block — a tool name, not starter branding, and removing them would break that block

#### Manual Verification:

- With `SUPABASE_URL` unset, the config banner renders in Polish with no link to any GitHub repository
- README reads as the product's documentation and renders no broken image on GitHub
- Nothing in the app changed visually compared with the end of Phase 2

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

`context/foundation/test-plan.md:202-206` places this slice in §7, "What We Deliberately
Don't Test": "product copy, the browser tab title, the document language, and deleting
unused template files. A glance or one screenshot is the test; an automated assertion on copy
breaks on every reword." `:207-210` likewise excludes UI snapshot and visual-regression
tests. **No new test is written in this change, and no cookbook §6 entry is added** — §6
tracks the test-plan's own rollout phases, and this slice is not one of them.

### Unit Tests:

None. The repository has no unit test runner, and `context/foundation/test-plan.md:115`
schedules one for §3 Phase 3 of the test rollout, not here.

### Integration Tests:

None added. The existing `scripts/smoke.mjs` walk runs unchanged as a regression check — it
asserts status codes and redirect targets, not copy, so it should stay green through all
three phases. A smoke failure in this change means a route or redirect broke, not that a
string changed.

### Manual Testing Steps:

1. Start the local stack and dev server, signed out, and open `/`. Confirm the Polish product
   page, no template cards, and the tab title "Dziennik dziecka".
2. Click `Zaloguj się` and `Zarejestruj się`; confirm both reach the right page and both
   pages are fully Polish.
3. Submit each form empty; confirm Polish validation messages appear.
4. Register a new account; confirm the confirm-email page is Polish and its link returns to
   sign-in.
5. Sign in with correct credentials; confirm the redirect to `/dashboard` and the unchanged
   "Moje dzieci" title.
6. While signed in, open `/` and confirm the redirect to `/dashboard` still fires.
7. Sign out; confirm the return to `/` and that the landing renders for a signed-out visitor.
8. Unset `SUPABASE_URL`, reload, and confirm the config banner shows the Polish message with
   no repository link.
9. View page source on any page and confirm `<html lang="pl">`.

## Performance Considerations

None. The change removes markup and two component files from the landing render path and adds
no dependency, no data access and no client-side JavaScript. The two React islands on the auth
pages keep their existing `client:load` directives.

## Migration Notes

Not applicable — no schema, no stored data and no persisted user state is touched. Rollback is
`git revert` of the phase commit; no cleanup follows.

One cross-change note: `supabase/config.toml:5` is deliberately left at
`project_id = "10x-astro-starter"` while `testing-isolation-boundary` is mid-implementation.
If that change completes and the project is later renamed, the local Docker container names
change with it, and `context/changes/testing-isolation-boundary/change.md:32` would need
updating. That is a future change's problem, not this one's.

## References

- Related research: `context/changes/landing-product-identity/research.md`
- Roadmap slice S-05 and gap inventory: `context/foundation/roadmap.md:53,60,103-114`
- Product vision used for the landing sentence: `context/foundation/prd.md:17-21`
- Testing exclusion for this slice: `context/foundation/test-plan.md:202-210`
- Prior deferral of exactly this work: `context/archive/2026-09-23-child-profiles/plan.md:35`
- Polish validation-message style to match: `src/components/children/AddChildForm.tsx:36-41`
- Title convention to match: `src/pages/dashboard.astro:31`
- CI gate commands: `.github/workflows/ci.yml:20-21,48`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Product identity on the entry surface

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — e2adb40
- [x] 1.2 Type and template checking passes: `npx astro check` — e2adb40
- [x] 1.3 Production build succeeds: `npm run build` — e2adb40
- [x] 1.4 `git grep -n -i "Welcome\.astro\|Topbar" -- src/` returns no hits — e2adb40
- [x] 1.5 Smoke walk passes against a local preview: `npm run smoke` — e2adb40

#### Manual

- [x] 1.6 Signed out, `/` shows the Polish product page with no template cards, and the browser tab reads "Dziennik dziecka" — e2adb40
- [x] 1.7 Both landing buttons reach `/auth/signin` and `/auth/signup` — e2adb40
- [x] 1.8 Signed in, `/` still redirects to `/dashboard` — e2adb40
- [x] 1.9 Page source declares `<html lang="pl">`, and `/dashboard` still shows the title "Moje dzieci" — e2adb40

### Phase 2: Polish auth flow

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — 04a0ff9
- [x] 2.2 Type and template checking passes: `npx astro check` — 04a0ff9
- [x] 2.3 Production build succeeds: `npm run build` — 04a0ff9
- [x] 2.4 Smoke walk passes unchanged, including the sign-in redirect to `/dashboard` and the sign-out redirect to `/`: `npm run smoke` — 04a0ff9
- [x] 2.5 `git grep -n "Sign in\|Sign up\|Signing in\|Creating account\|Show password\|Hide password" -- src/` returns no hits — 04a0ff9
- [x] 2.11 `git grep -n "Supabase is not configured" -- src/` returns no hits — 04a0ff9

#### Manual

- [x] 2.6 `/auth/signin` and `/auth/signup` are fully Polish, including tab titles, and the links between them work — 04a0ff9
- [x] 2.7 Submitting each form empty shows Polish validation messages — 04a0ff9
- [x] 2.8 Registering a new account lands on a Polish confirm-email page, and its link returns to sign-in — 04a0ff9
- [x] 2.9 The password eye toggle still shows and hides the password — 04a0ff9
- [x] 2.10 Signing in with correct credentials still reaches `/dashboard` — 04a0ff9
- [x] 2.12 Signing in with a wrong password shows a Polish message, not Supabase's English text — 04a0ff9

### Phase 3: Remove the remaining starter traces

#### Automated

- [x] 3.1 Linting passes: `npm run lint` — 51374ca
- [x] 3.2 Type and template checking passes: `npx astro check` — 51374ca
- [x] 3.3 Production build succeeds: `npm run build` — 51374ca
- [x] 3.4 Smoke walk passes: `npm run smoke` — 51374ca
- [x] 3.5 `git grep -n -i "10x.astro.starter\|przeprogramowani\|template\.png\|libbadge" -- . ':!package-lock.json' ':!context/' ':!.claude/' ':!CLAUDE.md'` returns hits only in `package.json:2` and `supabase/config.toml:5`, both deliberately out of scope. `CLAUDE.md` is excluded because its only matches are the `<!-- BEGIN/END @przeprogramowani/10x-cli -->` markers delimiting a CLI-managed block — a tool name, not starter branding, and removing them would break that block — 51374ca

#### Manual

- [x] 3.6 With `SUPABASE_URL` unset, the config banner renders in Polish with no link to any GitHub repository — 51374ca
- [x] 3.7 README reads as the product's documentation and renders no broken image on GitHub — 51374ca
- [x] 3.8 Nothing in the app changed visually compared with the end of Phase 2 — 51374ca
