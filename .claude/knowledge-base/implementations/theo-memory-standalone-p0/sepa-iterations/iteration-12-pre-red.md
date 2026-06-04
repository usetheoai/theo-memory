# SEPA — Iteration 12 / Tasks T2.4 + T2.5 / Phase pre-RED (combined)

## Findings
- **[CRITICAL] T2.5 test count**: plan declares 5 RED tests (valid DB → 0; invalid URI → 1; Memory factory throws → 1; --deep success → 0; --deep embedder failure → 1). Honor 5/5, not 3.
- **[MAJOR] Extract both**: `run-migrate.ts` + `run-health.ts` mirror run-server.ts/run-mcp-server.ts. Pattern consistency + testability + cli.ts LoC budget.
- **[MAJOR] EC-36 test renaming**: "themory migrate idempotent: second invocation against already-migrated DB is no-op" — accurate to assertion shape; avoids flaky concurrent racing per testing.md § Determinism.
- **[MAJOR] T2.5 --deep**: invoke real `embedder.embed("ping")` + `llm.generateChat(...)` against the wired impl. JSDoc honest-frames "at P0 stubs return deterministic results; real impls are network round-trips."
- **[MAJOR] EC-17 2s timeout**: `themory health` mandatory pool.query('SELECT 1') must use Promise.race with 2s timeout (mirror T1.3 /v1/health/db).
- **[MINOR] CHANGELOG**: single combined [Unreleased] entry covering both migrate + health.

## Recommended sequence (T2.4 this iter; T2.5 next iter)
1. Create `src/agent-tools/run-migrate.ts` with `runMigrate(options?)` exporting.
2. 3 RED tests in `__tests__/run-migrate.test.ts`: fresh DB applies; idempotent second-run no-op (EC-36 reframed); pool.end called after completion.
3. Wire `.command('migrate').action(runMigrate)` in cli.ts.
4. EC-35 README note: drizzle wraps each migration in tx by default.
5. T2.5 follows in iter 13 with 5 RED tests + --deep flag + EC-37.

No CRITICAL blockers for T2.4. Proceed to RED.
