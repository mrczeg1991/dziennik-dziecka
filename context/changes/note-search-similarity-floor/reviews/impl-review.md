<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Similarity Floor Re-derivation

- **Plan**: context/changes/note-search-similarity-floor/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-28
- **Verdict**: REJECTED (at review time; all 10 findings have since been triaged and fixed)
- **Findings**: 1 critical, 4 warnings, 5 observations

Reviewed at `5747f31~1..HEAD` (5 commits, 15 files, +2511/-77). Every finding below was
re-verified in this session by execution, not taken on a sub-agent's word; the two claims that did
not survive verification are recorded under "Retracted" near the bottom.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

REJECTED follows the rubric mechanically: one CRITICAL finding puts Safety & Quality at FAIL. It
means "one real bug to fix", not "discard the work" — the threshold recalibration itself is
measured, documented and verified.

## Findings

### F1 — `w lipcu?` returns nothing while `w lipcu` returns the month

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/search.ts:42, with src/lib/date-range-parse.ts:214-220
- **Detail**: The window-only path is gated on `queryText === ""`, but `stripPeriodPhrase` leaves
  trailing punctuation behind, so the gate never fires for a punctuated question. Verified by
  running the real function: `"w lipcu?" → "?"`, `"dzisiaj?" → "?"`, `"w lipcu." → "."`. Verified
  end to end against the live database with a real embedding of `"?"`:
  `search_notes('…c1', '?', <embedding of ?>, '2026-07-01', '2026-08-01')` returns **0 rows**,
  while that child's July window holds **2 notes**. Both arms are dead for this input —
  `websearch_to_tsquery('simple', immutable_unaccent('?'))` is an empty tsquery, and the maximum
  cosine of `"?"` against those two notes is **0.163**, far below the 0.434 floor. So a parent who
  types the question mark gets exactly the "Brak notatek pasujących do pytania." this change
  exists to remove — plus a billed OpenAI call. Untested at both layers: the unit cases cover only
  `"w lipcu"`, `"dzisiaj"` and `"  w tym tygodniu  "`, and manual criterion 4.7 plus the epilogue
  walk both used the bare form, which is why it went unobserved.
- **Fix A ⭐ Recommended**: Gate on "no letters or digits remain" in `src/lib/search.ts` —
  `!/[\p{L}\p{N}]/u.test(queryText)` instead of `queryText === ""`.
  - Strength: Leaves `stripPeriodPhrase`'s documented contract intact (it returns the question
    minus the phrase, nothing more) and puts the emptiness judgement at the consumer that needs
    it. One expression, one call site.
  - Tradeoff: Two notions of "empty" then coexist — the helper's `""` and the caller's "no word
    characters" — so a second consumer would have to re-derive the rule.
  - Confidence: HIGH — the failing input is reproduced and the fix is testable offline.
  - Blind spot: Not checked against a phrase plus a digit (`w lipcu 5?`), which should *not* take
    the window-only path.
- **Fix B**: Make `stripPeriodPhrase` return `""` when the residue holds no letters or digits.
  - Strength: One definition of empty everywhere; every present and future consumer inherits it.
  - Tradeoff: Changes the helper's semantics from "the question minus the phrase" to "…and nothing
    if that leaves no words", which the unit suite pins in nine places.
  - Confidence: MEDIUM — correct, but it widens the helper's remit beyond its stated job.
  - Blind spot: Whether a future caller wants the punctuation-only residue preserved.
- **Decision**: FIXED via Fix A (2026-10-28). `hasSearchableText()` added to `src/lib/search.ts`
  and used at all three sites (the window-only gate, the `embedText` guard, and the `degraded`
  computation). Verified by a temporary integration test calling the real `searchNotes` against
  the live database: with the fix, `"w lipcu"` and `"w lipcu?"` both return the same 4 in-window
  notes and `degraded` is false; with the gate reverted to `=== ""`, the same test prints
  `BARE=4 PUNCT=0` and fails. lint, astro check, 135 unit and 11 integration tests green after
  the change. The regression test itself is queued under F3 rather than left unnamed in the tree.

### F2 — The strip corrupts ordinary Polish words that contain a phrase

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/lib/date-range-parse.ts:108-117, 204-220
- **Detail**: The module matches phrases by bare substring on purpose (a trailing `\b` after `ł`/`ą`
  never fires in JS's ASCII-only definition). Removal inherits that, so a word that merely
  *contains* a phrase is mutilated. Verified by running the real function:
  `"Co jadł przedwczoraj?" → "Co jadł przed?"`, `"Czy przedwczoraj wymiotował?" → "Czy przed
  wymiotował?"`, `"Co było wczorajszego wieczoru?" → "Co było szego wieczoru?"`. These are words a
  parent types. Pre-existing: the parser already mis-windowed them (it reads `wczoraj` inside
  `przedwczoraj`). **New in phase 4**: the mutilated fragment now reaches both the tsquery and the
  embedding, so the text the search arms see is corrupted rather than merely diluted. The unit
  suite documents the class with a contrived instance (`"Nurofenów lipcu" → "Nurofenó"`) but no
  common one.
- **Fix A ⭐ Recommended**: Pin `przedwczoraj` and `wczorajszego` in the unit test as known,
  accepted behaviour; leave the matcher alone.
  - Strength: Costs nothing, makes a real wart visible instead of leaving it to be rediscovered,
    and keeps the shared matcher — on which parse/strip parity depends — untouched. Consistent
    with how this plan handled its other knowingly-abandoned cases.
  - Tradeoff: The corruption stays; a parent asking about the day before yesterday has their
    question edited behind their back.
  - Confidence: HIGH — purely additive, no behaviour change.
  - Blind spot: How often the affected forms actually occur in real use. Unmeasured.
- **Fix B**: Switch matching to a Unicode-aware lookaround — `(?<!\p{L})phrase(?!\p{L})` with the
  `u` flag, which works where `\b` fails.
  - Strength: Removes the whole class, for the parser and the strip at once, and the module's own
    comment rules out only `\b`, not a lookaround.
  - Tradeoff: It changes what the parser **recognizes**, not just what the strip removes — e.g.
    `"Nurofenów lipcu"` would stop returning a July window, and a pinned test asserts it does.
    That is a change to the date filter, outside this change's scope, and it must land on parse
    and strip together or parity breaks.
  - Confidence: MEDIUM — the regex is right; the blast radius on the 29-input parity suite and on
    the recognized set is the uncertain part.
  - Blind spot: Whether any real or seeded question depends on the current substring behaviour.
- **Decision**: FIXED via Fix A (2026-10-28). `tests/unit/date-range-parse.test.ts` now pins
  `"Co jadl przedwczoraj?" -> "Co jadl przed?"` and
  `"Co bylo wczorajszego wieczoru?" -> "Co bylo szego wieczoru?"` as accepted behaviour, with the
  comment recording why the lookaround fix belongs to a change of its own (it would alter what the
  date filter recognizes). No production code touched. 136 unit tests green.

### F3 — The phase-4 behaviour change has no test at any layer

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/notes.ts:41-72, src/lib/search.ts:42-50
- **Detail**: `listNotesInRange` and the window-only early return — the user-visible change phase 4
  shipped — are exercised by nothing. The new integration block covers only the similarity floor;
  the new unit tests cover `stripPeriodPhrase` in isolation, never through `search.ts`'s gate. The
  reason `notes-search.test.ts` gives for calling the RPC directly instead of importing
  `@/lib/search` does not apply here: `tests/integration/notes-read-boundaries.test.ts:17` already
  value-imports `listNotes` from `@/lib/notes` and works, because `vitest.config.ts:37` aliases
  `astro:env/server` to a stub. Had such a test existed, F1 would have been caught by it.
- **Fix**: Add one integration case in `notes-read-boundaries.test.ts`'s shape, asserting the
  window-only read returns the in-window notes in ascending `occurred_at` order — plus a case for
  `"w lipcu?"` once F1 is decided.
- **Decision**: FIXED (2026-10-28), with the calendar dependency removed rather than commented
  around. `tests/integration/notes-search-window.test.ts` calls the real `searchNotes` (importable
  for the same reason `notes-read-boundaries.test.ts` can import `@/lib/notes`) and asserts three
  things on a child of its own: the window-only read returns the in-window notes by id in ascending
  order, a note outside the window is excluded, and the punctuated form answers identically. The
  fixture gained a third child whose notes are seeded at `warsawWallClock(new Date())` and the
  question is `dzisiaj`, so the window cannot go empty as the calendar moves — a literal month would
  have made the assertion vacuous rather than red once 2026 passed. The notes deliberately carry no
  `embedding`, so a regression that started embedding a wordless question would surface. Verified by
  deliberate break: reverting the F1 gate to `=== ""` turns exactly one of the three red (the
  punctuated case) and leaves the other two green. Counters re-derived by running the tools — eslint
  58 exact, unit floor 136. All gates green: lint, astro check 0 errors, test:db, 14 integration
  tests across 4 files, gate:routes, gate:scope.

### F4 — 0.434 does not follow the overlap rule written in the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/note-search-similarity-floor/plan.md (Phase 2 item 3, and the
  `## What We're NOT Doing` entry on removing the floor)
- **Detail**: The plan fixed the rule in advance: *"If they overlap, set the value just below the
  lowest true positive."* The bands did overlap (`0.247..0.481`), so the rule read literally gives
  ≈`0.246`. The implementation chose `0.434` — the midpoint of the only gap of width ≥ 0.008 inside
  a self-defined decision window. The deviation is not hidden: `change.md:217-235` is headed
  *"Reguła, jej sprzeczność i adaptacja"*, argues that `0.246` would admit 142 of 468 measured
  values and would therefore **be** the floor removal the same plan forbids as its first
  exclusion, and records the user's acceptance plus a separate dated decision. The migration
  header repeats the argument. The finding is narrow and about provenance only: `plan.md` and the
  shipped constant disagree, so anyone citing the plan as the derivation's authority cites the
  wrong clause.
- **Fix**: Add one line to the plan's Phase 2 item 3 pointing at `change.md`'s adaptation section
  as the governing derivation.
- **Decision**: FIXED (2026-10-28). Phase 2 item 3 of `plan.md` now carries a paragraph stating
  that the clause no longer governs the shipped value, naming the contradiction between it and the
  first `## What We're NOT Doing` entry, and directing any reader to `change.md`'s adaptation and
  decision sections as the derivation of `0.434`. The original rule text is left intact above it —
  the point is that the rule was fixed in advance, so overwriting it would erase the evidence that
  it was.

### F5 — The seed creates a login-capable account whose password is published in the repo

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/seed.sql:48-102, supabase/config.toml:60-65
- **Detail**: Nothing secret is committed, and that deserves precision: `encrypted_password` is
  computed at apply time with a random `gen_salt('bf')`, so no reusable hash sits in the
  repository, and `haslo123` is a documented local convenience. The issue is **reach**. The file
  creates a fully usable account — `email_confirmed_at` set, a matching `auth.identities` row, and
  (since the phase-3 fix) the four token columns GoTrue needs — and `[db.seed] enabled = true` with
  `sql_paths = ["./seed.sql"]` applies it on `supabase db reset` **and** on a fresh
  `supabase start`. `supabase db reset` accepts `--linked` and `--db-url`, and nothing in the file
  or the config constrains the target to localhost. The 26 notes and 2 children are harmless
  committed; the account is the part with blast radius.
- **Fix A ⭐ Recommended**: Add a `-- LOCAL ONLY — never apply with --linked or --db-url` banner at
  the top of the file.
  - Strength: One line, no workflow change, and it puts the warning where someone about to run the
    dangerous command will read it.
  - Tradeoff: A comment stops nobody; it is a convention, not a control.
  - Confidence: HIGH — nothing mechanical changes, nothing can regress.
  - Blind spot: Whether anyone on this project would run `db reset --linked` at all.
- **Fix B**: Move the `auth.users` / `auth.identities` rows into a seed file **not** listed in
  `sql_paths`, documented as applied by hand.
  - Strength: Makes the reach structurally impossible rather than merely discouraged.
  - Tradeoff: `db reset` then no longer yields a usable UI session, so every manual walk needs an
    extra documented step — exactly the friction that produced the phase-3 login bug.
  - Confidence: MEDIUM — correct, but it trades a real hazard for a real papercut.
  - Blind spot: Whether the integration suite or any gate depends on the seeded account existing
    after a plain `db reset`.
- **Decision**: FIXED via Fix A (2026-10-28). `supabase/seed.sql` now opens with a seven-line
  LOCAL ONLY banner naming both dangerous invocations (`db reset --linked`, `--db-url`), saying
  that the password is published in the repository, that `[db.seed] enabled = true` applies the
  file without asking, and that the comment is the only thing standing between the two commands.
  Comment-only change; the corpus and the account rows are untouched. Fix B was considered and not
  taken: structurally safer, but it removes the usable UI session that a plain `db reset` currently
  gives, which is the exact friction that produced the phase-3 login bug.

### F6 — Three files outside the plan, and a second read path no contract describes

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/notes.ts:41-72, supabase/seed.sql, scripts/measure-similarity.mjs
- **Detail**: Exactly three files were touched outside the Changes Required, each with its reason
  recorded in the commit that made it: the seed's four GoTrue token columns (a phase-1 bug that
  blocked phase 3's own manual criteria 3.8–3.12), `measure-similarity.mjs`'s `CURRENT_THRESHOLD`
  (its own header requires it to move in the same commit as the default), and `listNotesInRange`.
  The last is the structural note: date-bound search now has a second, non-RPC read path, where the
  plan's Critical Implementation Details expected `search_notes`'s date branch to serve this case.
  The implementation's reasoning is correct and checkable — that branch requires `fts` **or** a
  vector match, and blank text with a null embedding fires neither — and the plan did say "decide
  the mechanism in Phase 4". Consequence to carry: if a `limit` is ever added it must land on this
  function and the SQL date branch together, or the two will disagree about a window's contents.
  All eight `## What We're NOT Doing` guardrails held, verified mechanically.
- **Fix**: Note the second read path and the paired-limit obligation in `listNotesInRange`'s
  docstring.
- **Decision**: FIXED (2026-10-28). `listNotesInRange`'s docstring now states that this is a second
  read path for date-bound search, why the SQL date branch cannot serve the case, and the standing
  obligation that a future `limit` must land here and on that branch in the same change.

### F7 — Strip regex mechanics: three latent edges

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/date-range-parse.ts:215-219
- **Detail**: Three small things, none currently reachable as a bug. **(a)** The punctuation tidy
  `/ ([?!.,;:])/g` is global, so it edits spacing unrelated to the removal site and leaves a
  leading separator when the phrase opened the sentence — verified:
  `"Gorączka , kaszel dzisiaj?" → "Gorączka, kaszel?"` and `"dzisiaj, co jadła?" → ", co jadła?"`.
  Cosmetic for the tsquery, a mild perturbation of the embedding. **(b)** `new RegExp(phrase, "i")`
  is built from a non-literal; safe today because every entry is letters plus one space with no
  user-input path, but a future phrase containing `.` `(` `-` or `?` silently becomes a pattern.
  **(c)** Discovery (`toLowerCase().includes`) and removal (the `i` flag) do not case-fold
  identically, so an exotic input can be found and not removed — it degrades to pre-change
  behaviour, so no action is needed there.
- **Fix**: Escape the phrase before constructing the regex, and note (a) in the comment.
- **Decision**: FIXED (2026-10-28). The phrase is escaped before `new RegExp`, with a comment
  saying why a module constant still gets escaped, and the global punctuation tidy now carries a
  comment naming both of its side effects with the `", co jadła?"` example. Behaviour is
  deliberately unchanged — re-checked by running the real function over five inputs, all identical
  to before, because no current phrase contains a metacharacter. That is the point: the escape
  removes a trap for the phrase somebody adds later, not a bug that exists today.

### F8 — measure-similarity.mjs is the only runnable script with no package.json entry

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: package.json, scripts/measure-similarity.mjs
- **Detail**: The script tracks `backfill-embeddings.mjs` closely and deliberately — identical
  `requireEnv` wording and env-var names, the same timeout rationale, the same exit-code tail, zero
  added dependencies, the same service-role justification — and its two divergences (raw `fetch`,
  fatal on an OpenAI failure) are both documented in the header. The one undocumented divergence:
  `smoke`, `backfill:embeddings` and every `gate:*` have a `package.json` script; this one does not,
  so it can only be run as `node scripts/measure-similarity.mjs`.
- **Fix**: Add `"measure:similarity": "node scripts/measure-similarity.mjs"`, or state in the
  header why it is deliberately absent.
- **Decision**: FIXED (2026-10-28). `"measure:similarity"` added to `package.json` next to
  `backfill:embeddings`, which is the script it already mirrors in every other respect. JSON
  re-parsed to confirm.

### F9 — A CI comment the seed made false

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .github/workflows/ci.yml:79
- **Detail**: The comment says the database "is migrated and holds zero rows only here" and calls
  that step's position load-bearing. With `[db.seed] enabled = true` and the new seed file,
  `supabase start` on a fresh volume now lands 1 user, 2 children and 26 notes before
  `supabase test db` runs. Nothing functionally breaks — every `count(*)` in `supabase/tests/` is
  scoped to a literal fixture id or a CTE, the pgTAP files roll back, and the three id spaces
  (`00000000-`, `f1c70000-`, `5eed0000-`) are disjoint — but the comment is now untrue, and it is
  the kind of untrue comment that gets trusted later.
- **Fix**: Reword the comment to say the database holds the seed corpus, and why that is harmless.
- **Decision**: FIXED (2026-10-28). The comment now says the database holds nothing but the
  committed seed corpus at that point, names `[db.seed] enabled = true` as the reason, gives the
  actual contents (one account, two children, 26 notes under the `5eed0000-` prefix) and states
  outright that the previous claim of an empty database was what changed.

### F10 — Two stale provenance details

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/integration/notes-search.test.ts:13,
  supabase/migrations/20261027140907_recalibrate_search_notes_similarity_floor.sql:9-10
- **Detail**: **(a)** The test header still reads *"trivially clears `search_notes`'s default 0.5
  similarity threshold"* while `fixtures.ts:206` was updated to `0.434` in the same commit — the
  sibling comment was missed. **(b)** The migration header presents
  `"Gorączka 39,1 wieczorem. Nurofen 5 ml o 21:00."` as a quotation of the note that produced the
  symptom, but the seeded `a010` (`seed.sql:198`) reads *"Gorączka 39,1 wieczorem. Nurofen o 21:30,
  czopek niepotrzebny. Dzwoniłam na nocną pomoc."*. The quoted text most likely comes from the
  earlier four-note measurement in `frame.md`, but the same header names `seed.sql` as the corpus,
  so as written the quote points at nothing in the repository. **(c)** The committed phase-4 test
  file carries two literal backspace control characters (`0x08`) in comment text where `` was
  meant -- `git show d32e2d3:tests/unit/date-range-parse.test.ts | grep -cP ''` returns 2, at
  lines 279 and 281. Introduced by a heredoc collapsing a doubled backslash while the file was
  being written. Neither sub-agent saw it, because a backspace renders invisibly in every tool that
  read the file; it surfaced only from a byte-level scan. A scan of every tracked file found no
  other occurrence (`public/favicon.png` aside, which is binary).
- **Fix**: Update the stale `0.5` to `0.434`, and either quote `a010` verbatim or attribute the
  older quote to `frame.md`. **(c)** was repaired in the working tree during this review; it still
  stands in commit `d32e2d3`.
- **Decision**: FIXED (2026-10-28), (b) by correction rather than by edit. (a) the test header now
  reads `0.434`. (c) was repaired in the working tree. (b) the migration header was deliberately
  NOT edited: the repo's rule is that a migration is never edited in place, this one is applied
  locally and pushed to the hosted project, and `supabase_migrations.schema_migrations.statements`
  was checked rather than assumed — it stores the whole file including comments (8232 characters
  for this version), so changing even a comment would make the repo file disagree with what is
  recorded as applied. The correction is recorded in `change.md` under
  `## Korekta cytatu w nagłówku migracji` instead, naming what the note actually says, where the
  quoted text most likely came from, and that the substantive symptom the header describes is
  itself confirmed by measurement.

## Success criteria verification

Automated criteria across all four phases, run in this session:

| Criterion | Result |
|---|---|
| 1.2 corpus query | PASS — 26 notes, 2 children, 26 embedded (threshold: ≥ 20) |
| 1.3 / 3.6 / 4.3 lint | PASS |
| 1.4 / 3.6 / 4.3 astro check | PASS — 0 errors, 58 files, 3 pre-existing hints in `scripts/` |
| 1.5 / 3.7 / 4.4 gate:scope | PASS — eslint 57 exact, astro 58 ≥ 48, unit 135 ≥ 135 |
| 3.2 test:db | PASS — 5 files, 26 tests |
| 3.3 / 4.1 test:unit | PASS — 3 files, 135 tests |
| 3.4 / 4.2 test:int | PASS — 3 files, 11 tests |
| 4.5 gate:routes, gate:build-output | PASS — 12 routes; build output clean on a fresh build |
| (outside the plan) gate:drift | PASS — 7 versions agree on both sides |

Not re-run, stated rather than assumed: `1.1`/`3.1` `supabase db reset` (destroys the local
database and costs 26 embedding calls; passed twice earlier today, once deliberately after the
seed fix, with sign-in confirmed on a pristine row), `1.6`/`1.7`/`2.1`/`2.2`
`measure-similarity.mjs` (18 OpenAI calls per run; ran during phase 4, exit 0, values reproduced to
three decimals against phase 2), and `3.5` the deliberate-break check (performed in phase 3 and
twice in phase 4).

Manual criteria: all 13 are `[x]`. Two carry caveats worth recording. `1.8` was accepted on a
reading of `seed.sql` and the database, not through the UI — and the phase-1 note's claim that the
seeded account could log in was false when written, corrected later in `change.md`. `4.7` passed on
the bare `w lipcu`; F1 shows the punctuated form fails, so that criterion is satisfied as literally
worded and **not** satisfied in spirit.

## Retracted during verification

Two sub-agent claims did not survive checking, recorded here so they are not rediscovered as
findings:

- **"`measure-similarity.mjs` reads `process.argv`, breaking the phase-1 contract."** False. The
  only occurrence of that string is the header comment at `:13` asserting its absence.
- **"A whitespace-only question still reaches `embedText`."** Not reachable.
  `src/pages/children/[id].astro:68` reads `searchParams.get("q")?.trim() ?? ""`, so a
  whitespace-only question never arrives at `searchNotes`.

## Verified clean

The parser refactor is behaviour-preserving, established by differential execution rather than by
reading: the old if-chain and the new switch were both reimplemented and compared over
**8,104 (input, anchor-date) pairs** — every phrase alone, upper-cased, prefix-glued, suffix-glued,
all 441 ordered phrase pairs, plus `we wrześniu`, bare `lipcu` and an unrecognized phrase, across 8
anchor dates spanning month, year and ISO-week boundaries. **Zero mismatches.**

Also verified clean: `listNotesInRange`'s cross-account isolation (line-by-line identical scoping to
`listNotes`, on the request-scoped anon client, so `public.notes` RLS plus the explicit `child_id`
filter apply — `serviceClient()` appears nowhere under `src/`); the migration (exactly one changed
line against its predecessor, no earlier migration touched, no caller passes the parameter, so no
deploy-ordering hazard); the service-role key's handling in the measurement script (env only,
headers only, never logged); `graded-vector.ts`'s construction and its one-way test dependency; the
absence of any hardcoded secret, injection surface or destructive operation in the diff; and
`lessons.md`'s single accepted rule, whose standing obligation to re-derive the ESLint count in the
same commit was met in all three commits that added linted files. Both bumped gate values were
confirmed by running the tools: eslint reports exactly 57 files, vitest exactly 135 passing tests.
