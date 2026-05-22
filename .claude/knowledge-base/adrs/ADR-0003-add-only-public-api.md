# ADR-0003: ADD-only public API (no `update()` method)

- **Status:** Accepted
- **Date:** 2026-05-22
- **Plan:** [`memory-contract-v0-0-plan.md`](../plans/memory-contract-v0-0-plan.md) § ADRs § D3
- **Owner:** TheMemory v0.0 contract design
- **Resolves:** CLAUDE.md § Open questions Q2

## Context

Mem0 ships a public `update(memory_id, data)` method that destructively rewrites a memory's text in place. The semantic merge logic (decide whether to merge with neighbors, supersede, or contradict) is opaque inside that call.

Question Q2 asked: should TheMemory's public API include `update()`? Three positions exist:

1. Adopt Mem0's `update()` verbatim — destructive in-place mutation.
2. Provide `update()` as sugar over `forget(id) + remember(newText)` — same outcome, simpler implementation.
3. Hold the line: ADD-only. No public destructive update. Mutation is `forget + remember`.

## Decision

**ADD-only.** The public surface has **NO `update()` method**. Consumers mutate facts via `forget(memoryId) + remember(newText)`. The LLM extraction pipeline absorbs semantic merge inside the next `remember()` write (existing-retrieval phase decides whether the new text contradicts, supersedes, or extends).

`history(memoryId)` exists for audit trails (cheap; no new code path).

The two-stage write pipeline IS ADD-only: an LLM call produces zero-or-more facts; nothing rewrites existing facts in place. Internal helpers may still call `VectorStore.update(...)` to refresh embeddings (e.g., during reflection consolidation), but this is hidden from public consumers per the Memory / ScopedMemory surface.

## Consequences

**Positive:**

- Clean event-log semantics. Every memory event is a new fact; old facts are tombstoned via `tInvalid` (D6). Audit history becomes trivial: walk the timestamps.
- Trivial reasoning about concurrency. No "last write wins" semantics on the same memoryId. Race conditions become non-existent at the API surface (the LLM extraction pipeline serializes semantic merge).
- Public copy is honest: "remembers + forgets" is the locked vocabulary. No "edit" verb leaks.
- Storage growth is predictable: ADD-only writes scale linearly. Reflection (Item 5) handles consolidation later.

**Negative:**

- Consumers who want "patch this fact's text" must use `forget + remember`. Slight ergonomic cost; documented in API reference.
- A `replace(id, text)` sugar verb is NOT shipped at v0.0 — see Alternatives.
- Storage growth must be managed by reflection + forgetting (Items 5+6); a stale memory's `tInvalid` is the soft-delete marker.

**Reversibility:**

- HARD. Reintroducing `update()` post-v1.0 would silently change semantic merge behavior for existing consumers. The LLM extraction logic would have to absorb in-place mutation, complicating the pipeline.
- Adding `replace()` as new sugar at v1.1+ is forward-compatible (additive).

## Alternatives

| Alternative | Verdict | Why rejected |
|---|---|---|
| **Adopt Mem0's `update()` verbatim** | Rejected | Adds destructive update path. Complicates reasoning about audit history. Locks in semantic merge inside the `update()` call, hiding logic from consumers. Conflicts with the locked ADD-only decision in `CLAUDE.md § Architectural Decisions Locked #4`. |
| **`replace(id, text)` as atomic sugar over `forget + remember`** | Rejected for v0.0 | Pollutes API surface. Same outcome achievable with two explicit calls. Reconsider at v1.1+ when ergonomic feedback from real consumers exists. Premature optimization (YAGNI). |
| **`update()` with explicit semantic-merge mode flag** (`{ mode: 'replace' \| 'merge' \| 'append' }`) | Rejected | Pushes complexity into API surface; consumers must understand semantic-merge modes. Worse DX than `forget + remember` which makes intent explicit. |

## References

- `.claude/rules/architecture.md § 2 ADD-only by design` — the canonical project rule.
- `CLAUDE.md § Architectural Decisions Locked #4` — locked.
- `CLAUDE.md § Open questions Q2` (RESOLVED 2026-05-22 → this ADR).
- ADR-0001 (Mem0-shape architecture — explicit divergence noted).
- ADR-0004 (API verbs — `forget` + `remember` are part of the locked verb set).
