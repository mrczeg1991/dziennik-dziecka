---
change_id: note-search-precision
title: Pytanie o konkretne słowo zwraca właśnie tę notatkę, nie tylko podobną znaczeniowo
status: archived
created: 2026-10-23
updated: 2026-10-28
archived_at: 2026-10-28T23:23:46Z
---

## Notes

Roadmap slice **S-04** (`context/foundation/roadmap.md`) — prerequisite S-03
(`note-search-by-meaning`) is done and archived at
`context/archive/2026-10-16-note-search-by-meaning/`.

Outcome per roadmap: rodzic pytający o dokładne słowo — nazwę leku, liczbę, nazwisko
lekarza — dostaje notatkę zawierającą właśnie to słowo wyżej niż notatkę jedynie
podobną znaczeniowo. PRD refs: FR-006, §Business Logic.

Open before scoping — the roadmap's own unknown for this slice, owner: user, non-blocking:
czy nieostrość dopasowania znaczeniowego jest realnym problemem na tym zbiorze, czy
tylko teoretycznym. S-03 was supposed to answer it on real questions.

Relevant fact from S-03 as shipped: search is already **hybrid** — a generated
`notes.fts tsvector` (`to_tsvector('simple', immutable_unaccent(content))`, GIN index)
fused with the pgvector arm via RRF (`k = 50`) inside `search_notes()`. So a lexical
exact-word arm exists; what is not guaranteed is that an exact-word hit *outranks* a
merely-similar one. Scope this slice against that, not against a greenfield
"add keyword search".

Roadmap risk note for S-04: at the scale of one parent and two children it is easy to
build more here than anyone will ever use — if S-03 proved topical matching accurate
enough, this slice should be **narrowed or parked, not expanded**.

## Pomiar 2026-10-24 (dwie korekty diagnozy)

Lokalny stack, cztery notatki na jednym dziecku, daty w lipcu 2026 potwierdzone w UI.
Zmierzone rzeczywiste podobienstwo cosinusowe (text-embedding-3-small), prog 0.5:

| Pytanie | N4 (Nurofen) | Wynik w UI |
| --- | --- | --- |
| `Czy dostawal Nurofenu w lipcu?` | 0.475 | pusto |
| `Czy dostawal Nurofen w lipcu?` | 0.592 | wraca |
| `Czy dostawal Nurofenu?` | 0.507 | wraca (o 0.007) |
| `Czy dostawal Nurofen?` | 0.662 | — |
| `Czy mial goraczke w lipcu?` | N2 = 0.491 | pusto |

Trafienia: 0.475-0.662. Nie-trafienia: do 0.381. Luka 0.381-0.475 jest pusta.
Koszt odmiany: -0.12 do -0.20. Koszt frazy okresu: -0.03 do -0.07.

Korekta 1: objawem jest pustka, nie zla kolejnosc — kolejnosc jest poprawna
w kazdym z osmiu zmierzonych pytan.
Korekta 2: przyczyna nie jest fraza okresu (jak zapisano wczesniej), a **prog
0.5 lezacy w srodku pasma trafien** dla odmienionych polskich pytan.

Wnioski: przeslanka S-04 (rankingowa) obalona. Prawdziwa wada jest w S-03 —
niezmierzony prog `p_similarity_threshold`. Dowod i liczby w `frame.md`
§Measurement i §Root Cause.

Otwarta niewiadoma z `roadmap.md:99` zamknieta: nie, ranking dziala; problemem
jest odciecie.

## Zamknięcie: przesłanka odrzucona pomiarem (2026-10-28)

Ten folder nigdy nie doszedł do planu i nie powinien był. `frame.md` zmierzył przesłankę slice'a
S-04 i **ją odrzucił**: w ośmiu zmierzonych pytaniach kolejność wyników była poprawna, więc nie było
czego wyostrzać. Problem, który rodzic faktycznie zgłaszał, leżał gdzie indziej — w nigdy niezmierzonej
stałej `p_similarity_threshold = 0.5`, odcinającej trafione notatki przy odmienionych polskich
pytaniach.

**Co z tego wyszło:** `note-search-similarity-floor`, zarchiwizowane 2026-10-28 w
`context/archive/2026-10-24-note-search-similarity-floor/`. Cztery fazy, próg przeniesiony na
zmierzone `0.434`, fraza okresu przestała być wysyłana dwa razy, przegląd implementacji z dziesięcioma
znaleziskami. To jest dostarczona wartość tego frame'u — nie kod w tym folderze, bo tu żadnego nie ma.

**S-04 nie jest `done`.** Nic dla niego nie powstało; jego przesłanka upadła. Zaparkowany w
`context/foundation/roadmap.md` § Parked, dokładnie tak, jak przewidywał jego własny wpis Risk:
„jeśli po S-03 okaże się, że pytania są wyłącznie tematyczne i trafność wystarcza, ten kawałek należy
zawęzić albo zaparkować, nie rozbudować".

**Dlaczego ten folder w ogóle wchodzi do repozytorium, zamiast zostać usunięty.** `frame.md` jest
cytowany jako źródło pomiaru i odrzuconej przesłanki przez cztery zarchiwizowane dokumenty
(`2026-10-16-note-search-by-meaning/plan.md` i jego impl-review,
`2026-10-24-note-search-similarity-floor/plan.md` i `change.md`) oraz przez roadmapę — a do
2026-10-28 nie był w gicie ani jednym plikiem. Repozytorium powoływało się na dokument istniejący
tylko na jednej maszynie. Odnośniki w tamtych plikach używają ścieżki `context/changes/…`, sprzed tej
archiwizacji; dokument leży teraz pod `context/archive/2026-10-23-note-search-precision/`.
