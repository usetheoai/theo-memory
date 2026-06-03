# SEPA Post-GREEN + Pre-COMMIT Review — iteration 3, T2.1, MODE=TIGHT

**Status:** GREEN
**Recommendation:** COMMIT

## Drift documented
- **Drift-T2.1-1:** `download-fixtures.mjs` (plain JS) instead of plan's `.ts` + `tsx`. Avoids new devDep (`tsx` not in package.json; only `jiti` present). EC-6 intent (cross-platform Node 20+ fetch, no wget) fully preserved. Operational tooling (~80 LoC fetch+save) doesn't need TS load-bearing.

## Verified
- 9 files in T2.1 + 1 helper (`_string-coerce.ts` introduced post-RED to satisfy `@typescript-eslint/no-base-to-string` on unknown-typed JSON row fields — small DRY refactor, not scope creep)
- EC-1 normalizeLongMemEvalAnswer: 4-branch coverage (string/number/{text}/fallback-JSON)
- EC-6 native fetch in `.mjs` script
- EC-8 idempotent HEAD-size check
- ADR D4 download-at-install: README + .gitignore + console banner per fixture
- LoCoMo CC-BY-NC-SA banner: present in script + README
- Tests: 8 loader tests PASS (731 total)
- Typecheck zero errors
- Lint zero warnings (after 2 cleanup passes)
- `npm run download-fixtures` script added to package.json
- `.gitignore`: `benchmarks/data/` + `benchmarks/results/`

## ADR cross-check
- D4 honored — fixtures gitignored, license banners visible, no committed dataset files
- D1 N/A at T2.1 (loader layer, not runner)
- D5 N/A (Protocol not touched)
- EC-1/EC-6/EC-8 all absorbed

## Wiring
- (a) static caller: deferred to T3.1/T5.1 (adapter + runner consumers)
- (b) integration: unit tests against committed samples ARE the loader validation
- (c) runtime metric: n/a (pure parse functions)

## Commit GREEN.
