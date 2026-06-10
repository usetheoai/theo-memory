/**
 * Re-export of `ScopedContext` from core (moved at v0.3 T3.1 per ADR D3).
 *
 * The full JSDoc + structural shape live at `src/core/scope.ts` — single source
 * of truth consumed by BOTH `memoryFromCtx` (v0.2 PR-A) AND the agent-tools
 * AsyncLocalStorage scope binding (v0.3 T3.1).
 *
 * @see {@link import('../core/scope.js').ScopedContext} — canonical definition + ADR D1/D4/D6 (v0.2) + D3 (v0.3)
 * @see ADR D1 (v0.2) — structural typing over peer-dep on `theokit`
 * @see ADR D4 (v0.2) — 3-state resolver
 * @see ADR D6 (v0.2) — `@usetheo/memory/theokit` subpath isolation
 */
export type { ScopedContext } from '../../domain/scope.js';
