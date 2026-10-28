---
change_id: testing-gates-that-gate
title: Gates that actually gate
status: archived
created: 2026-10-07
updated: 2026-10-28
archived_at: 2026-10-28T23:19:22Z
---

## Notes

Rollout Phase 2 of `context/foundation/test-plan.md` §3. Phase name there:
**"Gates that actually gate"**. Phase 1 (`testing-isolation-boundary`) is
`complete` and archived at `context/archive/2026-10-03-testing-isolation-boundary/`.

**Goal (§3).** Make CI fail for the three reasons it currently cannot: hosted
schema drifting from deployed code, a gate run that aborted rather than passed,
and a data-touching route never added to the guard list.

**Risks covered:** #2, #3, #6, #7. Two of these (#2, #3) are the remaining
High × High rows, which is why §3 orders this phase ahead of Phase 3 — it needs
no test runner.

**Test types planned (§3):** gates, route-coverage test, build-output assertion.

### Risk response intent — the behaviour each must prove protected

Copied from §2 Risk Response Guidance. These are behaviours and anti-patterns,
not code anchors; the anchors are `/10x-research`'s output for this phase.

- **#2** — Every page and endpoint that touches a parent's data refuses an
  anonymous request, _including one added after the test was written_.
  Cheapest layer: a test that enumerates route files and asserts each
  data-touching one is covered by the guard.
  **Anti-pattern:** a hand-maintained list of paths to check — it drifts the
  moment someone adds a route, which is the exact failure being guarded against.
- **#3** — A merge cannot produce a deployed app whose expected schema is absent
  from the hosted database, and divergence is reported rather than discovered by
  the parent at the moment of capture.
  Cheapest layer: a migration-drift check against the linked project, plus one
  authenticated read after deploy.
  **Anti-pattern:** treating a green build as a parity check; re-running the whole
  HTTP walk against production.
- **#6** — No secret value and no note body appears in the built client output,
  and an error shown to the parent carries a message without its cause.
  Cheapest layer: a scan of the build output for known secret values, plus a test
  on the error-response shape.
  **Anti-pattern:** scanning source instead of build output; asserting the literal
  current wording of an error string.
- **#7** — A lint or typecheck run that aborted, skipped, or matched zero files
  fails the gate instead of passing it.
  Cheapest layer: an assertion in CI on the reported file or check count.
  **Anti-pattern:** adding a second linter to catch the first one's failure;
  relying on exit codes alone.

### Gates this phase is expected to wire

All four still read `required after §3 Phase 2` in §5:

| Gate | Where | Risk |
| --- | --- | --- |
| gate-integrity check | CI | #7 |
| route-guard coverage | CI | #2 |
| build-output secret scan | CI | #6 |
| migration-drift check against the linked project | between merge and deploy | #3 |

### Carried forward from Phase 1 (2026-10-07) — live Risk #7 evidence

Three findings from implementing `testing-isolation-boundary` that bear directly
on this phase and are recorded nowhere else:

1. **A gate that had never run.** The database-policy CI step was committed
   (`fa0de8b`) and then sat unpushed for a day — `git branch -r --contains fa0de8b`
   returned empty, so the step had never once executed. It was only proven by
   pushing and watching run `37679261140`. A gate nobody has seen fire is not known
   to be a gate. This phase should make "did this gate actually run" machine-checkable
   rather than a manual step someone remembers to do.
2. **Gate reachability: most branches run no CI at all.**
   `.github/workflows/ci.yml` triggers only on `push: branches: [master]` and
   `pull_request: branches: [master]`. A push to any other branch runs nothing.
   Consequence: the mutation-check procedure the Phase 1 plan specified — "push a
   scratch branch and confirm CI fails" — could not work as written and needed a
   pull request (run `37681063537`, PR #9, closed unmerged). Worth covering as a
   gate-reachability gap.
3. **Husky was inert until 2026-10-07.** `.husky/pre-commit` existed and `husky`
   was a devDependency, but no `prepare` script meant `core.hooksPath` was never
   set, so the hook never ran. Fixed in `ff5882c`, along with a `.prettierignore`
   exempting `context/` and `.claude/`. A configured-but-inert gate is the same
   failure class as #7 — relevant precedent for whatever this phase checks.

Also: `context/foundation/lessons.md` records an ESLint rule that throws and
**aborts the entire lint run**, where an inline `eslint-disable` does not help
because directives filter only after the rule has already thrown. That entry is
the cited source of Risk #7 and the concrete case the gate-integrity check must
catch — but its `Rule:` and `Applies to:` fields are still `<to fill in>`.
Closing them out belongs to this phase.

## Domknięcie 5.7 — nocny sweep drift (2026-10-28)

Ostatni otwarty wiersz Progress był zostawiony świadomie 2026-10-11: cron `23 5 * * *` nie zdążył
odpalić, zanim faza 5 się zamknęła, a kryterium cron-owe nie może być zielone w momencie zamykania
własnej fazy. Decyzją było traktować sweep jako stałe monitorowanie, z zaleceniem „sprawdź pierwszy
przebieg; czerwony to realne znalezisko, nie formalność".

**Sprawdzone, i pierwszy przebieg był czerwony — a z nim trzy następne.** Przebiegi z 2026-10-12,
13, 14 i 15 (id `38254558197`, `38399797047`, `38548655673`, `38717332113`) padały w jobie `drift`
z jedną przyczyną: `SUPABASE_ACCESS_TOKEN` nie był dostępny dla zdarzenia `schedule`, więc
`supabase migration list` zwracał `LegacyPlatformAuthRequiredError`, a gate kończył się
`FAIL  migration drift: the CLI's JSON is not a recognised shape`.

To jest gate działający dokładnie jak zaprojektowany: brak sekretu **pada**, nie przemilcza — i to
właśnie ta własność sprawiła, że brakujący sekret dał się zauważyć, zamiast przez cztery dni
raportować zielono, nie sprawdzając niczego. Od 2026-10-16 sekret jest obecny i sweep jest zielony
13 dni z rzędu (id `38883718151` … `40679752629`).

**Druga połowa kryterium też sprawdzona**: log porównuje obie strony. Pierwszy zielony przebieg
wypisał `local (supabase/migrations): 20260923221601, 20260927205447` przeciw `remote (project ***)`
z tymi samymi dwiema wersjami i `PASS  migrations agree: 2 version(s) applied both sides`; przebieg
`40679752629` robi to samo dla wszystkich 7 wersji.

Czterodniowa luka jest zapisana, nie wygładzona. Gdyby ktoś czytał tylko ostatni przebieg,
zobaczyłby 13 zielonych dni i nie dowiedziałby się, że sekret trzeba było dodać.
