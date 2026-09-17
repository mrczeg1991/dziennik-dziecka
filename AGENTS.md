# Repository Guidelines

10x Astro Starter: an Astro 7 + React 19 (islands) app in TypeScript, styled with Tailwind 4 and shadcn/ui, using Supabase for auth and deploying to Cloudflare Workers via Wrangler.

## Hard Rules

- `SUPABASE_URL` / `SUPABASE_KEY` are server-only secrets via Astro's `astro:env` schema (`@src/env.d.ts`, `@src/lib/supabase.ts`) — never expose or log them client-side.
- Do not write to `context/archive/` — owned by the 10xDevs skill chain in `@CLAUDE.md`; archived changes are immutable.
- To protect a new page, add its path to `PROTECTED_ROUTES` in `@src/middleware.ts` — don't gate auth ad hoc inside a page.
- Use the `@/*` import alias (maps to `src/*`, set in `@tsconfig.json`) instead of relative `../../` chains.

## Project Structure & Module Organization

- `src/pages/` — Astro routes; `src/pages/api/` — server endpoints (`auth/signin|signup|signout`).
- `src/components/` — Astro and React components; `components/ui/` holds shadcn/ui primitives, `components/auth/` the auth-form islands.
- `src/lib/` — `supabase.ts` (client factory), `utils.ts`, `config-status.ts`.
- `src/layouts/`, `src/styles/global.css`, `public/`, `supabase/` (local CLI config), `wrangler.jsonc` (Cloudflare config).
- shadcn/ui components follow `@components.json` (style `new-york`; aliases `@/components`, `@/lib`, `@/components/ui`).

## Build, Test, and Development Commands

- `npm run dev` — start the dev server on the Cloudflare `workerd` runtime.
- `npm run build` / `npm run preview` — production build / preview it locally.
- `npm run lint` / `npm run lint:fix` — ESLint (type-checked rules); `npm run format` — Prettier.
- `npm run smoke` — run `@scripts/smoke.mjs` against a running server (`BASE_URL`, default `http://localhost:4321`).

## Coding Style & Naming Conventions

- Formatting/lint are enforced by `@.prettierrc.json` and `@eslint.config.js`: 2-space indent, double quotes, semicolons, 120-char lines, trailing commas.
- Unused args/vars/caught errors must be prefixed `_` (`@typescript-eslint/no-unused-vars`).
- `@.husky/pre-commit` runs `lint-staged`: staged `.ts/.tsx/.astro` get `eslint --fix`, `.json/.css/.md` get `prettier --write`.

## Testing Guidelines

- No unit/integration suite yet. `scripts/smoke.mjs` walks the full auth flow (sign-up, sign-in, protected page, sign-out) over HTTP — a build sanity check, not a replacement for real tests.

## Commit & Pull Request Guidelines

- No established commit-message convention yet (single-commit history).
- PRs to `master` must pass `@.github/workflows/ci.yml`: `ci` runs lint, `astro check`, build; `smoke` boots a local Supabase and runs the smoke test.

## Security & Configuration Tips

- Local secrets live in `.env` (Supabase) and `.dev.vars` (Wrangler) — gitignored; copy from `@.env.example`, never commit real values.
- In production, set `SUPABASE_URL` / `SUPABASE_KEY` as Cloudflare Worker secrets (`npx wrangler secret put`), not in `wrangler.jsonc`.
