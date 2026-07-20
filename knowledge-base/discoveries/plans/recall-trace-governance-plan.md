---
version: 1.0
slug: recall-trace-governance
owner: engineering
created_at: 2026-07-20
milestone_id: M4
---

# Discovery Plan: recall-trace governance (M4)

## Context

M4 (roadmap) makes the shipped accountable-forgetting surface (S1 recall-trace write + S2 read REST, v0.35.0) **governed**: per-tenant retention/opt-out for the `recall_traces` table + an MCP `explain_recall` tool. Before locking the design, we investigate the prior art for a **workspace-scoped, race-safe TTL sweep** and the **MCP tool shape**. The bottleneck this discovery de-risks: the retention sweep is a `DELETE FROM recall_traces` that runs concurrently with recall writes — it must be workspace-scoped (never cross-tenant), race-safe (no orphan/lost-update), and fail-closed (default OFF, bounded growth).

**Honest framing (Staff-level):** the external cloned references (`REDACTED`, `REDACTED`) do NOT have an accountable-forgetting trace table at all — the `accountable-forgetting-blueprint` (SHIPPABLE, this project) proved they DISCARD the drop reason entirely (that absence IS our differentiator). So the load-bearing prior art for M4 is **in-repo**, not in the references. See ADR D1.

## Objective

Produce a blueprint that locks: (a) the retention-sweep design (SQL shape + workspace predicate + race-safety mechanism) reusing the recall-cache pattern, (b) the opt-out/config model, (c) the MCP `explain_recall` tool contract — measured by a blueprint whose every design claim cites a real in-repo `file:line` (recall-cache / forget / mcp-tools) or a stable external governance source.

## In-scope / Out-of-scope

**Primary sources (in-repo — the real prior art):**
- `packages/core/src/infrastructure/db/recall-cache/` — the TTL sweep (`CLEAR_EXPIRED_SQL`), scope-scoped DELETE (`INVALIDATE_SCOPE_SQL`), SERIALIZABLE race retry.
- `packages/core/src/infrastructure/db/recall-trace/` — the S1/S2 store the retention extends.
- forget hard-delete path (GDPR escape hatch precedent).
- `packages/mcp/src/tools/` — the MCP handler+schema+dispatch pattern.

**Reference projects (negative-confirmation only, per ADR D1):**
- `.claude/knowledge-base/references/REDACTED/` — in scope: confirm no trace-retention analog. Out of scope: its graph/temporal core (irrelevant — different problem).
- `.claude/knowledge-base/references/REDACTED/` — in scope: confirm no drop-reason persistence. Out of scope: its vector/LLM pipeline.

## ADRs

### D1 — External references are negative-confirmation only; in-repo is the primary prior art
- **Decision:** M4's discovery treats the in-repo recall-cache/forget/mcp code as the primary source, and `REDACTED`/`REDACTED` as a single negative-confirmation corner (do they persist drop reasons? proven no).
- **Rationale:** the `accountable-forgetting-blueprint` already established that the field discards the negative-space — re-researching the refs for a pattern they provably lack is theater (Rule 3 honesty + Rule 10 KISS + the goal's "sem re-trabalho"). The reusable retention/MCP patterns exist in this repo.
- **Alternatives considered:** full 4-corner external-reference research — REJECTED: the refs have no trace table, so every corner answer is "no", producing a thin blueprint that re-proves the blueprint's finding.
- **Consequences:** the four-corner budget is weighted toward in-repo techniques + tests; one corner (a single negative-confirmation question) covers the external refs.

### D2 — Retention sweep reuses the recall-cache SERIALIZABLE pattern, not a new mechanism
- **Decision:** investigate adapting `CLEAR_EXPIRED_SQL` + `INVALIDATE_SCOPE_SQL` + the SERIALIZABLE-retry wrapper for `recall_traces`, rather than a novel sweep.
- **Rationale:** the recall-cache already solved race-safe capacity/TTL DELETE under concurrency (EC-7, `40001` retry) — Rule 9 (don't reinvent).
- **Alternatives:** a fresh cron/advisory-lock sweep — deferred unless the discovery shows the recall-cache pattern doesn't fit.
- **Consequences:** the blueprint's retention design is anchored to a proven in-repo mechanism.

## Research questions

| # | Corner | Question | Method | Expected answer shape |
|---|---|---|---|---|
| Q1 | Techniques | How does recall-cache implement the TTL/capacity DELETE **race-safely** (SERIALIZABLE, `40001` retry), and how does `INVALIDATE_SCOPE_SQL` scope a DELETE to one key? | `Read packages/core/src/infrastructure/db/recall-cache/pgvector-recall-cache-store.ts` (CLEAR_EXPIRED_SQL:105, INVALIDATE_SCOPE_SQL:102, SERIALIZABLE wrapper) + `serializable-tx.ts` | SQL + tx-wrapper shape reusable for a workspace-scoped `recall_traces` retention DELETE |
| Q2 | Techniques | How is the recall-cache sweep TRIGGERED in production (time-based / capacity-based / manual)? What owns the schedule? | `Grep -r "clearExpired\|TimeBasedTrigger\|CapacityBasedTrigger" packages/core/src` | The trigger/ownership model M4 retention should mirror (or an honest gap) |
| Q3 | Techniques | How does the forget hard-delete path enforce workspace/scope safety + the GDPR escape? | `Read` the forget hard-delete (core `Memory.forget(id, { hard })`) + its scope predicate | Precedent for workspace-scoped destructive ops + the opt-out/erasure model |
| Q4 | Techniques | What is the MCP tool contract shape (schema + handler + dispatch registration) so `explain_recall` mirrors it + reuses the S2 `getByRecallId(recallId, workspaceId)` read? | `Read packages/mcp/src/tools/dispatch.ts` + `forget-handler.ts` + `forget-schema.ts` | The exact 3-file pattern `explain_recall` follows |
| Q5 | Integration tests | How does recall-cache TEST the concurrent sweep / race (EC-7 SERIALIZABLE, `Promise.all` writers)? | `Read packages/core/src/infrastructure/db/recall-cache/pgvector-recall-cache-store.test.ts` (EC-7 concurrent test) | The race-aware test template M4's retention sweep test must follow |
| Q6 | Dependencies + Tools | Does the sweep need a NEW dependency (scheduler/cron) or reuse an installed one? How is a periodic sweep run in the Docker/CLI runtime today? | `Grep` for cron/scheduler deps in `package.json` + `packages/cli/src` triggers | Dep decision (reuse vs add) + the ops invocation story |
| Q7 | Negative-confirmation (refs) | Do `REDACTED` / `REDACTED` persist any per-candidate drop reason OR a retention policy for such a log? | `Grep -ri "drop\|retention\|ttl\|expire" .claude/knowledge-base/references/{REDACTED,REDACTED}/` (sampled) | Confirm absence (grounds the differentiator + confirms no borrowable pattern) |

## Coverage Matrix

| Corner | Questions | Covered? |
|---|---|---|
| Techniques | Q1, Q2, Q3, Q4 | ✅ (4 — the load-bearing corner per D1) |
| Integration tests | Q5 | ✅ |
| Dependencies | Q6 (deps half) | ✅ |
| Tools | Q6 (tools half) | ✅ |
| (External refs) | Q7 negative-confirmation | ✅ (per D1) |

Every question maps to a method; every in-repo path pre-verified to exist. **Coverage: 4/4 corners (100%).**

## Halt-loop checkpoints (for /discover-execute)

- A question is DONE when its method ran (file read / grep executed) AND the answer is recorded with a `file:line` citation.
- The blueprint is complete when all 7 questions are answered, all 4 coverage corners populated, and the retention-sweep + MCP-tool designs each cite the in-repo pattern they reuse.

## Acceptance Criteria

- [ ] All 7 questions answered with real citations (in-repo `file:line` or a stable governance URL).
- [ ] Retention sweep design cites the recall-cache `CLEAR_EXPIRED_SQL` / SERIALIZABLE pattern (D2).
- [ ] MCP `explain_recall` design cites the `dispatch.ts` + handler + schema pattern.
- [ ] Race-safety + workspace-scoping + fail-closed opt-out explicitly addressed (the bottleneck).
- [ ] Negative-confirmation (Q7) recorded — refs lack the pattern.

## Global Definition of Done

Blueprint scores ≥ SHIPPABLE_WITH_CAVEATS at `/discover-confidence` per `rules/discover-blueprint-golden-rule.md`; all 4 coverage corners non-empty; no fabricated `knowledge-base/references/` citation.
