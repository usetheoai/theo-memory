# SEPA — Iteration 8 / Task T5.1 / Phase 5 (Tool dispatch — 4 verbs end-to-end)

## Plan recap

- T5.1 ships 4 dispatch handlers (`remember-handler.ts`, `recall-handler.ts`, `forget-handler.ts`, `reflect-handler.ts`) + a central `dispatch.ts` Map lookup + wires `setRequestHandler(CallToolRequestSchema, …)` in `server.ts`. Each handler: (1) zod safeParse args → (2) resolve scope via `getScope() + memoryFromCtx` → (3) call underlying Memory verb → (4) return CallToolResult or route through `classifyError`. EC-6 (empty-recall shape) and EC-14 (forget-unknown-id idempotent) absorbed inline. Per ADRs D3 + D6 + D2.

## Findings

### [CRITICAL] — `memoryFromCtx` returns `ScopedMemory`, not `Memory`; `ScopedMemory` has NO `forget` method

- Verified at `src/core/memory-store.ts:63-68` — `ScopedMemory` interface exposes `remember`, `recall`, `reflect`, `getAll` only. `forget` is **deliberately excluded** with JSDoc note: *"Notably excludes `forget` (memoryId is globally unique — use top-level Memory.forget)"*.
- Verified at `src/theokit/index.ts:56` — `memoryFromCtx(ctx, memory): ScopedMemory`.
- Plan T5.1 § Deep Dives says forget handler "calls `memory.forget(id)` or `memory.forgetAll()`" — both calls would be against the ScopedMemory returned by `memoryFromCtx`, which **does not expose forget**. TS compile error guaranteed.
- **Recommended fix (no plan deviation needed; plan handler-signature `deps: {memoryFactory: () => Memory}` already provides the top-level Memory):** forget handler MUST call `deps.memoryFactory().forget(parsed.data.id)` directly — using the **unscoped** top-level Memory. Still resolve scope via `getScope()` first so MissingScopeError fires when called outside `withScope` (preserves dispatch's scope-required invariant per ADR D3) but the actual delete uses top-level Memory. Suggested shape:
  ```ts
  const ctx = getScope();           // throws MissingScopeError outside withScope
  // ctx not used for the call itself; forget is scope-agnostic by id
  await deps.memoryFactory().forget(parsed.data.id);
  ```
- Document this asymmetry in forget-handler JSDoc: *"forget bypasses memoryFromCtx because ScopedMemory excludes forget (memory IDs are globally unique). Scope is still required to enter the handler — prevents anonymous bulk-delete attempts via stdio."*

### [CRITICAL] — `Memory.forgetAll()` does NOT exist; `all:true` MUST short-circuit to honest deferral

- Verified `src/core/memory-store.ts:76-92` — Memory exposes `forget(memoryId, options?)`, `get`, `history`, `reset(scope)`. No `forgetAll`.
- `reset(scope)` exists (line 91) but plan T5.1 explicitly defers bulk delete to v0.4. **Do NOT** wire `all:true` to `reset(getScope())` — that would silently land bulk-delete behavior the plan defers.
- Forget handler MUST detect `parsed.data.all === true` BEFORE the Memory call and return execution-error wire shape (NOT throw): `{content: [{type:'text', text:'bulk delete not yet supported, pending v0.4'}], isError: true}`. Matches plan T5.1 § Deep Dives literal text. Test `test_forget_all_mode_returns_not_yet_supported` (RED #4) asserts this exact shape.

### [MAJOR] — EC-14 (forget unknown id idempotent) — `MemoryStore.forget` currently throws `MemoryNotFound` on unknown id; not idempotent today

- v0.1 local runtime: confirm behavior by reading `src/local/memory-store.ts` (or equivalent). If `forget(unknownUuid)` throws `MemoryNotFound`, EC-14 absorption requires the **handler** to catch that specific error and return success wire shape (NOT propagate to classifyError, which would treat unhandled MemoryNotFound as -32603).
- Two acceptable shapes for the catch:
  1. In forget-handler: `try { await memory.forget(id) } catch (e) { if (e instanceof MemoryNotFound) return {content:[{type:'text',text:'Memory not found or already forgotten.'}], isError: false}; throw e; }`
  2. In classifier: add `if (err instanceof MemoryNotFound) return execution(...)` branch BEFORE the -32603 fallback. Cleaner but spreads idempotency policy into a generic classifier — prefer option 1 (handler-local).
- Add RED test `test_forget_unknown_id_returns_idempotent_success` per the EC-14 inline absorption: mock `memory.forget` throws `MemoryNotFound('xxx')`, dispatch returns `isError:false`. Logged in edge-case report as SHOULD TEST EC-14.
- **Verify before RED:** read `src/local/` forget impl to confirm error class. If v0.1 already returns silently for unknown id, downgrade this finding to INFO and skip the catch block — but still add the RED test as regression guard.

### [MAJOR] — Recall handler MUST map `createdAt: Date` → ISO string at wire boundary

- `MemoryItemWithScore.createdAt` is `Date` (`memory-item.ts:23`). `OUTPUT_SCHEMA.results[].createdAt` is `z.string()` (`recall-schema.ts:67`).
- Direct `JSON.stringify(results)` will serialize Date as ISO string via `Date.prototype.toJSON()` automatically, so the wire shape *happens* to be correct — but the type contract is mismatched. Add explicit `createdAt: item.createdAt.toISOString()` in the mapper to make the contract honest (zod parse on output won't crash today, but a future Date→Date-ish refactor will silently break consumers).
- Same applies to `updatedAt` (excluded from OUTPUT_SCHEMA per recall-schema.ts:44 — confirmed dropped under ADD-only).
- Suggested mapper shape:
  ```ts
  const results = items.map(item => ({
    id: item.id,
    text: item.text,
    score: item.score,
    scope: item.scope,
    createdAt: item.createdAt.toISOString(),
    metadata: item.metadata ?? {},
  }));
  ```
- Also: validate the mapped output against `OUTPUT_SCHEMA.parse(...)` at handler exit in dev/test (NOT in prod hot path — adds latency). Catches drift early.

### [MAJOR] — Dispatch error symmetry: Protocol Errors MUST be thrown; Execution Errors MUST be returned

- SDK `setRequestHandler(CallToolRequestSchema, …)` boundary expects:
  - Throw → SDK serializes as JSON-RPC `error{code, message, data?}` (Protocol Error).
  - Return CallToolResult → SDK serializes as JSON-RPC `result` (with `isError:true` for Execution Errors).
- `classifyError` already returns the tagged union `{kind:'protocol'|'execution', payload}`. Dispatch wrapper MUST:
  ```ts
  try {
    return await handler(args, deps);
  } catch (err) {
    const c = classifyError(err);
    if (c.kind === 'protocol') {
      const e = new Error(c.payload.message) as Error & {code?: number; data?: unknown};
      e.code = c.payload.code;
      e.data = c.payload.data;
      throw e;  // SDK serializes to JSON-RPC error field
    }
    return c.payload;  // {content, isError:true} — JSON-RPC result field
  }
  ```
- Verify the exact SDK convention for Protocol Error throwing — check `@modelcontextprotocol/sdk/server/index.js` Server source or types. Some SDKs use `McpError` class with `.code` field; if so, import + use it instead of plain Error. **Add this verification to RED phase reads.**
- RED tests `test_dispatch_invalid_args_returns_protocol_error` (#7) + `test_dispatch_unknown_tool_returns_method_not_found` (#8) should assert **thrown** errors with `.code === -32602` / `-32601`, NOT returned CallToolResults. Test naming says "returns" but contract says "throws" — clarify in test description with AAA comment.

### [MAJOR] — `dispatch.ts` Map lookup MUST throw `UnknownToolError`, not return a fallback CallToolResult

- Per `error-classifier.ts:62-69`, `UnknownToolError` exists for exactly this purpose. Dispatch:
  ```ts
  const handler = HANDLERS.get(name);
  if (!handler) throw new UnknownToolError(name);
  return handler(args, deps);
  ```
- Wrapped in dispatch's try/catch above, this routes to -32601 Method not found via classifyError branch 3.

### [MINOR] — Handler signature `deps: {memoryFactory: () => Memory}` — clarify lifecycle

- Plan signature uses factory `() => Memory`, not direct Memory instance. Why? Two reasonable interpretations:
  1. **Per-request Memory** — factory invoked each call for isolation (rules out shared connection pool — likely wrong for pg).
  2. **Lazy singleton** — factory caches; first call constructs Memory + pg pool, subsequent calls reuse.
- Recommended: lazy singleton at the server-bootstrap level (T6.1 cli wiring), passed into dispatch. Factory is just `() => sharedMemory` — keeps the signature flexible for future per-request scoping (e.g., per-tenant pools at v0.4+).
- Document the choice in `dispatch.ts` JSDoc + add to T6.1 cli wiring notes.

### [MINOR] — Handler file size budget (≤ 500 LoC, expected ~80) — REFACTOR-phase common helper

- Plan acceptance: ≤ 500 LoC each; expected ~80. After 3 handlers the rule-of-three triggers extraction (plan REFACTOR note). Suggested helper signature in `dispatch.ts` or a new `_handler-helper.ts`:
  ```ts
  async function withScopedMemory<T>(
    args: unknown,
    schema: z.ZodTypeAny,
    deps: HandlerDeps,
    fn: (parsed: any, scopedMem: ScopedMemory) => Promise<T>,
  ): Promise<T> {
    const parsed = schema.parse(args);                  // throws ZodError → -32602
    const ctx = getScope();                              // throws MissingScopeError → execution
    const scoped = memoryFromCtx(ctx, deps.memoryFactory());
    return fn(parsed, scoped);
  }
  ```
- forget handler can't use this helper as-is (needs unscoped Memory + bypass scope-binding for the call) — accept the duplication for forget to keep the helper honest. Document the asymmetry.

### [MINOR] — Test naming: split RED #7 "test_dispatch_invalid_args_returns_protocol_error"

- The word "returns" misleads (contract is "throws"). Rename to `test_dispatch_invalid_args_throws_protocol_error` OR add explicit AAA comment in test body: `// Then: dispatch throws Error with .code === -32602 (SDK serializes to JSON-RPC error field)`. Same for #8.

### [INFO] — server.ts wiring is one line

- Add ONE import (`CallToolRequestSchema` from sdk/types.js) + ONE registration in `McpServer` constructor (after the `ListToolsRequestSchema` registration at line 51-53):
  ```ts
  this.sdkServer.setRequestHandler(CallToolRequestSchema, (req) =>
    dispatch(req.params.name, req.params.arguments, this.deps),
  );
  ```
- `this.deps` requires extending `McpServerOptions` to carry the `memoryFactory`. Verify `types.ts` shape and update if needed (NEW field, backward-compat optional? — if T6.1 hasn't wired cli yet, make it required at constructor; T6.1 wires it).

### [INFO] — CHANGELOG entry shape (Inquebrável Rule 6)

- Cluster T5.1 under `[Unreleased]` → `Added` → bullet referencing v0.3 + T5.1 + EC-6 + EC-14 absorptions. Suggested: *"MCP `tools/call` dispatch wiring for `remember`/`recall`/`forget`/`reflect`; empty-recall shape locked (EC-6); forget-unknown-id idempotent (EC-14); bulk-delete deferred to v0.4 (#PR-N)"*.

## Recommended action

1. **Before RED #3 (forget happy path):** Read `src/local/memory-store.ts` (or `src/local/index.ts`) to confirm whether `forget(unknownId)` throws `MemoryNotFound` (default v0.1 behavior) or returns silently. EC-14 handler logic depends on this — if it throws, catch in handler; if silent, skip catch but keep RED test as regression.
2. **Before RED:** Read `@modelcontextprotocol/sdk/server/index.js` (or `node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.d.ts`) to confirm the **exact** mechanism for throwing Protocol Errors (plain Error with `.code` field, or `McpError` class). Adjust dispatch try/catch accordingly.
3. **RED additions beyond the 9 plan tests:**
   - Add `test_forget_unknown_id_returns_idempotent_success` (EC-14 inline regression).
   - Add `test_recall_maps_createdAt_to_iso_string` (asserts wire-shape contract; mock memory.recall returns item with `createdAt: new Date('2026-05-25T00:00:00Z')`, assert structuredContent.results[0].createdAt === '2026-05-25T00:00:00.000Z').
   - Add `test_forget_handler_uses_unscoped_memory_not_scoped` (regression guard for the ScopedMemory-excludes-forget gotcha — assert `memory.forget` called on the top-level mock, not on a `memoryFromCtx`-wrapped instance).
4. **GREEN order:** implement `dispatch.ts` skeleton + `remember-handler.ts` first (simplest); use it as the reference shape for `reflect-handler.ts` (also simple). Tackle `recall-handler.ts` next (output mapping). `forget-handler.ts` last (most edge cases: ScopedMemory bypass + all:true short-circuit + EC-14 catch).
5. **REFACTOR:** extract `withScopedMemory` helper after 3rd handler (remember + recall + reflect share the pattern; forget opts out). Document the asymmetry.
6. **WIRING triad:** pillar (a) production callers = `server.ts setRequestHandler` (1 caller, functional, not no-op); pillar (b) integration test for dispatch lives in T7.1 E2E stdio subprocess (mark as `ADR-DEFER-WIRING-B: deferred to T7.1 stdio E2E` if T7.1 not yet landed); pillar (c) runtime metric n/a for T5.1 unless plan declared one — check plan § DoD for any metric, otherwise n/a.
7. **JSDoc cross-references on every handler file:** `@see ADR D3` (scope), `@see ADR D6` (error mechanisms), `@see EC-6` (recall handler), `@see EC-14` (forget handler), `@see plan T5.1`.
