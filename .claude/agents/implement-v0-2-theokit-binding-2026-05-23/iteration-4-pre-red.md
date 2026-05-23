# SEPA — Iteration 4 / Task T2.1 / Phase pre-RED

## Findings (condensed)
- Files verified: package.json + src/index.ts exist (no theokit re-exports — clean baseline); `tests/integration/public-paths.test.ts` DOES NOT EXIST (plan said "APPEND" — correct action is CREATE).
- 4 RED tests under tests/integration/public-paths.test.ts (BDD shape per testing.md):
  1. test_subpath_theokit_resolves (dynamic import + exports check)
  2. test_main_barrel_does_not_export_theokit (pattern b: dynamic import keys + pattern c: static-source assert on src/index.ts)
  3. test_subpath_exports_scoped_context_type (type-only)
  4. test_subpath_resolves_under_node16_moduleResolution (EC-9 — spawn `tsc --noEmit` against fixture tsconfigs for node16/bundler/nodenext)
- vitest.integration.config.ts include matches; passWithNoTests:true; no Postgres needed.
- Don't add theokit re-export to src/index.ts during REFACTOR (would break isolation invariant).

## Proceed to RED — CREATE (not APPEND) the test file.
