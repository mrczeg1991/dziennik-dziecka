# Landing Product Identity — Plan Brief

> Full plan: `context/changes/landing-product-identity/plan.md`
> Research: `context/changes/landing-product-identity/research.md`

## What & Why

Roadmap slice S-05. A parent opening the site meets the 10x Astro Starter, not Dziennik
dziecka — an English hero about the template, three cards describing its tech stack, a tab
reading "10x Astro Starter", English login and registration, and a link to the template's own
GitHub repo in the config-error banner. This plan makes the entry surface present the product,
in Polish, and removes the starter leftovers that reference-verification showed to be removable.

## Starting Point

`src/pages/index.astro` delegates to `src/components/Welcome.astro` (10 English strings) and is
the only one of 6 `<Layout>` call sites passing no `title`, so it is the single page showing the
starter default from `Layout.astro:10`. `<html lang="en">` is hardcoded at `Layout.astro:14`
although the dashboard and child pages already shipped in Polish. The auth screens were
deliberately left English by an earlier change
(`context/archive/2026-09-23-child-profiles/plan.md:35`); this slice is that follow-through.

## Desired End State

A signed-out parent opening `/` sees a Polish page named Dziennik dziecka, one sentence about
what it is for, and buttons to log in or register. The browser tab names the product. Logging in
and registering happen entirely in Polish, through to the page registration lands on. No file
remains that exists only because the project was built on a starter and that nothing references.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Landing copy length | Product name, one sentence from PRD §Vision, two CTAs; no cards | Matches the roadmap outcome, and a third card would have had to advertise FR-006 search, which does not exist yet | Plan |
| De-branding reach | User-visible surfaces plus README; leave `package.json:2` and `supabase/config.toml:5` | README is the repo's front door and is pure starter text; `config.toml` drives Docker container names `testing-isolation-boundary` depends on | Plan |
| Favicon | Leave the scaffold icon | The roadmap outcome never names it, and it is a visual asset like the cosmic theme, which explicitly stays | Plan |
| Polish reach in auth | Landing, signin, signup, confirm-email, both forms, toggle aria-labels; not the config string or raw Supabase errors | Covers the normal flow; a map keyed on upstream English error text breaks silently when Supabase rewords | Plan |
| Landing markup location | Inlined into `index.astro`; `Welcome.astro` deleted | `dashboard.astro:32+` and `children/[id].astro:64+` already inline their markup | Plan |
| `Topbar.astro` | Deleted with Welcome | Its CTAs duplicate the new hero buttons, its signed-in branch is unreachable behind the middleware redirect, and leaving it creates a new unused file | Plan |
| Page titles | Bare page names; the product is named by the `Layout` default | Matches the existing `"Moje dzieci"` at `dashboard.astro:31` | Research |
| Cosmic theme | Untouched | Explicit roadmap decision (`roadmap.md:113`); a retheme is a separate change | Research |
| Tests | None written | `context/foundation/test-plan.md:202-206` places this slice in the deliberately-untested set | Research |

## Scope

**In scope:** Polish landing inlined into `index.astro`; `Layout.astro` default title and
`lang="pl"`; Polish `signin.astro`, `signup.astro`, `confirm-email.astro`, `SignInForm.tsx`,
`SignUpForm.tsx` and the `PasswordToggle.tsx` aria-labels; starter link out of
`config-status.ts:16`; deletion of `Welcome.astro`, `Topbar.astro`, `ui/LibBadge.astro` and
`public/template.png`; README rewritten as the product's.

**Out of scope:** the cosmic theme; `supabase/config.toml:5` and `package.json:2` (neither
user-facing, the first load-bearing for an in-flight change); `favicon.png`, `.assetsignore`,
`CLAUDE.md.scaffold`; the 5 "Supabase is not configured" sites and raw GoTrue error text; a
password-recovery link (no such flow exists, by decision); any i18n library; the `/` →
`/dashboard` redirect at `middleware.ts:21-23`; automated tests of any kind.

## Architecture / Approach

No architecture change. The landing stops being a component and becomes page markup, matching the
other two product pages; everything else is string replacement plus four deletions. One ordering
constraint: `index.astro` is rewritten *before* `Welcome.astro` and `Topbar.astro` are deleted,
and both deletions happen inside Phase 1 rather than the cleanup phase — otherwise Phase 1 ends by
creating two unused files, the exact condition this slice removes. `bg-cosmic`
(`global.css:113`) is shared by five other pages and must survive Welcome's deletion.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Entry surface | Polish landing, product tab title, `lang="pl"`, Welcome and Topbar deleted | Welcome holds the only anonymous route to sign-in; `bg-cosmic` must not go with it |
| 2. Polish auth flow | Login, registration and the post-registration page fully Polish | `src/components/auth/` is shared with the Polish child and note forms — translating the shared field components would leak copy into working screens |
| 3. Remaining traces | Config-banner link gone, LibBadge and template.png deleted, README rewritten | Deleting `template.png` without the README line embedding it leaves a broken image on GitHub |

**Prerequisites:** None — S-05 has no roadmap prerequisites and runs parallel to S-03 and S-04.
The smoke gate needs a local Supabase stack; `testing-isolation-boundary` relocated its ports, so
start from that config.
**Estimated effort:** ~1 session across 3 phases — copy and deletions, no data, schema or
dependency work.

## Open Risks & Assumptions

- The landing will look sparse: the cosmic theme stays while the three cards that filled it go.
  An accepted tradeoff (`roadmap.md:113`), and the most likely prompt for a follow-up visual change.
- A wrong password still shows an English Supabase message, and a misconfigured deployment one
  English config line. Both deliberate; translating the first is a small follow-up if it grates.
- `scripts/smoke.mjs` asserts status codes and redirects, never copy, so it cannot catch a bad
  translation. The manual walk is the real check — the test plan says so explicitly.
- The README rewrite assumes its setup and script sections still describe this repo accurately;
  if they have drifted, correcting them expands Phase 3.

## Success Criteria (Summary)

- A signed-out parent learns the site is Dziennik dziecka and can reach login from the first
  screen, in Polish, with the product named in the browser tab.
- Registering and logging in happen without meeting a single English screen in the normal path.
- No file remains that exists only because the project was built on a starter and that nothing
  references — verified by `git grep`, not by assumption.
