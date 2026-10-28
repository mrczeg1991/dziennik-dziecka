# Scenariusze weryfikacyjne przed /10x-plan — S-04 (`note-search-precision`)

> Wejście: `frame.md` (ten sam folder). Cel: rozstrzygnąć, czy S-04 to poprawka
> kierunku sortowania, czy realny problem rankingu — **zanim** zakres zostanie
> ustalony. Ręczne scenariusze, nie kod testowy.
>
> Obserwacja, od której się zaczęło, jest odtworzona z pamięci: nie zapisano ani
> treści pytania, ani kolejności wyników. Te scenariusze mają ją zastąpić zapisem.

## 0. Przygotowanie

Migracje S-03 są **tylko lokalne** — hostowany projekt nie ma wyszukiwania wcale.
Wszystko poniżej dotyczy lokalnego stacku.

1. `supabase start` (wymaga Dockera), potem `supabase db reset` — zakłada wszystkie
   sześć migracji, w tym `20261020200647_tune_search_notes_rrf_relevance.sql`.
2. **`OPENAI_API_KEY` w `.env` musi być ustawiony.** Bez niego `embedText` zwraca
   `null` (`src/lib/embeddings.ts:23-25`), a `createNote` zapisuje notatkę
   z `embedding = null` (`src/lib/notes.ts:56-59`) — notatka wypada z ramienia
   wektorowego na zawsze i każdy pomiar trafności jest bezwartościowy.
3. `npm run dev`, zaloguj się, utwórz jedno dziecko testowe.
4. Dodaj cztery notatki z **ręcznie ustawioną datą** (formularz pozwala ustawić
   `occurred_at`) — zestaw z §1.
5. **Sprawdź, że embeddingi powstały**, zanim zaczniesz mierzyć:
   ```sql
   select occurred_at, (embedding is not null) as ma_embedding, left(content, 40)
   from notes order by occurred_at;
   ```
   Jeśli któryś jest `null` → `npm run backfill:embeddings` i sprawdź ponownie.
6. Połączenie do lokalnej bazy: port weź z `supabase status`
   (zwykle `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`).

Pytania zadawaj przez pole „Zapytaj o notatki". Formularz jest GET, więc treść
pytania zostaje w adresie (`?q=...`) — to jest twój zapis, wystarczy skopiować URL.

**Dwa wskaźniki na ekranie, które mówią, co się stało** (`children/[id].astro`):

| Co widzisz | Znaczenie |
| --- | --- |
| niebieski banner `wyniki z okresu …` (`:135-137`) | rozpoznano okres → **gałąź chronologiczna**, zero rankingu, sortowanie `occurred_at` rosnąco |
| brak tego bannera | **gałąź RRF** — tu i tylko tu istnieje ranking |
| żółty banner `wyszukiwanie częściowo niedostępne — wyniki tylko tekstowe` (`:140-142`) | embedding = `null`, działa wyłącznie ramię leksykalne |
| `Brak notatek pasujących do pytania.` (`:145`) | zero wyników — nie „słaby ranking", a brak trafienia |

## 1. Zestaw notatek (dokładna treść i daty)

Dobrany tak, żeby notatka z dokładnym słowem była **najnowsza** (więc w sortowaniu
rosnącym wypada ostatnia) i **tematycznie odległa** od pytań o chorobę.

| # | `occurred_at` | Treść | Rola |
| --- | --- | --- | --- |
| N1 | 2026-07-05 09:00 | `Kupiłam nowe buty na jesień, rozmiar 27.` | wypełniacz, inny temat |
| N2 | 2026-07-12 20:00 | `Gorączka 38,5 wieczorem, zimne okłady.` | bliska znaczeniowo „chorobie", **bez** słowa Nurofen |
| N3 | 2026-07-20 14:00 | `Katar od trzech dni, dużo śpi.` | bliska znaczeniowo „chorobie", **bez** słowa Nurofen |
| N4 | 2026-07-28 18:30 | `Podałam Nurofen 2,5 ml, bo bolał ząb po wizycie u dentysty.` | **ma dokładne słowo**, najnowsza, temat: ząb/dentysta |

Dlaczego lipiec: `w lipcu` rozwiązuje się do najbliższego minionego lipca, nigdy
w przyszłość (`date-range-parse.ts:138-142`). Dziś jest 2026-10-23, więc lipiec 2026.

## 2. Grupa A — co właściwie zobaczyłeś (D4 / D4b)

### A1. Odtworzenie z frazą okresu
Pytanie: `Czy dostawał Nurofenu w lipcu?`
Zapisz: czy jest niebieski banner · kolejność notatek od góry.
**Oczekiwane, jeśli D4 trafione:** banner jest; wyniki idą N1 → N2 → N3 → **N4 na końcu**.
**Co rozstrzyga:** jeśli tak — to, co zobaczyłeś, nie jest wadą rankingu. To
sortowanie chronologiczne, udokumentowane i celowe
(`20261019215004_…sql:14-19`), a „za nisko" znaczy po prostu „najnowsza na dole".

### A2. To samo pytanie bez frazy okresu
Pytanie: `Czy dostawał Nurofenu?`
Zapisz: brak bannera · pozycja N4.
**Co rozstrzyga:** N4 na górze → ranking w tym przypadku działa, przesłanka S-04
słaba → zawęzić albo zaparkować. N4 pod N2/N3 → realna wada rankingu, **po raz
pierwszy zaobserwowana** (to jest warunek z `roadmap.md:136`).

### A3. Porównanie kierunku sortowania z listą obok
Po A1, nie zmieniając nic, porównaj kolejność wyników z listą notatek poniżej na
tej samej stronie.
**Oczekiwane:** lista jest od najnowszej (`notes.ts:31`, `occurred_at desc`),
wyniki od najstarszej (`…sql:139`, `asc`).
**Co rozstrzyga:** czy niespójność jest odczuwalna dla rodzica. Jeśli tak — to
najtańsza poprawka w całym S-04 i prawdopodobnie usuwa cały odczuwany problem.

### A4. Konfrontacja z pamięcią
Nie nowe pytanie — przypomnij sobie, czy przy tej pierwotnej obserwacji był
**niebieski banner `wyniki z okresu …`**. Jeśli tak, D4 jest potwierdzone wstecz.
Zwróć też uwagę, że podpowiedź w polu (`:115`) brzmi `np. Co jadła w zeszłym
tygodniu?` — sama zawiera rozpoznawaną frazę, czyli UI popycha do gałęzi bez rankingu.

## 3. Grupa B — czy ramię leksykalne w ogóle strzela (D1)

### B1. Forma podstawowa kontra odmieniona (samo słowo, bez okresu)
Zadaj kolejno: `Nurofen`, potem `Nurofenu`.
Zapisz: pozycję N4 w obu.
**Oczekiwane, jeśli D1(i) trafione:** `Nurofen` stawia N4 wysoko (ramię
leksykalne strzela), `Nurofenu` nie daje tej przewagi.
**Co rozstrzyga:** brak różnicy → o kolejności decyduje i tak embedding, a
dokładanie ostrości ramieniu leksykalnemu nic nie zmieni.

### B2. Samo słowo kontra pełne zdanie (oba w formie podstawowej)
Zadaj kolejno: `Nurofen`, potem `Czy dostawał Nurofen?`
Zapisz: pozycję N4 w obu.
**Oczekiwane, jeśli D1(ii) trafione:** samo słowo działa, zdanie nie —
`websearch_to_tsquery` łączy wyrazy przez AND, a `'simple'` nie usuwa polskich
słów funkcyjnych, więc notatka musiałaby zawierać `czy` i `dostawal` dosłownie.
**Co rozstrzyga:** to jest **większa** z dwóch przyczyn i niezależna od odmiany —
dotyczy każdego naturalnego pytania, także bez odmienionego słowa.

### B3. Potwierdzenie mechanizmu w SQL (30 sekund, zero dwuznaczności)
```sql
select websearch_to_tsquery('simple', public.immutable_unaccent('Czy dostawał Nurofen?'));
select to_tsvector('simple', public.immutable_unaccent('Podałam Nurofen 2,5 ml')) @@ websearch_to_tsquery('simple', public.immutable_unaccent('Nurofen'));
select to_tsvector('simple', public.immutable_unaccent('Podałam Nurofen 2,5 ml')) @@ websearch_to_tsquery('simple', public.immutable_unaccent('Nurofenu'));
select to_tsvector('simple', public.immutable_unaccent('Podałam Nurofen 2,5 ml')) @@ websearch_to_tsquery('simple', public.immutable_unaccent('Czy dostawał Nurofen?'));
```
**Oczekiwane:** (1) `'czy' & 'dostawal' & 'nurofen'` · (2) `true` · (3) `false` · (4) `false`.
**Co rozstrzyga:** cała analiza D1 w `frame.md` opiera się na udokumentowanym
zachowaniu tych funkcji, nie na uruchomionym zapytaniu. To je domyka.

## 4. Grupa C — pierwszy realny pomiar trafności

To jest scenariusz, na który czeka `roadmap.md:136` i `test-plan.md:924-930`:
obie pozycje są zaparkowane do czasu **pomiaru** pokazującego, że trafność S-03
jest realnie za niska.

### C1. Osiem pytań, oczekiwania zapisane z góry
**Najpierw** wypełnij kolumnę „oczekiwana", dopiero potem zadawaj pytania. Żadne
pytanie nie zawiera frazy okresu, więc wszystkie idą gałęzią RRF.

| # | Pytanie | Oczekiwana | Faktyczna #1 | Oczekiwana w top-3? |
| --- | --- | --- | --- | --- |
| 1 | `Czy dostawał Nurofenu?` | N4 | | |
| 2 | `Co z gorączką?` | N2 | | |
| 3 | `Czy miał katar?` | N3 | | |
| 4 | `Kiedy był u dentysty?` | N4 | | |
| 5 | `ile ml leku dostał` | N4 | | |
| 6 | `temperatura 38,5` | N2 | | |
| 7 | `Jakie buty kupiliśmy?` | N1 | | |
| 8 | `Czy chorował?` | N2 lub N3 | | |

**Jak czytać wynik:**

| Trafień #1 | Wniosek dla zakresu |
| --- | --- |
| 7–8 / 8 | Przesłanka S-04 jest teoretyczna. **Zaparkuj** albo zawęź do samej poprawki sortowania (A3). |
| 5–6 / 8 | Granicznie. Zrób tylko A3 + jedną najtańszą poprawkę wskazaną przez B1/B2. Nie buduj trzeciego ramienia. |
| ≤ 4 / 8 | Wada realna i zmierzona. S-04 dostaje zakres, a zapisy z B1/B2 mówią **który** wymiar naprawiać. |

Zapisz tę tabelę wypełnioną — to jedyny dowód, który przechodzi bramkę z roadmapy.

## 5. Grupa D — ryzyka już zgłoszone, wciąż nierozstrzygnięte

### D1s. Próg `0.5` z `ed302b8` (otwarte od zamknięcia S-03)
Pytanie: `Czy miał temperaturę?` (notatka mówi `Gorączka 38,5` — inne słowo, ten sam sens).
**Oczekiwane, jeśli próg jest za ostry:** `Brak notatek pasujących do pytania.`
**Co rozstrzyga:** migracja `20261020200647` sama ostrzega, że `0.5` nigdy nie
zmierzono na krótkim polskim tekście, a objawem przestrzelenia jest pusty wynik
dla notatki, która wyraźnie pasuje. Jeśli to wyjdzie — `ed302b8` wraca albo
dostaje inny próg, **niezależnie od S-04**.

### D2s. Zachowanie bez klucza OpenAI
Usuń `OPENAI_API_KEY`, zrestartuj `npm run dev` (notatki zostaw — mają już embeddingi).
Zadaj: `Nurofen`, potem `Nurofenu`.
**Oczekiwane:** żółty banner w obu; `Nurofen` → N4 wraca (ramię leksykalne);
`Nurofenu` → prawdopodobnie `Brak notatek pasujących do pytania.`
**Co rozstrzyga:** gdy OpenAI jest niedostępne, **odmienione pytanie nie zwraca
nic** — bo jedyny fallback jest słepy na odmianę. Tego ryzyka nikt dotąd nie zapisał.

### D3s. Niedeterminizm remisu
Zadaj to samo pytanie bez okresu pięć razy (odśwież stronę).
**Oczekiwane, jeśli remis `1/51` jest żywy:** kolejność zmienia się między
odświeżeniami przy identycznych danych.
**Co rozstrzyga:** gałąź RRF sortuje wyłącznie po `combined_score`, bez klucza
zapasowego — remis rozstrzyga planner. Jeśli to widać, brakujący tie-breaker
jest wadą samą w sobie.

## 6. Czego na tym etapie nie robić

- **Nie zmieniaj żadnej liczby w trakcie pomiaru.** `0.5`, `50` i `10` zostają
  tam, gdzie są, dopóki tabela z C1 nie jest wypełniona — inaczej mierzysz dwie
  rzeczy naraz.
- **Nie pisz jeszcze testów automatycznych.** Obecne fixture'y dzielą jeden
  wektor one-hot (`fixtures.ts:194-200`), więc pięć notatek ma odległość 0.0 —
  żadne twierdzenie o kolejności nie miałoby tam sensu bez wcześniejszej zmiany
  fixture'ów. To należy do planu, nie do weryfikacji.
- **Nie wdrażaj migracji na hosting, żeby to sprawdzić.** Cały zestaw działa lokalnie.
- **Nie dotykaj zaparkowanego rerankera ani modeli polskich**
  (`roadmap.md:136`) przed wypełnieniem C1.

## 7. Minimalny zapis do przeniesienia dalej

Po przejściu scenariuszy zanotuj w `change.md` (sekcja `## Notes`) cztery rzeczy:

1. A1: banner obecny tak/nie, kolejność wyników.
2. A2: pozycja N4 bez frazy okresu.
3. B1/B2: która forma pytania stawia N4 wysoko, a która nie.
4. C1: liczba trafień #1 na 8 i wniosek dla zakresu z tabeli w §4.

To zamyka otwartą niewiadomą z `roadmap.md:99` (owner: user) i jest wejściem do
`/10x-plan`.
