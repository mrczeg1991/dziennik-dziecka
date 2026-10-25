---
change_id: note-search-similarity-floor
title: Próg podobieństwa 0,5 odcina trafione notatki przy odmienionych pytaniach
status: implementing
created: 2026-10-24
updated: 2026-10-25
archived_at: null
---

## Notes

prog p_similarity_threshold 0.5 odcina trafione notatki przy odmienionych polskich pytaniach; zmierzyc i ustawic z danych

---

Wywodzi się z `/10x-frame` nad S-04 — dowód i liczby leżą w
`context/changes/note-search-precision/frame.md` (§Measurement, §Root Cause).
Ten kawałek jest tym, co z tamtego framingu wyszło jako prawdziwa wada; S-04
jako kawałek o rankingu został obalony pomiarem.

Pomiar z 2026-10-24 (`text-embedding-3-small`, cztery notatki, osiem pytań):

- trafienia: 0,475–0,662 · nie-trafienia: do 0,381 · luka 0,381–0,475 pusta
- koszt odmienionej formy: −0,12 do −0,20 · koszt frazy okresu: −0,03 do −0,07
- `Czy dostawał Nurofenu w lipcu?` → 0,475 → pusto
- `Czy dostawał Nurofenu?` → 0,507 → przechodzi o 0,007
- `Czy miał gorączkę w lipcu?` → 0,491 → pusto, przy notatce „Gorączka 38,5"

Ramię leksykalne nie może tego nadrobić: `to_tsvector('simple', …)` bez stemmingu,
a `websearch_to_tsquery` łączy słowa przez AND. Próg wektorowy jest jedyną bramką.

Trzy rzeczy do rozstrzygnięcia w planie, świadomie nieprzesądzone:

1. **Czy cofnąć `ed302b8`** — ona wprowadziła ten próg na gałąź RRF trzy dni temu.
   Cofnięcie przywraca wyniki zbyt szerokie, czyli inną wadę, nie brak wady.
2. **Skąd wziąć liczbę** — 0,42–0,44 rozdziela bezbłędnie na czterech notatkach,
   ale cztery notatki nie wystarczą, by ustawić stałą w produkcji.
3. **Czy próg zostaje domyślną wartością SQL, czy przechodzi do wywołującego** —
   dziś `src/lib/search.ts:33-39` nie przekazuje żadnego parametru tuningowego,
   więc każda zmiana wymaga migracji.

Tanie rzeczy do zabrania po drodze, każda z osobnym uzasadnieniem w `frame.md`:
usunięcie rozpoznanej frazy okresu przed `p_query_text` i `embedText`,
`asc`/`desc` w gałęzi datowej wbrew `listNotes` (`src/lib/notes.ts:31`), oraz
placeholder `np. Co jadła w zeszłym tygodniu?` popychający rodzica w pytania
o okres (`src/pages/children/[id].astro:115`).

Nie zmieniać progu i nie usuwać frazy w jednym kroku bez pomiaru pomiędzy —
inaczej żaden z efektów nie będzie przypisywalny.

## Faza 1 — adaptacje i zapis pomiaru wstepnego (2026-10-25)

**ADAPT (kryterium 1.7).** Kryterium zadalo identycznych liczb w dwoch przebiegach.
Endpoint embeddingow OpenAI nie jest bitowo deterministyczny: 2 z 505 wartosci
rozjechaly sie, maksymalnie o **0,0010**. To dziesiec razy poniżej rozdzielczosci
decyzji o progu (0,01) i okolo 90 razy poniżej luki miedzy pasmami zmierzonej
2026-10-24. Kryterium przyjete co do istoty — liczba daje sie wyprowadzic ponownie —
z rozjazdem zapisanym tutaj. Tekst kryterium w `plan.md` zostal nietkniety.

**ADAPT (logowanie do zasianego konta).** Plan nie przewidzial, ze konto z seeda musi
dac sie zalogowac, inaczej nie da sie wykonac recznego przegladu korpusu ani obchodu
pytan w UI w fazie 3. `seed.sql` zasiewa `auth.users` z haslem przez
`extensions.crypt`/`gen_salt('bf')`, ustawia `email_confirmed_at` (grant haslowy
odrzuca niepotwierdzony e-mail nawet przy `enable_confirmations = false`) oraz wiersz
w `auth.identities`, bez ktorego GoTrue nie rozwiaze konta e-mailowego.
Dane: `rodzic@local.test` / `haslo123`, w naglowku `seed.sql`.

**Korpus.** 26 notatek, dwoje dzieci (14/12), `occurred_at` 2026-02-03 .. 2026-10-12,
pula id `5eed0000-...` rozlaczna z harnessem testowym. `backfill:embeddings`:
26 found, 26 embedded, 0 skipped — pierwszy pelny przebieg od przepisania paginacji.

**Sygnal dla fazy 2, jeszcze nie decyzja.** Na 26 notatkach czysta luka z czterech
notatek **nie istnieje**. Trafienia rozciagaja sie od `.280` (samo „Nurofenu") i
`.347` („Co z uchem?") do `.608`; notatki, ktorych nikt nie nazwalby odpowiedzia,
dochodza do `.453`. Pasma zachodza na siebie. Prog pod najnizszym trafieniem to
~`0.28`, co wpuscilo by niemal wszystko. Regula „recall, zapisz koszt" ustalona przed
pomiarem moze wymagac ponownego przemyslenia w fazie 2.
