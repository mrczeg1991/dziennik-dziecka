# Repository Guidelines

Dziennik dziecka: a parent's private notes about their children — an Astro 7 + React 19 (islands) app in TypeScript, styled with Tailwind 4 and shadcn/ui, using Supabase for auth and data, and deploying to Cloudflare Workers via Wrangler. UI copy is Polish.

## Hard Rules

- `SUPABASE_URL` / `SUPABASE_KEY` are server-only secrets via Astro's `astro:env` schema (`@src/env.d.ts`, `@src/lib/supabase.ts`) — never expose or log them client-side.
- Do not write to `context/archive/` — owned by the 10xDevs skill chain in `@CLAUDE.md`; archived changes are immutable.
- `@src/lib/protected-routes.json` is the single source of truth for route auth: `protected` holds the prefixes `@src/middleware.ts` matches with `startsWith`, `public` the routes reachable anonymously. **Every new route under `src/pages/` must be classified in one of the two**, or `npm run gate:routes` fails the build. Don't add the prefix to `middleware.ts` — it reads this file. An endpoint may _additionally_ self-guard when it needs `user.id` for its own query (as `api/children.ts`, `api/notes.ts` and `api/notes/[id].ts` do) — redundantly, never instead; don't "fix" those away.
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
- `npm run test:db` — run the pgTAP policy suite in `supabase/tests/` (needs `supabase start` first).

## Coding Style & Naming Conventions

- Formatting/lint are enforced by `@.prettierrc.json` and `@eslint.config.js`: 2-space indent, double quotes, semicolons, 120-char lines, trailing commas.
- Unused args/vars/caught errors must be prefixed `_` (`@typescript-eslint/no-unused-vars`).
- `@.husky/pre-commit` runs `lint-staged`: staged `.ts/.tsx/.astro` get `eslint --fix`, `.json/.css/.md` get `prettier --write`. Hooks are wired by the `prepare` script on `npm install`/`npm ci`; run `npm run prepare` if `git config core.hooksPath` is unset.
- `@.prettierignore` exempts `context/` and `.claude/`, so the hook does **not** reformat those Markdown files — `context/changes/*/plan.md` has a `## Progress` section whose Phase blocks the 10xDevs skill chain treats as read-only.

## Testing Guidelines

- Row-security policies are covered by a pgTAP suite in `supabase/tests/`, run with `npm run test:db` and enforced in CI. It is the only layer that tests the policies directly: the HTTP walk cannot see a _widened_ policy, because handlers filter first and the policy is never the thing that fails. Read `@context/foundation/test-plan.md` §6.1 before adding one.
- No unit/integration suite yet. `scripts/smoke.mjs` walks the full auth flow (sign-up, sign-in, protected page, sign-out) over HTTP — a build sanity check, not a replacement for real tests.

## Commit & Pull Request Guidelines

- No established commit-message convention yet (single-commit history).
- PRs to `master` must pass `@.github/workflows/ci.yml`: `ci` runs lint, `astro check`, build; `smoke` boots a local Supabase, runs the pgTAP policy suite (`supabase test db`) against the still-empty database, then builds and runs the smoke test.

## Security & Configuration Tips

- Local secrets live in `.env` (Supabase) and `.dev.vars` (Wrangler) — gitignored; copy from `@.env.example`, never commit real values.
- In production, set `SUPABASE_URL` / `SUPABASE_KEY` as Cloudflare Worker secrets (`npx wrangler secret put`), not in `wrangler.jsonc`.
