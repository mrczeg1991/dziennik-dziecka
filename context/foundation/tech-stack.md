---
starter_id: 10x-astro-starter
package_manager: npm
project_name: dziennik-dziecka
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

A solo parent building a single-user notes app about their two children in one week, after hours, needs a starter that already wires auth, a database, and deploy together rather than one assembled from parts. 10x Astro Starter is the recommended default for `(web, js)` and clears all four agent-friendly gates: TypeScript-first with explicit contracts, Supabase gives Postgres + auth out of the box for the account/login/child-profile/notes loop (FR-001–005), and Cloudflare Pages is a fast first deploy. The nice-to-have natural-language query over notes (FR-006) isn't built into the starter but doesn't require a different foundation — it can be added as a fast-follow against the same Supabase-stored notes. Auth and AI feature flags are set; payments, realtime, and background jobs are out of scope. CI runs on GitHub Actions with auto-deploy-on-merge, the starter's standard shape.
