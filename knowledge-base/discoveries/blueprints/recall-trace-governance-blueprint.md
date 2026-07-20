---
version: 1.0
slug: recall-trace-governance
milestone_id: M4
created_at: 2026-07-20
source_plan: knowledge-base/discoveries/plans/recall-trace-governance-plan.md
---

# Blueprint: recall-trace governance (M4)

Locks the design for M4's theo-memory-gating pieces: **per-tenant retention sweep** for `recall_traces` + the **MCP `explain_recall` tool**. Every design claim cites an in-repo `file:line` it reuses (Rule 9 — don't reinvent). The dashboard piece is cross-repo (theo-cloud) and out of this blueprint.

## Summary of the answered research questions

| Q | Finding (citation) |
|---|---|
| Q1 | Scope-scoped + TTL DELETE patterns exist verbatim: `INVALIDATE_SCOPE_SQL = DELETE FROM recall_cache WHERE scope_key = $1` and `CLEAR_EXPIRED_SQL = DELETE FROM recall_cache WHERE expires_at IS NOT NULL AND expires_at <= NOW()` (`pgvector-recall-cache-store.ts:102,105`). SERIALIZABLE + `40001` single-retry wrapper is the race mechanism (`serializable-tx.ts`, cited in the same store's header). |
| Q2 | Periodic housekeeping already has a home: `TimeBasedTrigger` (exported at `packages/core/src/index.ts:151`) + `clearExpired(): Promise<number>` DIP method (`dip/recall-cache-store.ts:161`). Cron parsing via `croner` (`domain/errors.ts:224`). |
| Q3 | Destructive ops precedent = `Memory.forget(id, { hard })` (GDPR escape hatch, v0.4b) — workspace/scope-predicated hard-delete. Retention's per-workspace opt-out mirrors this "off/erase" model. |
| Q4 | MCP tool contract = 3 files + 1 registration: a `{TOOL_NAME, DESCRIPTION, INPUT_SCHEMA}` schema (zod) + a handler + a `name → handler` Map entry in `dispatch.ts` (`packages/mcp/src/tools/dispatch.ts:17-29`, `forget-schema.ts:12-34`, `forget-handler.ts`). |
| Q5 | Race-aware test template = the recall-cache SERIALIZABLE concurrency test (mock `set()` opens SERIALIZABLE at `pgvector-recall-cache-store.test.ts:133`; the EC-7 `Promise.all` concurrent-writers race is the integration-level template M4's sweep test copies). |
| Q6 | **No new dependency** — `croner` (^10.0.1) is already in root `package.json`; the sweep reuses `TimeBasedTrigger` + `croner`. Ops invocation mirrors the eviction `TimeBasedTrigger` cron path. |
| Q7 | `REDACTED` / `REDACTED` persist NO per-candidate drop reason and NO retention policy for such a log (grep found only "data retention" inside LLM eval-fixture TEXT, never code). Confirms the differentiator + that there is nothing to borrow externally. |

## ADRs

### ADR-1 — Retention = a `RecallTraceRetentionPolicy` DIP + a workspace-scoped age-based sweep reusing the recall-cache pattern
- **Decision:** add a 14th-DIP-sibling `RecallTraceRetentionPolicy` (or extend the store) with a `sweep(workspaceId, olderThan)` that runs `DELETE FROM recall_traces WHERE workspace_id = $1 AND created_at <= $2`, wrapped in the SERIALIZABLE-retry helper. Per-workspace config holds `retentionMaxAgeSeconds` + `enabled` (opt-out).
- **Rationale:** mirrors `INVALIDATE_SCOPE_SQL` (workspace predicate) + `CLEAR_EXPIRED_SQL` (age predicate) + the SERIALIZABLE `40001` retry — a proven, race-safe in-repo mechanism (Q1, Q5; Rule 9).
- **Alternatives:** a global (non-workspace) sweep — REJECTED (cross-tenant deletion risk / CWE-441 write-side); an advisory-lock sweep — REJECTED (recall-cache proves SERIALIZABLE suffices).
- **Consequences:** the sweep is workspace-scoped by construction; a bug cannot delete another tenant's rows because the predicate binds `$1 = workspaceId`.

### ADR-2 — Fail-closed opt-out is enforced at the WRITE, not the sweep
- **Decision:** "opt-out" for a workspace = tracing is OFF for it (the write path in `recallTraceDeps` / factory skips it), so no rows accrue. Default = OFF globally (already true — `THEOMEM_RECALL_TRACE`). Retention bounds the ON case.
- **Rationale:** bounding growth at the source (no write) is stronger than sweeping after the fact; matches the S1/S2 default-OFF posture + the forget "off/erase" model (Q3).
- **Alternatives:** opt-out = keep writing but never sweep — REJECTED (unbounded growth, the exact bottleneck).
- **Consequences:** per-workspace opt-out needs the write path to consult a per-workspace enable flag (a small extension of the factory/context gate).

### ADR-3 — `explain_recall` MCP tool mirrors the 3-file pattern + reuses the S2 workspace-scoped read
- **Decision:** add `explain-recall-schema.ts` (`{ recallId: z.string() }`) + `explain-recall-handler.ts` (calls `getByRecallId(recallId, workspaceId)` — the S2 read, workspace from the MCP scope binding) + register in `dispatch.ts`.
- **Rationale:** exact reuse of the `forget` tool triad (Q4) + the S2 workspace-scoped `getByRecallId` (tenant isolation already proven in the S2 review — airtight).
- **Alternatives:** a new MCP transport/shape — REJECTED (Rule 9; the triad is the convention).
- **Consequences:** the MCP tool inherits S2's CWE-441 safety (workspace from the resolved scope, never the args).

## Coverage Corner 1 — Integration Tests
The retention sweep's race-safety test copies the recall-cache EC-7 concurrent template: `Promise.all` of N concurrent recall-trace writes for workspace A WHILE a sweep runs → assert (a) no workspace-B rows ever deleted, (b) final count deterministic (no lost-update/orphan), (c) `40001` retried once. Template: `pgvector-recall-cache-store.test.ts:133` (SERIALIZABLE) + the sibling integration EC-7 test. THE GOAL TEST (M4): a workspace with `retentionMaxAgeSeconds=X` has rows older than X swept; an opted-out workspace writes 0 rows; a concurrent cross-workspace write is untouched.

## Coverage Corner 2 — Dependencies
**No new dependency.** `croner ^10.0.1` (root `package.json`) drives the periodic sweep via the existing `TimeBasedTrigger` (`core/index.ts:151`). `pg` (installed) runs the parameterized DELETE. The MCP tool adds no dep (reuses `@modelcontextprotocol/sdk` already in `packages/mcp`).

## Coverage Corner 3 — Tools
Sweep invocation reuses the eviction ops path: a `TimeBasedTrigger` cron (croner expression) calls the retention `sweep()` on a schedule, wired at the composition root (`packages/cli/src/run-server.ts` / the factory), gated by the same `THEOMEM_RECALL_TRACE` posture. Test command: `npm test -- recall-trace-retention` (unit) + `npm run test:integration -- recall-trace` (real pgvector). MCP: `themory mcp` registers `explain_recall`; round-trip via `@modelcontextprotocol/sdk` client.

## Coverage Corner 4 — Techniques
1. **Workspace-scoped age-based DELETE** (`DELETE ... WHERE workspace_id = $1 AND created_at <= $2`) — the composition of `INVALIDATE_SCOPE_SQL` (workspace predicate) + `CLEAR_EXPIRED_SQL` (age predicate).
2. **SERIALIZABLE + single `40001` retry** — the recall-cache race mechanism (`serializable-tx.ts`), reused so concurrent writes + sweep don't lost-update/orphan.
3. **Per-workspace enable flag at the write gate** — extends `recallTraceDeps` (S1) to consult a per-workspace opt-out, making "governed per-tenant" honest (ADR-2).
4. **MCP triad** — schema + handler + dispatch registration (Q4), reusing the S2 `getByRecallId(recallId, workspaceId)` read.

## Bottleneck & benchmark hooks (Staff-level)
- **Bottleneck:** the sweep DELETE under concurrency. Benchmark M4 must produce: (a) sweep throughput (rows/sec deleted, workspace-scoped, no cross-tenant touch — measured on a seeded N-row table); (b) the trace-write overhead on recall (p50/p95 recall latency with tracing ON vs OFF — must be within a stated bound). Both against real `ankane/pgvector:v0.5.1`, ≥3 runs, mean±stddev.
