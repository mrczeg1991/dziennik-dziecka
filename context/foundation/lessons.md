# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Astro frontmatter: a top-level `return` breaks tooling that walks for a parent node

- **Context**: `src/pages/children/[id].astro` (`eslint.config.js` scoped override; also hit during the `getChild` try/catch fix)
- **Problem**: `astro-eslint-parser` gives a top-level `return` in frontmatter no parent node. Any tool that walks up for an enclosing function hits that hole. Two concrete hits in this repo: `@typescript-eslint/no-misused-promises` throws "Expected node to have a parent" and aborts the **entire** ESLint run (not just that file); and `astro check` reports a `const` helper as unused when every use of it sits after a top-level `return`. An inline `/* eslint-disable */` does not help — directives filter reported problems only after the rule has already thrown. Versions: typescript-eslint 8.70.0, astro-eslint-parser 3.1.0.
- **Rule**: <to fill in>
- **Applies to**: <to fill in>
