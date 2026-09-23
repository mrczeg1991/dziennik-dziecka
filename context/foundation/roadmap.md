---
project: Dziennik dziecka
version: 1
status: draft
created: 2026-09-22
updated: 2026-09-24
prd_version: 1
main_goal: speed
top_blocker: time
milestone_id: first-child-note
milestone_seq: 1
milestone_status: open
---

# Roadmap: Dziennik dziecka

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-1: Pierwsza notatka o dziecku** — Status: open

- **Intent:** Rodzic przechodzi pełną podstawową pętlę produktu — zakłada konto, loguje się, dodaje dziecko i zapisuje o nim notatkę, która nie ginie i jest widoczna tylko dla niego. To jest główne kryterium sukcesu z PRD.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** every S-NN below is `done`.
- **Scope anchors:** FR-001–FR-005 (wszystkie konieczne wymagania funkcjonalne), US-01, zasady ochronne PRD („notatki nigdy nie giną ani nie są po cichu nadpisywane”, „notatki dziecka widzi tylko zalogowane konto”). FR-006 (opcjonalne) jest świadomie przeniesione do następnego kamienia milowego — patrz `## Parked`.

## Vision recap

Rodzic dwójki dzieci nie pamięta drobnych faktów o nich — pomiarów, objawów, kamieni milowych rozwoju — i nie potrafi ich szybko odtworzyć, np. przed wizytą u lekarza. Istniejące aplikacje do śledzenia dziecka wymuszają sztywne formularze; ten produkt pozwala zapisać dowolną notatkę tekstową o dziecku, a w kolejnym kroku zapytać o nie językiem naturalnym i dostać listę pasujących notatek z datami i linkami do źródła.

## North star

**S-02: Rodzic zapisuje notatkę o dziecku i widzi ją na liście jego notatek** — to najmniejszy kompletny przepływ, który dowodzi, że produkt działa (główne kryterium sukcesu PRD), więc przy celu „szybkość dostarczenia” idzie tak wcześnie, jak pozwalają zależności.

> „North star” (gwiazda przewodnia) oznacza tu najmniejszy kawałek funkcjonalności od początku do końca, którego dostarczenie potwierdza główne założenie produktu — dlatego stoi możliwie wcześnie: wszystko inne ma sens tylko wtedy, gdy to działa.

## At a glance

| ID   | Change ID              | Outcome (user can …)                                                                 | Prerequisites | PRD refs                     | Status   | Issue |
| ---- | ---------------------- | ------------------------------------------------------------------------------------ | ------------- | ---------------------------- | -------- | ----- |
| S-01 | child-profiles         | rodzic po założeniu konta i zalogowaniu dodaje profil dziecka i widzi listę swoich dzieci | —             | FR-001, FR-002, FR-003       | in-progress | #1 |
| S-02 | first-child-note       | rodzic zapisuje dowolną notatkę o dziecku i widzi ją na liście notatek tego dziecka  | S-01          | US-01, FR-004, FR-005        | proposed | #2    |

## Baseline

What's already in place in the codebase as of `2026-09-22` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 7 + React 19 + Tailwind 4 (`package.json`, `src/layouts/Layout.astro`); tylko strona startowa i dashboard ze startera.
- **Backend / API:** partial — endpointy Astro istnieją tylko dla logowania (`src/pages/api/auth/*`); brak endpointów aplikacji.
- **Data:** partial — klient Supabase gotowy (`src/lib/supabase.ts`); brak migracji i tabel (`supabase/` zawiera tylko `config.toml`).
- **Auth:** present — rejestracja/logowanie/wylogowanie przez Supabase (`src/pages/api/auth/signup.ts`, `signin.ts`, `signout.ts`); middleware chroni `/dashboard` (`src/middleware.ts:4`).
- **Deploy / infra:** partial — Cloudflare Workers skonfigurowane (`wrangler.jsonc`); CI (lint, check, build, smoke) w `.github/workflows/ci.yml`, ale bez automatycznego wdrożenia po merge; wdrożenie ręczne wg runbooka.
- **Observability:** partial — tylko wbudowane `observability.enabled` w `wrangler.jsonc`; brak zewnętrznego śledzenia błędów.

## Foundations

Brak. Logowanie i frontend są obecne, a brakująca warstwa danych jest wprowadzana stopniowo — tabela dzieci w S-01, tabela notatek w S-02 — w pierwszym kawałku, który jej potrzebuje. Żadna praca przekrojowa nie jest warunkiem koniecznym, by zaplanować lub zweryfikować S-01.

## Slices

### S-01: Rodzic dodaje profil dziecka

- **Outcome:** rodzic po założeniu konta i zalogowaniu dodaje profil dziecka i widzi listę swoich dzieci (zamiast pustego dashboardu ze startera).
- **Change ID:** child-profiles
- **PRD refs:** FR-001, FR-002, FR-003
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Jakie pola ma profil dziecka poza imieniem (np. data urodzenia)? PRD tego nie precyzuje. — Owner: user. Block: no.
- **Risk:** Pierwsze wprowadzenie danych aplikacji — tu powstaje zasada „dane widzi tylko właściciel konta”, na której opiera się S-02; błąd w izolacji danych między kontami przeniesie się na notatki. FR-001/FR-002 już działają (Baseline) — ten kawałek tylko prowadzi zalogowanego rodzica do listy dzieci i nie przebudowuje logowania.
- **Status:** in-progress

### S-02: Rodzic zapisuje notatkę o dziecku i widzi ją na liście

- **Outcome:** rodzic zapisuje dowolną notatkę tekstową o wybranym dziecku z datą/godziną i od razu widzi ją na liście notatek tego dziecka; notatka przetrwa wylogowanie i ponowne zalogowanie.
- **Change ID:** first-child-note
- **PRD refs:** US-01, FR-004, FR-005
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Czy data/godzina notatki to zawsze moment zapisu, czy rodzic może ustawić ją wstecz (np. objaw zauważony wczoraj)? FR-004 mówi tylko „with a date/time”. — Owner: user. Block: no.
- **Risk:** Gwiazda przewodnia — musi spełnić obie zasady ochronne PRD (notatka nigdy nie ginie ani nie jest po cichu nadpisywana; widzi ją tylko właściciel konta). Idzie zaraz po S-01, bo notatka musi być przypisana do istniejącego dziecka.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID        | Suggested issue title                                        | Ready for `/10x-plan` | Notes                           | Issue |
| ---------- | ---------------- | ------------------------------------------------------------ | --------------------- | ------------------------------- | ----- |
| S-01       | child-profiles   | Rodzic dodaje profil dziecka i widzi listę dzieci            | yes                   | Run `/10x-plan child-profiles`  | #1    |
| S-02       | first-child-note | Rodzic zapisuje notatkę o dziecku i widzi listę notatek      | no                    | Czeka na S-01                   | #2    |

> Tracked in GitHub: milestone **M-1: Pierwsza notatka o dziecku** (mrczeg1991/dziennik-dziecka). Open questions → #3, #4, #5 (`roadmap-question`); parked future work → #6, #7, #8 (`parked`).

## Open Roadmap Questions

1. **Jaka jest spodziewana liczba zapytań na sekundę i orientacyjna objętość danych?** — `target_scale.qps` i `target_scale.data_volume` nie zostały ustalone podczas kształtowania pomysłu; znane jest tylko `users: small`. Owner: user. Block: none (domyślne założenia dla małej skali są bezpieczne).
2. **Który dostawca AI obsłuży pytania o notatki (FR-006) i czy jego polityka prywatności dopuszcza wysyłanie notatek o zdrowiu dzieci?** — Owner: user. Block: FR-006 w następnym kamieniu milowym (nie blokuje M-1).
3. **Czy przed wdrożeniem FR-006 przejść na płatny plan Cloudflare Workers (limit czasu CPU)?** — ryzyko z `infrastructure.md`. Owner: user. Block: FR-006 w następnym kamieniu milowym (nie blokuje M-1).

## Parked

- **FR-006: pytanie o notatki dziecka językiem naturalnym** — Why parked: PRD oznacza je jako opcjonalne i zaplanowane zaraz po podstawowej pętli; przy celu „szybkość” i ryzyku „czas” trafia do następnego kamienia milowego (ta sama wersja PRD, kolejna transza), nie jest porzucone.
- **Automatyczne wdrożenie po merge (GitHub Actions → Cloudflare)** — Why parked: wskazówka `ci_default_flow: auto-deploy-on-merge` z `tech-stack.md`, ale żaden kawałek M-1 tego nie wymaga; ręczne wdrożenie wg runbooka wystarcza dla jednego użytkownika.
- **Zewnętrzne śledzenie błędów** — Why parked: PRD nie stawia wymagań obserwowalności; wbudowane logi Cloudflare (`wrangler tail`) wystarczają na MVP.
- **Wspólne konto rodziców / dostęp opiekunów** — Why parked: PRD §Non-Goals.
- **Generowane podsumowania tekstowe** — Why parked: PRD §Non-Goals (odpowiedź to lista notatek, nie podsumowanie).
- **Import/eksport danych (np. PDF dla lekarza)** — Why parked: PRD §Non-Goals.
- **Natywna aplikacja mobilna** — Why parked: PRD §Non-Goals (tylko web).

## Milestone History

## Done
