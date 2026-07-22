---
slug: m9-session-to-global-consolidation
milestone_id: M9
created_at: 2026-07-22
goal: Promote durable session (workspace,user,session) memories to global (workspace,user) at the reflect boundary with derivedFrom provenance, proven by a real-pgvector integration test where 3 session mentions become 1 promoted global row and cross-user isolation holds.
---

# Plan: M9 — Session → Global Consolidation (within `(workspace, user)`)

> **Review reconciliation (2026-07-22)** — after `/review` (3 agents), these plan claims were corrected to the SHIPPED design (commit `2155e31` + fix `7653f8d`); read the tasks below with these overrides:
> - **Individual promotion, NOT cluster-merge (F-xval-1).** The policy promotes EACH durable memory individually — `rejectedMemoryIds` is ALWAYS `[]`, `originalEpisodeIds` is `[self]`. Task T1.1/T4.1 prose describing "reject the other 2 / originalEpisodeIds = all 3" is superseded: 3 exact mentions dedup (composite UPSERT, Princípio 1) to ONE `confirmation_count=3` row, so there are never 3 source rows.
> - **Provenance = `consolidation_history` (id-preserving), NOT a `derivedFrom` field (F-dom-2).** In-place promotion keeps the row's id, so a `derivedFrom` self-reference is meaningless; provenance + reversibility come from the audit row + the preserved id (`forget` undoes it).
> - **Promotion rule v1 = `confirmation_count` only (F-dom-1, PARTIAL).** LLM-judged / agent-marked triggers are declared but ship as future hooks (honest deferral).
> - **Runtime metric is the typed OTel event `consolidation_promoted`, not a counter `theo.memory.promotions` (F-xval-5).** The event carries `{scope_tier, promoted_count}` and reports only ACTUAL promotions (F-arch-3).
> - **`recallConsolidationCandidates` is a full session-scan (O(session)) in v1 (F-xval-4)** — the blueprint's "never a full session scan / incremental" is deferred; not a correctness bug (scoped to one `(workspace, user)`).


## Goal

Promote durable `session (workspace, user, session)` memories UP to `global (workspace, user)` at the `reflect` boundary — carrying `derivedFrom` provenance and one `consolidation_history` audit row per promotion, with non-promoted session memories left to the shipped triadic eviction — proven by a hard-gate integration test on real `ankane/pgvector:v0.5.1` (3 session mentions of one fact by user A → 1 promoted `global` row under `(workspace, userA)`; a one-off session fact is NOT promoted; user B sees none of it).

**One metric:** the M9 integration test (`tests/integration/consolidation/session-to-global.test.ts`) passes on real pgvector — the promoted row has `session_id IS NULL`, the SAME `workspace_id`+`user_id`, `derivedFrom` to the 3 sources, one `consolidation_history` row; user B's recall returns 0 of it.

## Context

Grounded in the blueprint `.claude/knowledge-base/discoveries/blueprints/m9-session-to-global-consolidation-blueprint.md` (`/discover-confidence` SHIPPABLE 98.8) + its edge-case review. Central finding: M9 is a COMPOSITION of shipped seams, NOT a new engine (Rule 9). M8 (PR #106, on `develop`) fills the `session` scope via agent-chosen routing; M9 promotes what proves durable so it survives the shipped eviction. Owner directive: `/goal` M9.

## Baseline Context

### Files that will be touched

| File | LoC today | Role | Change |
|---|---|---|---|
| `packages/core/src/domain/dip/conflict-resolution-policy.ts` | 78 | `ConflictResolutionPolicy` DIP + `ConsolidationCandidate`/`ConsolidationContext`/`ConflictResolutionResult` types | REUSE (no change) — the decision seam |
| `packages/core/src/domain/dip/reflection-policy.ts` | 45 | `ReflectionPolicy` DIP (`shouldReflect`, `onReflectionEnd`) | REUSE (no change) — the boundary trigger |
| `packages/core/src/domain/consolidation/session-to-global-policy.ts` | 0 (NEW) | M9 `SessionToGlobalConsolidationPolicy implements ConflictResolutionPolicy` — the promotion decision | NEW |
| `packages/core/src/infrastructure/db/pgvector-store.ts` | 1147 | `persistConsolidations` (soft-delete rejected + `consolidation_history` insert) | EXTEND — add `promoteToGlobal` (UPDATE `session_id=NULL, agent_id=NULL` on the kept row, inside the same txn) |
| `packages/core/src/infrastructure/db/in-memory-store.ts` | 621 | in-memory `persistConsolidations` twin | EXTEND — mirror `promoteToGlobal` |
| `packages/core/src/infrastructure/db/reflect-orchestrator.ts` | 265 | reflect flow that already calls `ConflictResolutionPolicy` | WIRE — invoke the M9 policy on a session scope at the reflect boundary |
| `tests/integration/consolidation/session-to-global.test.ts` | 0 (NEW) | the isolation + promotion hard-gate proof | NEW |

### Current callers / seams (verified)

- `ConflictResolutionPolicy.consolidate(candidates, ctx): Promise<ConflictResolutionResult[]>` — `conflict-resolution-policy.ts:71-78`. `ConflictResolutionResult{ keptMemoryId, rejectedMemoryIds[], reason, policyName, originalEpisodeIds[] }` (`:51-57`). `rejectedMemoryIds` → `t_invalid=NOW()` soft-delete per the JSDoc (`:46-48`).
- `ReflectionPolicy.shouldReflect(scope, trigger): Promise<boolean>` + `onReflectionEnd(scope, result)` — `reflection-policy.ts:21-37`.
- `persistConsolidations(...)` — `pgvector-store.ts:1060` — `withTransaction`: `UPDATE memories SET t_invalid = NOW() WHERE id = ANY($rejected)` + `INSERT consolidation_history (...)`. Does NOT touch `session_id` today — the gap M9 fills.
- `consolidation_history` table — migration `0007_distillation_columns.sql:14-42`; drizzle `schema.ts:483`. Columns: `kept_memory_id` (FK `ON DELETE SET NULL`), `rejected_memory_ids` jsonb, `reason`, `policy_name`, `original_episode_ids` jsonb, `created_at`.
- `confirmation_count` read — `pgvector-store.ts:480`; migration `0011_confirmation_count_and_composite_unique.sql`.
- M8 hierarchical recall (shipped this branch): a global recall is `session_id IS NULL AND agent_id IS NULL`, so a promoted row (session_id→NULL) becomes visible to the user's global recall automatically.

### Glossary

- **Promotion** = moving a durable session memory into the user's global scope (`session_id: S → NULL`), keeping the SAME `workspace_id`+`user_id`.
- **Durable** = `confirmation_count ≥ 3` OR LLM-judged durable OR agent-marked (M9 rule, grounded in Princípio 1 — ADR D3 of the blueprint; NOT a copied reference pattern).

### Architecture boundaries crossed

- Domain: a new `ConflictResolutionPolicy` impl (`domain/consolidation/`) — pure, no I/O (DIP per `architecture.md § 2`).
- Infrastructure: `promoteToGlobal` in the pgvector + in-memory stores (adapters implement the promotion persistence).
- Composition root: `reflect-orchestrator` wires the M9 policy at the boundary.

## Prior Art & Related Work

- Blueprint `.claude/knowledge-base/discoveries/blueprints/m9-session-to-global-consolidation-blueprint.md` (SHIPPABLE 98.8) — mem0's 4-op decision shape (reuse, not the per-write timing), graphiti's bi-temporal supersession (relational, no graph store), incremental related-subset scan; all mapped onto the shipped seams above.
- Shipped v0.7 distillation (`ConflictResolutionPolicy` + `consolidation_history`) — M9 reuses it; the ONLY new persistence is the `session_id→NULL` promotion.

## ADRs

### D1 — Promotion is `session_id→NULL` in place, NOT a new derived row

**Decision:** the representative durable session memory is PROMOTED in place (`UPDATE memories SET session_id=NULL, agent_id=NULL WHERE id=keptMemoryId`); the duplicate session mentions become `rejectedMemoryIds` (soft-deleted `t_invalid=NOW()`); provenance is `originalEpisodeIds` + a `consolidation_history` row.

**Rationale:** in-place promotion (a) preserves the memory's `id`, embedding, and `confirmation_count` (no re-embed, no lineage break), (b) fits the shipped `ConflictResolutionResult` shape exactly (`keptMemoryId`=promoted, `rejectedMemoryIds`=duplicates), and (c) makes the promoted row appear in the user's global recall for free (M8 hierarchical recall filters `session_id IS NULL`). **Alternatives:** (i) INSERT a new global row + soft-delete all session sources (rejected — re-embeds, breaks id/confirmation_count continuity, doubles storage); (ii) copy text into a reflect-derived memory (rejected — that is distillation, not promotion; loses the confirmation_count signal).

### D2 — Trigger at the ReflectionPolicy boundary; NO new trigger

**Decision:** M9 promotion runs inside the reflect flow (`reflect-orchestrator`) when `ReflectionPolicy.shouldReflect(sessionScope, trigger)` is true — never per remember().

**Rationale:** blueprint ADR M9-D2 / EC-1 — mem0's per-write timing is wrong for "promote what proved durable at the boundary". The boundary trigger already ships. **Alternative:** a per-write promotion hook (rejected — EC-1, write-amplification).

### D3 — The `≥3` durability rule is a theo-memory design choice (Princípio 1), not copied

**Decision:** durability = `confirmation_count ≥ 3` OR the reused LLM-judged conflict policy marks it durable OR an explicit agent-marked flag. Grounded in Princípio 1; the threshold `3` is configurable.

**Rationale:** blueprint ADR M9-D3 / CHECKPOINT-3 — neither mem0 nor graphiti has a count-threshold analog; claiming one would be fabricated provenance (Rule 3). **Alternative:** LLM-only judgment (rejected — cost per boundary; the count signal is free and already shipped).

## Dependency Graph

```
Phase 1 (policy) ─→ Phase 2 (persistence) ─→ Phase 3 (wiring) ─→ Phase 4 (integration proof)
   T1.1 policy        T2.1 promoteToGlobal      T3.1 reflect wire    T4.1 isolation+promotion e2e
                      T2.2 in-memory twin                            T4.2 non-promoted decay
```

Phase 2 depends on Phase 1 (the policy's result shape drives the persistence). Phase 3 depends on Phase 2. Phase 4 depends on Phase 3.

## Phase 1 — The promotion decision policy

### T1.1 — `SessionToGlobalConsolidationPolicy implements ConflictResolutionPolicy`

#### Files to edit
- `packages/core/src/domain/consolidation/session-to-global-policy.ts` (NEW)
- `packages/core/src/domain/consolidation/session-to-global-policy.test.ts` (NEW)

#### Why this step
The decision seam is shipped (`ConflictResolutionPolicy`); M9 only needs a new IMPL that, given a cosine-similar cluster of session candidates, decides which one to promote (the durable representative) and which are duplicates. Reusing the DIP (ADR D1) means the persistence + audit path is already built.

#### TDD
- `RED: test_promotes_when_confirmation_count_at_or_above_threshold` — given 3 candidates for one fact where the representative has `confirmationCount ≥ 3`, `consolidate()` returns 1 `ConflictResolutionResult` with `keptMemoryId` = the representative, `rejectedMemoryIds` = the other 2, `originalEpisodeIds` = all 3, `policyName = 'session-to-global'`.
- `RED: test_does_not_promote_a_one_off_below_threshold` — a single candidate with `confirmationCount = 1` → `consolidate()` returns `[]` (no promotion; it will decay via eviction).
- `RED: test_reason_is_recorded` — the `reason` names the trigger (confirmation_count vs LLM-judged).

#### Concurrency tests
(none — single-threaded pure policy; the transaction is in Phase 2)

#### Acceptance criteria
- `consolidate([], ctx)` → `[]`; a below-threshold cluster → `[]`; an at-threshold cluster → exactly 1 result with the correct kept/rejected/lineage.
- No I/O in the policy (pure); `npm run typecheck` 0, `npm run lint` 0.

## Phase 2 — Promotion persistence

### T2.1 — `promoteToGlobal` in the pgvector store (extend the consolidation txn)

#### Files to edit
- `packages/core/src/infrastructure/db/pgvector-store.ts` (EXTEND `persistConsolidations` / add `promoteToGlobal`)

#### Why this step
`persistConsolidations` already soft-deletes rejected + inserts `consolidation_history` in one txn; M9 adds the in-place promotion (`UPDATE ... SET session_id=NULL, agent_id=NULL WHERE id=keptMemoryId`) to that SAME txn, so promotion + duplicate-soft-delete + audit are atomic (EC-8 rollback parity).

#### TDD
- `RED: test_promote_to_global_sets_session_id_null_atomically` — against real pgvector: a session row promoted has `session_id IS NULL AND agent_id IS NULL`, keeps its `workspace_id`+`user_id`+`id`+`confirmation_count`; the rejected duplicates have `t_invalid` set; one `consolidation_history` row exists with the `original_episode_ids`. A forced `consolidation_history` insert failure rolls BACK the promotion + soft-deletes (EC-8).

#### Failure scenarios
- DB connection reset mid-txn → the whole promotion rolls back (no partial promote); asserted by wrapping the insert in a failing stub.
- `keptMemoryId` already global (`session_id` already NULL) → idempotent no-op UPDATE (0 rows changed is not an error).

#### Concurrency tests
- `RED: test_concurrent_promotion_of_same_cluster_is_idempotent` — two concurrent `promoteToGlobal` on the same `keptMemoryId` → the row ends `session_id NULL` exactly once; the second sees 0 rows to update (the `WHERE session_id IS NOT NULL` guard). Race-aware: uses the shipped `withTransaction` SERIALIZABLE pattern.

#### Acceptance criteria
- Promotion + soft-delete + audit are atomic; idempotent on re-run; isolation columns (`workspace_id`,`user_id`) unchanged.

### T2.2 — `promoteToGlobal` in the in-memory store (twin)

#### Files to edit
- `packages/core/src/infrastructure/db/in-memory-store.ts` (EXTEND)

#### Why this step
The in-memory store backs the fast contract tier; the promotion semantics must match pgvector for unit-level tests.

#### TDD
- `RED: test_in_memory_promote_sets_session_id_null` — mirrors T2.1 at the in-memory level (payload `session_id` cleared on the kept row; rejected rows flagged invalid).

#### Concurrency tests
(none — single-threaded in-memory map)

#### Acceptance criteria
- Byte-parity with the pgvector promotion semantics for the kept/rejected rows.

## Phase 3 — Wire into the reflect boundary

### T3.1 — Invoke the M9 policy on a session scope at reflect

#### Files to edit
- `packages/core/src/infrastructure/db/reflect-orchestrator.ts` (WIRE)

#### Why this step
The reflect flow already resolves a scope + calls `ConflictResolutionPolicy`; M9 wires: on a `session` scope, fetch the related candidate cluster (over-fetch recall of the session's rows), run the M9 policy, and call `promoteToGlobal` for each result. This is the composition root (caller pillar of the wiring triad).

#### TDD
- `RED: test_reflect_on_session_scope_promotes_durable_cluster` — a reflect on a session scope with a ≥3-confirmed fact calls `promoteToGlobal`; `onReflectionEnd` reports the promoted count. A reflect on a global scope does NOT promote (no session→global for an already-global scope).

#### Failure scenarios
- The policy throws → reflect fails-soft (logs an OTel event `consolidation_failed`, does NOT crash the reflect); asserted with a throwing policy stub.

#### Concurrency tests
(none — the promotion txn owns the concurrency, tested in T2.1)

#### Acceptance criteria
- Caller present (pillar a); an OTel counter `theo.memory.promotions` increments per promotion (pillar c); the integration test (Phase 4) exercises the boundary (pillar b).

## Phase 4 — Integration Validation (the hard gate)

### T4.1 — Isolation + promotion e2e on real pgvector

#### Files to edit
- `tests/integration/consolidation/session-to-global.test.ts` (NEW)

#### Why this step
The M9 DoD's hard gate: prove promotion + isolation end-to-end on real `ankane/pgvector` via `createIsolatedDb` (`tests/integration/_helpers/isolated-db.ts:46-62`).

#### TDD
- `RED: test_three_session_mentions_promote_to_one_global_row_isolated` — user A writes one fact 3× in session S (confirmation_count reaches 3) + a one-off fact; reflect(session S); assert: (1) the durable fact is 1 `global` row (`session_id IS NULL`) under `(workspace, userA)` with `derivedFrom` to the sources + 1 `consolidation_history` row; (2) the one-off fact is NOT promoted; (3) user B in the same workspace recalls 0 of A's promoted/session rows.

#### Failure scenarios
- pgvector unavailable (`THEOMEM_PG_URI` unset) → the suite `describe.skip`s (harness convention), never a false green.

#### Concurrency tests
- covered by T2.1's concurrent-promotion test.

#### Acceptance criteria
- The GOAL TEST passes on real pgvector; the promoted row keeps `(workspace_id, user_id)`; cross-user isolation holds.

### T4.2 — Non-promoted decay proof

#### Files to edit
- `tests/integration/consolidation/session-to-global.test.ts` (same file, second test)

#### TDD
- `RED: test_non_promoted_session_fact_decays_via_eviction` — a one-off session fact, under capacity pressure, is evicted by the shipped triadic eviction (bounded session growth) — NOT promoted.

#### Acceptance criteria
- Non-promoted session memories decay via the shipped `EvictionPolicy` (no unbounded session growth).

## Coverage Matrix

| M9 DoD item (ROADMAP) | Task(s) |
|---|---|
| `ConsolidationPolicy` reusing reflect/ConflictResolutionPolicy + eviction (Rule 9) | T1.1 (policy) + T3.1 (reflect wire) + ADR D1/D2 |
| Promotion rule `confirmation_count ≥ N (N≥3)` OR LLM-judged OR agent-marked | T1.1 + ADR D3 |
| Non-promoted session memories decay via triadic eviction | T4.2 |
| Isolation preserved (hard gate) — promoted memory keeps `workspace_id`+`user_id` | T2.1 + T4.1 |
| Integration test (real pgvector): 3 mentions → 1 promoted global w/ provenance; one-off not promoted; user B sees none | T4.1 |
| `derivedFrom` / `consolidation_history` provenance | T2.1 (audit row) + T1.1 (`originalEpisodeIds`) |

100% of the M9 DoD maps to ≥ 1 task.

## Drawbacks & Risks

1. **Wrong promotion pollutes the user's durable scope (HIGH).** A false-positive "durable" judgment permanently promotes noise. **Mitigation:** conservative `≥3` threshold + provenance so every promotion is auditable + reversible via `forget` (the promoted row keeps its id). **Owner:** T1.1. **Severity:** HIGH.
2. **Promotion txn contention at scale (MEDIUM).** Concurrent reflects on the same `(workspace, user)` could contend. **Mitigation:** scoped to one `(workspace, user)`, idempotent `WHERE session_id IS NOT NULL` guard, SERIALIZABLE-retry (T2.1). **Owner:** T2.1. **Severity:** MEDIUM.
3. **Extending the 1147-LoC pgvector-store.ts trips the 300-LoC quality budget hook (MEDIUM).** **Mitigation:** the file is pre-existing over-budget; the promotion method is a minimal addition to the existing consolidation txn — document the deferral (schema.ts precedent), do not split the store in M9 (KISS/YAGNI). **Owner:** T2.1. **Severity:** MEDIUM.

## Unresolved Questions

- Should promotion also fire for the AGENT tier (agent memory → global)? **Resolved:** NO — M9 is strictly session→global per the ROADMAP; agent-tier promotion is out of scope (not requested; YAGNI).
- Configurable threshold storage — per-`(workspace,user)` config lands in M11 (governance). M9 ships the `≥3` default as a policy constructor param; the per-tenant config is M11's job. (none other — every decision is resolved at plan time.)

## Failure scenarios

- pgvector timeout / connection reset mid-promotion → whole txn rolls back (T2.1 failure scenario) — no partial promote.
- `consolidation_history` insert fails → rolls back the promotion + soft-deletes (EC-8 parity).
- Policy throws at the boundary → reflect fails-soft with an OTel `consolidation_failed` event (T3.1) — recall/reflect degrade gracefully, never crash.

## Global Definition of Done

- `npm run typecheck` 0, `npm run lint` 0.
- Contract tier: T1.1 + T2.2 policy/in-memory tests green.
- Integration tier (real pgvector): T2.1 + T4.1 + T4.2 green.
- Wiring triad: caller (T3.1 reflect wire), integration test (T4.1), runtime metric (`theo.memory.promotions` counter).
- `CHANGELOG.md [Unreleased]` updated.
- No new store, no new dependency (Rule 9 — blueprint central finding).

## Final Phase: Integration Validation

The plan is NOT complete until `npm run test:integration` (real pgvector) passes T4.1 + T4.2 AND `npm test` passes T1.1 + T2.2, with `npm run typecheck` + `npm run lint` clean. The isolation hard-gate (T4.1: user B sees 0 of user A's promoted/session rows) is the eat-your-own-cooking gate.
