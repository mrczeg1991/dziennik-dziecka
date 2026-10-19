// Stand-in for the `astro:env/server` virtual module, which only exists inside an Astro build and
// does not resolve under plain Vitest -- aliased to this file by `vitest.config.ts`. Exports the
// same bindings the real module provides, read from `process.env` directly (the same convention
// `tests/integration/fixtures.ts` already uses for its own required environment values), so a value
// importer like `src/lib/embeddings.ts` or `src/lib/supabase.ts` degrades exactly the way it already
// does for an unconfigured deployment -- `embedText`'s `if (!OPENAI_API_KEY) return null` sees
// `undefined` here precisely as it would see a genuinely missing secret in production.
export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_KEY = process.env.SUPABASE_KEY;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
