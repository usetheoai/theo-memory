---
name: implement-explainable-recall-sepa-knowledge
description: Paired knowledge skill for the explainable-recall SEPA. Provides the load-bearing invariants + context file pointers the SEPA re-checks each iteration, and (when needed) a WebSearch refresh contract for TS/pg/pgvector idioms. Read-only companion to .claude/agents/implement-explainable-recall-2026-07-20/sepa.md.
---

# SEPA Knowledge — explainable-recall

Companion to the SEPA agent (`.claude/agents/implement-explainable-recall-2026-07-20/sepa.md`). The SEPA loads this for a fast recap of the plan's invariants without re-reading the whole plan every call.

## The 10 load-bearing invariants (guard every iteration)

1. `recall()` + `runRetrievalPipeline` keep returning `readonly MemoryItemWithScore[]` (D1 — bare-array contract; 3 callers depend on it).
2. Trace write is fail-soft (D3 — throw → `recall_trace_write_failed`, return kept results).
3. DIP boundary: pipeline (domain) never imports the pg impl; factory wires the concrete store.
4. `maxRowsPerRecall` ≤ 5000 (EC-1, Postgres bind-param limit).
5. Tenant keys via `recallTraceContext { recallId, workspaceId, scopeKey }` (EC-2).
6. Factory resolver probes the table → fail-fast (EC-3), not silent-no-trace.
7. Truncation emits `recall_trace_truncated` (EC-4); write gate needs BOTH port + context (EC-5).
8. New events added to the typed `MEMORY_EVENTS` union (Princípio 3).
9. No new deps; raw parameterized SQL in the pg impl; no paper names in `src/**`.
10. `entity` component uniformly 0 in v0.1 — persist schema-forward, don't fabricate signal.

## Context pointers

- Plan: `.claude/knowledge-base/plans/explainable-recall-plan.md`
- Edge cases: `.claude/knowledge-base/reviews/explainable-recall-edge-cases-2026-07-20.md`
- Blueprint: `.claude/knowledge-base/discoveries/blueprints/accountable-forgetting-blueprint.md`
- Rules: `.claude/rules/{architecture,testing,error-handling,parsimony-ladder}.md`
- Templates to mirror in code: `packages/core/src/domain/dip/recall-cache-store.ts` (DIP shape), `packages/core/src/infrastructure/db/pg-usage-counter-store.ts` (raw-SQL pg impl), `packages/core/src/infrastructure/db/factory.ts:67-105` (opt-in resolver).

## WebSearch refresh (only when a code idiom is genuinely uncertain)

The SEPA MAY request the main session run a WebSearch for an authoritative TS/pg/pgvector idiom (e.g., multi-row parameterized INSERT param limits, `crypto.randomUUID` availability). Keep it rare — most answers are in the reference stores above. Never fabricate an API; flag uncertainty instead.
