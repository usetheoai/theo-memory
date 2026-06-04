# SEPA — Iteration 11 / Task T2.3 / Phase Pre-RED

## Plan recap
Wire `themory server`: createServer + migrate-on-startup (D8) + SIGTERM/SIGINT graceful (EC-32) + EADDRINUSE clean stderr (EC-31) + readiness-gate 503/200 (EC-33). 7 RED tests.

## Findings
- **[MAJOR] Q1 extract run-server.ts**: CONCUR (mirrors T2.1 run-mcp-server precedent). Plan Files-to-edit list NEEDS expansion — document in iteration log + commit msg per anti-pattern #7.
- **[CRITICAL] Q2 readinessProbe DI**: extend `CreateServerOptions.readinessProbe?: () => boolean` + extend `healthHandler(c, readinessProbe?)` analogous to `healthDbHandler(c, dbProbe)`. THIRD file edit (`src/server/handlers/health.ts` + `src/server/app.ts`) beyond plan; document.
- **[MAJOR] Q3 test strategy**: in-process for migrate-before-bind + readiness 503/200 + DB-unreachable; child-process for SIGTERM + EADDRINUSE. `describe.skipIf` gates per file precedent.
- **[MAJOR] Q4 dbProbe closure**: thin `() => pool.query('SELECT 1').then(() => undefined)`; let healthDbHandler own 2s timeout (DRY).
- **[CRITICAL] Q5 SIGTERM**: shared idempotent handler with `shuttingDown` boolean guard registered on BOTH SIGTERM + SIGINT; close server via Promise-wrapped `http.Server.close(cb)`; then `pool.end()`; then `exit 0`.
- **[CRITICAL] Q6a THEMEMORY_SKIP_MIGRATIONS**: positive opt-in `=== 'true'` only (fail-safe default = run migrations).
- **[CRITICAL] Q6b EC-33 ordering**: factory MUST be kicked off async-parallel with `serve()` — `let isReady = false; const warmPromise = (async () => { memory = await createLocalMemory(...); isReady = true; })(); serve(...)`. Without this, factory completes before any HTTP call → EC-33 RED test unreachable.

## Recommended sequence
1. Extract `src/agent-tools/run-server.ts` exporting `runServer(options)`.
2. Extend `CreateServerOptions` with `readinessProbe?: () => boolean`; extend `healthHandler` to consult probe → 503 when probe returns false.
3. runServer ordering: pool → migrations (if not skipped) → kick off memory factory async → setup readinessProbe → bind port eagerly via @hono/node-server `serve()` → readiness flag set when factory resolves.
4. SIGTERM/SIGINT shared idempotent shutdown handler.
5. EADDRINUSE: serve() returns a Server; listen `error` event for EADDRINUSE → stderr + exit 1.
6. RED tests hybrid: 4 in-process (#1/#2/#3/#7), 3 child-process (#4/#5/#6).

3 CRITICALs absorbed as plan-scope expansion (third file `src/server/handlers/health.ts` + app.ts edits) with documented rationale. Proceed to RED.
