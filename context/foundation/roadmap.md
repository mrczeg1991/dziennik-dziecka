---
project: Dziennik dziecka
version: 3
status: draft
created: 2026-09-22
updated: 2026-10-21
prd_version: 1
main_goal: speed
top_blocker: time
milestone_id: ask-about-notes
milestone_seq: 2
milestone_status: open
---

# Roadmap: Dziennik dziecka

> Derived from `context/foundation/prd.md` (v1, transza FR-006) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-2: Pytanie o notatki dziecka** — Status: open

- **Intent:** Rodzic pyta własnymi słowami o notatki wybranego dziecka i dostaje listę pasujących notatek z datami i linkami do źródłowych wpisów. To wyróżnik produktu z PRD — jedyna rzecz, która odróżnia go od zwykłej aplikacji do notatek — dowieziony jako świadoma szybka kontynuacja po podstawowej pętli zamkniętej w M-1.
- **Source materials:** `context/foundation/prd.md` (v1) — transza FR-006, jedyne wymaganie funkcjonalne nieobjęte przez M-1 — plus opis użytkownika z 2026-10-01 dla S-05 (porządek identyfikacji produktu), którego PRD nie deklaruje.
- **Done when:** every S-NN below is `done`.
- **Scope anchors:** MS-01 (poniżej) oraz FR-006, PRD §Business Logic (odpowiedź to lista pasujących notatek z datami i linkami do źródła), §Success Criteria (kryterium drugorzędne — „główny wyróżnik pomysłu"), §Non-Functional Requirements (odpowiedź w ciągu 10 sekund), §Non-Goals (odpowiedzią jest lista notatek, nie wygenerowane streszczenie).
- **Punkt zakresu spoza PRD** — dopisany 2026-10-01 na prośbę użytkownika, źródłem jest jego opis, nie PRD:
  - MS-01: Wejście do aplikacji przedstawia produkt, którym aplikacja jest. Nigdzie — ani na stronie wejściowej, ani w tytule karty przeglądarki, ani w komunikacie błędu konfiguracji, ani w nieużywanych resztkach plików — nie zostaje ślad po szablonie startowym, na którym projekt postawiono. Treść wejściowa oraz logowanie i rejestracja są po polsku, spójnie z językiem produktu.

  > M-2 miał być kamieniem czysto o pytaniu o notatki. Ten punkt jest świadomym wyjątkiem: termin oddania to 2026-11-04, a aplikacja przedstawia się dziś odwiedzającemu nazwą szablonu startowego — odłożenie tego do następnego kamienia znaczyłoby oddanie projektu w tym stanie. Kawałek nie ma żadnych zależności z S-03 ani S-04, więc nie wydłuża drogi do gwiazdy przewodniej.

- **Zakres pytania:** per dziecko. FR-006 mówi o notatkach *jednego* dziecka („a child's notes"), więc pytanie zadaje się na stronie tego dziecka — tak samo, jak dodaje się tam notatki. Dziecko bierze się z kontekstu strony, nie z rozpoznawania imienia w treści pytania.
- **Dane wysyłane do modelu:** rozstrzygnięte — notatki mogą opuścić dotychczasowy hosting. Zamyka to pytanie otwarte w poprzedniej wersji roadmapy. Podstawa: w pytaniu nie ma imienia (dziecko bierze się z adresu strony, nie z treści pytania), a notatki nie zawierają danych jednoznacznie identyfikujących. Zostaje jedno sprawdzenie przed jednorazowym przetworzeniem istniejącego zbioru — patrz niewiadoma w S-03.

## Vision recap

Rodzic dwójki dzieci nie pamięta drobnych faktów o nich — pomiarów, objawów, kamieni milowych rozwoju — i nie potrafi ich szybko odtworzyć, np. przed wizytą u lekarza. M-1 zamknęło zapisywanie: konto, dziecko, notatka, która nie ginie i którą widzi tylko właściciel konta. Zostało odtwarzanie — zapytanie o te notatki zwykłym językiem i otrzymanie listy pasujących wpisów z datami i linkami do źródła, bez przewijania całej listy ręcznie.

## North star

**S-03: Rodzic pyta o notatki dziecka i dostaje pasujące notatki z datami** — to najmniejszy kompletny przepływ, który dowodzi wyróżnika produktu: że pytanie zadane własnymi słowami znajduje właściwe notatki.

> „North star" (gwiazda przewodnia) oznacza tu najmniejszy kawałek funkcjonalności od początku do końca, którego dostarczenie potwierdza główne założenie produktu — dlatego stoi możliwie wcześnie: wszystko inne ma sens tylko wtedy, gdy to działa. Przy celu „szybkość dostarczenia" świadomie wybrano wariant obejmujący dopasowanie znaczeniowe, a nie samo szukanie po słowach: hostowana baza nie ma polskiej konfiguracji szukania tekstowego, więc wersja oparta tylko na słowach nie dopasowałaby „gorączka" do „gorączki" i nie dowiodłaby hipotezy dla polskich odmian.

## At a glance

| ID   | Change ID               | Outcome (user can …)                                                                                             | Prerequisites | PRD refs                                                                                | Status   | Issue |
| ---- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------- | -------- | ----- |
| S-03 | note-search-by-meaning  | rodzic pyta na stronie dziecka własnymi słowami i dostaje jego pasujące notatki z datami i linkami do źródła      | S-02          | FR-006, §Business Logic, §Success Criteria, §Non-Functional Requirements, §Non-Goals     | done    | —     |
| S-04 | note-search-precision   | rodzic pyta o konkretne słowo i dostaje właśnie tę notatkę, a nie tylko podobne znaczeniowo                       | S-03          | FR-006, §Business Logic                                                                 | proposed | —     |
| S-05 | landing-product-identity | rodzic wchodzący na stronę widzi, że to Dziennik dziecka, i loguje się po polsku — bez śladu szablonu startowego  | —             | MS-01, §Access Control (ekran logowania)                                                | done        | —     |

## Baseline

What's already in place in the codebase as of `2026-10-01` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 7 + React 19 + Tailwind 4; dashboard oraz strona dziecka z dodawaniem, edycją i miękkim usuwaniem notatek (`src/pages/children/[id].astro`). Brak jakiegokolwiek miejsca na zadanie pytania. **Wejście do aplikacji jest nadal wejściem szablonu startowego**: nagłówek „10x Astro Starter" i trzy karty opisujące sam szablon (`src/components/Welcome.astro`), domyślny tytuł karty przeglądarki „10x Astro Starter" oraz `lang="en"` (`src/layouts/Layout.astro`), link do repozytorium szablonu w banerze błędu konfiguracji (`src/lib/config-status.ts:16`), nieużywany nigdzie `src/components/ui/LibBadge.astro` oraz `public/template.png`. Formularze logowania i rejestracji są po angielsku przy polskim banerze konfiguracji — język interfejsu jest niespójny. To luka MS-01, nie FR-006.
- **Backend / API:** present — punkty wejścia logowania oraz aplikacji: `src/pages/api/children.ts`, `api/notes.ts`, `api/notes/[id].ts`. Brak punktu wejścia dla pytania o notatki.
- **Data:** present — tabele `children` i `notes` z RLS, dwie migracje w `supabase/migrations/`; notatka ma treść i własny czas zdarzenia (`occurred_at`), usuwanie jest miękkie, polityki `delete` celowo nie ma. Istnieje indeks `notes_child_id_occurred_at_idx` na `(child_id, occurred_at desc, created_at desc)` — filtrowanie po dziecku i po dacie jest już tanie. **Brak natomiast jakiejkolwiek infrastruktury szukania po treści** — ani indeksu tekstowego, ani miejsca na reprezentacje znaczeniowe. To jedyna realna luka M-2.
- **Auth:** present — rejestracja, logowanie i wylogowanie przez Supabase plus middleware chroniące strony zalogowanego rodzica (`src/middleware.ts`).
- **Deploy / infra:** present — Cloudflare Workers (`wrangler.jsonc`), CI z zadaniami `ci` i `smoke` na `master`; wdrożenie ręczne wg runbooka, bez automatu po merge. Dostęp do modelu nie jest jeszcze skonfigurowany. Darmowy plan wystarcza: czekanie na odpowiedź zewnętrznej usługi nie wlicza się do limitu czasu procesora — to zamyka pytanie o przejście na plan płatny, otwarte w poprzedniej wersji roadmapy (rozstrzygnięte w `context/foundation/fr-006-research/`).
- **Observability:** partial — tylko wbudowane `observability.enabled` w `wrangler.jsonc`; brak zewnętrznego śledzenia błędów.

Ścieżka weryfikacji istnieje i jest gotowa do użycia przez oba kawałki: `npm run lint`, `astro check`, `npm run build`, `npm run smoke`.

## Foundations

Brak — świadomie. Wszystkie warstwy przekrojowe (dane, logowanie, punkty wejścia, wdrożenie) raportuje Baseline jako obecne, a jedyna luka — infrastruktura szukania po treści — ma w tym kamieniu milowym dokładnie jednego odbiorcę: S-03. Wydzielenie jej jako osobnego kawałka przekrojowego zbudowałoby całą warstwę przed pierwszym użyciem przez rodzica i odebrałoby S-03 jego pionowy charakter, nie dając w zamian ani odblokowania drugiego kawałka, ani zamknięcia żadnego pytania. Zgodnie z zasadą wprowadzania elementów technicznych dopiero tam, gdzie są pierwszy raz potrzebne, infrastruktura szukania powstaje wewnątrz S-03.

## Slices

### S-03: Rodzic pyta o notatki dziecka i dostaje pasujące notatki z datami

- **Outcome:** rodzic na stronie wybranego dziecka zadaje własnymi słowami pytanie o jego notatki i dostaje listę pasujących notatek z datami i linkami do źródłowych wpisów. Dopasowanie po temacie działa też wtedy, gdy w pytaniu użył innego słowa lub innej formy niż w notatce („gorączkę" znajduje notatkę „gorączka 38,5" i notatkę „temperatura 38,5"). Pytanie o okres („w lipcu", „ostatni tydzień") zawęża wynik twardo do tego przedziału i zwraca z niego wszystkie pasujące notatki, nie tylko kilka najbardziej podobnych.
- **Change ID:** note-search-by-meaning
- **PRD refs:** FR-006, §Business Logic, §Success Criteria, §Non-Functional Requirements, §Non-Goals
- **Prerequisites:** S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Czy w notatkach napisanych do tej pory nie ma imion ani innych danych jednoznacznie identyfikujących? Decyzja o wysyłaniu notatek na zewnątrz opiera się na założeniu, że ich nie ma, a jednorazowe przetworzenie istniejącego zbioru jest nieodwracalne. To przegląd własnych notatek, nie badanie. — Owner: user. Block: no (przed jednorazowym przetworzeniem, nie przed planowaniem).
  - Jaka jest realna trafność dopasowania na polskich, skrótowych notatkach o zdrowiu? Liczby z benchmarków są przybliżeniem, nie pomiarem na tym zbiorze. — Owner: user. Block: no (mierzalne tylko po wdrożeniu, na własnych notatkach).
  - Czy darmowy plan hostingu obejmuje wybrany model i jaki rozmiar ma jego reprezentacja? Rozmiar trzeba znać przed utworzeniem miejsca na nią. — Owner: user. Block: no (do sprawdzenia przy implementacji).
- **Risk:** Gwiazda przewodnia M-2 i jedyny kawałek, który dotyka całego zbioru notatek naraz — notatki napisane przed tym kawałkiem trzeba jednorazowo przetworzyć, a ten krok jest nieodwracalny, więc przegląd ich treści idzie przed nim, nie po nim. Druga zasada ochronna PRD („notatki dziecka widzi tylko zalogowane konto") musi obowiązywać również w szukaniu: wyniki nie mogą przeciekać ani między kontami, ani między dziećmi tego samego konta — zakres per dziecko jest tu pomocą, nie zabezpieczeniem. Dwie pułapki wykonania, których nie wolno pomieszać: pytanie o okres wymaga twardego odcięcia po dacie i kompletności w przedziale (pytanie „jak często" na rankingu podobieństwa po prostu zwróci złą liczbę), a jednorazowe przetworzenie istniejących notatek to inna ścieżka niż odpowiadanie na pytanie w 10 sekund. Test kompletności przedziału należy do tego kawałka: `context/foundation/test-plan.md` §3 Faza 3 przekazała go tutaj, bo czytanie, które miałby sprawdzać, powstaje dopiero w S-03 — a oczekiwany zbiór notatek musi pochodzić z fixture'u, nigdy z tego samego zapytania, które jest testowane.
- **Status:** done

### S-04: Rodzic pyta o konkretne słowo i dostaje właśnie tę notatkę

- **Outcome:** rodzic pytający o dokładne słowo — nazwę leku, liczbę, nazwisko lekarza — dostaje notatkę zawierającą właśnie to słowo wyżej niż notatkę jedynie podobną znaczeniowo.
- **Change ID:** note-search-precision
- **PRD refs:** FR-006, §Business Logic
- **Prerequisites:** S-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Czy nieostrość dopasowania znaczeniowego jest w praktyce realnym problemem na tym zbiorze, czy tylko teoretycznym? Dopasowanie po temacie bywa zbyt pojemne (notatka „katar od trzech dni" leży blisko „gorączki", bo oba znaczą „dziecko choruje") — ale czy to przeszkadza, pokaże dopiero S-03 na prawdziwych pytaniach. — Owner: user. Block: no.
- **Risk:** Dokłada ostrość tam, gdzie dopasowanie znaczeniowe jest z natury rozmyte, i to jest cała wartość tego kawałka. Idzie po S-03, bo bez działającego przepływu pytania nie ma czego wyostrzać. Ryzyko odwrotne niż zwykle: przy skali jednego rodzica i dwóch dzieci łatwo zbudować tu więcej, niż ktokolwiek kiedykolwiek użyje — jeśli po S-03 okaże się, że pytania są wyłącznie tematyczne i trafność wystarcza, ten kawałek należy zawęzić albo zaparkować, nie rozbudować.
- **Status:** proposed

### S-05: Rodzic wchodzi na stronę i widzi Dziennik dziecka, nie szablon startowy

- **Outcome:** rodzic, który wchodzi na stronę główną albo wprost na logowanie, widzi treść o Dzienniku dziecka — czym produkt jest i do czego służy — a nie opis szablonu startowego ani jego trzech cech technicznych. Tytuł karty przeglądarki nazywa produkt. Logowanie i rejestracja są po polsku. W repozytorium nie zostaje nieużywany plik ani odnośnik, który istnieje tylko dlatego, że projekt postawiono na szablonie.
- **Change ID:** landing-product-identity
- **PRD refs:** MS-01, §Access Control (ekran logowania)
- **Prerequisites:** —
- **Parallel with:** S-03, S-04
- **Blockers:** —
- **Unknowns:**
  - Jaka treść ma stanąć na stronie wejściowej w miejsce kart o szablonie — jedno zdanie o produkcie i wejście do logowania, czy więcej? Opis produktu z PRD (§Vision) wystarcza jako materiał; to decyzja o długości, nie o treści. — Owner: user. Block: no (do rozstrzygnięcia w planie).
- **Risk:** Najmniejszy kawałek M-2 i jedyny, który nie dotyka danych — żadnej migracji, żadnego punktu wejścia, żadnego dostępu do notatek, więc i żadnego ryzyka dla drugiej zasady ochronnej PRD („notatki dziecka widzi tylko zalogowane konto"). Brak zależności pozwala puścić go równolegle do S-03, więc nie wydłuża drogi do gwiazdy przewodniej. Dwie pułapki. Pierwsza: kosmiczny motyw wizualny szablonu (ciemne tło, świetlne kule, pole gwiazd) zostaje w tym kawałku świadomie — ekran przestanie *mówić* „szablon startowy", ale nadal będzie tak *wyglądał*; jeśli to zacznie przeszkadzać, jest to osobna sprawa wizualna, nie rozszerzenie tego kawałka. Druga: usunięcie pliku jako nieużywanego idzie po sprawdzeniu, że faktycznie nikt go nie importuje — pomyłka tutaj psuje działający ekran, zamiast sprzątnąć śmieć.
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID              | Suggested issue title                                              | Ready for `/10x-plan` | Notes                                  | Issue |
| ---------- | ---------------------- | ------------------------------------------------------------------ | --------------------- | -------------------------------------- | ----- |
| S-03       | note-search-by-meaning | Rodzic pyta o notatki dziecka i dostaje pasujące notatki z datami  | yes                   | Run `/10x-plan note-search-by-meaning` | —     |
| S-04       | note-search-precision  | Rodzic pyta o konkretne słowo i dostaje właśnie tę notatkę          | no                    | Czeka na S-03                          | —     |
| S-05       | landing-product-identity | Wejście do aplikacji przedstawia Dziennik dziecka, nie szablon startowy | yes                   | Run `/10x-plan landing-product-identity` | —     |

> Zadania M-1 były prowadzone jako issues w GitHubie (`mrczeg1991/dziennik-dziecka`): #1, #2 plus pytania #3–#5 i zaparkowane #6–#8. Dla M-2 issues nie są jeszcze utworzone — kolumna `Issue` czeka na numery.

## Open Roadmap Questions

1. **Jaka jest spodziewana liczba zapytań na sekundę i orientacyjna objętość danych?** — `target_scale.qps` i `target_scale.data_volume` nie zostały ustalone podczas kształtowania pomysłu; znane jest tylko `users: small`. Owner: user. Block: none (domyślne założenia dla małej skali są bezpieczne).

> Pytanie o to, czy notatki mogą opuścić dotychczasowy hosting, zostało rozstrzygnięte 2026-10-01 — patrz `## Milestone`, pozycja „Dane wysyłane do modelu". Wybór konkretnego dostawcy należy do planu S-03; roadmapa nazw usług nie trzyma.

## Parked

- **Automatyczne wdrożenie po merge (GitHub Actions → Cloudflare)** — Why parked: wskazówka `ci_default_flow: auto-deploy-on-merge` z `tech-stack.md`, ale żaden kawałek M-2 tego nie wymaga; ręczne wdrożenie wg runbooka wystarcza dla jednego użytkownika.
- **Zewnętrzne śledzenie błędów** — Why parked: PRD nie stawia wymagań obserwowalności; wbudowane logi hostingu wystarczają na MVP.
- **Dalsze podnoszenie trafności szukania (drugi przebieg przestawiający wyniki, modele wyspecjalizowane dla polskiego)** — Why parked: badanie FR-006 uznaje to za przeinżynierowanie przy skali notatek jednego rodzica; wracamy do tego tylko wtedy, gdy trafność dowieziona w S-03 okaże się realnie za niska.
- **Pytanie obejmujące oba dzieci naraz** — Why parked: FR-006 mówi o notatkach jednego dziecka, a pytanie zadawane na stronie dziecka upraszcza zakres i usuwa całą klasę błędu „trafiło w złe dziecko". Do rozważenia tylko wtedy, gdy pojawi się realna potrzeba porównywania dzieci.
- **Wspólne konto rodziców / dostęp opiekunów** — Why parked: PRD §Non-Goals.
- **Generowane podsumowania tekstowe** — Why parked: PRD §Non-Goals (odpowiedź to lista notatek, nie podsumowanie) — ograniczenie wiążące wprost dla M-2.
- **Import/eksport danych (np. PDF dla lekarza)** — Why parked: PRD §Non-Goals.
- **Natywna aplikacja mobilna** — Why parked: PRD §Non-Goals (tylko web).

## Milestone History

- **M-1: Pierwsza notatka o dziecku** (`first-child-note`) — closed 2026-10-01. Rodzic zakłada konto, loguje się, dodaje profil dziecka i zapisuje o nim notatkę, która nie ginie i jest widoczna tylko dla jego konta — podstawowa pętla produktu działa na produkcji. Pokryte wymagania: FR-001–FR-005, US-01.

## Done

- **S-01: rodzic po założeniu konta i zalogowaniu dodaje profil dziecka i widzi listę swoich dzieci (zamiast pustego dashboardu ze startera).** — Archived 2026-09-24 → `context/archive/2026-09-23-child-profiles/`. Lesson: —.
- **S-02: rodzic zapisuje dowolną notatkę tekstową o wybranym dziecku z datą/godziną i od razu widzi ją na liście notatek tego dziecka; notatka przetrwa wylogowanie i ponowne zalogowanie.** — Archived 2026-10-01 → `context/archive/2026-09-26-first-child-note/`. Lesson: —.
- **S-05: rodzic, który wchodzi na stronę główną albo wprost na logowanie, widzi treść o Dzienniku dziecka — czym produkt jest i do czego służy — a nie opis szablonu startowego ani jego trzech cech technicznych. Tytuł karty przeglądarki nazywa produkt. Logowanie i rejestracja są po polsku. W repozytorium nie zostaje nieużywany plik ani odnośnik, który istnieje tylko dlatego, że projekt postawiono na szablonie.** — Archived 2026-10-05 → `context/archive/2026-10-04-landing-product-identity/`. Lesson: —.
- **S-03: rodzic na stronie wybranego dziecka zadaje własnymi słowami pytanie o jego notatki i dostaje listę pasujących notatek z datami i linkami do źródłowych wpisów. Dopasowanie po temacie działa też wtedy, gdy w pytaniu użył innego słowa lub innej formy niż w notatce („gorączkę" znajduje notatkę „gorączka 38,5" i notatkę „temperatura 38,5"). Pytanie o okres („w lipcu", „ostatni tydzień") zawęża wynik twardo do tego przedziału i zwraca z niego wszystkie pasujące notatki, nie tylko kilka najbardziej podobnych.** — Archived 2026-10-21 → `context/archive/2026-10-16-note-search-by-meaning/`. Lesson: —.
