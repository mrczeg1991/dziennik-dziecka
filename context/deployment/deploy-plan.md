---
project: dziennik-dziecka
platform: Cloudflare Workers
source_docs:
  - context/foundation/infrastructure.md
  - context/foundation/tech-stack.md
status: deployed
planned_at: 2026-09-18
deployed_at: 2026-09-19
deployed_url: https://dziennik-dziecka.mrczeg.workers.dev
---

## Cel

Runbook dla pierwszego wdrożenia `dziennik-dziecka` na Cloudflare Workers, zbudowany na rekomendacji z [`infrastructure.md`](../foundation/infrastructure.md) i stacku z [`tech-stack.md`](../foundation/tech-stack.md) (10x Astro Starter, Supabase, npm), z poprawkami wynikającymi z inspekcji faktycznego kodu repo.

## Poprawki względem infrastructure.md

`infrastructure.md` zostało napisane przed sprawdzeniem kodu i ma cztery luki, które ten plan naprawia:

| # | Luka w `infrastructure.md` | Poprawka |
|---|---|---|
| 1 | Krok 3 "Getting Started" każe ustawić sekret `SUPABASE_ANON_KEY` | Kod (`astro.config.mjs`, `src/lib/supabase.ts`, `src/lib/config-status.ts`) oczekuje **`SUPABASE_KEY`**. Ponieważ pole jest zadeklarowane jako `optional: true`, sekret pod złą nazwą zostałby po cichu zignorowany — appka wystartowałaby, ale auth byłby wyłączony bez żadnego błędu w logach. |
| 2 | Nie wspomina nazwy Workera | `wrangler.jsonc` wciąż ma `name: "10x-astro-starter"` ze scaffoldu — to ta wartość trafia do URL-a `*.workers.dev`. Trzeba ją zmienić na `dziennik-dziecka` **przed** pierwszym deployem (zmiana po fakcie tworzy nowego Workera pod nowym adresem). |
| 3 | Nie wspomina Supabase Auth Site URL / Redirect URLs | Linki w mailach (potwierdzenie rejestracji, reset hasła) używają Site URL skonfigurowanego w dashboardzie Supabase. Ta wartość musi wskazywać na finalną domenę produkcyjną, która jest znana dopiero **po** pierwszym `wrangler deploy` — stąd krok "wróć i zaktualizuj" poniżej. |
| 4 | Nie mówi wprost, że pierwszy deploy jest ręczny | **Nieaktualne od 2026-10.** Gdy ten runbook powstawał, `git remote -v` było puste. Dziś `origin` istnieje (`https://github.com/mrczeg1991/dziennik-dziecka.git`), a integracja Git w dashboardzie Cloudflare **buduje `master` przy każdym pushu** — `auto-deploy-on-merge` jest więc realne i działa. Pierwszy deploy (2026-09-19) był ręczny przez CLI; kolejne idą automatycznie. Patrz „Brama wdrożenia” poniżej. |

## Runbook

### 1. Zmień nazwę Workera

W `wrangler.jsonc` zmień `name` z `"10x-astro-starter"` na `"dziennik-dziecka"`.

### 2. Załóż projekt Supabase (chmura)

1. Utwórz nowy projekt na [supabase.com](https://supabase.com) (organizacja, region, hasło do bazy).
2. **Authentication → Email → Confirm email → wyłącz.** Spójne z lokalnym dev (`supabase/config.toml` ma `enable_confirmations = false`), użytkownik może się zalogować od razu po rejestracji.
3. Zanotuj z **Settings → API**: `Project URL` i klucz `anon` `public`.
4. Site URL na razie ustaw tymczasowo (np. `http://localhost:4321`) — wrócimy do tego w kroku 9, gdy poznamy faktyczny adres produkcyjny.

### 3. Zaloguj Wranglera

```bash
npx wrangler login
```

Interaktywne, otwiera przeglądarkę — wymaga Twojego udziału, nie da się zautomatyzować.

### 4. Ustaw sekrety Workera

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
```

Wartości z kroku 2.3. Nigdy nie wpisuj ich do `wrangler.jsonc` (repo jest publiczne/wersjonowane).

### 5. Preflight

```bash
npm run lint
npx astro check
```

Te same bramki co w CI (`.github/workflows/ci.yml`) — łapią błędy przed wysłaniem na produkcję.

### 6. Wypchnij migracje bazy

Raz, żeby powiązać lokalne repo z projektem Supabase w chmurze (`<ref>` to identyfikator projektu z URL-a dashboardu / **Settings → General**):

```bash
npx supabase link --project-ref <ref>
```

Potem przy każdym wdrożeniu, które niesie nowe migracje:

```bash
npx supabase db push
```

Nakłada na produkcyjną bazę migracje z `supabase/migrations/`, których tam jeszcze nie ma (np. tabele `children` i `notes` z RLS). **Każda przyszła migracja wymaga tego kroku przed deployem kodu, który od niej zależy** — inaczej nowy kod trafi na bazę bez tabeli i np. `/dashboard` zwróci błąd.

Od 2026-10 tę kolejność **wymusza bramka**, a nie tylko ta notatka: `npm run gate:drift`
(`scripts/gate-migration-drift.mjs`) porównuje 14-cyfrowe wersje migracji z repo z tymi
zastosowowanymi w projekcie hostowanym i kończy się błędem w obie strony — gdy repo wyprzedza bazę
(deploy by się wywalił) i gdy baza wyprzedza repo (ktoś zrobił `db push` z laptopa i nie
zacommitował migracji). Bramka jest częścią `npm run gates`, czyli build commandu Cloudflare, więc
deploy z brakującą migracją **nie opublikuje się**. Objaw, który wcześniej to przepuszczał, to
HTTP 200 z polskim banerem „nie udało się wczytać” — zielony smoke test tego nie łapał.

Wymaga `SUPABASE_PROJECT_REF` i `SUPABASE_DB_PASSWORD`. Brak któregokolwiek to **błąd, nie
pominięcie** — bramka, która po cichu nic nie sprawdza, jest gorsza od jej braku.

### 7. Build i deploy

```bash
npm run build
npx wrangler deploy
```

Zanotuj adres URL z outputu `wrangler deploy` (postać `https://dziennik-dziecka.<subdomain>.workers.dev`).

### 8. Weryfikacja

- Wejdź na zwrócony URL — strona główna powinna się załadować.
- Ręcznie przejdź: `/auth/signup` → rejestracja → `/dashboard` (powinno przepuścić, bo email confirm jest wyłączony) → `/auth/signout`.
- W osobnym terminalu podczas pierwszego realnego requestu: `npx wrangler tail` (live logi, bezpieczne do uruchomienia).

### 9. Zamknij pętlę Supabase Site URL

Wróć do Supabase dashboard → Authentication → URL Configuration i ustaw Site URL oraz Redirect URLs na faktyczny adres z kroku 7.

## Brama wdrożenia

Dopisane 2026-10 (rollout Phase 2 planu testów, `testing-gates-that-gate`). Runbook powstał przed
integracją Git w Cloudflare i nie opisywał tego, co faktycznie się dzieje przy wdrożeniu.

**Jak dziś wygląda deploy.** Push na `master` → Cloudflare buduje projekt → publikuje, jeśli build
się udał. GitHub Actions (`.github/workflows/ci.yml`) biegnie niezależnie i jest **tylko szybkim
feedbackiem**: repo jest prywatne na darmowym planie, więc branch protection (required status
checks) jest niedostępne — `gh api .../branches/master/protection` zwraca `403 "Upgrade to GitHub
Pro or make this repository public"`. Czerwony CI nie blokuje merge'a. Z tego samego commita może
więc wyjść czerwony CI i udany deploy.

**Gdzie jest blokada.** Jedyne dostępne miejsce, które faktycznie blokuje, to **build command
Cloudflare** — jeśli zwróci kod != 0, nic się nie publikuje. Dlatego build command to:

```
npm run gates
```

czyli `gates:pre` (`gate:scope` → `gate:routes` → `gate:drift`) → `npm run build` →
`gates:post` (`gate:build-output`). Kolejność jest nośna: `gate:build-output` potrzebuje istniejącego
`dist/`, a wszystko inne biegnie zanim zapłacimy za build.

**Co trzeba ustawić w dashboardzie Cloudflare** (Workers & Pages → projekt → Settings):

| Co | Wartość |
|---|---|
| Build command | `npm run gates` |
| Build output directory | bez zmian |
| Zmienna build-environment `SUPABASE_PROJECT_REF` | ref projektu Supabase |
| Zmienna build-environment `SUPABASE_DB_PASSWORD` | hasło do bazy projektu hostowanego |

Bez tych dwóch zmiennych `gate:drift` **celowo wywala build** — patrz krok 6. Ta jedna rzecz jest
konfiguracją poza repo, i dlatego logika bramek siedzi w wersjonowanych skryptach `scripts/gate-*.mjs`,
a dashboard trzyma tylko jedną wartość. **Zanotuj poprzedni build command przed zmianą — tej zmiany
nie cofnie `git revert`.**

Dla `master` i PR-ów do niego ten sam zestaw bramek biegnie też w CI jako osobne, nazwane kroki
(`gate:scope`, `gate:routes`, `gate:build-output`); `gate:drift` jest tam wyłączony i chodzi zamiast
tego w zaplanowanym jobie `drift` (codziennie, cron `23 5 * * *`), bo rozmawia z projektem
hostowanym.

## Sekrety — ściąga

| Zmienna | Gdzie ustawiana | Kiedy |
|---|---|---|
| `SUPABASE_URL` | `wrangler secret put` | Krok 4, teraz |
| `SUPABASE_KEY` | `wrangler secret put` | Krok 4, teraz |
| `SUPABASE_PROJECT_REF` | zmienna build-environment w Cloudflare + secret repo na GitHubie | Dla `gate:drift` — build Cloudflare i zaplanowany job `drift` |
| `SUPABASE_DB_PASSWORD` | zmienna build-environment w Cloudflare + secret repo na GitHubie | Jak wyżej |
| LLM API key (FR-006, NL-query) | `wrangler secret put` | Odłożone — FR-006 nie jest jeszcze zbudowane |

## Rollback

```bash
npx wrangler deployments list
npx wrangler rollback [deployment-id]
```

Cofa kod/assets Workera w sekundy. **Nie cofa** migracji schematu Supabase — jeśli zły deploy wypuścił łamiącą migrację, wymaga ręcznego uzgodnienia (przeniesione z `infrastructure.md`).

To zastrzeżenie jest teraz również powodem, dla którego `gate:drift` będzie w takim stanie **głośno
krzyczeć**: po rollbacku kodu baza zostaje na nowszym schemacie, czyli „baza wyprzedza repo” — i
następny build to zgłosi, zamiast pozwolić, żeby rozjazd został odkryty przez rodzica w momencie
zapisywania notatki.

## Poza zakresem tego wdrożenia

- ~~CI/CD auto-deploy-on-merge — brak `git remote`, repo nie jest jeszcze na GitHubie.~~ **Zrobione poza tym runbookiem**: `origin` istnieje, integracja Git w Cloudflare buduje `master` przy pushu. Patrz „Brama wdrożenia”.
- Sekret klucza LLM i powiązana logika — FR-006 nie jest jeszcze zbudowane.
- Upgrade na Workers Paid plan ($5/mo, wyższy limit CPU) — odłożony do momentu budowy FR-006, per risk register w `infrastructure.md`.

## Następne kroki

Kroki 1-5 oraz 7-8 wykonane 2026-09-19, kroki 6 (migracje, dodany później razem z tabelą `children`) i 9 wykonane 2026-09-24. Worker działa pod `https://dziennik-dziecka.mrczeg.workers.dev` (homepage i `/auth/signup` odpowiadają 200, `/dashboard` przekierowuje 302 dla niezalogowanego użytkownika — zgodnie z oczekiwaniami).

Brak otwartych kroków. Flow signup → `/dashboard` („Moje dzieci”) → signout sprawdzony na produkcji 2026-09-24, w tym izolacja danych między dwoma kontami.
