/**
 * Public barrel for `@usetheo/memory/theokit` subpath — T1.1 of plan v0-2-theokit-binding.
 *
 * Auto-scopes memory from TheoKit request context via structural typing.
 * Zero peer-dependency on the `theokit` package (per ADR D1); zero
 * `AsyncLocalStorage` (per ADR D2 — verified by /discover-execute Q6
 * exhaustive negative search across ../theokit/).
 *
 * @see ADR D1 — structural typing
 * @see ADR D2 — arg-passed binding (no async-local container)
 * @see ADR D4 — 3-state resolver with fail-loud errors
 * @see ADR D6 — subpath ships independent of main barrel
 */

import { MissingScopeError } from '../../domain/errors.js';
import type { Memory, ScopedMemory } from '../../domain/memory-store.js';

import type { ScopedContext } from './types.js';

export type { ScopedContext } from './types.js';
export { MissingScopeError } from '../../domain/errors.js';

const STATE_B_MESSAGE =
  'authenticated session required — call requireAuth(ctx.session) first';
const STATE_C_MESSAGE =
  'binding requires session-bearing TheoKit context — wire createSessionManager first';

/**
 * Resolve a `ScopedMemory` rooted at `ctx.session.userId` from a TheoKit-shaped
 * request context. Throws `MissingScopeError` when the scope cannot be derived.
 *
 * Three resolver states per ADR D4:
 * - (a) `ctx.session.userId` is a non-empty string → return `memory.user(userId)`
 * - (b) `ctx.session === null` → throw `MissingScopeError("authenticated session required…")`
 * - (c) `ctx.session` field absent OR `userId` undefined/non-string/empty/whitespace
 *       → throw `MissingScopeError("binding requires session-bearing TheoKit context…")`
 *
 * **EC-11 — future-tier deferral:** v0.2 only resolves the `userId` tier.
 * Use `memory.session(id)` / `memory.agent(id)` directly for other tiers.
 * Multi-tier auto-resolution may land in v0.3+.
 *
 * **EC-12 — runtime no-check on `memory`:** this binding does NOT runtime-validate
 * the `memory` parameter — TypeScript's `Memory` type guard is the contract.
 * If you escape the type system, you own the resulting NPE.
 *
 * @see EC-3 — runtime type-guard for `userId` (defends against `any`-escape).
 * @see EC-6 — whitespace-only `userId` treated as state (c) via `.trim().length === 0`.
 * @see EC-7 — consumer's `ctx` MUST NOT be mutated during resolution.
 * @see EC-8 — `sessionId` / `agentId` fields are IGNORED by v0.2 resolver (use `memory.session(id)` / `memory.agent(id)` directly).
 *
 * @param ctx - TheoKit handler `ctx` (any consumer shape that structurally extends `ScopedContext`).
 * @param memory - app-scoped `Memory` singleton (typically a module-level constant).
 * @returns `ScopedMemory` rooted at `ctx.session.userId`.
 * @throws {MissingScopeError} when state (b) or (c) is detected.
 */
export function memoryFromCtx<T extends ScopedContext>(ctx: T, memory: Memory): ScopedMemory {
  if (!('session' in ctx)) {
    throw new MissingScopeError(STATE_C_MESSAGE);
  }
  const session = ctx.session;
  if (session === null) {
    throw new MissingScopeError(STATE_B_MESSAGE);
  }
  if (session === undefined) {
    throw new MissingScopeError(STATE_C_MESSAGE);
  }
  const userId = session.userId;
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    throw new MissingScopeError(STATE_C_MESSAGE);
  }
  return memory.user(userId);
}
