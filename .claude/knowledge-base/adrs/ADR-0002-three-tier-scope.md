# ADR-0002: Three-tier scope (User / Session / Agent) via scoped sub-objects

- **Status:** Accepted
- **Date:** 2026-05-22
- **Plan:** [`memory-contract-v0-0-plan.md`](../plans/memory-contract-v0-0-plan.md) § ADRs § D2
- **Owner:** TheMemory v0.0 contract design

## Context

Memory APIs in this space split into two shape families:

1. **Flat with options bag** — `memory.remember(text, { userId, sessionId, agentId })`. Mem0 uses this. Loses type narrowing; ambiguous when multiple scopes are passed.
2. **Scoped sub-objects** — `memory.user(id).remember(text, options)`. Each scope returns a typed sub-handle where downstream calls inherit the scope at compile time.

TheMemory's locked tier vocabulary (CLAUDE.md § Locked names) is **User / Session / Agent**. The contract needs to expose these three tiers in a way that:

- TypeScript narrows correctly on each scope's call surface
- Internal filter shape maps cleanly onto Mem0's `{ user_id, agent_id, run_id }` so adapters can be ported
- TheoKit binding (v0.2) can resolve the active scope from a request context and inject it via the sub-object

## Decision

Public API exposes three sub-objects on the `Memory` class:

- `memory.user(userId: string): ScopedMemory`
- `memory.session(sessionId: string): ScopedMemory`
- `memory.agent(agentId: string): ScopedMemory`

Each returns a `ScopedMemory` handle exposing `remember / recall / reflect / getAll` (the scoped operations). The internal filter shape is `Filters { user_id?, agent_id?, session_id? }` — identical to Mem0's `{ user_id, agent_id, run_id }` with only `run_id → session_id` renamed (Mem0's `run_id` doesn't carry across our docs; "session" is what BODY copy uses).

`Scope` is a discriminated union:

```ts
export type UserScope = { readonly kind: 'user'; readonly userId: string };
export type SessionScope = { readonly kind: 'session'; readonly sessionId: string; readonly userId?: string };
export type AgentScope = { readonly kind: 'agent'; readonly agentId: string; readonly userId?: string };
export type Scope = UserScope | SessionScope | AgentScope;
```

Session and Agent allow optional `userId` for cross-tier filtering ("recall my session's memories filtered to my user_id").

## Consequences

**Positive:**

- TypeScript narrows: `memory.user('alice').remember('text')` returns `Promise<readonly MemoryItem[]>`; the user_id is part of the type, not just runtime.
- Mental model is clear: each scope has a distinct call surface.
- Trivial internal mapping onto Mem0's filter shape — adapters from `referencia/mem0/mem0-ts/src/oss/src/vector_stores/pgvector.ts` port with minimal change.
- TheoKit's request-context resolver (v0.2) can return one of the three sub-objects directly.

**Negative:**

- A fourth tier would require strategic review (`.claude/rules/architecture.md § 1` is locked at three tiers).
- Cannot collapse to a single namespace ("just remember(text)") without breaking type narrowing.
- Public copy is locked on the trio — `public-copy.md § 2` lists "Three tiers: User / Session / Agent" as an anchor.

**Reversibility:**

- HARD. Public sub-object API is load-bearing for type narrowing across every downstream item (v0.1 → v1.4). Renaming or collapsing breaks every consumer.
- Adding a fourth tier (e.g., Org) is forward-compatible (additive); collapsing tiers is breaking.

## Alternatives

| Alternative | Verdict | Why rejected |
|---|---|---|
| **Flat API with options bag** (`memory.remember(text, { userId, sessionId, agentId })`) | Rejected | Loses type narrowing on the user/session/agent dimensions. Ambiguous semantics when multiple are provided. Worse DX in autocomplete (every call shows all three fields). |
| **Single tier** ("just user_id") | Rejected | TheoKit binding (v0.2) needs session_id resolution from request context. Agent-tools (v0.3) need agent_id for skill isolation. A single tier collapses these use cases. |
| **Mem0's tier names** (`run_id` instead of `session_id`) | Rejected | Public copy uses "Session" (per `public-copy.md § 2`). Internal filter key `session_id` is the intentional rename. |
| **Four tiers** (User / Session / Agent / Org) | Deferred | Not in v0.0 scope. Adding later is additive. No consumer asked for it day-0. |

## References

- `.claude/rules/architecture.md § 1 Three-tier scope` — the canonical tier definition.
- `CLAUDE.md § Locked names` — User / Session / Agent locked as strategic-review-only.
- `referencia/mem0/mem0-ts/src/oss/src/types/index.ts:84-89` — Mem0's `SearchFilters` shape (source of internal filter rename).
- ADR-0001 (Mem0-shape architecture).
