# ADR-0007: Entity store opt-out via constructor flag `entityBoost: boolean`

- **Status:** Accepted
- **Date:** 2026-05-22
- **Plan:** [`memory-contract-v0-0-plan.md`](../plans/memory-contract-v0-0-plan.md) § ADRs § D7
- **Owner:** TheMemory v0.0 contract design
- **Resolves:** CLAUDE.md § Open questions Q5

## Context

Mem0's nine-step search uses a SECOND vector store dedicated to entities (named-entity vectors extracted at write time). The entity store enables the entity-boost component of the additive scoring formula (`combined = (semantic + bm25 + entity_boost) / max_possible`).

This doubles storage cost — every fact requires its semantic embedding PLUS its entity vectors. For cost-sensitive consumers (small-team agents, hobby projects, dev environments), this overhead is meaningful.

Question Q5 asked: should there be an opt-out? And if yes, at what granularity?

- (a) Always on (no opt-out) — preserves Mem0 parity by default
- (b) Per-`remember` flag (`{ extractEntities: false }`) — write-time decision
- (c) Per-`recall` flag (`{ entityBoost: false }`) — query-time decision
- (d) Per-scope / per-Memory-instance constructor flag — one-time decision

## Decision

**Path (d)**: The `MemoryConfig` constructor accepts an optional `entityBoost?: boolean` flag, default `true`.

When `entityBoost: false`:
- The second vector store (entity store) is NEVER instantiated.
- The retrieval-side scoring formula sets entity_boost = 0 (omits the entity component).
- Storage cost is approximately halved for the affected `Memory` instance.

When `entityBoost: true` (default):
- Mem0-parity behavior: entity vectors are extracted at write time and stored in the dedicated store.
- Recall uses the full additive formula.

```ts
export interface MemoryConfig {
  // ... other fields
  /** Default `true`. When `false`, no entity vector store is instantiated. */
  readonly entityBoost?: boolean;
  // ...
}
```

## Consequences

**Positive:**

- Cost-sensitive consumers can halve their pgvector footprint by setting `entityBoost: false`.
- Default `true` preserves Mem0 parity — no surprise for emigrants.
- Constructor-level granularity is the right shape: write-time and recall-time are coupled (you can't recall entity-boost benefits without write-time extraction), so a per-operation flag would be wasteful (per `Write`) or incoherent (per `Recall`).

**Negative:**

- Flipping `entityBoost` mid-life (from `false` to `true` on an existing scope) requires a backfill — recall quality drops until the entity store is populated for all existing memories. Documented as a one-time decision per `Memory` instance.
- Flipping from `true` to `false` is wasteful (you've paid the write-time entity extraction cost but stop benefiting at recall).
- The flag's behavior is invisible in the API surface beyond the type — consumers must read the JSDoc to understand the cost/recall-quality tradeoff.

**Reversibility:**

- Yes, with a backfill (manual operation, not handled by the runtime).
- The flag itself can be removed in a major version bump, defaulting to `true` permanently.

## Alternatives

| Alternative | Verdict | Why rejected |
|---|---|---|
| **Always on, no opt-out** (path a) | Rejected | Storage-cost objection from cost-sensitive consumers is real. Locking them into Mem0's defaults excludes a legitimate use case. |
| **Per-`remember` flag** (`{ extractEntities: false }`) (path b) | Rejected | Write-time decision invalidates recall-time benefit asymmetrically. Caller must remember to disable on EVERY write — error-prone. |
| **Per-`recall` flag** (`{ entityBoost: false }`) (path c) | Rejected | Entity vectors are already written; ignoring them at recall is computation waste. Doesn't reduce storage cost — the storage is already committed. |
| **Environment variable** (`THEMEMORY_ENTITY_BOOST=false`) | Rejected | Hidden global state. Hostile to multi-tenant deployments where different `Memory` instances need different behavior. Constructor flag is explicit and per-instance. |

## References

- `CLAUDE.md § Open questions Q5` (RESOLVED 2026-05-22 → this ADR).
- ADR-0001 § "Adopt" list — entity store is in the locked set.
- ADR-0008 (DIP method counts) — `VectorStore` shape supports the entity store as a second instance of the same interface.
- T2.5 `MemoryConfig` shape — declares `entityBoost?: boolean`.
- `.claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/memory/index.ts:151` — Mem0's `_entityStore?: VectorStore` field, used optionally for entity vectors.
