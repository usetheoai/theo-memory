# SEPA — Iteration 5 / Task T4.1 / Phase Pre-RED / Mode TIGHT

Date: 2026-05-31
Agent ID: afcdf8e4958dd953c

## Plan recap

T4.1 ships `src/local/eviction/index.ts` barrel + extends `LocalMemoryConfig.eviction?` + wires capacity/time triggers through `createLocalMemory()` so consumers opt-in via public API (closes F-dom-2 CRITICAL + F-arch-5 + F-wire-2 + F-xval-3 MAJOR per ADR D6; absorbs EC-6 concurrent dual-trigger advisory-lock invariant).

## 3 CRITICAL design decisions (plan does not lock; SEPA recommended defaults)

### 1. createLocalMemory return shape with time-trigger lifecycle

Options:
- (A) Widen `Memory` interface with optional `dispose?(): Promise<void>` — cross-runtime contract change; cloud needs no-op
- (B) Return tuple `{ memory, dispose }` — PUBLIC API BREAKING (second this cycle after T7.1); requires ADR + CHANGELOG `**BREAKING**:`
- (C) Widen ONLY local return type to `Memory & { dispose(): Promise<void> }` — additive, non-breaking, no Memory contract change

**Decision: (C)** — minimal blast radius. The local factory return becomes `Promise<Memory & { dispose(): Promise<void> }>`; cloud factory unchanged.

### 2. Capacity-trigger post-remember hook mechanism

Options:
- (A) Private `postRememberHook?: (scope: Scope) => Promise<void>` field on `LocalMemoryConfig` consumed by `LocalScopedMemory.remember` post-pipeline
- (B) Subclass `LocalMemoryWithEviction extends LocalMemory`

**Decision: (A)** — single class, opt-in via factory, no inheritance branch. Scope is already on `LocalScopedMemory`; hook closes over `trigger.fire(scope, new Date())`.

### 3. Eviction with InMemoryVectorStore behavior

Options:
- Fail-loud at factory time (`EvictionNotSupported` error)
- Silently no-op

**Decision: fail-loud** per architecture.md § 8 "Validate at boundaries". Eviction over in-memory is not implemented (advisory locks are PG-only). Add 1 sentinel test outside plan's 6 RED.

## Other findings absorbed

- **[MAJOR]** EC-6 RED test #6 must use real PgEvictor + Pool (advisory locks are PG-only); assert via raw SQL `COUNT(*) WHERE t_invalid IS NOT NULL` not OTel counter (T10.1 will fix counter lazy-init separately).
- **[MAJOR]** `LocalEvictionConfig` type lives in `src/local/eviction/index.ts` (barrel) per DIP direction.
- **[MAJOR]** RED tests #1+#2 must also verify `LocalEvictionConfig` type export.

## Recommended action

Proceed to RED with the 3 SEPA-recommended defaults + 1 sentinel test (eviction-with-inmemory throws). Document decisions inline in commit body for /review traceability.
