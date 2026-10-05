---
date: 2026-10-04T11:22:08+02:00
researcher: marcin.zegunia2
git_commit: dfabc297450e01c4df62f62807ada5eba7988184
branch: feature/landing-product-identity
repository: 10xdevs_projekt
topic: "S-05 landing-product-identity — what still presents the starter template, which surfaces are still English, and which starter leftovers are safe to remove"
tags: [research, codebase, s-05, landing, branding, i18n, starter-leftovers, ms-01]
status: complete
last_updated: 2026-10-04
last_updated_by: marcin.zegunia2
---

# Research: S-05 — landing product identity

**Date**: 2026-10-04T11:22:08+02:00
**Researcher**: marcin.zegunia2
**Git Commit**: dfabc297450e01c4df62f62807ada5eba7988184
**Branch**: feature/landing-product-identity
**Repository**: 10xdevs_projekt

## Research Question

Roadmap slice S-05 (`context/foundation/roadmap.md:103-114`): a parent entering the site
sees "Dziennik dziecka" — not the starter template — the browser tab title names the
product, sign-in and sign-up are Polish, and no unused file or link remains that exists
only because the project was built on a starter.

Three questions follow: (1) which surfaces still present the starter, (2) which
user-facing text is still English, (3) which starter leftovers are actually unreferenced
and therefore safe to delete.

## Summary

**The entry surface is the starter's.** `src/pages/index.astro:6-8` renders
`Welcome.astro` inside `Layout` and passes no `title`, so `/` falls back to the starter
default. Of the 6 `<Layout>` call sites in `src/` (the exact set listed in §Code
References), exactly 1 — `src/pages/index.astro:6` — omits `title`, so exactly 1 page
shows the tab title "10x Astro Starter" (`src/layouts/Layout.astro:10,19`).
`src/components/Welcome.astro` carries 10 user-visible English strings, including the h1
"10x Astro Starter" (`:23`) and the three cards describing the template itself
(`:62,64,85,87,107,109`).

**The English/Polish split is per file, not per setting.** No i18n mechanism exists: no
`i18n:` key in `astro.config.mjs`, no translation dependency in `package.json`, no
locale or messages module under `src/`. Every string is an inline literal. `<html lang>`
is hardcoded `"en"` at `src/layouts/Layout.astro:14` and set nowhere else, which is wrong
for the Polish pages that already shipped (`dashboard.astro`, `children/[id].astro`).

**Still English, in this inspected path:** `Welcome.astro` (10 strings), `Topbar.astro`
(5 strings), the chrome of `auth/signin.astro` and `auth/signup.astro`,
`auth/confirm-email.astro` (6 strings), `SignInForm.tsx`, `SignUpForm.tsx`, the
`PasswordToggle.tsx` aria-labels, and the string "Supabase is not configured" at exactly
5 call sites (listed in §Code References). Raw Supabase GoTrue error text passes through
untranslated at `api/auth/signin.ts:16` and `api/auth/signup.ts:16` — that text
originates outside this repo.

**Already Polish:** `dashboard.astro`, `children/[id].astro`, `AddChildForm.tsx`,
`AddNoteForm.tsx`, `NoteItem.tsx`, the validation messages in `api/children.ts`,
`api/notes.ts` and `api/notes/[id].ts`, and the Supabase-config banner
(`Layout.astro:24`, `config-status.ts:15,17`).

**Only one file is unreferenced.** Of the starter suspects checked against the whole
tracked tree, `src/components/ui/LibBadge.astro` is the single one with no importer, no
href and no config reference — its only mention anywhere is the prose line
`context/foundation/roadmap.md:60`. `public/template.png` is referenced once, by
`README.md:3`. Everything else named as a "leftover" is live and must not be deleted:
`Welcome.astro` (imported at `index.astro:2`), `Topbar.astro` (imported at
`Welcome.astro:2`), `Banner.astro` (imported at `Layout.astro:3`), `favicon.png` (linked
at `Layout.astro:18`), and the `bg-cosmic` utility, which 5 pages besides Welcome use.

**Two starter names are NOT user-facing and should be treated separately** —
`package.json:2` (`"name": "10x-astro-starter"`) and `supabase/config.toml:5`
(`project_id = "10x-astro-starter"`). The second one is load-bearing for in-flight work;
see §Architecture Insights.

**No test is required for this slice**, by an explicit, already-made decision
(`context/foundation/test-plan.md:202-206`). The existing gates still apply.

## Detailed Findings

### The entry surface and the tab title

- `src/pages/index.astro` is 8 lines: it imports `Welcome` (`:2`) and `Layout` (`:3`) and
  renders `<Layout><Welcome /></Layout>` (`:6-8`). It has no text of its own and passes
  no `title`.
- `src/layouts/Layout.astro:10` declares `const { title = "10x Astro Starter" } = Astro.props;`
  and `:19` renders `<title>{title}</title>`.
- Per-page titles, the exact set of 6 `<Layout>` call sites in `src/`:
  `index.astro:6` (none → starter default), `dashboard.astro:31` (`"Moje dzieci"`, PL),
  `children/[id].astro:63` (`{child.name}`, data), `auth/signin.astro:8` (`"Sign in"`, EN),
  `auth/signup.astro:8` (`"Sign up"`, EN), `auth/confirm-email.astro:21`
  (`{content.heading}`, EN).
- `src/layouts/Layout.astro:14` hardcodes `<html lang="en">`. This is the only `lang`
  assignment in `src/`.

### Who sees the landing page

- `src/middleware.ts:21-23` redirects `/` to `/dashboard` when `context.locals.user` is
  set. So the landing page and the starter tab title are reached **only by signed-out
  visitors**.
- Consequence for `Topbar.astro`: its signed-in branch (`:7-19`, rendering "Dashboard"
  and "Sign out") is unreachable from `/`, because a signed-in request never renders
  Welcome. Topbar is mounted nowhere else (`Welcome.astro:2,18` are its only references).
- `src/components/Welcome.astro:29-41` holds the only anonymous entry points to the app:
  the `/auth/signin` and `/auth/signup` CTA links. Whatever replaces Welcome must keep an
  entry to sign-in, or `/` becomes a dead end for a signed-out parent.

### The starter link in the config-error banner

- `src/lib/config-status.ts:16` sets
  `docsUrl: "https://github.com/przeprogramowani/10x-astro-starter#supabase-configuration"`.
- It is **user-visible**: `src/layouts/Layout.astro:28` renders it as an `<a>` with the
  label from `config-status.ts:17` ("Zobacz instrukcję konfiguracji").
- It renders only when `SUPABASE_URL` or `SUPABASE_KEY` is missing
  (`config-status.ts:14`, filtered at `:21`). So it is a conditional surface, not one a
  healthy deployment shows — but it is still the template's repo address shown to a
  parent.

### Starter leftovers — reference-verified

The governing trap from `context/foundation/roadmap.md:113` is that deleting a file as
"unused" must follow a check that nobody imports it. Result of that check, over the
tracked tree (`git grep -n -i`, excluding `package-lock.json`):

| File | Verdict | Evidence |
| --- | --- | --- |
| `src/components/ui/LibBadge.astro` | no reference found in the tracked tree | only hit is the prose line `context/foundation/roadmap.md:60` |
| `public/template.png` | referenced once | `README.md:3` (`![](./public/template.png)`) |
| `src/components/Welcome.astro` | live | `src/pages/index.astro:2,7` |
| `src/components/Topbar.astro` | live, only via Welcome | `src/components/Welcome.astro:2,18` |
| `src/components/Banner.astro` | live | `src/layouts/Layout.astro:3,23,34` |
| `public/favicon.png` | live | `src/layouts/Layout.astro:18` |
| `public/.assetsignore` | no reference in the tracked tree, but a Cloudflare convention file | zero hits for `assetsignore`; `wrangler.jsonc:7-8` has an `assets` block. Not proven safe to delete — see §Open Questions |
| `CLAUDE.md.scaffold` | no code or config reference | only `context/changes/bootstrap-verification/verification.md:53-54` |

Scope of the negative findings: tracked files only, `package-lock.json` excluded, and
the gitignored `dist/`, `node_modules/`, `.astro/` and `.wrangler/` not inspected. "No
reference found in the tracked tree" is not the same as "definitely unused".

**`bg-cosmic` must not be removed with Welcome.** It is defined at
`src/styles/global.css:113` and used by 6 files in total: `Welcome.astro:5`,
`auth/confirm-email.astro:22`, `auth/signin.astro:9`, `auth/signup.astro:9`,
`children/[id].astro:64` and `dashboard.astro:32`.

### Starter branding outside the UI

- `package.json:2` — `"name": "10x-astro-starter"`. There is no `description` key.
- `supabase/config.toml:5` — `project_id = "10x-astro-starter"`.
- `README.md:1,3,5,26-27` — title, the `template.png` image, "starter template", and the
  upstream clone URL.
- `AGENTS.md:3` — "10x Astro Starter: an Astro 7 + React 19 …".
- Already de-branded: `wrangler.jsonc:3` is `"name": "dziennik-dziecka"`. The claim at
  `context/deployment/deploy-plan.md:24,32` that `wrangler.jsonc` still says
  `10x-astro-starter` is stale as of this commit; the rest of that runbook was not
  re-checked here.

### Shared "auth" components are not auth-only

`src/components/auth/` is shared form infrastructure, not an auth-only folder:

- `FormField.tsx`, `SubmitButton.tsx` and `ServerError.tsx` carry no hardcoded text —
  they take labels, `pendingText` and `message` as props.
- They are consumed by the already-Polish `AddChildForm.tsx` and `AddNoteForm.tsx`, and
  by `children/[id].astro:79`. `TextAreaField.tsx` was added by the `first-child-note`
  change because `FormField` hardcodes `<input>`
  (`context/archive/2026-09-26-first-child-note/plan.md:248,252-254`).
- `PasswordToggle.tsx:14` is the one component in that folder with hardcoded English —
  the aria-labels "Hide password" / "Show password" — and it is used by the auth forms
  only.

So the English copy to translate lives in `SignInForm.tsx`, `SignUpForm.tsx`, the three
`auth/*.astro` pages and `PasswordToggle.tsx`, not in the shared field components.

### Test and gate constraints

- `context/foundation/test-plan.md:202-206` puts this exact slice in §7 "What We
  Deliberately Don't Test": "product copy, the browser tab title, the document language,
  and deleting unused template files. A glance or one screenshot is the test; an
  automated assertion on copy breaks on every reword."
- `context/foundation/test-plan.md:207-210` likewise excludes UI snapshot and
  visual-regression tests.
- `scripts/smoke.mjs:78` asserts `/` returns status 200 and nothing about its content, so
  rewriting the landing page does not break smoke — and smoke gives no regression signal
  for this change either.
- `scripts/smoke.mjs:221,263` assert that sign-out redirects to `/`. Any change to the
  sign-out destination would break them; translating copy would not.
- `scripts/smoke.mjs` asserts the sign-in success redirect is `/dashboard`
  (`context/archive/2026-09-23-child-profiles/plan.md:25`). Server-side auth error
  strings reach the UI through `?error=` redirects, so re-wording them is a smoke risk
  worth re-checking in the plan rather than assuming.

## Code References

- `src/pages/index.astro:2,6-8` — landing route; imports and renders Welcome, no `title`
- `src/layouts/Layout.astro:10` — `title` default `"10x Astro Starter"`
- `src/layouts/Layout.astro:14` — `<html lang="en">`, the only `lang` assignment in `src/`
- `src/layouts/Layout.astro:18` — favicon link
- `src/layouts/Layout.astro:19` — `<title>{title}</title>`
- `src/layouts/Layout.astro:22-35` — config-error banner, including the starter link at `:28`
- `src/components/Welcome.astro:23,26` — starter h1 and tagline
- `src/components/Welcome.astro:29-41` — the only anonymous sign-in / sign-up CTAs
- `src/components/Welcome.astro:62,64,85,87,107,109` — the three template feature cards
- `src/components/Topbar.astro:11,15,22,25,28` — 5 English strings
- `src/lib/config-status.ts:16` — upstream starter repo URL, user-visible
- `src/middleware.ts:21-23` — `/` → `/dashboard` for a signed-in user
- `src/styles/global.css:113` — `@utility bg-cosmic`
- `src/pages/auth/signin.astro:8,12,16,18` — EN title, h1, prompt, link
- `src/pages/auth/signup.astro:8,12,16,18` — EN title, h1, prompt, link
- `src/pages/auth/confirm-email.astro:4,6-18,21` — dev/prod EN content, heading used as title
- `src/components/auth/SignInForm.tsx:21,23,26,47,53,60,67,82,83` — EN labels, placeholders, validation
- `src/components/auth/SignUpForm.tsx:26,28,32,34,38,40,60-61,70,76,83,90,107,114,129,130` — EN labels, validation, live hint
- `src/components/auth/PasswordToggle.tsx:14` — EN aria-labels
- "Supabase is not configured", the exact set of 5 sites: `src/pages/api/auth/signin.ts:11`,
  `src/pages/api/auth/signup.ts:11`, `src/pages/api/children.ts:57`,
  `src/pages/api/notes.ts:26`, `src/pages/api/notes/[id].ts:24`
- `src/pages/api/auth/signin.ts:16`, `src/pages/api/auth/signup.ts:16` — raw GoTrue
  `error.message` passed through untranslated
- `scripts/smoke.mjs:78` — `/` asserted on status only
- `package.json:2`, `supabase/config.toml:5`, `wrangler.jsonc:3` — project names

## Architecture Insights

- **There is no i18n layer, and S-05 does not need one.** Inspected to conclude this:
  `astro.config.mjs` in full (no `i18n:` key; `sitemap()` called with no i18n options),
  the full dependency and devDependency lists in `package.json`, a filename search for
  `*i18n*`, `*locale*`, `*messages*`, `*translat*`, `*dictionar*`, `*lang*` outside
  `node_modules` and `dist`, a listing of all files under `src/`, and a content grep of
  `src/` for `i18n|intl|translat|locale|dictionary|messages` — whose only hit is
  `src/lib/wall-clock.ts:18`, `new Intl.DateTimeFormat("sv-SE", …)`, a date-formatting
  trick rather than a language choice. `context/foundation/roadmap.md:112` scopes S-05 to
  Polish copy, not locale switching.
- **Renaming `supabase/config.toml:5` would collide with in-flight work.** That
  `project_id` determines the local Docker container names, and
  `context/changes/testing-isolation-boundary/change.md:32` pins
  `supabase_db_10x-astro-starter` as the container every `docker exec` in that change
  targets. `testing-isolation-boundary` is `status: implementing` with phases 2-5 still
  pending. The value is not user-facing. Changing it here buys nothing the slice's
  outcome asks for and breaks a running change — leave it.
- **`package.json:2` is likewise not user-facing.** It does not reach the browser.
  Whether it counts as "a trace of the starter" under MS-01 is a judgment call for the
  plan, not a fact this research settles.
- **The error-query pattern is repo-wide.** Server errors reach the UI as
  `?error=<encoded>` read by the page and passed to a React island, rendered through
  `ServerError.tsx:13` as an escaped text node. The same pattern is used on the dashboard
  and the child page, so arbitrary text can be put into the error panel via a crafted
  URL. That is pre-existing and out of S-05's scope; noted so the plan does not mistake
  it for something this change introduces.

## Historical Context (from prior changes)

- **The auth-screen translation was deliberately deferred to exactly this slice.**
  `context/archive/2026-09-23-child-profiles/plan.md:35`, under "What We're NOT Doing":
  "Translating the existing auth screens or changing `<html lang>` in `Layout.astro`.
  Only the new UI is Polish." Repeated as out of scope at
  `context/archive/2026-09-23-child-profiles/plan-brief.md:40-52`.
- **The UI-language convention is by precedent, not by rule.**
  `context/archive/2026-09-23-child-profiles/plan-brief.md:26`: "UI language | Polish for
  new UI; auth screens untouched". `plan.md:16` records the starting state: "Existing UI
  copy is English. The PRD user and roadmap are Polish." `context/foundation/lessons.md`
  contains no language rule — its only entry is an Astro-frontmatter note with unfilled
  `Rule` and `Applies to` fields.
- **The Polish config banner came from the starter, not from a decision here.** No change
  document in `context/changes/**` or `context/archive/**` mentions "Uwaga" or
  `config-status`. The string entered `src/` in the scaffold commit `b90086f`
  (2026-09-17), which is also the only commit touching `src/lib/config-status.ts`.
- **Correction to a prior plan's record of the landing redirect.**
  `context/archive/2026-09-23-child-profiles/plan.md:161-167` specifies that
  `index.astro` returns `Astro.redirect("/dashboard")` when `Astro.locals.user` is set.
  As implemented, that redirect lives in `src/middleware.ts:21-23`, not in
  `index.astro` — `src/pages/index.astro` contains no redirect. `git log -S` shows the
  `pathname === "/"` check entered `src/middleware.ts` in commit `04f0c4e`
  ("feat(child-profiles): Children page and flow (p2)"), i.e. the same change moved it.
  The plan's *intent* ("a logged-in parent goes straight to their children", `plan.md:163`)
  holds and is live; only its stated file is wrong. The behaviour is a constraint S-05
  must preserve — but the file to leave alone is the middleware.
- **No prior decision exists about Welcome's content, Topbar, the favicon, the default
  title or branding.** Folders inspected to conclude this: `context/changes/`
  (`bootstrap-verification`, `fr-006-research`, `testing-isolation-boundary`),
  `context/archive/` (`2026-09-23-child-profiles`, `2026-09-26-first-child-note`),
  `context/foundation/` and `context/deployment/`. The only prior title decision is
  per-page: `"Moje dzieci"` for the dashboard
  (`context/archive/2026-09-23-child-profiles/plan.md:153`).
- **Password recovery must not appear on the Polish login screen.**
  `context/foundation/test-plan.md:219-221` records that the PRD considered and rejected
  the counter-argument; no recovery flow exists. Do not add a "Nie pamiętasz hasła?" link
  as part of translating.
- **The cosmic visual theme stays, by an explicit roadmap decision.**
  `context/foundation/roadmap.md:113`: the theme "zostaje w tym kawałku świadomie — ekran
  przestanie *mówić* „szablon startowy", ale nadal będzie tak *wyglądał*". A retheme is a
  separate change. `context/foundation/test-plan.md:207-209` treats it the same way.

## Related Research

- `context/changes/testing-isolation-boundary/research.md` — the enforcing layer for note
  isolation; relevant to S-05 only through the `supabase/config.toml` container-name
  coupling noted above.
- `context/changes/fr-006-research/research.md` and
  `context/foundation/fr-006-research/` — FR-006 library compatibility (search). Not
  applicable to this slice; checked and found to carry no landing, branding or UI-language
  decision.

## Open Questions

1. **How much copy goes on the landing page** — one sentence about the product plus an
   entry to sign-in, or more. `context/foundation/roadmap.md:112` names this as the
   slice's only open unknown, calls it "decyzja o długości, nie o treści", assigns it to
   the user, marks it non-blocking, and points at PRD §Vision
   (`context/foundation/prd.md:17-21`) as sufficient source material. To be settled in
   the plan.
2. **Does MS-01's "no trace of the starter" extend to non-user-facing names?** Concretely
   `package.json:2` and `README.md`. `supabase/config.toml:5` should be excluded for the
   collision reason above, but the other two are a scope call the plan has to make.
3. **Is `public/.assetsignore` safe to delete?** It has no reference in the tracked tree,
   but it is a Cloudflare Workers-assets convention file read by Wrangler tooling rather
   than by import, and its contents are `_worker.js` and `_routes.json`. Nothing in this
   repo proves it either load-bearing or dead. Deleting it is a deploy risk with no
   upside for the slice's outcome; the safe default is to leave it.
4. **Whether `public/favicon.png` is replaced or kept.** It is the scaffold's file —
   `git log -- public/favicon.png` shows exactly one commit, the scaffold `b90086f`, and
   no later modification. It is 733 bytes, 32x32 RGBA. It was not compared against the
   upstream starter's copy, so "it is the starter's default icon" is inferred from
   provenance, not from a byte comparison. It is linked live at `Layout.astro:18`, so the
   cleanup would be replacement, never deletion. Whether a product icon is in scope for
   S-05 is a plan decision; the roadmap's outcome text does not name the favicon.
