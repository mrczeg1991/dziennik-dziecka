// §4 of context/foundation/test-plan.md names `getViteConfig()` from `astro/config` as the stack
// choice, and that is the route this file tried first. It does not work in this project: the
// helper loads astro.config.mjs, including `adapter: cloudflare()`, and the adapter's Vite plugins
// hand the run to a workerd test runner regardless of `test.environment`, which fails during
// startup with `ReferenceError: module is not defined` before any test file is loaded. So this is
// the fallback the plan pre-approved -- a plain Vitest config plus the one thing `getViteConfig()`
// was wanted for, the `@/*` alias that mirrors tsconfig.json's path mapping.
//
// Nothing under tests/ imports `astro:env/server`, so the fallback loses nothing: src/lib's only
// Astro-adjacent imports are type-only and erase at runtime. Revisit if a test ever needs an
// Astro virtual module.
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // A node environment rather than a browser one; no test here needs a DOM.
    environment: "node",
    // Mirrors tsconfig.json's `"@/*": ["./src/*"]`. The key is `@` and not `@/`: Vite's alias
    // matcher takes a string `find` as an exact segment prefix, so `@/` only ever matches `@//`
    // and the specifier falls through to Node's resolver ("Cannot find package '@/lib/...'").
    // Absolute, because a relative replacement would resolve against the importing file.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
