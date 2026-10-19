// §4 of context/foundation/test-plan.md names `getViteConfig()` from `astro/config` as the stack
// choice, and that is the route this file tried first. It does not work in this project: the
// helper loads astro.config.mjs, including `adapter: cloudflare()`, and the adapter's Vite plugins
// hand the run to a workerd test runner regardless of `test.environment`, which fails during
// startup with `ReferenceError: module is not defined` before any test file is loaded. So this is
// the fallback the plan pre-approved -- a plain Vitest config plus the one thing `getViteConfig()`
// was wanted for, the `@/*` alias that mirrors tsconfig.json's path mapping.
//
// `astro:env/server` is aliased to a stub (`tests/stubs/astro-env-server.ts`) for the same reason:
// this was the "revisit if a test ever needs an Astro virtual module" case. `src/lib/notes.ts`
// started importing `src/lib/embeddings.ts` (a *value* import, not type-only) once the write-path
// embedding landed, and `embeddings.ts` imports `OPENAI_API_KEY` from `astro:env/server` -- a
// virtual module with no meaning outside an Astro build, so any integration suite that imports
// `@/lib/notes` now needs it to resolve to *something*, not nothing.
import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // A node environment rather than a browser one; no test here needs a DOM.
    environment: "node",
    // .claude/worktrees/ holds full second checkouts (see scripts/gate-routes.mjs), and Vitest
    // neither reads .gitignore nor anchors the `tests/unit` filter, so a worktree's tests would be
    // counted by gate:scope's floor and its integration suites would race this one's fixtures.
    exclude: [...configDefaults.exclude, ".claude/**"],
    alias: {
      // Mirrors tsconfig.json's `"@/*": ["./src/*"]`. The key is `@` and not `@/`: Vite's alias
      // matcher takes a string `find` as an exact segment prefix, so `@/` only ever matches `@//`
      // and the specifier falls through to Node's resolver ("Cannot find package '@/lib/...'").
      // Absolute, because a relative replacement would resolve against the importing file.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // An exact specifier, not a prefix -- `astro:env/server` is the only virtual module any
      // test-reachable code imports today. A real importer like `src/lib/supabase.ts` is never
      // actually reached at runtime by a current test (it's `import type`-only two hops away), but
      // the stub answers for it too in case that changes.
      "astro:env/server": fileURLToPath(new URL("./tests/stubs/astro-env-server.ts", import.meta.url)),
    },
  },
});
