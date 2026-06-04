# SEPA Initial Brief Response — theo-memory-standalone-p0

**Date:** 2026-06-03
**Mode:** VERBOSE
**Phase:** INITIAL_BRIEF (pre-iteration-0)

## Plan recap
Ship standalone REST + Docker + CLI distribution at `@usetheo/memory/server` + `themory` CLI + GHCR distroless image; goal-test = round-trip `POST /v1/remember` + `POST /v1/recall` against `ghcr.io/usetheo/themory:0.1.0-alpha`.

## Findings

- **INFO** — Role contract + plan v1.2 + ADR D1-D14 + all 49 EC absorptions + 4 deps-audit deferrals (rows 86-89) confirmed read. Coverage Matrix 89/89 (100%). 14 ADRs internally consistent (D6 ↔ D8 ↔ D13 mutually reference EC-47; D3 amended ↔ EC-1/2/3/4; D12 ↔ EC-9 strict union; D14 ↔ rows 86-89).

- **INFO** — Cross-reference triple-check for EC-47 (the BLOCKER): **CONSISTENT** across D6 Consequences, D8 Decision, D13 Decision. All three concur. T3.4 implements; T2.3 carries the migrate-on-startup discipline inside `themory server` (D8 amended). NO shell-entrypoint contradiction detected.

- **INFO** — `runMigrations` actually exists at `src/local/index.ts:1026`. T2.3 D8 absorption path is realizable.

- **MAJOR** — **`vitest.contract.config.ts` `include` does NOT cover `src/server/**`**. Plan T1.1 adds this. Without it during early T1.1 phases, RED tests in `src/server/auth/__tests__/` will be SILENTLY SKIPPED + `passWithNoTests: true` makes false-GREEN possible. **Recommend hoisting to T0.1.**

- **MAJOR** — **`tsconfig.contract.json` `include` does NOT cover `src/server/**`**. Plan T1.7 adds this. T1.1 writes server code → `npm run typecheck` would skip server files silently during T1.1-T1.6 (6 tasks dark). **Recommend hoisting to T0.1.**

- **MAJOR** — **Runtime-metric pillar (c)**: confirmed T1.5 is sole runtime-metric task. Other tasks `n/a`. However `tests/integration/rest-api.test.ts` is NOT listed in T1.5 Files-to-edit (only `otel-middleware.ts` + `otel.test.ts`). Integration test file is implied but never explicitly declared as NEW. Recommend SEPA flag at T1.5 pre-RED.

- **INFO** — `package.json#files` wildcard `src/**/*.ts` automatically picks up server. EC-52 test should pass.

- **INFO** — `src/core/dip/__tests__/auth-verifier.test-d.ts` convention valid per vitest typecheck include line 32.

- **INFO** — Node v20.19.2 ≥ engines >=20.0.0. Cycle-implement v1.5 Check 6 PASSES.

- **INFO** — ADR D14 sunset 2026-09-01 consistent across all 4 deps.

- **MINOR** — `no-paper-names-in-code.md` cross-reference confirmed.

## Recommended action

**Pre-T0.1 pre-RED:**

1. T0.1 should ALSO patch `tsconfig.contract.json` include + `vitest.contract.config.ts` include to add `src/server/**` upfront — NOT defer to T1.1/T1.7. Single biggest invisible-trap.
2. T0.1 RED test EC-18 (version alignment smoke): place at `tests/unit/dep-version-alignment.test.ts` (matches existing include).
3. T1.5 must explicitly declare `tests/integration/rest-api.test.ts` (NEW) for pillar (c) observability.

**Verdict:** plan is READY for /implement halt-loop, with one MAJOR caveat: T0.1 should be expanded upfront. Halt-loop catches silent-skip eventually but a pre-emptive expansion saves ~3 iterations.
