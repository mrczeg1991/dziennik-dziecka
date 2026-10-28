---
change_id: note-search-similarity-floor
title: Próg podobieństwa 0,5 odcina trafione notatki przy odmienionych pytaniach
status: archived
created: 2026-10-24
updated: 2026-10-28
archived_at: 2026-10-28T22:48:46Z
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

## Pomiar (faza 2, 2026-10-25)

**Przebieg.** `node scripts/measure-similarity.mjs` przeciw korpusowi z `supabase/seed.sql`
(26 notatek, dwoje dzieci, wszystkie z embeddingiem), zamrożony zbiór 18 pytań z
`scripts/measure-similarity.mjs:82-106`, model `text-embedding-3-small`. Oba przebiegi exit 0.
Rozjazd między przebiegami: **1 wartość z 468** (`a005` × „Co z uchem?", .333 → .334, czyli
≤ 0,001) — ten sam brak bitowego determinizmu endpointu, który faza 1 zapisała wyżej. Żadne pasmo,
żadna najlepsza trafiona notatka i żadna decyzja o progu się nie zmieniły, więc kryterium 2.2 jest
spełnione co do istoty, nie co do bitu.

Podczas pomiaru **nie ruszono żadnej stałej** w `search_notes`: `CURRENT_THRESHOLD` w skrypcie
został na `0.5`, `p_rrf_k` i `p_match_count` bez zmian, `git status supabase/` czysty przez cały
przebieg (kryterium 2.4).

### Tabela pytanie × notatka

Legenda notatek — `scripts/measure-similarity.mjs` drukuje ją przed tabelą; etykieta to cztery
ostatnie znaki uuid z seeda, `a*` to dziecko 1, `b*` to dziecko 2.

```
question  (a001..b005)                  a001  a002  b001  a003  b002  a004  a005  b003  a006  b004  a007  a008  b005  
----------------------------------------------------------------------------------------------------------------------
Czy dostawał Nurofenu w lipcu?          .464  .336  .224  .321  .279  .192  .370  .275  .252  .293  .286  .362  .250  
Czy dostawał Nurofen w lipcu?           .543* .394  .239  .375  .299  .198  .411  .332  .266  .333  .357  .445  .265  
Czy dostawał Nurofenu?                  .485  .346  .259  .331  .308  .230  .355  .275  .229  .285  .291  .340  .270  
Czy dostawał Nurofen?                   .600* .420  .305  .409  .350  .238  .419  .343  .255  .346  .385  .447  .302  
Nurofenu                                .305  .108  .080  .139  .121  .069  .167  .141  .083  .148  .133  .176  .139  
Nurofen                                 .458  .203  .087  .189  .132  -.003 .214  .189  .082  .173  .227  .282  .160  
Jaka była najwyższa gorączka?           .531* .452  .345  .368  .357  .315  .510* .310  .315  .328  .453  .403  .253  
gorączka                                .494  .349  .243  .330  .289  .202  .420  .255  .276  .374  .424  .342  .209  
Czy brała antybiotyk?                   .449  .429  .291  .568* .402  .281  .442  .394  .291  .363  .383  .597* .251  
Augmentin                               .243  .145  .088  .209  .189  .012  .208  .192  .086  .180  .157  .484  .058  
Kiedy było szczepienie w marcu?         .325  .280  .229  .393  .346  .254  .523* .258  .339  .405  .287  .396  .255  
Co z uchem?                             .291  .281  .195  .253  .236  .186  .333  .303  .234  .362  .334  .270  .216  
Czy uderzył się w głowę?                .297  .292  .263  .289  .259  .249  .269  .212  .193  .280  .264  .271  .290  
Ile waży?                               .255  .307  .494  .266  .478  .250  .247  .266  .273  .297  .228  .215  .268  
Czy dzisiaj coś się działo?             .360  .365  .334  .315  .325  .322  .372  .270  .355  .289  .382  .313  .300  
Czy był u dentysty w zeszłym tygodniu?  .366  .377  .317  .476  .428  .256  .387  .439  .301  .355  .380  .449  .251  
Czy ma uczulenie na orzeszki?           .358  .399  .259  .379  .343  .272  .353  .315  .357  .370  .398  .420  .246  
Kiedy był pierwszy raz w kinie?         .143  .188  .205  .217  .229  .404  .151  .162  .286  .138  .169  .124  .344  

question  (a009..b012)                  a009  b006  b007  b008  a010  a011  b009  a012  b010  a013  b011  a014  b012  
----------------------------------------------------------------------------------------------------------------------
Czy dostawał Nurofenu w lipcu?          .307  .223  .440  .363  .439  .600* .198  .234  .289  .235  .231  .338  .258  
Czy dostawał Nurofen w lipcu?           .383  .278  .529* .444  .516* .539* .219  .259  .383  .296  .296  .403  .313  
Czy dostawał Nurofenu?                  .316  .261  .482  .364  .463  .640* .200  .278  .290  .246  .244  .388  .275  
Czy dostawał Nurofen?                   .420  .330  .615* .469  .568* .604* .243  .326  .419  .327  .320  .474  .354  
Nurofenu                                .102  .094  .307  .187  .280  .438  .051  .054  .128  .071  .083  .160  .057  
Nurofen                                 .227  .138  .515* .314  .409  .395  .058  .106  .242  .145  .113  .226  .103  
Jaka była najwyższa gorączka?           .393  .253  .355  .365  .524* .374  .315  .303  .422  .284  .315  .207  .387  
gorączka                                .373  .270  .359  .298  .489  .247  .223  .217  .438  .299  .230  .216  .359  
Czy brała antybiotyk?                   .481  .406  .427  .545* .430  .413  .262  .382  .404  .370  .361  .475  .324  
Augmentin                               .195  .087  .237  .339  .222  .216  .041  .163  .142  .112  .102  .194  .044  
Kiedy było szczepienie w marcu?         .332  .189  .305  .381  .310  .327  .252  .231  .328  .242  .226  .321  .257  
Co z uchem?                             .296  .230  .320  .347  .316  .257  .279  .190  .326  .294  .206  .273  .302  
Czy uderzył się w głowę?                .347  .242  .299  .297  .302  .275  .254  .223  .239  .299  .194  .281  .402  
Ile waży?                               .274  .346  .236  .187  .248  .313  .256  .265  .273  .315  .322  .266  .300  
Czy dzisiaj coś się działo?             .352  .294  .327  .301  .397  .320  .259  .368  .428  .357  .280  .325  .419  
Czy był u dentysty w zeszłym tygodniu?  .428  .302  .402  .492  .403  .364  .300  .349  .400  .480  .316  .608* .383  
Czy ma uczulenie na orzeszki?           .453  .440  .389  .364  .385  .306  .218  .305  .412  .413  .281  .388  .394  
Kiedy był pierwszy raz w kinie?         .133  .160  .198  .178  .169  .200  .388  .257  .161  .172  .224  .211  .235  

* = at or above the current threshold 0.5
  (the flag reads the full-precision value; an unflagged .500 sits just under it)

Per-question bands:
question                                expected  sim     best      sim     >=0.5  what it isolates
-----------------------------------------------------------------------------------------------------------
Czy dostawał Nurofenu w lipcu?          a010      .439    a011      .600    1/26   odmiana + fraza okresu <- below
Czy dostawał Nurofen w lipcu?           a010      .516    a001      .543    4/26   forma podstawowa + fraza okresu
Czy dostawał Nurofenu?                  a010      .463    a011      .640    1/26   odmiana, bez frazy <- below
Czy dostawał Nurofen?                   a010      .568    b007      .615    4/26   forma podstawowa, bez frazy
Nurofenu                                a010      .280    a011      .438    0/26   samo słowo, odmiana <- below
Nurofen                                 a010      .409    b007      .515    1/26   samo słowo, forma podstawowa <- below
Jaka była najwyższa gorączka?           a010      .524    a001      .531    3/26   pełne zdanie, liczba w notatce
gorączka                                a010      .489    a001      .494    0/26   samo słowo, kontrola dla zdania wyżej <- below
Czy brała antybiotyk?                   a008      .597    a008      .597    3/26   kategoria leku, nie nazwa
Augmentin                               a008      .484    a008      .484    0/26   dokładna nazwa leku <- below
Kiedy było szczepienie w marcu?         a005      .523    a005      .523    1/26   fraza okresu + szczepienie
Co z uchem?                             b008      .347    b004      .362    0/26   krótkie, eliptyczne pytanie <- below
Czy uderzył się w głowę?                b012      .402    b012      .402    0/26   inne słowa niż w notatce <- below
Ile waży?                               b002      .478    b001      .494    0/26   liczba, jednostka w notatce <- below
Czy dzisiaj coś się działo?             (none)      -     b010      .428    0/26   fraza okresu, brak notatki z dzisiaj
Czy był u dentysty w zeszłym tygodniu?  a014      .608    a014      .608    1/26   fraza okresu poza okresem notatki
Czy ma uczulenie na orzeszki?           (none)      -     a009      .453    0/26   brak odpowiedzi w korpusie
Kiedy był pierwszy raz w kinie?         (none)      -     a004      .404    0/26   brak odpowiedzi w korpusie

'expected' is the note a parent would call the right answer; '(none)' means the corpus has none.
'<- below' marks an expected note the current threshold would drop -- a false negative.

Observed range across all 468 value(s): -.003 .. .640 (spread .643).
Values inside 0.44..0.56 (the current threshold +/-0.06): 36 of 468.
```

### Pasma — liczone tak, jak `search_notes` naprawdę filtruje

Tabela wyżej jest **międzydziecięca**: skrypt nie stosuje ani okna daty, ani `p_child_id`.
`search_notes` zawsze zawęża do jednego dziecka, więc pasma poniżej liczone są **w obrębie
dziecka, do którego pytanie się odnosi** — inaczej para pytanie × notatka innego dziecka
zawyżałaby sufit nie-trafień o wartość, której produkcja nigdy nie zobaczy.

„Trafienie" to notatka, którą rodzic uznałby za odpowiedź na pytanie, ocenione **z treści
notatki przeciw treści pytania, przed odczytaniem jakiejkolwiek wartości**. Zbiór jest szerszy niż
pole `expect` w skrypcie, bo `expect` nazywa jedną notatkę, a korpus ma pytania z kilkoma dobrymi
odpowiedziami (`Czy dostawał Nurofenu?` → `a001`, `a010` i `a011`, wszystkie trzy o Nurofenie).

| pasmo | liczba par | zakres |
| --- | --- | --- |
| trafienia | 37 | **0,247 .. 0,640** |
| nie-trafienia | 245 | **−0,003 .. 0,481** |
| zachodzenie | — | **0,247 .. 0,481** (szerokość 0,234) |

Wewnątrz zachodzenia siedzi **17 z 37 trafień i 163 z 245 nie-trafień**. Czysta luka 0,381–0,475
z pomiaru na czterech notatkach **nie istnieje** na 26 — sygnał z fazy 1 potwierdzony.

Najniższe trafienia: `a011@.247` („gorączka"), `a010@.280` („Nurofenu"), `a001@.305` („Nurofenu"),
`b008@.347` („Co z uchem?").
Najwyższe nie-trafienia: `a009@.481` („Czy brała antybiotyk?"), `a013@.480` („dentysta"),
`a003@.476` („dentysta"), `a014@.474` („Czy dostawał Nurofen?").

### Przemiatanie progu

Dla każdej wartości: ile pytań odpowiadalnych zwraca **co najmniej jedną** dobrą notatkę, ile
zwraca dokładnie tę z `expect`, i ile nie-odpowiedzi wpuszcza łącznie na 21 zakresów
pytanie × dziecko.

| próg | ≥1 dobra / 15 | `expect` / 15 | wpuszczone nie-odpowiedzi | najgorsze pytanie |
| --- | --- | --- | --- | --- |
| 0,50 (dziś) | 8 | 6 | 0 | 0 |
| 0,48 | 11 | 8 | 2 | 1 |
| 0,46 | 11 | 10 | 5 | 2 |
| 0,45 | 12 | 10 | 7 | 2 |
| **0,434** | **13** | **11** | **13** | **4** |
| 0,42 | 13 | 11 | 21 | 6 |
| 0,40 | 14 | 13 | 32 | 7 |
| 0,38 | 14 | 13 | 52 | 11 |
| 0,28 | 15 | 15 | 142 | 24 |

### Reguła, jej sprzeczność i adaptacja

**ADAPT (reguła wyprowadzenia).** Reguła z `plan.md` §„Derive the value": pasma rozdzielone →
środek pustej luki; pasma zachodzące → wartość **tuż pod najniższym trafieniem**, z zapisanym
kosztem. Najniższe trafienie to `0,247`, więc reguła dosłownie czytana daje **≈0,246** — co
wpuszcza 142 z 468 wartości i zwraca niemal całą kartotekę dziecka na każde pytanie, w tym na trzy,
na które korpus świadomie nie ma odpowiedzi. To jest funkcjonalnie **usunięcie progu**, czyli
pierwsza pozycja w `plan.md` §„What We're NOT Doing". Klauzula o zachodzeniu i ten zakaz przeczą
sobie na tych danych.

Adaptacja przyjęta przez użytkownika: **klauzulę „środek pustej luki" stosuje się do luki na
granicy decyzji, a nie do globalnej luki, której nie ma.** Przychylność dla recall zostaje jako
rozstrzygnięcie, na której granicy siedzieć, a liczba wpuszczonych nie-odpowiedzi jest zapisana
dokładnie tak, jak klauzula o zachodzeniu wymaga.

W oknie `0,390 .. 0,470` jest **dokładnie jedna** luka szerokości ≥ 0,008 — `0,430 → 0,438`.
Wszystko inne w tym oknie stoi 0,001–0,006 od siebie. Górna krawędź tej luki jest nośna:
`.438` to samo `Nurofenu` → `a011` („Rano 37,8. **Dałam Nurofenu** drugi raz, 5 ml") — dokładnie
ten przypadek odmienionego słowa-klucza, od którego ta zmiana się zaczęła.

### Wybrana wartość: `0.434`

`0,434 = środek(0,430 ; 0,438)`.

| | wartość |
| --- | --- |
| margines w dół (najbliższa wartość niżej) | `0,430` → **0,004** |
| margines w górę (najbliższa wartość wyżej) | `0,438` → **0,004** |
| pytania odpowiadalne zwracające ≥1 dobrą notatkę | **13 / 15** (było 8 / 15) |
| pytania zwracające notatkę z `expect` | **11 / 15** (było 6 / 15) |
| **wpuszczone nie-trafienia** | **13** na 21 zakresów pytanie × dziecko |
| najgorsze jedno pytanie | 4 nie-odpowiedzi, pod `a008@.597`, które i tak jest pierwsze |

Marginesy 0,004 są cztery razy nad rozjazdem embeddingu (≤ 0,001) zapisanym wyżej, więc żaden
przebieg nie przesunie decyzji przez tę granicę.

**Wpuszczone nie-trafienia, wszystkie 13** — klauzula o zachodzeniu wymaga tej listy, nie tylko
liczby:

```
Czy dostawał Nurofen w lipcu?  [c1] -> a008@.445
Czy dostawał Nurofen?          [c1] -> a008@.447, a014@.474
Jaka była najwyższa gorączka?  [c1] -> a007@.453
Czy brała antybiotyk?          [c1] -> a001@.449, a005@.442, a009@.481, a014@.475
Czy był u dentysty…?           [c1] -> a003@.476, a008@.449, a013@.480
Czy ma uczulenie na orzeszki?  [c1] -> a009@.453
Czy ma uczulenie na orzeszki?  [c2] -> b006@.440
```

Z tego tylko dwa wiersze („orzeszki") to pytania, na które korpus nie ma odpowiedzi — tam rodzic
dostanie **jedną** nietrafioną notatkę zamiast komunikatu o pustym wyniku. W pozostałych szum
siedzi **pod** notatką trafioną, więc rodzic czyta ją pierwszą. To jest dokładnie ten koszt, który
`plan.md` §„Derive the value" nazwał akceptowalnym: „rodzic wolałby przejrzeć jedną notatkę
więcej, niż przegapić tę, której szukał".

### Czego `0.434` nie naprawia

Dwa trafienia zostają pod progiem i **nie są tym samym rodzajem porażki**:

1. `Czy uderzył się w głowę?` → `b012@.402` („Spadł z kanapy, guz na czole"). **Naprawialne
   progiem** — sufit nie-trafień dla tego pytania to tylko `.299`. Ale żeby je sięgnąć, trzeba
   zejść do `0,40`, co podnosi szum z 13 do 32, każe pytaniu o orzeszki zwracać 5 notatek, i sadza
   liczbę w obszarze, gdzie wartości stoją 0,001 od siebie — próg wybrany na szumie.
2. `Co z uchem?` → `b008@.347`, przy czym nie-odpowiedź `b004@.362` („Szczepienie: błonica…")
   stoi **wyżej**. **Żaden próg tego nie naprawi** — to błąd rankingu w embeddingu krótkiego,
   eliptycznego pytania, nie pozycji progu. Należy do ramienia leksykalnego albo osobnej zmiany;
   `plan.md` §„What We're NOT Doing" słusznie parkuje reranker i model specjalizowany pod polski.

Obie pozycje są świadomie zostawione, nie przemilczane.

### Sonda poza zamrożonym zbiorem

`plan.md` kryterium 3.9 testuje `Czy miał gorączkę w lipcu?`, którego **nie ma** w zamrożonym
zbiorze 18 pytań. Zmierzone osobno, z oczekiwaniem zadeklarowanym przed odczytem wartości
(`a010` „Gorączka 39,1 wieczorem", 14.07):

```
Czy miał gorączkę w lipcu?   a001 .506   a005 .494   a010 .477 <- oczekiwana   a008 .429
Czy miała gorączkę w lipcu?  a001 .503   a005 .489   a010 .470 <- oczekiwana   a003 .453
```

`a010` przechodzi `0,434` z marginesem `0,043`. Pod `0,5` wypada, a `a001@.506`, które przechodzi,
jest z **lutego** — okno „w lipcu" je usuwa i rodzic dostaje pusto. To odtwarza zgłoszony objaw na
26-notatkowym korpusie dokładnie, nie tylko na czterech notatkach z `note-search-precision`.

Sonda jest zapisana jako sonda: zamrożony zbiór pytań w skrypcie **nie został zmieniony** po
odczytaniu pierwszej wartości (kryterium 2.3).

### Decyzja (2026-10-26)

Wymiana zaakceptowana przez użytkownika: **częściej odpowiadać, czasem dokładając zbędną
notatkę**. To ten sam wybór, który `plan.md` §„Derive the value" zapisał przed pomiarem.

`0,40` dałoby jedno odpowiedziane pytanie więcej, ale odrzucone: leży tam, gdzie zmierzone
wartości stoją 0,001 od siebie, czyli w zasięgu rozrzutu endpointu — próg chwiałby się między
przebiegami i nie dałby się uczciwie zapiąć testem. `0,434` jest najdalszą w stronę recall
wartością, która ma zapas (0,004 na stronę) większy od szumu pomiaru.

### Co z tego wchodzi do fazy 3

`p_similarity_threshold float default 0.434`, nagłówek migracji cytujący: korpus 26 notatek z
`supabase/seed.sql`, pasma `0,247..0,640` i `−0,003..0,481`, zachodzenie `0,247..0,481`, luka
`0,430→0,438`, 13 wpuszczonych nie-trafień, oraz obie zostawione pozycje wyżej. Fixture w fazie 3
siada na `0,434 ± 0,02`, czyli `0,454` i `0,414` — oba poza każdą wartością z luki, więc test
czerwienieje przy ruchu progu w dowolną stronę.

## Pomiar po fazie 3 (2026-10-27)

**Co się zmieniło.** `supabase/migrations/20261027140907_recalibrate_search_notes_similarity_floor.sql`
stawia `p_similarity_threshold float default 0.434`, a `CURRENT_THRESHOLD` w
`scripts/measure-similarity.mjs` idzie na tę samą wartość w tym samym commicie — tak, jak wymaga
nagłówek samego skryptu. Żaden inny parametr (`p_rrf_k`, `p_match_count`) nie został ruszony.

**Przebieg.** `npx supabase db reset` (siedem migracji + `supabase/seed.sql`), potem
`npm run backfill:embeddings` — 26 found, 26 embedded, 0 skipped — i
`node scripts/measure-similarity.mjs`, exit 0. Korpus i zamrożony zbiór 18 pytań bez zmian.

**Odtwarzalność względem fazy 2.** 455 z 468 wartości identyczne do trzech miejsc. 13 się rozeszło,
maksymalnie o **0,002**, i 11 z tych 13 siedzi w jednej kolumnie — notatce `b004`. To szerszy
rozjazd niż ≤0,001 z fazy 2 i ma inne źródło: tam przebiegi liczyły nowe wektory tylko dla pytań,
tu `db reset` wyczyścił embeddingi, więc backfill policzył na nowo cały korpus. Rozjazd nie dotyka
decyzji: sufit kolumny `b004` to `.405`, a **każda** wartość w przedziale `0,426 .. 0,442` — luka
`0,430 → 0,438` plus margines po obu stronach — odtworzyła się co do trzeciego miejsca (13 wartości,
0 rozjazdów). Próg stoi tam, gdzie faza 2 go postawiła.

**Efekt progu na zamrożonym zbiorze.** Flaga `<- below` (notatka z `expect` pod progiem) spada z
**8 na 4** z 18 pytań. Te cztery to: `Nurofenu` i `Nurofen` — gdzie `expect` to `a010`, ale
`a011@.438` i `b007@.515`, też notatki o Nurofenie, próg przechodzą, więc rodzic dostaje odpowiedź —
oraz `Co z uchem?` i `Czy uderzył się w głowę?`, dwie pozycje świadomie zostawione w §„Czego
`0.434` nie naprawia". To daje **13/15 pytań odpowiadalnych z co najmniej jedną dobrą notatką** i
**11/15 z notatką z `expect`** — dokładnie to, co przemiatanie progu przewidziało przed zmianą
migracji.

```
Per-question bands:
question                                expected  sim     best      sim     >=0.434what it isolates
-----------------------------------------------------------------------------------------------------------
Czy dostawał Nurofenu w lipcu?          a010      .439    a011      .600    4/26   odmiana + fraza okresu
Czy dostawał Nurofen w lipcu?           a010      .516    a001      .543    6/26   forma podstawowa + fraza okresu
Czy dostawał Nurofenu?                  a010      .463    a011      .640    4/26   odmiana, bez frazy
Czy dostawał Nurofen?                   a010      .568    b007      .615    7/26   forma podstawowa, bez frazy
Nurofenu                                a010      .280    a011      .438    1/26   samo słowo, odmiana <- below
Nurofen                                 a010      .409    b007      .515    2/26   samo słowo, forma podstawowa <- below
Jaka była najwyższa gorączka?           a010      .524    a001      .531    5/26   pełne zdanie, liczba w notatce
gorączka                                a010      .489    a001      .494    3/26   samo słowo, kontrola dla zdania wyżej
Czy brała antybiotyk?                   a008      .597    a008      .597    7/26   kategoria leku, nie nazwa
Augmentin                               a008      .484    a008      .484    1/26   dokładna nazwa leku
Kiedy było szczepienie w marcu?         a005      .523    a005      .523    1/26   fraza okresu + szczepienie
Co z uchem?                             b008      .347    b004      .362    0/26   krótkie, eliptyczne pytanie <- below
Czy uderzył się w głowę?                b012      .402    b012      .402    0/26   inne słowa niż w notatce <- below
Ile waży?                               b002      .478    b001      .494    2/26   liczba, jednostka w notatce
Czy dzisiaj coś się działo?             (none)      -     b010      .428    0/26   fraza okresu, brak notatki z dzisiaj
Czy był u dentysty w zeszłym tygodniu?  a014      .608    a014      .608    6/26   fraza okresu poza okresem notatki
Czy ma uczulenie na orzeszki?           (none)      -     a009      .453    2/26   brak odpowiedzi w korpusie
Kiedy był pierwszy raz w kinie?         (none)      -     a004      .404    0/26   brak odpowiedzi w korpusie

'expected' is the note a parent would call the right answer; '(none)' means the corpus has none.
'<- below' marks an expected note the current threshold would drop -- a false negative.

Observed range across all 468 value(s): -.003 .. .640 (spread .643).
Values inside 0.37..0.49 (the current threshold +/-0.06): 93 of 468.
```

**Jedna liczba, która się pogorszyła, zapisana bez wygładzania.** Wskaźnik „too close to call" ze
skryptu — wartości w `próg ± 0,06` — idzie z **36/468 na 93/468**. To nie jest regres decyzji, ale
nie jest też nic: `0,434` siedzi w gęstym środku rozkładu, nie na jego brzegu, więc pasmo ±0,06
łapie prawie cały obszar zachodzenia. Decyzja była podjęta na rozdzielczości **lokalnej** luki
(`0,004` na stronę wobec ≤`0,002` zmierzonego rozjazdu, i `0` rozjazdu przy samej granicy), a nie na
tym pasmie. `BAND_HALF_WIDTH` zostaje `0.06` — zmiana go teraz pod nową wartość progu byłaby
dopasowaniem instrumentu do wyniku.

**Co pinuje tę wartość.** `tests/integration/notes-search.test.ts` sieje dwie notatki na własnym
dziecku, na wektorach z `tests/support/graded-vector.ts`, przy `0,454` i `0,414`. Sprawdzone oba
kierunki: z domyślną wartością podmienioną z powrotem na `0.5` test czerwienieje
(`expected [] to strictly equal [c201]`), po przywróceniu `0.434` znów przechodzi, a pozostałe
cztery asercje w tym pliku zostają zielone w obu przebiegach.

**Faza 4 może się zacząć.** Pomiar progu jest zamknięty i zapisany, więc efekt usunięcia frazy
okresu będzie dawał się przypisać osobno.

## Poprawka seeda — logowanie na zasiane konto (faza 3, 2026-10-27)

**Korekta zapisu z fazy 1.** Nota „ADAPT (logowanie do zasianego konta)" wyżej twierdzi, że
`rodzic@local.test` / `haslo123` daje się zalogować. Nie dawało się. Pierwsza próba obchodu pytań
w UI (kryteria 3.8–3.12) skończyła się tym, że `/auth/signin` odrzucał to konto, a w jego miejsce
powstało świeże, puste konto przez `/auth/signup` — i aplikacja wyglądała jak baza bez danych,
chociaż 26 notatek z korpusu caly czas w niej siedziało.

**Objaw.** Grant hasłowy GoTrue zwracał:

```
{"code":500,"error_code":"unexpected_failure","msg":"Database error querying schema"}
```

Komunikat nie nazywa ani kolumny, ani wiersza, więc czyta się jak zepsuty lokalny stack, a nie
zepsuty seed.

**Przyczyna.** `seed.sql` wstawiał wiersz do `auth.users` bez czterech kolumn tokenowych:
`confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`. Ich domyślną
wartością jest NULL, a GoTrue czyta je do nienullowalnych stringów Go przy rozwiązywaniu konta, więc
skan wiersza wywala się przed sprawdzeniem hasła. Różnicę dało się zobaczyć przez porównanie wiersza
z seeda z wierszem, który GoTrue założył sam przy rejestracji: ten drugi ma w tych czterech
kolumnach `''`, i tylko w nich się różnił.

**Naprawa.** `supabase/seed.sql` wstawia teraz te cztery kolumny jako `''`, z komentarzem nad
insertem mówiącym dlaczego — żeby nikt ich nie „posprzątał" z powrotem do NULL. Wiersz w działającej
bazie został dodatkowo załatany w miejscu (`update auth.users set … where email = 'rodzic@local.test'`),
żeby obchód pytań nie wymagał kolejnego `db reset` i kolejnych 26 wywołań embeddingów. Po załataniu
grant hasłowy zwraca token dla `5eed0000-0000-0000-0000-000000000001`. Sam insert z poprawionego
seeda został sprawdzony przeciw prawdziwemu schematowi w transakcji z `rollback` (podstawione
id/e-mail) — parsuje się i aplikuje.

**Co z tego wynika dla fazy 1.** Kryterium 1.8 („korpus przeczytany i zaakceptowany") zostaje
zaliczone — korpus był czytany z `seed.sql` i z bazy, nie przez UI. Ale zdanie z noty fazy 1 o
logowaniu było nieprawdziwe w momencie zapisu i jest tutaj poprawione, a nie nadpisane.


## Obchód ręczny w UI (faza 3, 2026-10-27)

Kryteria 3.8-3.12 przeszedł użytkownik w aplikacji, na zasianym koncie `rodzic@local.test`, dziecko
Ala (`5eed0000-0000-0000-0000-0000000000c1`). Zaliczone wszystkie pięć. Dwa wymagają zapisu, bo ich
wynik nie jest tym, co tabela pomiaru przewidywała:

**3.10 - samo `Nurofenu`.** Zwróciło notatkę o Nurofenie, więc kryterium w swoim brzmieniu jest
spełnione: parent widzi notatkę, a nie komunikat „Brak notatek pasujących do pytania.". Zwróciło
jednak `a011` („Rano 37,8. Dałam Nurofenu drugi raz, 5 ml"), nie `a010` („Gorączka 39,1 wieczorem.
Nurofen o 21:30"), którą tabela trzymała jako `expect`. Przyczyna nie leży w progu. `a011` zawiera
dosłownie formę „Nurofenu", więc łapie je nawet arm pełnotekstowy, a wektorowo stoi na .438, czyli
nad 0.434. `a010` ma formę bazową „Nurofen", której `websearch_to_tsquery('simple', ...)` nie skleja
z „Nurofenu", bo nie robi stemmingu polskiego, a kosinusowo stoi na .280 - pod każdym progiem, który
w ogóle jest progiem. Odmienione zapytanie nie odzyska formy bazowej ani przez ten próg, ani przez
fazę 4 (zdejmowanie frazy okresu): to osobny brak, brak stemmingu, i zostaje tu zapisany zamiast
zaliczony po cichu.

**3.11 - `Czy dostawał Nurofenu?`.** Zwróciło wszystkie notatki o Nurofenie i pochodnych, nie jedną.
To jest ten realny margines, o który kryterium prosiło (przed zmianą ta notatka wchodziła z zapasem
`0.007`), i jest zgodne z decyzją o faworyzowaniu recall - gałąź RRF i tak ucina do
`p_match_count`. Gdyby kiedyś trzeba było to zacieśnić, kosztem jest właśnie recall, a nie ten próg.

**Co to nie testowało.** Obchód szedł przez konto zasiane; świeże konto założone przy okazji
(`marcin.zegunia@outlook.com`, jedno dziecko też o imieniu „Ala", zero notatek) pokazało przy okazji,
że RLS działa - ale dwa dzieci o tym samym imieniu na dwóch kontach to realna pułapka przy
diagnozie, bo puste dziecko wygląda w UI identycznie jak zasiane. Jedyne odróżnienie to prefiks id
w URL (`5eed0000-` = zasiane).

**Weryfikacja poprawki seeda pełnym resetem (2026-10-27, przed commitem fazy 3).** Łatka żywego
wiersza i transakcja z `rollback` dowodziły tylko, że insert się aplikuje - nie, że świeży
developer po `db reset` się zaloguje, a po to ta poprawka jest w pliku. Więc reset został powtórzony:
`npx supabase db reset` (7 migracji + seed, bez błędu), potem grant hasłowy na dziewiczo zasiane
konto bez żadnej łatki -> `HTTP 200`, `user = 5eed0000-0000-0000-0000-000000000001`. Następnie
`backfill:embeddings` (26 znalezionych, 26 zembeddowanych), `test:db` (5 plików, 26 testów, PASS)
i `test:int` (3 pliki, 11 testów, PASS) na odtworzonym korpusie.

## Pomiar po fazie 4 — ile daje strip, osobno od progu (2026-10-27)

Kryterium 4.9. Dwa przebiegi, bo atrybucja wymaga rozdzielenia dwóch rzeczy, które faza 3 i faza 4
zmieniły niezależnie.

**Przebieg 1: zamrożony zestaw bez zmian.** `node scripts/measure-similarity.mjs`, exit 0, 18 pytań
x 26 notatek. Wartości odtwarzają się co do trzeciego miejsca względem fazy 3 — te same `.439`,
`.516`, `.463`, `.568`, `.280`, `.409`, `.524`, `.489`, `.597`, `.484`, `.523`, `.347`, `.402`,
`.478`, `.428`, `.608`, `.453`, `.404`, te same 4 flagi `<- below`, ten sam zakres `-.003 .. .640`.
To jest kontrola: **faza 4 nie poruszyła decyzji o progu.** Skrypt mierzy pytania tak, jak zostały
napisane, więc dalej opisuje świat przed stripem, i dalej uzasadnia 0.434.

**Przebieg 2: atrybucja stripa.** Formy po stripie wzięte z prawdziwej `stripPeriodPhrase`, nie z
kopii algorytmu w skrypcie (jednorazowy test wypisał je do pliku, skrypt pomiarowy je wczytał).
Kosinus do notatki oczekiwanej, surowo kontra po stripie:

| pytanie | oczekiwana | surowo | po stripie | delta |
| --- | --- | --- | --- | --- |
| `Czy dostawał Nurofenu w lipcu?` | a010 | .439 | .463 | **+.024** |
| `Czy dostawał Nurofen w lipcu?` | a010 | .516 | .568 | **+.052** |
| `Kiedy było szczepienie w marcu?` | a005 | .523 | .505 | **-.018** |
| `Czy był u dentysty w zeszłym tygodniu?` | a014 | .608 | .646 | **+.038** |
| `Czy dzisiaj coś się działo?` | brak | - | - | sufit szumu .428 -> .445 |

**Zysk: +.024 do +.052 na trzech z czterech odpowiadalnych pytań z frazą.** Niezależna kontrola
spójności: forma po stripie pytania pierwszego to dosłownie `Czy dostawał Nurofenu?`, które w
zamrożonym zestawie jest osobnym wierszem, embedowanym osobno — i czyta `.463`, dokładnie tyle samo.

**Strip nie jest jednostronnie dobry, i to jest ustalenie, nie przypis.** `Kiedy było szczepienie
w marcu?` **traci** `.018`, bo notatka a005 sama dotyczy marca: fraza okresu była tam informacją o
treści, nie szumem do wyrzucenia. Zostaje `.505`, czyli wysoko nad 0.434, więc nic się dla rodzica
nie zmienia — ale założenie „fraza zawsze rozcieńcza pytanie", na którym ta faza stoi, jest
prawdziwe przeciętnie, a nie zawsze.

**Strip podnosi też pasmo szumu.** Sufit dla `Czy dzisiaj coś się działo?` (pytanie, na które korpus
nie ma odpowiedzi) idzie `.428 -> .445`, czyli **przechodzi nad 0.434**. Dla tego pytania jest to
bez skutku, bo gałąź datowa i tak nie ma w okienku „dzisiaj" ani jednej notatki, więc wynik jest
pusty niezależnie od wektora. Ale ogólne zdanie brzmi: strip przesuwa w górę oba pasma, nie tylko
trafienia, więc zjada część marginesu, który 0.434 miało nad pasmem prawdziwych negatywów. Próg
został wybrany na wartościach przed stripem i tutaj zostaje — przesuwanie go w górę na podstawie
jednego sufitu byłoby wybieraniem stałej na szumie, czego ta zmiana unikała od początku.

## Obchód ręczny po fazie 4 (2026-10-28)

Kryteria 4.6-4.8 przeszedł użytkownik w UI na `rodzic@local.test`, dziecko Ala
(`5eed0000-0000-0000-0000-0000000000c1`), które ma w lipcu dokładnie dwie notatki (a010 z 14.07 i
a011 z 15.07) -- więc każdy z trzech wyników dał się ocenić co do wiersza, a nie tylko „wygląda ok".
Zaliczone wszystkie trzy, bez rozbieżności wobec oczekiwań: pytania z frazą okresu zwracają swoje
notatki, samo `w lipcu` zwraca obie lipcowe notatki zamiast błędu albo pustki (nowa ścieżka, która
w ogóle nie dotyka `search_notes`), a pytanie bez frazy zachowuje się jak po fazie 3.

Plan jest wyczerpany: 37 z 37 pozycji Progress odhaczonych, cztery fazy zamknięte, migracja
`20261027140907` jest na hostowanym projekcie i `gate:drift` zgadza 7 wersji po obu stronach.

## Korekta cytatu w nagłówku migracji (impl-review, 2026-10-28)

Nagłówek `20261027140907_recalibrate_search_notes_similarity_floor.sql:9-10` podaje jako cytat
notatki: „Gorączka 39,1 wieczorem. Nurofen 5 ml o 21:00." **Takiej notatki nie ma w korpusie.**
Zasiane `a010` (`seed.sql:198`) brzmi: „Gorączka 39,1 wieczorem. Nurofen o 21:30, czopek
niepotrzebny. Dzwoniłam na nocną pomoc." Cytowany tekst pochodzi najpewniej z wcześniejszego,
czteronotatkowego pomiaru opisanego w `../note-search-precision/frame.md`, a nie z `seed.sql`,
który ten sam nagłówek wskazuje jako korpus — więc jako zapis proweniencji wskazuje na nic.

**Dlaczego poprawka jest tutaj, a nie w migracji.** Repo ma zasadę, że migracji nie edytuje się w
miejscu, a ta jest już zaaplikowana lokalnie i wypchnięta na hostowany projekt. Sprawdzone, nie
założone: `supabase_migrations.schema_migrations.statements` przechowuje **cały** tekst pliku razem
z komentarzami (8232 znaki dla tej wersji), więc edycja choćby komentarza rozjeżdża plik w repo z
tym, co zapisane jako zaaplikowane. Objaw merytoryczny — że 0.5 odcinało trafioną notatkę o
Nurofenie przy odmienionym pytaniu — jest prawdziwy i potwierdzony pomiarem; nieprawdziwy jest
tylko dosłowny cytat. Ta sekcja jest jego sprostowaniem.
