/**
 * AsyncLocalStorage scope binding for the v0.3 MCP server.
 *
 * Per ADR D3: per-request scope is set at JSON-RPC handler boundary via `withScope`;
 * tool dispatch handlers call `getScope()` to retrieve the active ScopedContext.
 * `AsyncLocalStorage.run()` auto-resets via lexical scope (no manual try/finally
 * needed, unlike Python's `contextvars.ContextVar`).
 *
 * EC-12 absorbed (STRICT invariant): `withScope` rejects null/undefined ctx at
 * entry. Nested `withScope(outer, () => withScope(undefined, ...))` throws
 * MissingScopeError immediately rather than silently passing. Lifts "scope
 * always defined inside withScope" to a structural invariant.
 *
 * @see ADR D3 — Cross-tool isolation via Node.js AsyncLocalStorage
 * @see ADR D4 — SDK integration: this scope is consumed at T5.1 dispatch via memoryFromCtx
 * @see EC-12 (plan v1.1) — nested withScope undefined inner locked STRICT
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import { MissingScopeError } from '@usetheo/memory/contract';
import type { ScopedContext } from '@usetheo/memory/contract';

const SCOPE_STORE = new AsyncLocalStorage<ScopedContext>();

/**
 * Runs `fn` with `ctx` bound to AsyncLocalStorage. `getScope()` inside `fn`
 * (and any awaited downstream) returns `ctx`. Reset is automatic at lexical exit.
 *
 * @throws MissingScopeError when `ctx` is null/undefined (EC-12 STRICT invariant)
 */
export function withScope<T>(ctx: ScopedContext, fn: () => T): T {
  if (ctx === null || ctx === undefined) {
    throw new MissingScopeError(
      'withScope: ctx must be defined. Caller must pass a ScopedContext (EC-12 STRICT invariant per ADR D3).',
    );
  }
  return SCOPE_STORE.run(ctx, fn);
}

/**
 * Retrieves the active ScopedContext set by an enclosing `withScope` call.
 *
 * @throws MissingScopeError when called outside any `withScope` (no ambient store).
 */
export function getScope(): ScopedContext {
  const ctx = SCOPE_STORE.getStore();
  if (ctx === undefined) {
    throw new MissingScopeError(
      'getScope: no active scope. The caller must invoke this inside a withScope(ctx, fn) block (ADR D3).',
    );
  }
  return ctx;
}
