# Dziennik dziecka

Prywatny dziennik rodzica: krótkie, swobodne notatki o dziecku — pomiary, objawy, pierwsze razy — zapisywane w chwili, gdy się dzieją, i odnajdywane wtedy, gdy są potrzebne (na przykład przed wizytą u lekarza).

Jedno konto, dostęp wyłącznie dla zalogowanego rodzica. Interfejs jest po polsku; dokumentacja techniczna poniżej po angielsku.

## Tech Stack

- [Astro](https://astro.build/) v7 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v6 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/mrczeg1991/dziennik-dziecka.git
cd dziennik-dziecka
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run smoke` - Smoke test the auth flow against a running server (`BASE_URL`, defaults to `http://localhost:4321`)

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ ├── lib/ # Data access and shared helpers
│ └── styles/ # Global stylesheet
├── public/ # Public assets
├── supabase/ # Local Supabase config and migrations
├── scripts/ # Smoke test
├── context/ # Product docs, plans and change history
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication and storage. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM. The `supabase/` folder is already checked in, so there is no `supabase init` step.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Start the local stack (downloads Docker images on first run, then applies every migration in `supabase/migrations/`):

```bash
npx supabase start
```

3. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

4. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

The database schema lives in `supabase/migrations/`. Run `npx supabase db reset` to re-apply every migration from scratch after pulling new ones.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation

Locally, email confirmation is already off — `supabase/config.toml` sets `enable_confirmations = false`, so an account can sign in immediately after sign-up. On a cloud project the setting lives under **Authentication → Email → Confirm email** in the dashboard.

### Auth routes

| Route                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `/`                   | Landing page for signed-out visitors; redirects to `/dashboard` when signed in |
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup confirmation page                                           |
| `/dashboard`          | The parent's children (redirects to `/auth/signin` if unauthenticated)  |
| `/children/[id]`      | One child's notes (protected)                                           |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## Smoke test

`scripts/smoke.mjs` is a dependency-free Node script that walks the whole flow (sign-up, sign-in, children, notes, cross-account isolation, sign-out) over HTTP. Run it against the dev server or the production preview:

```bash
npm run dev            # or: npm run build && npm run preview
BASE_URL=http://localhost:4321 npm run smoke
```

It needs a reachable Supabase instance (local or cloud) with email confirmation disabled.

> **Note:** the smoke script asserts status codes and redirect targets, not page copy. It is a fast check that a change did not break the build, the Cloudflare adapter or the auth and data flow — **not** a substitute for a real test suite. The testing strategy lives in `context/foundation/test-plan.md`.

## CI

GitHub Actions runs two jobs on every push and PR to `master`:

- **ci** — lint, `astro check` and build. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets for the build step.
- **smoke** — starts a local Supabase via the Supabase CLI, builds, serves the production preview on the Cloudflare runtime and runs `npm run smoke` against it. No secrets required.

## License

MIT
