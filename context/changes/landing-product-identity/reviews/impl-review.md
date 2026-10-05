<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Landing Product Identity

- **Plan**: `context/changes/landing-product-identity/plan.md`
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-05
- **Verdict**: NEEDS ATTENTION — triaged 2026-10-05: 9 fixed, 1 skipped as intentional
- **Findings**: 0 critical, 7 warnings, 3 observations

> **Reviewer independence caveat.** This review was produced in the same session that wrote
> the implementation. Both evidence-gathering passes were run by fresh sub-agents reading the
> code cold, and every consequential claim below was re-verified directly, but this is not an
> independent review. F1 and F2 were found by the sub-agents, not by the implementer.

## Scope verified

Diff measured from merge-base `dfabc29` (not `master`, which has since advanced by 4 commits
of `testing-isolation-boundary` phases 2–4). True scope: 26 files across commits `e2adb40`,
`04a0ff9`, `51374ca`, `6011598`.

All automated success criteria re-run at review time: `npm run lint` PASS, `npx astro check`
PASS (0 errors, 0 warnings), `npm run build` PASS, and all four grep gates return the
expected results.

Every "What We're NOT Doing" boundary held: `package.json`, `supabase/config.toml`,
`public/favicon.png`, `public/.assetsignore`, `CLAUDE.md.scaffold`, `src/middleware.ts` and
`src/styles/global.css` are absent from the diff. No test file was added. The shared
`FormField.tsx` / `SubmitButton.tsx` / `ServerError.tsx` are untouched, as the plan required.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Plan Adherence is WARNING for the plan *document*, not the code: every planned change was
implemented as described (no DRIFT, no MISSING), but two mid-flight amendments left the
document internally inconsistent — see F5 and F6.

## Findings

### F1 — `authErrorMessage` can return a non-string through the prototype chain

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/auth-errors.ts:26
- **Detail**: `MESSAGES` is an object literal typed `Record<string, string>`, so it inherits
  `Object.prototype`. A lookup with `error.code` equal to an inherited property name returns
  a function, and `??` does not catch it because the value is not nullish. Verified by
  execution: `code: "constructor"` returns `function Object() { [native code] }`, and
  `encodeURIComponent` then writes that text into the `?error=` redirect. The module's own
  header comment claims no English ever reaches the parent; this breaks that invariant.
  Not reachable by a visitor — `error.code` comes from the Supabase response, never from
  request input — so this is a correctness defect, not an exploit path. Confirmed total for
  every realistic input: `undefined`, `""` and unmapped codes all return the fallback, and
  it cannot throw.
- **Fix**: Guard the lookup with `Object.hasOwn(MESSAGES, error.code)`, or build `MESSAGES`
  with `Object.create(null)`, or use a `Map`.
  - Strength: One line; removes the whole class without changing any call site.
  - Tradeoff: None meaningful.
  - Confidence: HIGH — the failing behaviour was reproduced directly, and the fix is standard.
  - Blind spot: None significant.
- **Decision**: FIXED

### F2 — Unmapped auth failures are now invisible to an operator

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signin.ts:17, src/pages/api/auth/signup.ts:17
- **Detail**: Before this change both routes passed `error.message` into the redirect, so an
  unmapped failure at least surfaced its upstream text in the URL and in smoke output. They
  now emit a fixed Polish fallback and log nothing — `grep -n "console\." src/pages/api/auth/*.ts
  src/lib/auth-errors.ts` returns nothing. A Supabase outage, `unexpected_failure`,
  `hook_timeout` or `email_address_not_authorized` all collapse into
  "Nie udało się zalogować. Spróbuj ponownie." with no trace anywhere. This is a diagnosability
  regression introduced by the fix for the English-message complaint, and it was not weighed
  when that scope change was agreed.
- **Fix**: Log the code and status (never the message or the email) on the fallback path —
  `console.error("auth", error.code, error.status)`. Cloudflare Workers logs capture it.
  - Strength: Restores operator visibility without putting anything back in front of the
    parent; keeps the Polish-only guarantee intact.
  - Tradeoff: Adds the first logging statement in these routes, so it sets a precedent the
    rest of the API does not yet follow.
  - Confidence: HIGH — the absence of logging is verified, and the regression is a direct
    consequence of the diff.
  - Blind spot: Whether the Workers log retention on this project is actually usable for the
    user was not checked.
- **Decision**: FIXED — implemented inside `authErrorMessage` rather than at the two call sites, since only that function knows whether the code was mapped; carries an annotated `eslint-disable-next-line no-console`

### F3 — `user_not_found` mapping is dead, and would be an enumeration oracle if it ever fired

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/auth-errors.ts:11
- **Detail**: GoTrue returns `invalid_credentials` for an unknown email on
  `signInWithPassword`, and `signUp` does not return `user_not_found`, so the entry is
  unreachable today. If a future Supabase version did return it, the mapped text
  "Nie znaleziono konta z tym adresem email" would tell an attacker which addresses have
  accounts — a distinction the generic `invalid_credentials` wording deliberately avoids.
  Dead code that becomes a security regression the moment it wakes up.
- **Fix**: Delete the `user_not_found` entry so the code falls through to the generic fallback.
  - Strength: Removes a latent enumeration oracle and one line of dead code at no cost.
  - Tradeoff: None.
  - Confidence: MEDIUM — the unreachability claim rests on current GoTrue behaviour, not on a
    test in this repo; the recommendation holds either way.
  - Blind spot: Not verified against a live cloud Supabase project, only local.
- **Decision**: FIXED

### F4 — Manual criterion 3.6 was checked without observable evidence

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/landing-product-identity/plan.md:533
- **Detail**: Row 3.6 ("With `SUPABASE_URL` unset, the config banner renders in Polish with no
  link to any GitHub repository") is marked `[x]`. Verifying it requires unsetting
  `SUPABASE_URL` in `.env` and `.dev.vars`, rebuilding and reloading. The implementer stated
  during the phase that it would not do this without consent, and no such run happened in the
  session; the row was flipped on a general "works". The underlying code change is trivially
  correct by inspection — `docsUrl` is gone and `Layout.astro:25` guards on it — so the risk is
  a false record, not a broken banner.
- **Fix**: Either run the check once (unset `SUPABASE_URL`, rebuild, look at `/`) or downgrade
  the row to reflect that it was verified by inspection rather than observation.
  - Strength: Keeps the Progress record honest, which is what `/10x-archive` and future
    reviews read as ground truth.
  - Tradeoff: The run temporarily breaks the working local configuration.
  - Confidence: HIGH — the session transcript shows no such run.
  - Blind spot: The user may have performed it outside the session without saying so.
- **Decision**: FIXED — the check was actually run: with `SUPABASE_URL` unset and a rebuild, the banner rendered the Polish message and the page contained zero occurrences of `github.com` or `przeprogramowani`; config restored afterwards

### F5 — Phase 2 "Changes Required" subsections are numbered 1, 2, 3, 4, 6, 5

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/landing-product-identity/plan.md:277, 297
- **Detail**: The mid-phase addition was inserted *before* the existing "#### 5. Password
  visibility toggle" but numbered 6, so the document reads 1, 2, 3, 4, 6, 5. Mechanical slip
  from the amendment, not a scope problem. Progress IDs show the same artefact — automated rows
  run 2.1–2.5 then 2.11, manual rows 2.6–2.10 then 2.12 — which is acceptable, since renumbering
  would break the "do not rename step titles" rule and the committed SHA mapping.
- **Fix**: Move the "#### 6" block below "#### 5" in the plan; leave the Progress IDs alone.
- **Decision**: FIXED

### F6 — Two phase Overviews still describe the pre-amendment scope

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/landing-product-identity/plan.md:214-215, 337-339
- **Detail**: Phase 2's Overview still says the phase covers "the two form pages, the page
  registration lands on, and the two React forms" — it never mentions the API error mapping that
  became change #6. Phase 3's Overview lists only the config link, LibBadge, the screenshot and
  the README; `AGENTS.md` appears only in the Files line and an appended paragraph. The
  "What We're NOT Doing" reversal (:90-95) and the appended AGENTS.md note (:388-391) are both
  correct and honest; the Overviews above them were simply not updated to match. A reader
  skimming the plan gets a smaller picture than what shipped. Current State Analysis (:31-33) has
  the same gap, which is defensible since it describes the state *before* the change.
- **Fix**: Add one clause to each Overview naming the added work.
- **Decision**: FIXED

### F7 — The minimum password length is hardcoded in a third place

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/auth-errors.ts:15
- **Detail**: `weak_password: "Hasło jest za słabe. Użyj co najmniej 6 znaków"` writes the digit
  6 literally. The same number already lives in `src/components/auth/SignUpForm.tsx:8`
  (`MIN_PASSWORD_LENGTH`, which that file interpolates rather than hardcoding) and in
  `supabase/config.toml:175` (`minimum_password_length = 6`). Raising the minimum in config
  would leave this string lying. `weak_password` also fires for leaked-password and
  character-class rules, where "6 znaków" is the wrong explanation entirely.
- **Fix**: Drop the number — e.g. "Hasło jest zbyt słabe. Wybierz dłuższe lub bardziej złożone".
- **Decision**: FIXED

### F8 — `docsUrl` / `docsLabel` and their Layout branch are now dead code

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/lib/config-status.ts:7-8, src/layouts/Layout.astro:25-33
- **Detail**: Removing the starter link left the only `configStatuses` entry with no `docsUrl`,
  so the optional interface fields and the `{cfg.docsUrl && …}` rendering branch are unreachable.
  The plan called for exactly this and chose to keep the fields optional, so it is intentional —
  worth noting rather than fixing. Secondary: the banner still names the vendor ("Supabase nie
  jest skonfigurowany…") while the five API strings were made generic
  ("Aplikacja nie jest poprawnie skonfigurowana"), so the two now describe the same condition
  differently.
- **Fix**: Leave as is, or trim the dead fields and align the banner wording with the API strings.
- **Decision**: SKIPPED — intentional per the plan; optional fields and the guard stay for a future product docs link

### F9 — Trailing-period convention is inconsistent inside the new module

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/auth-errors.ts:15, 19-22 vs src/pages/api/auth/signin.ts:17
- **Detail**: The repo's rule, inferred from `api/children.ts` and `api/notes.ts`, is that
  single-clause messages omit the trailing period and multi-sentence ones keep it. The new
  two-sentence map entries ("Hasło jest za słabe. Użyj co najmniej 6 znaków",
  "Zbyt wiele prób. Spróbuj ponownie za chwilę") drop it, while the fallbacks one file away
  ("Nie udało się zalogować. Spróbuj ponownie.") keep it.
- **Fix**: Add the trailing period to the multi-sentence map entries.
- **Decision**: FIXED — four entries, not the three named in triage: `validation_failed` was missed in the question

### F10 — In-sentence auth links are distinguished by colour alone

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/signin.astro:17, src/pages/auth/signup.astro:17
- **Detail**: The cross-links use `text-purple-300 hover:underline` inside `text-blue-100/60`
  prose, so without hover they differ from surrounding text by colour only — a WCAG 1.4.1
  failure. **Pre-existing**: this change translated the link text but did not touch the styling,
  and the same pattern came from the starter. Flagged because this change is the first time
  anyone has read these lines on purpose, not because it introduced the problem.
- **Fix**: Make the underline permanent rather than hover-only.
- **Decision**: FIXED

## Not findings

- `context/foundation/roadmap.md` is modified without the plan mentioning it, and at HEAD still
  reads `in-progress` while `change.md` reads `implemented`. Both are correct: the roadmap flip
  is owned by the `/10x-implement` workflow, and `/10x-archive` is what moves the item to `done`.
- The two scope expansions (Polish auth errors in Phase 2, `AGENTS.md` in Phase 3) were each put
  to the user and approved before being implemented, and both are recorded in the plan. They are
  governed scope growth, not drift.
- `master` has advanced by four commits since the merge-base. This branch will need a rebase or
  merge before it lands; nothing in the diff conflicts semantically with that work.

## Triage (2026-10-05)

All ten findings were decided in session. Nine fixed, one skipped as intentional (F8).

Gates re-run after the fixes: `npm run lint` PASS (no warnings), `npx astro check` PASS
(0 errors, 0 warnings), `npm run build` PASS, `npm run smoke` PASS with the wrong-password
step still redirecting to the Polish message.

Two notes on how the fixes landed:

- **F2 sets a precedent.** `src/lib/auth-errors.ts` now holds the first `console.*` call in
  `src/`, and the first `eslint-disable` there. `eslint.config.js:25` sets `no-console: "warn"`
  globally and `:90` turns it off only for `scripts/**/*.mjs`, so the log needed an annotated
  single-site exception to keep `npm run lint` output clean. If the project would rather carry
  the warning, or rather not log at all, this is a one-line reversal.
- **F9 was under-counted when it was put to the user.** The triage question named three
  offending entries; there were four. `validation_failed` was missed. All four now carry the
  trailing period.
