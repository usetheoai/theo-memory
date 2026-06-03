# SEPA — Iteration 8 / Task T1.7 / Phase Pre-RED

## Plan recap
T1.7 wires `./server` subpath export + EC-25 (ESM-only, typecheck-resolvable) + EC-26 (bundle isolation: default barrel does NOT pull Hono) + EC-52 (`npm pack` ships `src/server/**`).

## Findings

- INFO — Static-import verification: `src/index.ts` only imports from `./local/` + `./core/`; zero `from 'hono'` in `src/{local,core}/**`. EC-26 structurally honored at source.
- INFO — Current `files` whitelist already includes `src/server/**/*.ts` via the wildcard. EC-52 passes "for free" — test = regression guard, not gap-fix.
- INFO — `vitest.contract.config.ts` `typecheck.include` does NOT cover `server`. EC-25 test-d under `src/server/__tests__/` will silent-skip unless glob updated.

## Recommendations

- **Q1 EC-26**: APPROVE static-import recursive grep over esbuild bundle. Zero new deps; <100ms; tree-shaking false-positive risk avoided.
- **Q2 EC-52**: APPROVE `execSync('npm pack --dry-run --json')` cached in `beforeAll`. KISS over `pacote` lib.
- **Q3 EC-25**: PUT test-d under `src/server/__tests__/subpath-export.test-d.ts` AND add `server` to vitest typecheck.include glob.
- **Q4 README**: 30-50 line section: what+why, install+start snippet, one curl with bearer, OpenAPI auth-exempt one-liner, ESM-only note, docker-compose pointer.
- **Q5 CHANGELOG**: single consolidated entry under `[Unreleased] ### Added` with ticket ref placeholder.

## CRITICAL flags
None.

## Watchpoints
- Preserve alphabetical ordering of `exports` entries.
- Confirm `tsconfig.contract.json#include` covers `src/server/**` (already done T0.1).

## Recommended sequence
1. Write `src/server/__tests__/subpath-export.test-d.ts`.
2. Write `tests/integration/subpath-isolation.test.ts` (both EC-26 static + EC-52 pack assertions).
3. Verify RED.
4. GREEN: add `./server` to `package.json#exports`, add `server` to vitest typecheck.include.
5. README + CHANGELOG edits.
