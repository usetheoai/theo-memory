---
slug: recall-trace-retention-and-mcp
milestone_id: M4
created_at: 2026-07-20
goal: Govern accountable-forgetting — per-tenant retention sweep for recall_traces + MCP explain_recall.
---

# Plan: recall-trace retention + MCP explain_recall (M4)

> **Version 1.0** — S1 (recall-trace write) + S2 (read REST) shipped the accountable-forgetting surface in v0.35.0, but it is ungoverned: the `recall_traces` table grows unbounded when tracing is ON, and only a REST client can read a trace. M4 makes it governed + agent-reachable: a per-tenant retention sweep (bounded growth, the load-bearing bottleneck fix) with a fail-closed per-workspace opt-out, and an MCP `explain_recall` tool. Reuses the recall-cache SERIALIZABLE-retry sweep pattern + the MCP tool triad (Rule 9). The theo-cloud dashboard is OUT of scope (cross-repo; does not gate the M4 checkbox).

## Goal

> "Enable operators to bound and govern the recall_traces audit log by adding a per-tenant retention sweep + fail-closed per-workspace opt-out + an MCP explain_recall tool, measured by an integration test against real ankane/pgvector:v0.5.1 where rows older than the retention window are swept while a concurrent cross-workspace write is untouched, an opted-out workspace writes 0 rows, and MCP explain_recall round-trips recall_id → drops — plus a benchmark reporting sweep throughput and the recall-latency overhead of tracing ON vs OFF."

## Context

M4 (roadmap) closes the governance gap the honest competitive assessment identified as what turns the accountable-forgetting wedge into a moat. The discovery blueprint (`recall-trace-governance-blueprint`, SHIPPABLE_WITH_CAVEATS) locked the design: reuse the recall-cache `CLEAR_EXPIRED_SQL`/`INVALIDATE_SCOPE_SQL` + `withSerializableTransactionAndRetry` sweep mechanism, drive it with the installed `croner` + `TimeBasedTrigger`, and mirror the `forget` MCP tool triad for `explain_recall`. The load-bearing risk (grill Q4 + blueprint bottleneck): the sweep `DELETE` runs concurrently with recall writes and must be race-safe + must not orphan/lost-update; and the per-workspace opt-out must NOT add a per-recall DB read (a latency bottleneck).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/core/src/domain/dip/recall-trace-store.ts` | 169 | `1426703` (2026-07-20) | 14th DIP contract (`record` / `getByRecallId`) | ADR-0008 method-count cap; existing 2 methods unchanged |
| `packages/core/src/infrastructure/db/recall-trace/pg-recall-trace-store.ts` | 117 | `1426703` (2026-07-20) | S1/S2 pg impl | `record`/`getByRecallId` unchanged; SQL parameterized |
| `packages/core/src/infrastructure/db/recall-cache/serializable-tx.ts` | 51 | `23e97f8` (2026-07-16) | `withSerializableTransactionAndRetry<T>` — race helper | reuse as-is; do not modify |
| `packages/core/src/infrastructure/db/scoped-memory.ts` | 598 | `2daf36a` (2026-07-20) | `recallTraceDeps` write gate (S2 T1.1) | **D1 bare-array unchanged**; already >500 LoC (pre-existing) — add ≤ 8 lines |
| `packages/core/src/infrastructure/db/config.ts` | 209 | `9b8e86a` (2026-07-20) | `LocalMemoryConfig` incl. `recallTrace?` | existing fields unchanged; add optional field |
| `packages/core/src/infrastructure/db/factory.ts` | 376 | `9b8e86a` (2026-07-20) | `resolveRecallTraceStore` + wiring | existing wiring unchanged; add retention resolve |
| `packages/core/src/infrastructure/db/recall-trace/pg-recall-trace-retention.ts` (NEW) | 0 | — | the retention sweep impl | — |
| `packages/mcp/src/tools/explain-recall-schema.ts` (NEW) | 0 | — | MCP tool schema | — |
| `packages/mcp/src/tools/explain-recall-handler.ts` (NEW) | 0 | — | MCP tool handler | — |
| `packages/mcp/src/tools/dispatch.ts` | 69 | `2966b6b` (2026-06-23) | MCP `name → handler` Map | existing tools unchanged; additive registration |
| `benchmarks/recall-trace-retention.bench.ts` (NEW) | 0 | — | the M4 benchmark | — |
| test files (NEW/edited) | — | — | unit + integration | — |
| `CHANGELOG.md` | — | — | public contract | `[Unreleased]` updated |

### Current callers / dependents

- **Symbol:** `recallTraceDeps(options)` in `scoped-memory.ts` (private, self-only) — the per-workspace opt-out gate extends it. No external caller.
- **Symbol:** `getByRecallId(recallId, workspaceId)` (`recall-trace-store.ts`) — production callers: `packages/api/.../recall-traces.ts` (S2). The MCP `explain_recall` becomes a second caller. Signature UNCHANGED.
- **Symbol:** `withSerializableTransactionAndRetry` (`serializable-tx.ts`) — callers: `pgvector-recall-cache-store.ts`. The retention sweep becomes a second caller. Reused as-is.
- **Symbol:** MCP dispatch Map (`dispatch.ts:29`) — the `explain_recall` entry is additive.
- **External:** none of these are cross-repo published beyond the pre-release npm surface.

### Domain glossary
- **retention sweep** — a periodic internal job that DELETEs `recall_traces` rows older than the retention window (bounds table growth).
- **per-workspace opt-out** — a workspace for which tracing is disabled even when the deployment enabled it → writes 0 trace rows (fail-closed).
- **SERIALIZABLE-retry** — the recall-cache race helper: run in a SERIALIZABLE tx, retry once on PG `40001`.
- **TimeBasedTrigger** — the in-repo cron trigger (croner-backed) that schedules periodic jobs.

### Architecture boundaries affected
- Domain (`recall-trace-store.ts`) defines the retention port; infra (`pg-recall-trace-retention.ts`) implements it (DIP, `architecture.md § 2`). The sweep DELETE reuses the recall-cache infra pattern. The MCP tool (interface layer) depends inward on the S2 read. No new outward dependency (croner already installed — Rule 9).

## Prior Art & Related Work
- **Internal blueprint:** `knowledge-base/discoveries/blueprints/recall-trace-governance-blueprint.md` (M4 design; ADR-1 sweep, ADR-2 opt-out-at-write, ADR-3 MCP triad).
- **In-repo prior art:** recall-cache `CLEAR_EXPIRED_SQL`/`INVALIDATE_SCOPE_SQL` (`pgvector-recall-cache-store.ts:102,105`) + `withSerializableTransactionAndRetry` (`serializable-tx.ts:27`); the `forget` MCP triad (`dispatch.ts`, `forget-handler.ts`, `forget-schema.ts`); the S1/S2 recall-trace surface.
- **External:** `graphiti`/`mem0` — negative confirmation (they persist no drop-reason/retention; blueprint Q7).

## Objective
- [ ] `RecallTraceRetentionPolicy` port + pg impl: age-based sweep, SERIALIZABLE-retry, returns deleted count.
- [ ] Per-workspace fail-closed opt-out at the write gate (in-memory set; NO per-recall DB read).
- [ ] TimeBasedTrigger cron drives the sweep at the composition root (opt-in, THEOMEM_RECALL_TRACE).
- [ ] MCP `explain_recall` tool (schema + handler + dispatch) reusing S2 `getByRecallId`.
- [ ] Benchmark: sweep throughput (rows/sec) + recall-latency overhead ON vs OFF (≥3 runs, mean±stddev).

## ADRs

### D1 — Retention is a new `RecallTraceRetentionPolicy` port + pg impl, reusing the SERIALIZABLE-retry sweep
- **Decision:** a small port `RecallTraceRetentionPolicy { sweep(olderThanSeconds): Promise<number> }` implemented by `PgRecallTraceRetention` running `DELETE FROM recall_traces WHERE created_at <= NOW() - ($1 || ' seconds')::interval` inside `withSerializableTransactionAndRetry`.
- **Rationale:** mirrors the proven recall-cache age-sweep + race helper (Rule 9, `architecture.md § 2` DIP). A separate port keeps the 14th DIP (`RecallTraceStore`) at its ADR-0008 2-method cap — retention is a distinct concern (SRP).
- **Alternatives:** (a) add `sweep` to `RecallTraceStore` — REJECTED: breaks the 2-method ADR-0008 cap + mixes read/write with housekeeping (SRP); (b) a fresh advisory-lock sweep — REJECTED: recall-cache proves SERIALIZABLE suffices (Rule 9).
- **Consequences:** an internal age-based sweep (not tenant-triggered) — safe by construction (uniform housekeeping, not a tenant deleting another tenant's rows). Concurrency race covered by test.

### D2 — Per-workspace opt-out is an in-memory set checked at the WRITE gate (no per-recall DB read)
- **Decision:** `RecallTraceConfig` gains `disabledWorkspaces?: readonly string[]`; `recallTraceDeps` returns `{}` (no trace) when the resolved workspace is in that set → 0 rows written.
- **Rationale:** bounding at the source is stronger than post-hoc sweeping; an in-memory set avoids a per-recall policy DB read (the latency bottleneck the goal warns against — "sempre pense nos bottlenecks"). Fail-closed: default = the deployment `THEOMEM_RECALL_TRACE` flag; a disabled workspace never accrues rows.
- **Alternatives:** (a) a per-workspace policy TABLE read per recall — REJECTED: a DB round-trip on every recall is a latency regression; (b) opt-out = keep writing, never sweep — REJECTED: unbounded growth, the exact bottleneck.
- **Consequences:** per-workspace opt-out is config-time (restart to change); runtime per-workspace policy is a documented follow-up (YAGNI until asked).

### D3 — MCP `explain_recall` mirrors the forget triad + reuses the S2 workspace-scoped read
- **Decision:** `explain-recall-schema.ts` (`{ recallId: z.string() }`) + `explain-recall-handler.ts` (calls `getByRecallId(recallId, workspaceId)` with the MCP scope's workspace) + a `dispatch.ts` Map entry.
- **Rationale:** exact reuse of the shipped MCP tool convention (blueprint Q4) + the S2 read whose tenant isolation the S2 review proved airtight (Rule 9).
- **Alternatives:** a new MCP tool shape — REJECTED (Rule 9; the triad is the convention).
- **Consequences:** the tool inherits S2's CWE-441 workspace-scoping (workspace from the resolved scope, never the args).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| The sweep DELETE races with concurrent recall writes → lost-update/orphan | High | `withSerializableTransactionAndRetry` (proven recall-cache mechanism) + a race-aware concurrency test (Promise.all writers + sweep) | dev |
| A per-recall policy read would regress recall latency | Medium | D2 — opt-out is an in-memory set, checked in `recallTraceDeps`; the sweep reads config once per run, not per recall | dev |
| `scoped-memory.ts` already >500 LoC; the opt-out add grows it | Low | Add ≤ 8 lines (the set check); pre-existing over-budget documented, not introduced here (KISS) | dev |
| Cron sweep never runs if the trigger isn't wired in prod | Medium | Wire at the composition root under THEOMEM_RECALL_TRACE + a wiring test; benchmark exercises the sweep directly | dev |

## Unresolved Questions
- Q1 — Should retention be per-workspace-configurable (different max-age per tenant) or global-uniform? (M4 v1: global-uniform `maxAgeSeconds` + per-workspace opt-out only; per-workspace max-age is a documented follow-up — YAGNI until a tenant asks.)
- Q2 — Sweep cadence default (hourly? daily?) — leaning daily; operator-overridable via the cron expression. Resolved at wiring time.
- Q3 — Should the sweep emit an OTel metric (rows deleted)? Leaning yes (observability, Princípio 3) — included as a counter.

## Dependency Graph
```
Phase 1 (retention port + sweep) ──▶ Phase 3 (cron wiring) ──▶ Phase 5 (benchmark)
Phase 2 (per-workspace opt-out) ─────▶ Phase 5
Phase 4 (MCP explain_recall) ────────▶ Final
Phases 1,2,4 are independent (parallelizable). Phase 3 needs 1. Phase 5 needs 1+2. Final needs all.
```

---

## Phase 1: retention port + workspace-safe sweep

### T1.1 — `RecallTraceRetentionPolicy` port + `PgRecallTraceRetention` age sweep (SERIALIZABLE-retry)

#### Objective
A `sweep(olderThanSeconds)` that DELETEs `recall_traces` older than the window inside `withSerializableTransactionAndRetry`, returning the deleted count.

#### Why this step
1. **What** — add the port to `recall-trace-store.ts` + a new `pg-recall-trace-retention.ts` implementing the age-based DELETE wrapped in the race helper.
2. **Why now** — bounding table growth is the load-bearing M4 fix (the unbounded-growth risk); it must exist before the cron can drive it (D1; blueprint bottleneck).

#### Evidence
`pgvector-recall-cache-store.ts:105` (`CLEAR_EXPIRED_SQL` age-DELETE) + `serializable-tx.ts:27` (`withSerializableTransactionAndRetry`) — the exact patterns to reuse.

#### Files to edit
```
packages/core/src/domain/dip/recall-trace-store.ts — add RecallTraceRetentionPolicy interface + RecallTraceRetentionConfig
packages/core/src/infrastructure/db/recall-trace/pg-recall-trace-retention.ts (NEW) — PgRecallTraceRetention.sweep()
tests/integration/recall-trace/retention.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
- `recall-trace-store.ts` (Baseline row) — add a NEW port (not a method on `RecallTraceStore`, per D1 SRP + ADR-0008). No caller of the existing DIP changes.
- `pg-recall-trace-retention.ts` (NEW) — imports `Pool` + `withSerializableTransactionAndRetry`; no domain infra leak.

#### Deep Dives
- SQL: `DELETE FROM recall_traces WHERE created_at <= NOW() - ($1 || ' seconds')::interval` — parameterized (`$1` = olderThanSeconds).
- Invariant: the sweep is age-based only → cannot selectively target one tenant (safe housekeeping). Returns `rowCount`.
- Edge: 0 expired rows → returns 0, no error.

#### Concurrency tests
Race-aware: `Promise.all` of N concurrent `record()` writes for workspace A WHILE `sweep()` runs → assert (a) no lost-update/orphan (final count deterministic), (b) `40001` retried at most once, (c) rows for a DIFFERENT workspace with fresh `created_at` are NOT deleted. This is the load-bearing invariant (single-thread TDD cannot prove it).

#### TDD
```
RED: test_sweep_deletes_only_older_than_window() — seed rows at t-10d and t-1h, sweep(olderThan=1d) → the t-10d rows gone, t-1h rows remain, returns the deleted count
RED: test_sweep_is_race_safe_under_concurrent_writes() — Promise.all(writes) ‖ sweep → no orphan/lost-update; fresh cross-workspace rows survive
RED: test_sweep_zero_when_nothing_expired() — returns 0
GREEN: implement PgRecallTraceRetention.sweep with withSerializableTransactionAndRetry
REFACTOR: None expected
VERIFY: npm run test:integration -- recall-trace/retention
```

#### Acceptance Criteria
- [ ] `test_sweep_deletes_only_older_than_window` passes: `SELECT count(*)` post-sweep matches expected
- [ ] `test_sweep_is_race_safe_under_concurrent_writes` passes: no orphan; cross-workspace fresh rows survive
- [ ] `npx eslint` 0 warnings on the new files; `wc -l pg-recall-trace-retention.ts` ≤ 200
- [ ] `npm run typecheck` 0 errors

#### DoD
- [ ] `npm run test:integration -- recall-trace/retention` green
- [ ] CHANGELOG `[Unreleased]` noted

---

## Phase 2: per-workspace fail-closed opt-out

### T2.1 — `disabledWorkspaces` opt-out at the write gate

#### Objective
A workspace in `config.recallTrace.disabledWorkspaces` writes 0 trace rows (fail-closed), with NO per-recall DB read.

#### Why this step
1. **What** — `RecallTraceConfig` gains `disabledWorkspaces?: readonly string[]`; `recallTraceDeps` returns `{}` when the resolved workspace is in the set.
2. **Why now** — per-workspace governance (grill DoD) without the per-recall-DB-read bottleneck (D2).

#### Evidence
`scoped-memory.ts` `recallTraceDeps` (S2 T1.1) resolves `workspaceId` already (line ~214); the set check is a 1-line guard there.

#### Files to edit
```
packages/core/src/domain/dip/recall-trace-store.ts — RecallTraceStoreConfig gains disabledWorkspaces?: readonly string[]
packages/core/src/infrastructure/db/scoped-memory.ts — recallTraceDeps returns {} when workspace in the set
tests/integration/recall-trace/recall-trace-store.test.ts — RED test (opted-out → 0 rows)
```

#### Deep file dependency analysis
- `scoped-memory.ts` (Baseline, 598 LoC) — `recallTraceDeps` already computes `workspaceId`; add `if (disabled.has(workspaceId)) return {}` (≤ 8 lines). D1 return unchanged.

#### Deep Dives
- The set is built once from config (`new Set(disabledWorkspaces)`), not per recall.
- Fail-closed: if the workspace is disabled, `recallTraceDeps` returns `{}` → the pipeline writes nothing (EC-5 both-required gate already no-ops without context).

#### Concurrency tests
(none — single-threaded config check)

#### TDD
```
RED: test_opted_out_workspace_writes_zero_rows() — createLocalMemory({ recallTrace: { disabledWorkspaces: ['wsX'] } }) bound to wsX; recall dropping candidates → 0 recall_traces rows for wsX; a non-disabled workspace still writes
GREEN: add the set check in recallTraceDeps
REFACTOR: None
VERIFY: npm run test:integration -- recall-trace/recall-trace-store
```

#### Acceptance Criteria
- [ ] `test_opted_out_workspace_writes_zero_rows` passes (0 rows for disabled ws; >0 for enabled)
- [ ] `recall()` return unchanged (D1)
- [ ] Net add to `scoped-memory.ts` ≤ 8 lines (`git diff --stat`)

#### DoD
- [ ] integration green; typecheck 0; CHANGELOG noted

---

## Phase 3: cron wiring (ops path)

### T3.1 — TimeBasedTrigger drives the sweep at the composition root

#### Objective
Wire a `TimeBasedTrigger` (croner) that calls `retention.sweep()` on a schedule, opt-in under `THEOMEM_RECALL_TRACE`, at `run-server.ts`/factory.

#### Why this step
1. **What** — resolve `PgRecallTraceRetention` + a `TimeBasedTrigger` cron in the composition root when tracing is enabled; emit an OTel counter of rows swept.
2. **Why now** — without wiring, the sweep never runs in prod (Drawbacks row 4). Reuses the eviction cron path (croner installed — Rule 9).

#### Evidence
`croner` in root `package.json`; `TimeBasedTrigger` exported (`core/index.ts:151`); the eviction `TimeBasedTrigger` wiring precedent.

#### Files to edit
```
packages/core/src/infrastructure/db/config.ts — recallTrace config gains retentionMaxAgeSeconds? + retentionCron?
packages/core/src/infrastructure/db/factory.ts — resolve PgRecallTraceRetention + start a TimeBasedTrigger when recallTrace enabled
packages/agent-core/src/agent-tools-memory.ts — thread the retention config under THEOMEM_RECALL_TRACE
tests/integration/recall-trace/retention.test.ts — wiring assertion (trigger fires sweep)
```

#### Deep file dependency analysis
- `factory.ts` (376 LoC) — additive: resolve retention alongside `resolveRecallTraceStore`; start the trigger; return a disposer that stops it.
- `agent-tools-memory.ts` — extends the `resolveRecallTraceEnabled` path (from S2 fix-cycle) with the retention config.

#### Concurrency tests
The cron fires the sweep which is race-tested in T1.1; the wiring test asserts the trigger invokes `sweep` (a spy) at least once.

#### TDD
```
RED: test_trigger_invokes_sweep() — a fast-interval TimeBasedTrigger calls retention.sweep at least once (spy)
GREEN: wire the trigger in the factory under the enabled flag
REFACTOR: extract a resolveRecallTraceRetention helper if factory grows past budget
VERIFY: npm run test:integration -- recall-trace/retention
```

#### Acceptance Criteria
- [ ] `test_trigger_invokes_sweep` passes
- [ ] OTel counter `recall_trace_swept` observed non-zero when rows are deleted (runtime-metric proof)
- [ ] `factory.ts` stays ≤ 500 LoC (extract helper if needed)

#### DoD
- [ ] integration green; typecheck 0; CHANGELOG noted

---

## Phase 4: MCP explain_recall tool

### T4.1 — `explain_recall` MCP tool (schema + handler + dispatch)

#### Objective
An MCP tool `explain_recall` that returns a recall's dropped candidates for the caller's workspace, reusing S2 `getByRecallId`.

#### Why this step
1. **What** — 3 files (schema + handler + dispatch entry) mirroring the `forget` triad; the handler calls `getByRecallId(recallId, workspaceId)`.
2. **Why now** — closes the agent-reachable surface (grill DoD); reuses the S2 read whose isolation is proven (D3).

#### Evidence
`dispatch.ts:17-29` (Map), `forget-schema.ts:12-34` (schema shape), `forget-handler.ts` (handler shape); S2 `getByRecallId(recallId, workspaceId)`.

#### Files to edit
```
packages/mcp/src/tools/explain-recall-schema.ts (NEW) — TOOL_NAME 'explain_recall' + DESCRIPTION + INPUT_SCHEMA { recallId: z.string() }
packages/mcp/src/tools/explain-recall-handler.ts (NEW) — resolve workspace from scope + getByRecallId + return drops (projected)
packages/mcp/src/tools/dispatch.ts — register [EXPLAIN_RECALL, explainRecallHandler]
packages/mcp/src/tools/explain-recall.test.ts (NEW) — RED round-trip
```

#### Deep file dependency analysis
- `dispatch.ts` (69 LoC) — additive Map entry + import; existing tools unchanged.
- The handler needs a `RecallTraceStore` — injected the same way the MCP server injects the memory/stores (mirror `forget-handler` dependency access).

#### Deep Dives
- Response: `{ recallId, drops: [{ memoryId, semantic, bm25, entity, composite, threshold, dropReason }] }` — the SAME projected DTO as the S2 REST handler (consistency + no internal-field leak).
- Workspace from the MCP scope binding (AsyncLocalStorage, per the existing MCP scope pattern), NEVER from the tool args (CWE-441).

#### Concurrency tests
(none — single request)

#### TDD
```
RED: test_explain_recall_roundtrips() — MCP client calls explain_recall(recallId) → drops for the bound workspace; a foreign-workspace recallId → empty/NOT_FOUND
GREEN: implement the triad
REFACTOR: None
VERIFY: npm test -- explain-recall
```

#### Acceptance Criteria
- [ ] `test_explain_recall_roundtrips` passes (drops for own ws; foreign ws → empty)
- [ ] `tools/list` includes `explain_recall`
- [ ] workspace resolved from scope, not args (grep the handler)

#### DoD
- [ ] `npm test -- explain-recall` green; typecheck 0; CHANGELOG noted

---

## Phase 5: benchmark (evidence)

### T5.1 — sweep throughput + recall-latency overhead benchmark

#### Objective
Produce quantitative evidence: sweep rows/sec + recall p50/p95 latency tracing ON vs OFF (≥3 runs, mean±stddev), against real pgvector.

#### Why this step
1. **What** — a benchmark seeding N rows, timing `sweep()` (rows/sec) + timing recall with tracing ON vs OFF (overhead %).
2. **Why now** — the goal demands benchmark evidence; the bottleneck (sweep + write overhead) must be quantified, not asserted.

#### Evidence
The goal's benchmark requirement; blueprint § Bottleneck & benchmark hooks.

#### Files to edit
```
benchmarks/recall-trace-retention.bench.ts (NEW) — seed N rows, ≥3 runs, report mean±stddev
docs/benchmarks/m4-recall-trace-retention.md (NEW) — the recorded results + methodology + reproduction command
```

#### Deep Dives
- Sweep throughput: seed 10k/50k rows at ages spanning the window, run `sweep`, measure rows-deleted/sec.
- Overhead: 100 recalls each dropping ≥1 candidate, tracing ON vs OFF, report p50/p95 delta; assert the ON overhead is within a stated bound (e.g., < 15% p95).

#### Concurrency tests
(none — measurement harness; the race correctness is proven in T1.1)

#### TDD
```
RED: the benchmark asserts sweep throughput > 0 rows/sec AND recall-ON p95 overhead is within the declared bound
GREEN: implement the harness
VERIFY: npm run bench -- recall-trace-retention (or the project bench command)
```

#### Acceptance Criteria
- [ ] Benchmark runs ≥ 3 iterations, reports mean±stddev with units + hardware
- [ ] Results recorded in `docs/benchmarks/m4-recall-trace-retention.md` with a reproduction command
- [ ] Recall-ON overhead within the declared bound (documented number, not asserted-away)

#### DoD
- [ ] benchmark produces recorded numbers; docs committed

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | bounded growth via retention sweep (the bottleneck) | T1.1 | age-based DELETE + SERIALIZABLE-retry |
| 2 | race-safe sweep vs concurrent writes | T1.1 | concurrency test + withSerializableTransactionAndRetry |
| 3 | per-workspace fail-closed opt-out (no per-recall DB read) | T2.1 | in-memory disabledWorkspaces set at write gate |
| 4 | sweep runs in production | T3.1 | TimeBasedTrigger cron wiring + OTel counter |
| 5 | agent-reachable read (MCP) | T4.1 | explain_recall triad reusing S2 getByRecallId |
| 6 | benchmark evidence (sweep + overhead) | T5.1 | recorded ≥3-run benchmark |
| 7 | integration validation (THE GOAL TEST) | Final | end-to-end vs real pgvector |

**Coverage: 7/7 gaps covered (100%)**

## Global Definition of Done
- [ ] All phases completed
- [ ] `npm test` — no NEW failures vs the pre-existing baseline (28 pre-existing dogfood/examples reds documented)
- [ ] `npm run typecheck` 0 errors; `npm run lint` 0 warnings on changed files
- [ ] File-size budget respected on changed files (scoped-memory.ts pre-existing >500 noted; net add ≤ 8 lines)
- [ ] CHANGELOG.md `[Unreleased]` updated (Added: retention + MCP explain_recall)
- [ ] Backward compatibility: `RecallTraceStore`/`getByRecallId` unchanged; recall() bare-array unchanged (D1)
- [ ] Runtime-metric proof: `recall_trace_swept` counter observed non-zero in integration
- [ ] Benchmark recorded with reproduction command (M4 evidence requirement)
- [ ] Plan archived after `/review` READY_TO_MERGE + merge

## Failure scenarios (external I/O)

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `postgres:recall_traces` (DB, sweep) | serialization conflict (`40001`) under concurrent writes | Promise.all writers ‖ sweep in the integration test | retry once (withSerializableTransactionAndRetry); no orphan/lost-update; correct final count |
| `postgres` (DB) | connection error mid-sweep | pool error surfaces | the sweep throws (typed); the cron logs + the next tick retries; NEVER a silent partial delete masked as success |
| `postgres:recall_traces` (DB, MCP read) | unknown / foreign-workspace recall_id | MCP explain_recall with a bad id | empty/NOT_FOUND (workspace-scoped, no cross-tenant leak) |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** the governance works end-to-end against real pgvector + the benchmark produces evidence.

### Execution
```
npm test -- recall-trace-store retrieval/pipeline explain-recall     # unit
npm run test:integration -- recall-trace                             # migration + pg-store + GOAL + concurrency + read-surface + retention
npm run typecheck && npm run lint
npm run bench -- recall-trace-retention                              # benchmark evidence
```

THE GOAL TEST (M4, `retention.test.ts` + `recall-trace-store.test.ts`): rows older than the window are swept while a concurrent cross-workspace write is untouched; an opted-out workspace writes 0 rows; MCP `explain_recall` round-trips recall_id → drops; the cron trigger invokes the sweep; the benchmark records sweep-throughput + recall-overhead numbers.

### Acceptance Criteria
- [ ] All recall-trace + explain-recall suites green (no new failures vs baseline)
- [ ] Coverage ≥ 90% on changed files (critical paths 100%)
- [ ] Zero type errors / lint warnings on changed files
- [ ] Runtime-metric proof — `recall_trace_swept` counter non-zero
- [ ] Failure scenarios green — the `40001` retry + cross-tenant 404 exercised
- [ ] Benchmark numbers recorded (sweep rows/sec + recall overhead within bound)

### If Validation Fails
1. Separate plan-caused failures from the 28 pre-existing dogfood/examples reds (baseline `c624ce5`).
2. Fix all plan-caused failures; re-run.
3. Pre-existing issues logged, do NOT block (document in PR).
