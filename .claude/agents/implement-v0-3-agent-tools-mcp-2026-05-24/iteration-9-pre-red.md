# SEPA — Iteration 9 / Task T6.1 / Phase 6 (stdio transport + CLI full impl)

## Plan recap
- Connect `McpServer` (T1.1) to SDK's `StdioServerTransport`, replace T0.2 stub `cli.ts` with full `main(argv)` that env-validates, wires `createLocalMemory` as the `memoryFactory`, registers SIGTERM+SIGINT shutdown, and starts on stdio. EC-7 (env-var hard-fail + dual-signal shutdown) absorbed inline.

## Findings

### Files to touch (plan-conformant — verify before RED)
- `src/agent-tools/transports/stdio.ts` (NEW) — thin wrapper `connectStdio(server)` per plan § Files-to-edit.
- `src/agent-tools/cli.ts` (UPDATE — full replacement of T0.2 stub at `src/agent-tools/cli.ts:13-21`).
- `src/agent-tools/__tests__/cli.test.ts` (NEW).
- `src/agent-tools/index.ts` (UPDATE — add `export { connectStdio } from './transports/stdio.js'`).
- `package.json` — plan asks to "verify build script exists if not present"; v0.1 pipeline already covers this (per T0.2 step 0 EC-1 verified at iteration 1). Verify before editing; no change likely needed.

### SDK shape — verified (read `node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.d.ts`)
- `class StdioServerTransport implements Transport` — zero-arg constructor (defaults to `process.stdin`/`process.stdout`); accepts optional `(_stdin?: Readable, _stdout?: Writable)` for tests. Use the DI overload for unit tests instead of mocking `process.stdin`.
- Public surface: `start(): Promise<void>`, `close(): Promise<void>`, `send(message)`, `onclose`/`onerror`/`onmessage` callbacks.
- `McpServer.start(transport)` (server.ts:79) calls `sdkServer.connect(transport)` which internally calls `transport.start()` — DO NOT call `transport.start()` AND `server.start()`; that would double-start. Stick to `server.start(transport)`.

### `createLocalMemory` signature — VERIFIED (`src/local/index.ts:254`)
- `createLocalMemory(config: LocalMemoryConfig): Promise<Memory>` is **async** (probes embedder dim + calls `vectorStore.initialize()`).
- Requires `{ vectorStore, embedder, llm }` + optional `historyManager`, `reflectionPolicy`, `tracer`, `customInstructions`.
- **[CRITICAL pattern note]** The plan's pseudocode shows synchronous `const memoryFactory = () => createLocalMemory({...})` — that returns `Promise<Memory>`, not `Memory`. The `McpServerOptions.memoryFactory: () => Memory` contract (types.ts:39) is **synchronous**. T5.1 dispatch calls `deps.memoryFactory()` synchronously per `remember-handler.ts:28` (`const scoped = memoryFromCtx(getScope(), deps.memoryFactory())`).
  - **Resolution for T6.1**: `await` the `createLocalMemory(...)` ONCE at startup in `main()`, bind the resolved `Memory` to a constant, and pass `memoryFactory: () => memoryInstance` to `McpServer`. The factory is a closure over the already-resolved Memory. Plan pseudocode is shorthand; the GREEN impl must respect the contract.

### Bootstrap deps — needs decision
- v0.3 stdio needs concrete `Embedder` + `LLM`. Two options:
  - (A) Use `StubEmbedder` + `StubLLM` from `src/local/stubs.ts` for v0.3 boot (probe-safe, zero-config).
  - (B) Read provider env vars (OPENAI_API_KEY etc.) and wire real OpenAI clients.
- Plan does NOT explicitly resolve this — it only mandates `THEOMEM_PG_URI` is required. **Recommend (A) StubEmbedder/StubLLM for v0.3** (consistent with v0.2 PR-A scaffolded-app default per ADR D8); real-provider wiring is a v0.4+ concern. THE GOAL TEST (T7.1) tests alice/bob isolation via remember/recall — stubs DO work for isolation testing because filters route by user_id at the vector-store layer independently of embedding values.
  - **[INFO]** Stubs emit `console.warn` on first non-probe call — acceptable per ADR D8; not a test concern.

### `runMigrations` — REQUIRED at boot per `src/local/index.ts:278`
- Plan pseudocode omits this. `createLocalMemory` does NOT call `runMigrations`; if invoked against a fresh DB, pgvector tables don't exist → first `tools/call remember` crashes.
- **Recommend**: `main()` MUST call `await runMigrations(pool)` BEFORE `createLocalMemory(...)`. Same `Pool` (from `pg`) feeds the `PgvectorStore` constructor too.
- This is implicit in v0.1 plan deliverable but the v0.3 CLI is the FIRST external entry point that bootstraps from scratch — making it explicit avoids EC-7-shaped silent corruption.

### Per `THEOMEM_AGENT_ID` (optional)
- Plan § Deep Dives line 845: "Optional: pre-bind scope from THEOMEM_AGENT_ID if set". stdio is single-session per plan line 850; bind ONCE at boot via wrapping `server.start(transport)` inside `withScope({ kind: 'agent', agentId: ... }, () => server.start(transport))`.
- THE GOAL TEST (T7.1) specifies `THEOMEM_AGENT_ID=alice` then re-spawn with `THEOMEM_AGENT_ID=bob` — confirms scope binds ONCE at boot per-subprocess. T6.1 just needs to honor the env-var-to-scope mapping; per-message rebinding is v0.4 (DO NOT implement).
- **MAJOR**: if `THEOMEM_AGENT_ID` is absent, scope is unbound — `getScope()` will throw `MissingScopeError` on first `tools/call`. Verify with plan: T5.1's dispatch tests assume scope is set externally (e.g., by transport). For stdio v0.3, plan delegates "scope binding ONCE from env at boot OR per-message JSON-RPC notification (deferred to v0.4)". **Decide**: if `THEOMEM_AGENT_ID` unset, either (i) the stdio session has no scope (every `tools/call` fails with MissingScopeError — honest), OR (ii) `THEOMEM_AGENT_ID` becomes mandatory too. Plan says "optional" — go with (i), but add a clear stderr warn line at boot: "Warning: THEOMEM_AGENT_ID not set; tools/call will fail with MissingScopeError. Set THEOMEM_AGENT_ID=<id> to bind scope for this stdio session."

### TDD shape (plan-mandated 3 RED + EC-7 expansions)
Per plan line 862-864, the 3 mandated RED tests are:
1. `test_main_bootstraps_with_env_vars` — set env, call `main()`, assert StdioServerTransport `start` called (via `vi.spyOn` on prototype).
2. `test_main_uses_themory_pg_uri_for_memory_factory` — assert `createLocalMemory` invoked with config containing `vectorStore` whose `Pool` was constructed from the URI.
3. `test_cli_exits_cleanly_on_sigterm` — emit `process.emit('SIGTERM')`, assert `server.stop` called within 5s.

**EC-7 inline expansions** (MUST add, per plan § Deep Dives line 828):
4. `test_main_exits_2_when_THEOMEM_PG_URI_absent` — `delete process.env.THEOMEM_PG_URI`, spy on `process.exit` + `process.stderr.write`, call `main()`, assert exit code = 2 + stderr contains 'THEOMEM_PG_URI required'.
5. `test_main_handles_BOTH_SIGINT_and_SIGTERM` — emit SIGINT, assert shutdown handler invoked (mirror of test 3 for SIGINT).

**Recommended additional RED (defensive, plan-EC-7 spirit)**:
6. `test_shutdown_timeout_5s_force_exits` — `server.stop` hangs > 5s → `Promise.race` wins → `process.exit(0)` still fires. Use `vi.useFakeTimers()` + advance 5_000ms.

### Test isolation hazards
- **[MAJOR]** `process.on('SIGTERM', ...)` registers a persistent handler — DO NOT leak across tests. Use `process.removeAllListeners('SIGTERM')` + `removeAllListeners('SIGINT')` in `afterEach` OR design `main()` to return the handler refs so tests can `process.removeListener(...)` them.
- **[MAJOR]** `process.exit` mocking — tests MUST mock it BEFORE invoking `main()`, otherwise the test runner itself exits. Pattern: `vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(\`exit:\${code}\`); })`. Then `await expect(main()).rejects.toThrow('exit:2')`.
- **[MAJOR]** `process.env` mutation between tests — use `vi.stubEnv('THEOMEM_PG_URI', '...')` + `vi.unstubAllEnvs()` in `afterEach`. Plain `process.env.X = ...` leaks across tests in the same worker.
- **Mocking `StdioServerTransport`**: prefer DI overload — construct `new StdioServerTransport(mockReadable, mockWritable)` with `Readable.from([])` + `new PassThrough()`. Cleaner than `vi.mock('@modelcontextprotocol/sdk/server/stdio.js')`.

### EC absorption cross-check
- **EC-7**: stderr message wording — plan mandates EXACT string `'Error: THEOMEM_PG_URI required. Set it to a postgres connection string (e.g., postgres://user:pass@host:5432/dbname).'`. Implementation must include the example URI. RED test 4 should assert substring `'postgres://user:pass@host:5432/dbname'` to lock the actionable-error contract.
- **EC-7 shutdown**: `Promise.race([server.stop(), setTimeout(5_000)])` per plan line 840 — note `setTimeout` returns a `Timeout` handle, not a Promise. Use `new Promise(r => setTimeout(r, 5_000))` (plan pseudocode has this right).
- **EC-1 + EC-8**: build pipeline already verified at T0.2 step 0 (iteration 1 SEPA pre-commit confirmed). T6.1 step 1 says "verify v0.1 build pipeline emits `dist/`" — a `npm run build && test -f dist/agent-tools/cli.js` smoke step BEFORE moving to step 2 is the safest invariant. If green, no edit to `package.json` needed.

### Cross-references for JSDoc / commit (verify at pre-commit, but flag now)
- `cli.ts` header MUST cite `ADR D1` (transport), `EC-7` (env-var + dual-signal absorption), `T6.1`.
- `transports/stdio.ts` MUST cite `ADR D1`.
- Commit message: `feat(agent-tools)(v0-3): stdio transport + CLI bootstrap (T6.1, EC-7)`.
- No `Co-Authored-By` trailer (project policy per session memory).

### DIP boundary check
- `src/agent-tools/cli.ts` will import from `src/local/index.ts` (`createLocalMemory`, `runMigrations`, `PgvectorStore`, `StubEmbedder`, `StubLLM`). **This is a CLI composition-root import — distinct from the `src/agent-tools/` library boundary.** The architecture rule (architecture.md § 3) says `src/agent-tools/ → src/core/ ONLY` for library code; CLI entry points are explicitly composition roots that wire concrete runtimes. SEPA opinion: this is acceptable because `cli.ts` is the bin entrypoint, NOT library code consumed by external imports.
- **[MAJOR]** Boundary hook (`boundary-check.sh`) may flag this. **Recommend**: if hook complains, add an inline exemption comment AND a note to ADR D8 (composition-root pattern) — DO NOT silently bypass.
- The library subpath public surface (`src/agent-tools/index.ts`) STILL must not export anything from `src/local/`. Verify after edit.

## Recommended action

Proceed with RED phase using the 6 tests above (3 plan-mandated + 2 EC-7 + 1 defensive). Before writing tests:

1. **Confirm StubEmbedder/StubLLM is the boot default** (recommend yes — single-line ADR-D8-aligned decision).
2. **Add `runMigrations(pool)` call to `main()` bootstrap** — plan pseudocode omits it; without it, first `tools/call remember` against fresh DB crashes.
3. **Lock `memoryFactory` shape**: `main()` `await`s `createLocalMemory(...)` ONCE; wraps the resolved `Memory` in `() => memoryInstance` closure for the synchronous `McpServerOptions.memoryFactory` contract.
4. **Decide THEOMEM_AGENT_ID handling**: confirm "absent → no scope, runtime MissingScopeError on tools/call" + emit stderr warn at boot. Plan says "optional"; this is the honest interpretation.
5. **Test isolation**: use `vi.stubEnv` + `vi.spyOn(process, 'exit')` + `process.removeAllListeners` in `afterEach`. NEVER let `process.exit` actually fire in tests.
6. **DIP exemption**: if `boundary-check.sh` flags `cli.ts → src/local/`, add inline comment `// CLI composition root per ADR D8 — exempt from src/agent-tools/ library boundary rule`.

No [CRITICAL] findings; ready for RED.
