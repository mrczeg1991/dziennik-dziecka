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
| 4 | Nie mówi wprost, że pierwszy deploy jest ręczny | `git remote -v` w repo jest puste — nie ma jeszcze zdalnego repo na GitHubie, więc `ci_default_flow: auto-deploy-on-merge` z hand-offu tech-stacka nie może dziś zadziałać. Ten runbook jest w całości ręczny przez CLI; CI/CD to osobna, przyszła praca. |

## Runbook

### 1. Zmień nazwę Workera

W `wrangler.jsonc` zmień `name` z `"10x-astro-starter"` na `"dziennik-dziecka"`.

### 2. Załóż projekt Supabase (chmura)

1. Utwórz nowy projekt na [supabase.com](https://supabase.com) (organizacja, region, hasło do bazy).
2. **Authentication → Email → Confirm email → wyłącz.** Spójne z lokalnym dev (`supabase/config.toml` ma `enable_confirmations = false`), użytkownik może się zalogować od razu po rejestracji.
3. Zanotuj z **Settings → API**: `Project URL` i klucz `anon` `public`.
4. Site URL na razie ustaw tymczasowo (np. `http://localhost:4321`) — wrócimy do tego w kroku 8, gdy poznamy faktyczny adres produkcyjny.

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

### 6. Build i deploy

```bash
npm run build
npx wrangler deploy
```

Zanotuj adres URL z outputu `wrangler deploy` (postać `https://dziennik-dziecka.<subdomain>.workers.dev`).

### 7. Weryfikacja

- Wejdź na zwrócony URL — strona główna powinna się załadować.
- Ręcznie przejdź: `/auth/signup` → rejestracja → `/dashboard` (powinno przepuścić, bo email confirm jest wyłączony) → `/auth/signout`.
- W osobnym terminalu podczas pierwszego realnego requestu: `npx wrangler tail` (live logi, bezpieczne do uruchomienia).

### 8. Zamknij pętlę Supabase Site URL

Wróć do Supabase dashboard → Authentication → URL Configuration i ustaw Site URL oraz Redirect URLs na faktyczny adres z kroku 6.

## Sekrety — ściąga

| Zmienna | Gdzie ustawiana | Kiedy |
|---|---|---|
| `SUPABASE_URL` | `wrangler secret put` | Krok 4, teraz |
| `SUPABASE_KEY` | `wrangler secret put` | Krok 4, teraz |
| LLM API key (FR-006, NL-query) | `wrangler secret put` | Odłożone — FR-006 nie jest jeszcze zbudowane |

## Rollback

```bash
npx wrangler deployments list
npx wrangler rollback [deployment-id]
```

Cofa kod/assets Workera w sekundy. **Nie cofa** migracji schematu Supabase — jeśli zły deploy wypuścił łamiącą migrację, wymaga ręcznego uzgodnienia (przeniesione z `infrastructure.md`).

## Poza zakresem tego wdrożenia

- CI/CD auto-deploy-on-merge — brak `git remote`, repo nie jest jeszcze na GitHubie.
- Sekret klucza LLM i powiązana logika — FR-006 nie jest jeszcze zbudowane.
- Upgrade na Workers Paid plan ($5/mo, wyższy limit CPU) — odłożony do momentu budowy FR-006, per risk register w `infrastructure.md`.

## Następne kroki

Kroki 1-7 wykonane 2026-09-19. Worker działa pod `https://dziennik-dziecka.mrczeg.workers.dev` (homepage i `/auth/signup` odpowiadają 200, `/dashboard` przekierowuje 302 dla niezalogowanego użytkownika — zgodnie z oczekiwaniami).

Zostało do zrobienia:

- **Krok 8** — w Supabase dashboard ustawić Site URL i Redirect URLs na `https://dziennik-dziecka.mrczeg.workers.dev` (jeszcze nie wykonane).
- Ręczne przejście flow signup → dashboard → signout na produkcyjnym URL-u (nie zostało wykonane automatycznie — tworzy realne konto w Supabase Auth, decyzja należy do Ciebie).
