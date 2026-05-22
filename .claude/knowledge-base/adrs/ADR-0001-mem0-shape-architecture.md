# ADR-0001: Mem0-shape architecture (adopt the proven write/search pipeline)

- **Status:** Accepted
- **Date:** 2026-05-22
- **Plan:** [`memory-contract-v0-0-plan.md`](../plans/memory-contract-v0-0-plan.md) § ADRs § D1
- **Owner:** TheMemory v0.0 contract design

## Context

`@usetheo/memory` is a managed three-tier memory layer (User / Session / Agent) shipping in two runtimes (local pgvector + TheoCloud-managed). Before v0.0 contract design starts, the strategic question was: do we invent an architecture, fork Mem0, clone Mem0, or adopt Mem0's surface and diverge only on user-facing ergonomics?

Mem0 (Apache-2.0, available at `referencia/mem0/`) is the production-tested baseline in the memory-layer space. Its write pipeline and retrieval algorithm have been iterated against 30+ vector store / 24+ LLM / 15+ embedding implementations. Inquebrável Rule 9 (Não Reinvente a Roda) drives the question: when a proven shape exists, reinventing it is vanity.

## Decision

Adopt Mem0's architectural shape — **adopt**, **diverge**, and **defer** explicit lists:

**Adopt for v0.1:**

- Six-phase write pipeline: context gather → existing retrieval → single LLM extraction → batch embed → hash dedup → batch persist with fallbacks.
- Nine-step search: preprocess → embed → semantic over-fetch → BM25 → sigmoid normalization → entity boost → combined score → threshold → format.
- Additive scoring: `combined = (semantic + bm25 + entity_boost) / max_possible`, with semantic threshold gating BEFORE combining.
- Hash dedup via MD5 of normalized text (exact match only). Semantic dedup is the LLM's job inside extraction.
- UUID → integer mapping for LLM prompts (anti-hallucination).
- `textLemmatized` precomputed at write time.
- Auto-detected embedding dimension via probe call.
- `infer: false` escape hatch for caller-supplied facts.
- Per-row fallback path at every I/O boundary (batch failure → per-item retry).

**Diverge from Mem0:**

- Public verbs are `remember` / `recall` / `forget` / `reflect` (not `add` / `search` / `delete`). See ADR-0004.
- ADD-only — no public `update()` method. See ADR-0003.
- Three-tier vocabulary (User / Session / Agent) instead of Mem0's `user_id` / `agent_id` / `run_id` field names. Internal filter shape is the same (renaming only `run_id → session_id`). See ADR-0002.

**Defer to v0.4:**

- Generative Agents multiplicative scoring (`recency × importance × relevance`) — moves to v0.4 behind a strategy interface. v0.1 ships additive Mem0-style (production-tested).
- LLM-importance-aware forgetting — also v0.4 (part of Item 6).

## Consequences

**Positive:**

- Clean inheritance of Mem0's hard-won lessons (anti-hallucination integer mapping, sigmoid normalization, BM25-vs-semantic gating, fallback paths).
- Reduces v0.1 implementation risk: every pipeline step has a battle-tested reference in `referencia/mem0/mem0-ts/src/oss/src/memory/index.ts`.
- Honors Rule 9: do not reinvent the wheel.

**Negative:**

- Cannot drift into Letta's function-calling-driven memory (Letta-shape) or Zep's bi-temporal-first (Zep-shape) without contradicting this ADR. Both alternatives are preserved as separable layers:
  - Letta-style agent-tools land at v0.3 as a separate package (`@usetheo/memory/agent-tools`).
  - Zep-style bi-temporal lands at v0.5 (cloud-tier feature) — see ADR-0006.
- Public copy must preserve the "Mem0-shape (inspired, not cloned)" positioning anchor per `public-copy.md § 2`. Marketing cannot call this "a Mem0 wrapper" or "a Mem0 clone".

**Reversibility:**

- Public verb rename (`remember/recall/forget/reflect`) is HARD to undo post-v1.0.
- Architecture choices are reversible per item (e.g., scoring strategy is already pluggable per the strategy interface to be added at v0.4).
- Reverting to "non-Mem0-shape" entirely would be a Phase II overhaul — never in v0.1's window.

## Alternatives

| Alternative | Verdict | Why rejected |
|---|---|---|
| **Letta-shape** (function-calling memory) | Rejected | Conflates primitive with framework — we are infrastructure (vector + extraction + retrieval); Letta is agent loop. Coupling them locks consumers into our framework choice. Agent-tools as a separate v0.3 layer preserves the use case. |
| **Zep / Graphiti-shape** (graph-first) | Rejected | Heavyweight backend (Neo4j). We ship pgvector first; optional graph adapter at v1.3. Graph as the primary store would force a different value prop ("knowledge graph memory") that conflicts with our locked positioning. |
| **From-scratch** | Rejected | Violates Inquebrável Rule 9. Mem0 already paid the iteration cost. Our value-add is the three-tier API, TheoKit binding, and downstream open-problem attacks (long-tail forgetting, Voyager skills, distillation) — not the underlying pipeline plumbing. |

## References

- `.claude/rules/architecture.md § 4 Mem0-shape architecture` — the locked list of "Adopt / Diverge / Defer" items this ADR ratifies.
- `referencia/mem0/mem0-ts/src/oss/src/memory/index.ts` — the canonical TypeScript implementation of the six-phase + nine-step pipelines.
- `CLAUDE.md § Architectural Decisions Locked` — strategic context.
- Roadmap Item 1 acceptance criteria (CLAUDE.md § Macro roadmap).
