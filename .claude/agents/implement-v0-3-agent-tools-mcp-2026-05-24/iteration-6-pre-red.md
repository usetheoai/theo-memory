# SEPA — Iteration 6 / Task T3.1 / Phase 3 (Pre-RED, 1/3)

## Plan recap

- T3.1 lands `src/agent-tools/scope.ts` (NEW: `AsyncLocalStorage<ScopedContext>` + `withScope` + `getScope`) AND moves the `ScopedContext` interface from `src/theokit/types.ts` to `src/core/scope.ts` (NEW ADDITION to existing file) so both sibling layers depend on core per DIP. `src/theokit/types.ts` becomes a re-export shim; `src/agent-tools/index.ts` re-exports `withScope` + `getScope`. EC-4 backward-compat HARD GATE: v0.2 PR-A integration test suite (`tests/integration/theokit-binding.test.ts`, 46 tests + 304 total contract tests) MUST stay green after the move.

## Verification of context (Read confirmed)

- `src/theokit/types.ts` currently owns `ScopedContext` (lines 18-37) with load-bearing JSDoc citing ADRs D1/D4/D6 + blueprint Q5/Q7 + forward-compat note. **MUST be preserved verbatim** during the move — paste the JSDoc block onto the new declaration in `src/core/scope.ts`, then `src/theokit/types.ts` becomes a JSDoc'd re-export shim.
- `src/core/scope.ts` currently exports `UserScope` / `SessionScope` / `AgentScope` / `Scope` / `Filters`. The T3.1 move ADDS `ScopedContext` (structural binding type — distinct from the discriminated-union `Scope`). Do NOT conflate the two; `ScopedContext` is the inbound TheoKit-shaped request payload, `Scope` is the internal narrowing union. Keep them as separate declarations in the same file.
- `src/core/errors.ts` exports `MissingScopeError` (lines 75-82) with JSDoc citing v0.2 PR-A's 3-state resolver. ✓ Ready to import from `src/agent-tools/scope.ts` via `../core/errors.js`.

## Findings

- **[MAJOR] — JSDoc preservation strategy.** On the new `ScopedContext` declaration in `src/core/scope.ts`: copy the FULL v0.2 PR-A JSDoc block (D1/D4/D6 + Q5/Q7 references) verbatim. On the re-export in `src/theokit/types.ts`, use the `/** @see */` import re-export form per your initial-brief MAJOR finding:
  ```ts
  /**
   * Re-exported from `src/core/scope.ts` (moved at T3.1 of v0.3 agent-tools-mcp
   * for DIP alignment — both `src/theokit/` and `src/agent-tools/` are sibling
   * layers depending on core). Public type contract preserved for v0.2 consumers.
   *
   * @see ../core/scope.ts for the load-bearing JSDoc (ADRs D1/D4/D6 + blueprint Q5/Q7)
   * @see T3.1 of plan v0-3-agent-tools-mcp for the DIP rationale
   */
  export type { ScopedContext } from '../core/scope.js';
  ```
  NOT a bare `export type { ScopedContext } from '../core/scope.js';` — bare re-export loses the audit trail of WHY the move happened.

- **[MAJOR] — `getScope()` strict semantics + EC-12 SHOULD-TEST decision.** Plan T3.1 § Acceptance Criteria says `getScope()` outside `withScope` throws `MissingScopeError`. EC-12 inline RED test `test_nested_withScope_with_undefined_inner_throws` — per your STRICT decision: `withScope(undefined as any, () => getScope())` should ALSO throw `MissingScopeError`. The cleanest implementation: have `withScope` validate the ctx argument up-front (reject `undefined`/`null`) BEFORE entering `als.run`. This makes the invariant "scope is always defined inside `withScope`" hold structurally. Alternative: let `als.run(undefined, ...)` succeed and have `getScope()` throw on the undefined store. STRICT path (validate at `withScope` entry) is more honest — matches v0.2 PR-A's 3-state resolver fail-loud discipline. **Recommend: validate at `withScope` entry; throw `MissingScopeError("withScope requires a non-null ScopedContext")` on null/undefined ctx.** Add a 7th RED test: `test_withScope_rejects_null_or_undefined_ctx`.

- **[MAJOR] — `MissingScopeError` message specificity.** v0.2 PR-A pattern (per `src/core/errors.ts` JSDoc) distinguishes state (b) "session === null" from state (c) "session absent or userId missing" via caller-supplied message. For T3.1, the two `getScope`-related failure modes are:
  1. `getScope()` called outside any `withScope` → message: `"getScope() called outside withScope — agent-tools dispatch must run inside withScope(ctx, ...)"`.
  2. `withScope(null/undefined, ...)` rejected at entry → message: `"withScope requires a non-null ScopedContext (received null or undefined)"`.
  Distinct messages let downstream T4.1 `classifyError` + T5.1 dispatch error-routing keep tracing the failure to root cause without inspecting stack traces. Single generic message defeats the purpose.

- **[MINOR] — Test naming + AAA discipline (testing.md § BDD).** Plan declares test names as `test_*` snake_case. Vitest convention here is `describe('withScope')` + `it('throws MissingScopeError when called outside withScope')`. Plan's snake_case naming is a hint shape, not the literal test ID. Use Given-When-Then phrasing in `it(...)` strings per `testing.md`. Example: `it('returns the bound ctx when getScope() is called inside withScope', ...)`. Avoid `test_getScope_returns_ctx_inside_withScope` as the literal `it` string.

- **[MINOR] — Concurrent isolation test depth.** Plan RED `test_concurrent_withScope_isolation` says "Promise.all 2 ctxs". For real coverage of AsyncLocalStorage's per-async-context semantics, the inner functions MUST `await` something (e.g., `await sleep(10)`) BEFORE reading `getScope()`. Without an `await`, V8's microtask queue may not interleave — the test would pass even on a broken implementation. Recommend: `async () => { await new Promise(r => setTimeout(r, 10)); return getScope(); }` inside each `withScope` body, then `Promise.all([withScope(ctxA, fnA), withScope(ctxB, fnB)])` and assert each returns its own ctx.

- **[MINOR] — `test_scope_type_imported_from_core` typecheck assertion.** This is a compile-time-only check; runtime expression like `import type { ScopedContext } from '../../core/scope.js'` at top of test file + an `expectTypeOf<ScopedContext>().toMatchTypeOf<{session?: {userId?: string} | null}>()` from `vitest` covers the structural shape claim. Alternative: a `it.skipIf(true)(...)` placeholder is dishonest — use `expectTypeOf` per testing.md § "What NOT to test" exception ("tricky inference paths").

- **[INFO] — DIP boundary (`architecture.md § 3`).** `src/agent-tools/scope.ts` importing `import type { ScopedContext } from '../core/scope.js'` + `import { MissingScopeError } from '../core/errors.js'` is COMPLIANT — agent-tools → core is the only allowed direction. The boundary-check.sh hook will pass. No flag.

- **[INFO] — `AsyncLocalStorage` auto-reset.** Plan ADR D3 + your context note confirm: `als.run(ctx, fn)` auto-resets on lexical exit (no try/finally needed, unlike Python contextvars). The implementation:
  ```ts
  const als = new AsyncLocalStorage<ScopedContext>();
  export function withScope<T>(ctx: ScopedContext, fn: () => T | Promise<T>): T | Promise<T> {
    if (ctx == null) throw new MissingScopeError('withScope requires a non-null ScopedContext (received null or undefined)');
    return als.run(ctx, fn);
  }
  export function getScope(): ScopedContext {
    const ctx = als.getStore();
    if (ctx === undefined) throw new MissingScopeError('getScope() called outside withScope — agent-tools dispatch must run inside withScope(ctx, ...)');
    return ctx;
  }
  ```
  Note: `als.run`'s return type captures `T | Promise<T>` — async callers `await withScope(...)`. Sync callers get sync value. No double-await pitfall.

- **[INFO] — EC-4 HARD GATE execution shape.** After GREEN + REFACTOR, BEFORE COMMIT, run:
  ```
  npm test -- tests/integration/theokit-binding.test.ts
  ```
  Expected: 46 tests pass, exit 0. If ANY fail → revert the move, fix re-export shape (likely a missing `.js` extension or wrong path), re-run until green. This is non-negotiable per plan T3.1 Acceptance Criteria + EC-4 absorption. The full 304 v0.2 contract suite (`npm test`) is the broader confidence check; integration test is the targeted gate.

- **[INFO] — Commit shape preview.** T3.1 commit message draft for pre-COMMIT consultation (iter-6 #3):
  ```
  feat(agent-tools): add AsyncLocalStorage scope binding + relocate ScopedContext to core

  T3.1 of v0-3-agent-tools-mcp plan. ADR D3 (AsyncLocalStorage scope binding).
  EC-4 HARD GATE verified: v0.2 PR-A integration suite (46 tests) stays green.
  EC-12 absorbed: STRICT — withScope rejects null/undefined ctx at entry.

  Wiring: getScope/withScope re-exported from src/agent-tools/index.ts (caller
  at T5.1 dispatch); integration test deferred to T5.1 (ADR-DEFER-WIRING-B —
  scope module is dispatch-internal; integration emerges via T5.1 happy paths).
  ```
  NO `Co-Authored-By` trailer (project policy per session memory).

## Recommended action

1. **Start RED phase with 7 tests** (5 plan + EC-12 inline + 1 SEPA-recommended `test_withScope_rejects_null_or_undefined_ctx`). Use Vitest `describe('withScope + getScope', () => { it('GWT phrasing', ...) })` per testing.md § BDD format.
2. **Move ScopedContext FIRST, write scope.ts SECOND.** Order matters for the typecheck RED test: `src/core/scope.ts` must export `ScopedContext` before `src/agent-tools/scope.ts` can `import type` from it.
3. **Preserve v0.2 PR-A JSDoc on the moved declaration** verbatim. Add the re-export shim with `@see` form in `src/theokit/types.ts`.
4. **EC-4 HARD GATE before COMMIT, not after.** Run `npm test -- tests/integration/theokit-binding.test.ts` in the GREEN phase verification — if it fails, fix the re-export shape (most likely culprit: missing `.js` extension in re-export, or accidental `export {}` instead of `export type {}`).
5. **Defer pillar (b) integration test** with `<!-- ADR-DEFER-WIRING-B: scope module is dispatch-internal; integration emerges via T5.1 happy paths -->` marker — scope.ts has no direct integration coverage until T5.1 wires dispatch.
6. **EC-12 STRICT decision MUST be in JSDoc** on the `withScope` function — future readers will wonder why `withScope(undefined, ...)` throws instead of just letting `als.run` swallow it.

End of pre-RED consultation. Proceed to RED phase.
