# Plan: v0.4b — Forgetting pipeline with long-tail preservation (`EvictionPolicy` + `TriadicScoringPolicy`)

> **Version 1.2** (2026-05-30) — Pre-`/implement` patch closing two stale-plan defects detected at pre-flight (this plan was authored 2026-05-26; v0.6 voyager-skill-library shipped 2026-05-30 between authoring and `/implement`). Defect 1: renamed Drizzle migration filename from `0002_…` to `0003_eviction_columns.sql` to deconflict with `0002_skill_columns.sql` shipped by v0.6 (mechanical rename across D13, T0.1, Coverage Matrix, Dependencies table, Global DoD; migration ordering reference in T0.1 also updated to point at the new lex-order predecessor `0002_skill_columns.sql`). Defect 2: D12's "NEW 7th DIP" reframed as "NEW 8th DIP" — v0.6 introduced `src/core/dip/skill-representation-strategy.ts`, so the current DIP count under `src/core/dip/` is 7 (embedder, history-manager, llm, reflection-policy, scoring-strategy, skill-representation-strategy, vector-store); EvictionPolicy becomes the 8th. No ADR substance changed; Coverage Matrix unchanged; `/plan-confidence` re-score skipped (cosmetic counts, not Coverage gap).
> **Version 1.1** (2026-05-26) — Absorbed 4 MUST FIX + 6 SHOULD TEST + 2 DOCUMENT from `.claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-edge-cases-plan-2026-05-26.md` (EC-1 stale half_life on importance update → T2.2 trigger; EC-2 concurrent remember race → T5.1 advisory lock; EC-3 InMemoryVectorStore cosine-distance gap → ADR D18 + T7.2 strategy; EC-4 OTel counter undefined → T6.1 + T8.1; EC-5..EC-10 RED tests added; EC-11+EC-12 documented). v1.0 (2026-05-26): initial plan from `/to-plan`.
>
> Ships the AUTOMATED forgetting layer of TheMemory's roadmap Item 6 (CLAUDE.md flagged **OPEN PROBLEM #1** — "no competitor solved this"; empirically confirmed by `/discover-execute v0-4b-forgetting-pipeline` blueprint SHIPPABLE_WITH_CAVEATS 89/100). Adds ONE new `EvictionPolicy` DIP at `src/core/dip/eviction-policy.ts` plus ONE drop-in `TriadicScoringPolicy` impl combining 3 dimensions (Ebbinghaus exponential time decay via Half-Life Regression `p = 2^(-Δ/h)` per Settles & Meeder ACL 2016, LRU/LFU access bookkeeping, REUSED `llm_importance_score` from v0.4a) WITH a long-tail protection multiplier `clamp(0.1, 1.0, isolation_distance / mean_isolation_distance)` that defeats frequency bias for rare-but-semantically-isolated memories. Adds three new columns on `memories` (`last_accessed_at TIMESTAMPTZ`, `access_count INTEGER NOT NULL DEFAULT 0`, `half_life_seconds INTEGER`) via Drizzle migration. Wires two composable `EvictionTrigger` implementations: `CapacityBasedTrigger` (fires on `remember()` when scope exceeds `maxMemoriesPerScope`) and `TimeBasedTrigger` (cron-driven via REUSED `croner` from v0.4a — zero new runtime dep). Forget = soft-delete via `t_invalid = NOW()` reusing v0.1's bi-temporal schema (per ADR-0006) — NOT physical DELETE. Closes CLAUDE.md § Macro roadmap Item 6 acceptance verbatim: seed 1000 memories with 50 rare-query targets; remove 30% by triadic score; assert `recall@10` on rare-query set ≥ locked threshold AND guardrail unit test (rare-isolated survives ≥ 5 consecutive LRU eviction passes against frequent siblings) AND `docs/forgetting-evaluation.md` artifact reproducible.

## Goal

> "Enable `@usetheo/memory` consumers to opt into AUTOMATED triadic-scored forgetting (capacity-based OR cron-based triggers) with long-tail preservation, soft-deleting low-value memories via `t_invalid` while protecting rare-but-isolated ones, measured by `tests/integration/forgetting/triadic-eviction.test.ts` passing (seed 1000 memories with 50 rare-query targets in one scope + invoke eviction removing 30% by triadic score + assert `recall@10` on rare-query set ≥ 0.70 against real `ankane/pgvector:v0.5.1` AND the guardrail assertion: a rare-but-isolated memory survives ≥ 5 consecutive `CapacityBasedTrigger` eviction passes against 100 frequent-cluster siblings)."

## Context

### What exists today (the gap)

| Capability | Status | Source |
|---|---|---|
| Bi-temporal columns `t_valid` / `t_invalid` on `memories` | YES (v0.1, ADR-0006) | `src/local/schema.ts` |
| `Memory.forget(id)` caller-driven public API | YES (v0.1) | `src/core/memory-store.ts:60` |
| `llm_importance_score REAL` column on `memories` | YES (v0.4a, ADR D5/D11) | `src/local/schema.ts` post-v0.4a |
| `ScoringStrategy` DIP shape (additive weighted sum) | YES (v0.4a) | `src/core/dip/scoring-strategy.ts` |
| `croner` runtime dep (cron parser used by `SleepTimeReflectionPolicy`) | YES (v0.4a, ADR D10) | `package.json` post-v0.4a |
| `EvictionPolicy` DIP | NO | — gap addressed by this plan |
| `last_accessed_at` + `access_count` columns on `memories` | NO | — gap addressed by this plan |
| Automated eviction with Ebbinghaus decay + LRU/LFU + importance | NO | — gap addressed by this plan |
| Long-tail protection multiplier | NO (no cache-lit precedent) | — TheMemory innovation |
| `docs/forgetting-evaluation.md` artifact | NO | — CLAUDE.md Item 6 requirement |

### Why this matters NOW (motivation from blueprint synthesis)

1. **OPEN PROBLEM #1 empirically grounded.** Blueprint Q1+Q3+Q4 confirm Letta has ZERO automated eviction (9 `def delete_*` are caller-driven `hard_delete_async`); Q5 confirms Mem0 OSS has ZERO automated eviction (`delete`/`delete_all`/`_delete_memory` caller-driven; `MemoryQuotaExceededError` is hosted-SaaS only); Q6 confirms LangMem mentions strength conceptually but ships no equation, column, or scoring API. v0.4b's triadic-scored automatic forgetting WITH long-tail multiplier is innovation across ALL THREE primary competitors — exactly the "no competitor solved this" framing.
2. **v0.4a unlocks reuse.** v0.4a ships `llm_importance_score` (REUSED here) + content-hash cache (no extra LLM cost at eviction time) + `croner` (REUSED for `TimeBasedTrigger`). v0.4b builds on top WITHOUT new external deps.
3. **CLAUDE.md Roadmap Item 6 acceptance is testable today.** The 1000-memory seed + 50-rare-target evaluation maps cleanly onto vitest + real `ankane/pgvector:v0.5.1` Docker (v0.1 fixture). Greenfield test pyramid — no Letta/Mem0 precedent to mirror (Q1 negative-space finding).
4. **Soft-delete via `t_invalid` honors ADR-0006 (bi-temporal local schema) + ADR-0003 (ADD-only public API).** v0.4b is ADD-only-compatible: no new mutation primitive, just a `t_invalid = NOW()` write on auto-evicted rows. `recall()` already filters `WHERE t_invalid IS NULL` per v0.1 implementation.

### Discovery cross-reference

The blueprint at `.claude/knowledge-base/discoveries/blueprints/v0-4b-forgetting-pipeline-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89/100, scored 2026-05-26) is the technical source of truth for D7-D11 (HLR formula, additive scoring, long-tail multiplier formula, dual-trigger design, test pyramid). This plan ADOPTS those 5 ADRs by reference and adds 6 implementation-specific ADRs (D12-D17) below.

### Accepted Risks (declared upfront — v1.1 absorption EC-11 + EC-12)

- **EC-11 — Multi-process duplicate cron triggers (deployment-level, NOT v0.4b scope).** If TheMemory runs in N instances (cluster mode), each will have an active `TimeBasedTrigger` + each will fire eviction passes at the same cron tick. Result: N×30% eviction instead of 30%. Mitigation: distributed lock (Redis SETNX, Postgres advisory lock at process scope) OR single-leader pattern — **OUT OF SCOPE for v0.4b local-only runtime.** Documented as a v0.5 cloud-runtime concern. The risk is bounded by deployment shape: a single-process TheoCloud worker is the v0.5 baseline.
- **EC-12 — OpenAI cost for 1000-memory CI seed.** T7.1 seeds 1000 memories which v0.1's batch-embed pipeline batches to ~5-10 embedding API calls. With real OpenAI: ~$0.02 per CI run × 50 runs/month = ~$1/month. Mitigation: T7.1 fixture uses `StubEmbedder` (deterministic 1536-dim vectors derived from `hash(text)`) for CI; real-LLM run is a local-dev manual step before tagging a release. Real-LLM cost stays off CI.

### Compliance scope

Plan honors `architecture.md § 1` (three-tier scope unchanged — eviction operates per-scope), `§ 2` (ADD-only — auto-eviction = soft-delete, not mutation), `§ 3` (DIP — new `EvictionPolicy` interface lives in `src/core/dip/`, impls in `src/local/eviction/`), `§ 6` (kebab-case files, PascalCase types, camelCase functions). Honors `testing.md § Pyramid` (unit-dominant + integration with real pgvector + 1 acceptance E2E). Honors `dogfood-golden-rule.md` (v0.4b stays Planned until shipped; NO production-ready claim). Honors `deps-audit-golden-rule.md` (zero NEW deps adopted per blueprint Q2 Rule 9 verdict — ALL THREE npm candidates REJECTED for wrong-abstraction-layer reasons).

## Objective

- [ ] Sub-goal 1 — Add `EvictionPolicy` DIP at `src/core/dip/eviction-policy.ts` mirroring `ReflectionPolicy` v0.4a shape; types only, ZERO impl in `src/core/`
- [ ] Sub-goal 2 — Ship one `TriadicScoringPolicy` implementation at `src/local/eviction/triadic-scoring-policy.ts` parameterized by weights `{w_r, w_f, w_i}` + half-life base `h_base`
- [ ] Sub-goal 3 — Drizzle migration `0003_eviction_columns.sql` adds `last_accessed_at TIMESTAMPTZ`, `access_count INTEGER NOT NULL DEFAULT 0`, `half_life_seconds INTEGER` columns to `memories`
- [ ] Sub-goal 4 — `recall()` write-back hook updates `last_accessed_at = NOW()` + `access_count = access_count + 1` for every returned row (single batched UPDATE)
- [ ] Sub-goal 5 — Long-tail protection multiplier `clamp(0.1, 1.0, isolation_distance / mean_isolation_distance)` computed via pgvector cosine-distance nearest-neighbor at scoring time
- [ ] Sub-goal 6 — Two `EvictionTrigger` impls: `CapacityBasedTrigger({ maxMemoriesPerScope })` + `TimeBasedTrigger({ cronExpression, evictionFraction })` (REUSES `croner` from v0.4a)
- [ ] Sub-goal 7 — Auto-eviction performs soft-delete via `t_invalid = NOW()`, never physical DELETE
- [ ] Sub-goal 8 — Guardrail unit test: rare-isolated memory survives ≥ 5 consecutive `CapacityBasedTrigger` eviction passes against 100 frequent siblings
- [ ] Sub-goal 9 — THE GOAL TEST `tests/integration/forgetting/triadic-eviction.test.ts`: 1000 memories + 50 rare-targets + 30% eviction + `recall@10 ≥ 0.70` against real `ankane/pgvector:v0.5.1`
- [ ] Sub-goal 10 — `docs/forgetting-evaluation.md` artifact + `docs/forgetting-evaluation/run.ts` reproducible script committed
- [ ] Sub-goal 11 — Integration Validation: full chain (`npm test`, `npm run typecheck`, `npm run lint`, `npm run test:coverage`) green with zero regressions on v0.1 + v0.4a tests

## ADRs

### D1 — Inherit blueprint ADRs D7-D11 by reference; this plan extends them

**Decision:** The 5 ADRs locked in `.claude/knowledge-base/discoveries/blueprints/v0-4b-forgetting-pipeline-blueprint.md` (D7 HLR exponential `2^(-Δ/h)`, D8 ADDITIVE weighted sum, D9 long-tail multiplier `clamp(0.1, 1.0, isolation/mean)`, D10 capacity+time dual triggers, D11 3-tier test pyramid) ARE this plan's ADRs by reference. This plan adds 6 implementation-specific ADRs (D12-D17) below.

**Rationale:** The blueprint already documented alternatives + rationale + consequences for HLR vs power-law, additive vs multiplicative, multiplier vs exclusion list, capacity-only vs time-only, etc. Duplicating them here violates DRY. Cross-reference is preferable per `cycle-plan.md` Step 0 (read project rules) discipline.

**Alternatives considered:**

- (A) Re-state all 5 blueprint ADRs verbatim — REJECTED (DRY violation; 350 LoC of duplication).
- (B) Selected: cross-reference + extend.

**Consequences:** Readers reach for blueprint when reading D7-D11; this plan focuses on impl-shape decisions D12-D17.

### D12 — `EvictionPolicy` is a NEW 8th DIP at `src/core/dip/eviction-policy.ts` (ADR-0008's locked counts unchanged)

**Decision:** Add `EvictionPolicy` interface as the 8th DIP in `src/core/dip/`, alongside `VectorStore`, `LLM`, `Embedder`, `HistoryManager`, `ReflectionPolicy` (v0.4a), `ScoringStrategy` (v0.4a), `SkillRepresentationStrategy` (v0.6). Method count of the NEW interface is documented in this plan; ADR-0008's locked counts apply to the ORIGINAL 5 DIPs only — adding a NEW DIP is not a contract change to existing locked counts.

The interface (4 methods):

```ts
export interface EvictionPolicy {
  shouldEvict(scope: ScopeFilter, currentSize: number): Promise<boolean>;
  selectVictims(scope: ScopeFilter, fraction: number): Promise<MemoryId[]>;
  evict(ids: MemoryId[]): Promise<EvictionResult>;
  scoreMemory(memory: PersistedMemory, context: ScoreContext): Promise<number>;
}
```

**Rationale:**

- Same DIP discipline as v0.4a's `ReflectionPolicy` + `ScoringStrategy`; this is the 7th interface following the established shape.
- 4 methods separate the lifecycle: decision (`shouldEvict`), selection (`selectVictims`), execution (`evict`), scoring (`scoreMemory` exposed for testing). Mirrors `ReflectionPolicy`'s 4-method shape.
- `scoreMemory` is exposed (not private) because the guardrail test needs to invoke it directly to verify the multiplier (per CLAUDE.md Item 6 acceptance: "rare memory survives ≥ 5 consecutive passes").

**Alternatives considered:**

- (A) 1-method `evict()` blob — REJECTED (testability suffers; can't unit-test scoring math without forcing eviction).
- (B) 6+ methods (separate `applyMultiplier`, `lookupNearestNeighbor`, etc.) — REJECTED (leaks impl detail into interface).
- (C) Selected: 4 methods aligned with `ReflectionPolicy` shape.

**Consequences:**

- Adds an 8th DIP to `src/core/dip/index.ts` barrel.
- `src/local/eviction/triadic-scoring-policy.ts` implements all 4 methods; the impl is the ONE shipped strategy at v0.4b.

### D13 — Single Drizzle migration `0003_eviction_columns.sql` adds three columns + one index

**Decision:** ONE migration adds three columns to `memories`:

```sql
ALTER TABLE memories
  ADD COLUMN last_accessed_at TIMESTAMPTZ,
  ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN half_life_seconds INTEGER;

CREATE INDEX idx_memories_eviction_score ON memories (
  (CASE WHEN t_invalid IS NULL THEN 1 ELSE 0 END),
  last_accessed_at
) WHERE t_invalid IS NULL;
```

Rows from v0.1 + v0.4a backfill as `last_accessed_at = NULL`, `access_count = 0`, `half_life_seconds = NULL`. Backfill logic: `NULL last_accessed_at` is treated as "never accessed" → equivalent to `recency_component = 0` (eviction-favorable, per fail-graceful design).

**Rationale:**

- Single migration = atomic schema change; matches v0.4a's `0001_reflection_columns.sql` pattern.
- Partial index `WHERE t_invalid IS NULL` keeps eviction queries fast on active memories only.
- `half_life_seconds INTEGER` is nullable — backfilled rows compute `h` from `llm_importance_score` at scoring time (D14), avoiding a backfill UPDATE on v0.4a rows.

**Alternatives considered:**

- (A) Two migrations (one per scope concern) — REJECTED (atomicity matters for `npm run db:migrate` on shared dev DB).
- (B) Backfill `last_accessed_at = created_at` — REJECTED (creates false LRU signal; new memory at t=0 would tie with a fresh access at t=0).
- (C) Selected: three columns + one partial index.

**Consequences:**

- Migration ≈ 15 LoC SQL + Drizzle TS schema update ≈ 10 LoC additions to `src/local/schema.ts`.
- Tests must reset schema between runs (existing `tests/integration/setup.ts` pattern from v0.1).

### D14 — `half_life_seconds` derived from `llm_importance_score` at scoring time (lazy backfill)

**Decision:** When a row has `half_life_seconds = NULL` (v0.1 / v0.4a backfill), compute it lazily at scoring time using the formula:

```
h = h_base * (0.1 + 2.9 * llm_importance_score)
```

Where `llm_importance_score ∈ [0, 1]` (v0.4a ADR D5/D11 contract) and `h_base = 30 days` default. This yields `h ∈ [0.1 × h_base, 3 × h_base] = [3 days, 90 days]` matching the blueprint's recommended starting constants.

On first auto-eviction pass that scores a row with `NULL half_life_seconds`, persist the computed value back via UPDATE (one-time backfill per memory). Subsequent scoring reuses persisted value.

**Rationale:**

- Avoids a heavy backfill migration on potentially-large v0.1/v0.4a tables.
- Lazy backfill spreads cost across normal eviction sweeps; idempotent.
- Formula `0.1 + 2.9 * importance` is monotonic in importance, bounded, matches blueprint's `[0.1×, 3×]` factor table.

**Alternatives considered:**

- (A) Eager backfill on migration — REJECTED (UPDATE on every row of a large table; long migration; locks).
- (B) Recompute every scoring call (never persist) — REJECTED (wastes the column; non-stable scoring across calls if importance changes via re-extraction).
- (C) Selected: lazy backfill + persist on first scoring.

**Consequences:**

- `TriadicScoringPolicy.scoreMemory` has a small UPDATE side-effect on first call per row. Acceptable; idempotent.
- Tests for D14: unit test for formula bounds + integration test for lazy-persist behavior.

### D15 — `recall()` write-back hook batches LRU/LFU updates per call (single UPDATE)

**Decision:** Modify `src/local/pgvector-store.ts` `search()` to issue ONE batched UPDATE after the SELECT returns:

```sql
UPDATE memories
SET last_accessed_at = NOW(), access_count = access_count + 1
WHERE id = ANY($1::uuid[]);
```

Where `$1` is the array of IDs returned by `recall()`. The UPDATE fires AFTER results are returned to the caller (not blocking the response path — fire-and-forget with telemetry log on failure per `architecture.md § 9 Error Handling`).

**Rationale:**

- ONE round-trip per `recall()` (whether it returns 1 row or 10 rows). Critical for latency budget.
- `ANY($1::uuid[])` is the idiomatic Postgres batch update.
- Failure of LRU/LFU update is NOT user-facing error — eviction degrades gracefully (stale recency → slightly skewed eviction-score; not data loss).

**Alternatives considered:**

- (A) Per-row UPDATE inside SELECT loop — REJECTED (N+1 anti-pattern; 10× the latency).
- (B) Materialized view + background sweep — REJECTED (extra schema; complexity not justified for v0.4b commodity).
- (C) Bypass via TRIGGER on SELECT — Postgres does NOT support SELECT triggers; option doesn't exist.
- (D) Selected: batched UPDATE post-SELECT.

**Consequences:**

- `pgvector-store.ts:search()` gains ≈ 8 LoC for the batched UPDATE + telemetry hook.
- Integration test verifies `access_count` increments by 1 per `recall()` hit.

### D16 — Long-tail multiplier uses pgvector `<=>` operator (cosine distance) for nearest-neighbor lookup

**Decision:** The protection multiplier (blueprint D9) computes `isolation_distance = cosine_distance(memory, nearest_neighbor_within_scope)` via a single SQL query per memory at scoring time:

```sql
SELECT 1 - (m.embedding <=> $1::vector) AS cosine_similarity
FROM memories m
WHERE m.scope_filter = $2 AND m.id != $3 AND m.t_invalid IS NULL
ORDER BY m.embedding <=> $1::vector ASC
LIMIT 1;
```

`isolation_distance = 1 - cosine_similarity`. Aggregate `mean_isolation_distance` computed once per scope per eviction pass (cached for the pass duration).

**Rationale:**

- pgvector v0.5.1 already supports `<=>` operator (verified v0.1 schema); no extension needed.
- HNSW index from v0.1 makes nearest-neighbor lookup `O(log N)` per memory; for 1000-memory scope → ≈ 10ms × 1000 = ≈ 10s for full eviction pass scoring. Acceptable for cron-driven `TimeBasedTrigger`; for `CapacityBasedTrigger` the pass scores only the LOWEST-`access_count` rows (≈ 30% of scope, not 100%).
- Scope-filter narrows the query to current scope only (no cross-scope contamination).

**Alternatives considered:**

- (A) Compute isolation distance offline at write time — REJECTED (would require N×(N-1) pairwise computes per scope on every write; quadratic blow-up).
- (B) Use embedding centroid + distance-to-centroid — REJECTED (centroid drifts as memories accrete; less stable signal than nearest-neighbor).
- (C) Selected: per-scoring lazy lookup via pgvector `<=>`.

**Consequences:**

- One additional query per scored memory at eviction time. Budgeted (see D11 budget table in blueprint).
- Tests for D16: unit test for multiplier clamp + integration test for nearest-neighbor correctness against pgvector.

### D18 — `InMemoryVectorStore` MUST support cosine-distance nearest-neighbor (linear-scan); else T7.2 promoted to integration tier (EC-3 absorbed)

**Decision:** Before T7.2 starts, verify `InMemoryVectorStore` (v0.1 adapter) supports `findNearestNeighbor(scope, queryVector, { excludeIds })` returning cosine-distance. If absent: ADD ≈ 15-LoC O(N) linear scan to it in T4.1 (as part of the eviction barrel). If the addition would push `InMemoryVectorStore` beyond its KISS scope, PROMOTE T7.2 to integration tier (real `ankane/pgvector:v0.5.1` container).

**Rationale:** EC-3 surfaced that T7.2's "unit tier with in-memory adapter" assumption silently breaks if the adapter can't service the long-tail multiplier query — the test would pass for wrong reasons. Belt-and-suspenders: verify capability OR move to integration.

**Alternatives considered:**

- (A) Stub the multiplier in T7.2 (assume `multiplier = 1.0`) — REJECTED (T7.2's whole purpose is verifying the multiplier protects rare items).
- (B) Add 15 LoC linear-scan to `InMemoryVectorStore` — PREFERRED (keeps unit-tier velocity).
- (C) Promote T7.2 to integration tier (Docker) — FALLBACK (if (B) violates the adapter's KISS scope).

**Consequences:**

- If (B): T4.1 grows by 15 LoC + 1 RED test verifying linear-scan correctness.
- If (C): T7.2 runtime grows from < 500ms to ≈ 30s (Docker startup); acceptable but slower feedback.

### D17 — Auto-eviction uses `t_invalid = NOW()` UPDATE, never `DELETE FROM memories`

**Decision:** `EvictionPolicy.evict(ids)` performs:

```sql
UPDATE memories
SET t_invalid = NOW()
WHERE id = ANY($1::uuid[]) AND t_invalid IS NULL;
```

Returns `EvictionResult { soft_deleted: number, already_invalid: number, errors: EvictionError[] }`. NEVER calls `DELETE FROM memories`. Physical GC pass (deleting rows where `t_invalid < NOW() - INTERVAL '30 days'`) is OUT OF SCOPE for v0.4b (deferred to v0.5+ per blueprint D6 consequences).

**Rationale:**

- ADR-0006 (bi-temporal local schema) already established `t_invalid` semantics; v0.4b REUSES.
- Soft-delete preserves audit trail (Inquebrável Rule 3 — extreme honesty: "why did this memory go missing?" stays answerable).
- `recall()` already filters `WHERE t_invalid IS NULL` per v0.1 implementation — zero change to recall path.
- Physical GC out-of-scope avoids the "when to actually delete" debate (compliance / privacy / regret considerations not in scope at v0.4b).

**Alternatives considered:**

- (A) Physical DELETE — REJECTED (loses audit trail; v0.1 contract preserved otherwise).
- (B) Move to `evicted_memories` table — REJECTED (extra schema; same outcome as soft-delete; cross-table JOIN for history).
- (C) Selected: `t_invalid` soft-delete.

**Consequences:**

- `forget(id)` public API (v0.1) ALSO uses `t_invalid` UPDATE (already true) — auto-eviction is consistent with caller-driven forget.
- Test: integration verifies row remains queryable via `WHERE t_invalid IS NOT NULL` after auto-eviction.

## Dependency Graph

```
Phase T0: Pre-flight + Drizzle migration (D13)
   │
   ▼
Phase T1: EvictionPolicy DIP (D12)  ──┐
   │                                  │
   ▼                                  ▼
Phase T2: TriadicScoringPolicy impl (D14, D16) — additive math + lazy half_life backfill
   │
   ▼
Phase T3: recall() write-back hook (D15) — LRU/LFU bookkeeping
   │
   ▼
Phase T4: Long-tail multiplier integration (D16) — pgvector nearest-neighbor
   │
   ▼
Phase T5: EvictionTrigger impls — CapacityBasedTrigger + TimeBasedTrigger
   │
   ▼
Phase T6: Soft-delete via t_invalid (D17) — auto-eviction execution path
   │
   ▼
Phase T7: THE GOAL TEST + guardrail (acceptance)
   │
   ▼
Phase T8: Integration Validation (mandatory)
```

T1 can start in parallel with T0 once T0.1 (migration drafted) is reviewed. T2-T7 are sequential.

---

## Phase T0: Pre-flight + schema

**Objective:** Land the Drizzle migration adding 3 columns + 1 partial index; verify v0.4a was merged first (PRE-REQ).

### T0.1 — Verify v0.4a shipped + draft `0003_eviction_columns.sql`

#### Objective
Confirm v0.4a is in `plans/completed/` (PR merged); draft the migration adding `last_accessed_at`, `access_count`, `half_life_seconds` + partial index.

#### Evidence
v0.4a discovery blueprint (companion file, SHIPPABLE_WITH_CAVEATS 89/100) ships `llm_importance_score` column. v0.4b REUSES (per blueprint D14). The PRE-REQ check is non-negotiable: without v0.4a, v0.4b's lazy backfill in D14 cannot reference an existing column.

#### Files to edit
```
src/local/migrations/0003_eviction_columns.sql — NEW: ALTER TABLE + CREATE INDEX
src/local/schema.ts — UPDATE: add 3 new column definitions to memories table
src/local/__tests__/schema.test.ts — RED test added first: assert 3 columns present + index exists
```

#### Deep file dependency analysis

- `src/local/schema.ts` (v0.4a-post): defines `memories` table via Drizzle pgTable. v0.4b ADD 3 columns. Downstream: every file importing `memories` schema (`pgvector-store.ts`, `dedup.ts`, `__tests__/*.test.ts`).
- `src/local/migrations/0001_reflection_columns.sql` (v0.4a precedent): same shape we follow.
- `tests/integration/setup.ts`: schema-reset between tests — automatically picks up new migration via `drizzle-kit push`.

#### Deep Dives

- **Migration ordering:** `0003_eviction_columns.sql` MUST run after `0002_skill_columns.sql` (the immediate lex-order predecessor as of 2026-05-30 — v0.6 shipped `0002_skill_columns.sql`). Drizzle file-naming convention enforces; CI fails fast on out-of-order migrations.
- **Partial index:** `WHERE t_invalid IS NULL` keeps the index small (active memories only); the index is keyed on the eviction-relevant fields.
- **Backfill:** `access_count INTEGER NOT NULL DEFAULT 0` is set in DDL — Postgres ALTER ADD COLUMN with DEFAULT is fast (no full table rewrite in Postgres 11+; metadata-only operation).

#### Tasks

1. Verify `.claude/knowledge-base/plans/completed/v0-4a-reflection-pipeline-plan.md` exists. If NOT, HALT with honest report — v0.4b cannot proceed.
2. Write RED test in `src/local/__tests__/schema.test.ts`: assert `memories.last_accessed_at`, `memories.access_count`, `memories.half_life_seconds` columns exist; assert index `idx_memories_eviction_score` exists.
3. Run RED — confirms test fails.
4. Write migration SQL in `src/local/migrations/0003_eviction_columns.sql`.
5. Update Drizzle schema in `src/local/schema.ts`.
6. Run GREEN — `drizzle-kit push` + test passes.
7. REFACTOR: ensure SQL formatting matches `0001_reflection_columns.sql` style.

#### TDD

```
RED:      test_memories_has_last_accessed_at_column — schema introspection
RED:      test_memories_has_access_count_column_with_default_zero
RED:      test_memories_has_half_life_seconds_nullable
RED:      test_idx_memories_eviction_score_exists
GREEN:    Write SQL migration + Drizzle schema update
REFACTOR: Format-match against 0001_reflection_columns.sql
VERIFY:   npm test -- src/local/__tests__/schema.test.ts
```

#### Acceptance Criteria

- [ ] `v0-4a-reflection-pipeline-plan.md` is in `plans/completed/` (PRE-REQ check)
- [ ] Migration file applies cleanly via `drizzle-kit push` against fresh `ankane/pgvector:v0.5.1` container
- [ ] All 4 RED tests now GREEN
- [ ] Pass: complexity ≤ 10 per file
- [ ] Pass: coverage ≥ 90% on changed files
- [ ] Pass: lint zero warnings
- [ ] Pass: size — `0003_eviction_columns.sql` ≤ 30 LoC, `schema.ts` additions ≤ 20 LoC

#### DoD

- [ ] All tasks complete and validated
- [ ] `npm test -- src/local/__tests__/schema.test.ts` green
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings

---

## Phase T1: `EvictionPolicy` DIP

**Objective:** Define the 8th DIP interface in `src/core/dip/` mirroring `ReflectionPolicy` shape.

### T1.1 — `EvictionPolicy` interface at `src/core/dip/eviction-policy.ts`

#### Objective
4-method `EvictionPolicy` interface + `EvictionResult`, `ScoreContext`, `EvictionError` supporting types. Pure types — ZERO impl in `src/core/`.

#### Evidence
Blueprint D12: 4-method shape locked. v0.4a `ReflectionPolicy` (`src/core/dip/reflection-policy.ts`) is the precedent we mirror.

#### Files to edit
```
src/core/dip/eviction-policy.ts — NEW: EvictionPolicy interface + types
src/core/dip/index.ts — UPDATE: add `export * from './eviction-policy'`
src/core/__tests__/dip-eviction-policy.test.ts — RED test: type-shape contract test
```

#### Deep file dependency analysis

- `src/core/dip/index.ts` (v0.4a-post): re-exports 6 DIPs. v0.4b ADD a 7th.
- `src/core/types.ts` (v0.1): defines `MemoryId`, `ScopeFilter`, `PersistedMemory`. v0.4b reuses; no change to those.

#### Deep Dives

- **`ScoreContext`** carries the per-scope mean-isolation-distance + the current time (`now`) so scoring is deterministic given the context. NO global clock dependency in the interface.
- **`EvictionResult`** distinguishes `soft_deleted` (successful) from `already_invalid` (no-op because row already had `t_invalid`) and `errors[]` (transient SQL failures per row).
- **Importantly**: `selectVictims` accepts `fraction: number` (0-1) NOT an absolute count. Triggers compute the fraction; policies just translate to "score all candidates, return bottom-N".

#### Tasks

1. RED test: import `EvictionPolicy` interface; assert shape (4 methods + correct signatures).
2. Write interface + supporting types.
3. Update barrel `src/core/dip/index.ts`.
4. GREEN — types compile.
5. REFACTOR: ensure JSDoc on each method names the corresponding blueprint ADR.

#### TDD

```
RED:      test_eviction_policy_interface_shape — 4 methods present + correct param/return types
RED:      test_eviction_result_type_shape — fields: soft_deleted, already_invalid, errors
RED:      test_score_context_type_shape — fields: mean_isolation_distance, now
RED:      test_select_victims_rejects_invalid_fraction — EC-5: fraction < 0 OR > 1 throws InvalidFractionError
GREEN:    Write interface + types + runtime fraction-guard helper
REFACTOR: JSDoc cross-ref blueprint D12
VERIFY:   npm test -- src/core/__tests__/dip-eviction-policy.test.ts && npm run typecheck
```

#### Acceptance Criteria

- [ ] All 3 RED tests now GREEN
- [ ] `src/core/dip/index.ts` re-exports `EvictionPolicy` + types
- [ ] No import from `src/local/` or `src/cloud/` (DIP rule per `architecture.md § 3`)
- [ ] Pass: complexity / coverage / lint / size as Phase T0

#### DoD

- [ ] `npm test -- src/core/__tests__/dip-eviction-policy.test.ts` green
- [ ] Boundary-check hook does NOT flag the new file

---

## Phase T2: `TriadicScoringPolicy` impl

**Objective:** Ship one `EvictionPolicy` implementation at `src/local/eviction/triadic-scoring-policy.ts` with HLR exponential + additive weighted sum + lazy half_life backfill.

### T2.1 — `TriadicScoringPolicy` core scoring math

#### Objective
Implement `scoreMemory(memory, ctx)` returning a number in [0, 1]; pure math first, no SQL.

#### Evidence
Blueprint D7 (HLR formula), D8 (additive), D9 (multiplier formula), D14 (lazy backfill). Pure functions are unit-testable; defer SQL touches to T2.2.

#### Files to edit
```
src/local/eviction/triadic-scoring-policy.ts — NEW: TriadicScoringPolicy class + scoring math
src/local/eviction/types.ts — NEW: TriadicWeights, TriadicConstants types
src/local/eviction/__tests__/scoring-math.test.ts — RED tests: per-dimension correctness + clamp + additive sum
```

#### Deep file dependency analysis

- `src/local/eviction/` is a NEW directory; create barrel `src/local/eviction/index.ts` re-exporting the policy + types.
- `src/core/dip/eviction-policy.ts` (T1.1): T2.1 implements this interface.
- `src/local/schema.ts` (T0.1): typed columns referenced via Drizzle inference.

#### Deep Dives

- **`recency_component`:** `recency = 1 - 2^(-Δ/h)` so high recency-score = recently accessed (i.e., eviction-score CONTRIBUTOR for retention). `Δ = (now - last_accessed_at)`. Handle NULL `last_accessed_at` → `recency = 0` (eviction-favorable, per D13 fail-graceful).
- **`frequency_component`:** `frequency = ln(1 + access_count) / ln(1 + ACCESS_COUNT_NORM)` clamped to [0, 1]. `ACCESS_COUNT_NORM = 100` default (calibrate per project).
- **`importance_component`:** direct `llm_importance_score ∈ [0, 1]` (v0.4a contract). NULL → 0.5 default (neutral).
- **`score = w_r·recency + w_f·frequency + w_i·importance`** with weights normalized to sum=1. Default `w_r=0.4, w_f=0.2, w_i=0.4`.
- **`half_life_seconds` resolution:** if row has it, use; else compute via D14 formula `h = h_base × (0.1 + 2.9 × importance)`.

#### Tasks

1. RED tests for each component (recency boundary cases NULL/0/very-old, frequency clamp, importance NULL fallback, additive sum, weight normalization).
2. RED test for full `scoreMemory` returning a value in [0, 1].
3. Write impl (pure math; no SQL yet).
4. GREEN.
5. REFACTOR: extract `computeHalfLife(importance, h_base)` helper for testability.

#### TDD

```
RED:      test_recency_zero_when_last_accessed_null
RED:      test_recency_approaches_one_for_just_accessed
RED:      test_recency_approaches_zero_for_long_idle
RED:      test_frequency_zero_at_access_count_zero
RED:      test_frequency_clamped_at_one_above_norm
RED:      test_importance_default_when_null
RED:      test_score_is_weighted_sum_of_three_components
RED:      test_weight_normalization_enforced
RED:      test_compute_half_life_monotonic_in_importance
RED:      test_score_throws_when_all_weights_zero — EC-6: {w_r:0, w_f:0, w_i:0} fails weight-normalization with InvalidWeightsError
RED:      test_frequency_handles_null_access_count_as_zero — EC-7: defensive (access_count ?? 0) for pre-v0.4b malformed rows
GREEN:    Implement scoreMemory + helpers + weight-zero guard + null-safe frequency
REFACTOR: Extract helpers; JSDoc cross-ref blueprint D7+D8+D14
VERIFY:   npm test -- src/local/eviction/__tests__/scoring-math.test.ts
```

#### Acceptance Criteria

- [ ] All 9 RED tests now GREEN
- [ ] No I/O in this task (pure math) — `scoreMemory` may accept resolved `half_life_seconds` from the caller of the next task (T2.2)
- [ ] Coverage: 100% on `scoring-math.ts` (it's the critical-path math)
- [ ] Pass: complexity ≤ 10 per function
- [ ] Pass: lint / size

#### DoD

- [ ] `npm test -- src/local/eviction/__tests__/scoring-math.test.ts` green
- [ ] `npm run typecheck` zero errors

### T2.2 — Lazy `half_life_seconds` backfill on first scoring

#### Objective
When a memory has `half_life_seconds = NULL`, compute via D14 formula AND persist via UPDATE.

#### Evidence
Blueprint D14: lazy backfill avoids heavy migration UPDATE.

#### Files to edit
```
src/local/eviction/triadic-scoring-policy.ts — extend with persistHalfLife() method
src/local/eviction/__tests__/lazy-half-life.test.ts — RED integration test against real pgvector
```

#### Deep file dependency analysis

- This task introduces SQL touches (the first I/O in T2). Use the existing pgvector test container (v0.1 fixture).
- Idempotency: if row already has `half_life_seconds`, NO UPDATE — read the persisted value.

#### Deep Dives

- **UPDATE clause:** `UPDATE memories SET half_life_seconds = $1 WHERE id = $2 AND half_life_seconds IS NULL` — the `IS NULL` guard makes the UPDATE idempotent.
- **Concurrent-call safety:** two parallel scoring calls on the same memory may both compute + persist the same value (deterministic given importance unchanged). No race condition risk.
- **EC-1 absorption (stale half_life on importance update):** if `llm_importance_score` is later UPDATEd by re-extraction (rare v0.4a path), `half_life_seconds` becomes stale (still tied to old importance). Mitigation: whenever ANY UPDATE touches `llm_importance_score`, the SAME statement sets `half_life_seconds = NULL` so the next scoring re-backfills. Add Postgres trigger OR Drizzle middleware (decide at impl) that enforces invariant `UPDATE memories SET llm_importance_score = $1, half_life_seconds = NULL WHERE id = $2`. Acceptance: `test_half_life_reset_on_importance_update` RED test (see TDD below).

#### Tasks

1. RED integration test: seed a memory with `half_life_seconds=NULL` + `llm_importance_score=0.8`; call `scoreMemory`; assert row now has `half_life_seconds = floor(30 days × (0.1 + 2.9 × 0.8) × 86400) seconds`.
2. RED idempotency test: call `scoreMemory` twice; assert UPDATE count = 1 (not 2).
3. Implement `persistHalfLife`.
4. GREEN.
5. REFACTOR: extract SQL string constant.

#### TDD

```
RED:      test_lazy_backfill_persists_half_life_on_first_score
RED:      test_lazy_backfill_idempotent_no_double_update
RED:      test_score_uses_persisted_half_life_on_subsequent_call
RED:      test_half_life_reset_on_importance_update — EC-1: UPDATE importance forces half_life = NULL; next score recomputes
GREEN:    Implement persistHalfLife + importance-update invariant
REFACTOR: SQL constant
VERIFY:   npm test -- src/local/eviction/__tests__/lazy-half-life.test.ts
```

#### Acceptance Criteria

- [ ] All 3 RED tests now GREEN against real pgvector
- [ ] UPDATE count == 1 across two calls on same memory
- [ ] Pass: complexity / coverage / lint / size

#### DoD

- [ ] `npm test -- src/local/eviction/__tests__/lazy-half-life.test.ts` green
- [ ] Wiring triad: `persistHalfLife` called from `scoreMemory` (caller present); integration test covers (b); telemetry log on UPDATE failure (c)

---

## Phase T3: `recall()` write-back hook (LRU/LFU bookkeeping)

**Objective:** `recall()` updates `last_accessed_at` + `access_count` for returned rows.

### T3.1 — Batched UPDATE post-recall

#### Objective
Modify `src/local/pgvector-store.ts:search()` to issue ONE batched UPDATE after SELECT returns.

#### Evidence
Blueprint D15: single UPDATE batched across all hit IDs; fire-and-forget pattern.

#### Files to edit
```
src/local/pgvector-store.ts — extend search() with batched UPDATE
tests/integration/forgetting/recall-bookkeeping.test.ts — RED test: assert access_count++ per recall hit
```

#### Deep file dependency analysis

- `pgvector-store.ts:search()` (v0.1, modified at v0.4a for additive scoring) — v0.4b ADDS post-SELECT UPDATE.
- All `recall()` consumer paths (`memory-store.ts`, `theokit` binding, `agent-tools/recall-handler.ts`) — unchanged; the hook is internal to the store.

#### Deep Dives

- **Fire-and-forget telemetry:** on UPDATE failure, `console.warn` + telemetry counter `theo.memory.lru_update_failures`. Per `architecture.md § 9 Error Handling`: log + degrade gracefully; LRU/LFU bookkeeping is best-effort, not invariant.
- **Empty result-set:** if `search` returns 0 rows, SKIP the UPDATE (no IDs to update). Microbench: avoids the 1-row Postgres roundtrip.
- **Test isolation:** before each integration test, RESET `access_count = 0` for the seeded test memories (avoid cross-test contamination).

#### Tasks

1. RED integration test: seed 5 memories; call `recall(query)` returning 3 rows; assert those 3 rows have `access_count = 1` + non-NULL `last_accessed_at`.
2. RED edge case: `recall` returning 0 rows — assert NO UPDATE fires.
3. Implement batched UPDATE in `search()`.
4. GREEN.
5. REFACTOR: extract `recordAccess(ids)` private method.

#### TDD

```
RED:      test_recall_increments_access_count_for_each_returned_row
RED:      test_recall_sets_last_accessed_at_to_now
RED:      test_recall_zero_results_no_update_fires
RED:      test_recall_update_failure_does_not_crash_caller
RED:      test_recall_update_dedupes_ids_no_double_increment — EC-8: WITH dedup AS (SELECT DISTINCT unnest($1)) prevents double-increment if results contain dupes
GREEN:    Implement batched UPDATE + DISTINCT dedup + telemetry
REFACTOR: Extract recordAccess() private method
VERIFY:   npm test -- tests/integration/forgetting/recall-bookkeeping.test.ts
```

#### Acceptance Criteria

- [ ] All 4 RED tests GREEN against real pgvector
- [ ] `recall()` latency overhead ≤ 5ms (measured against v0.4a baseline)
- [ ] Pass: complexity / coverage / lint / size

#### DoD

- [ ] Integration test green
- [ ] `npm run typecheck` + `npm run lint` zero errors
- [ ] Telemetry counter exposed via OTel (existing v0.1 wiring)

---

## Phase T4: Long-tail multiplier integration

**Objective:** `TriadicScoringPolicy.scoreMemory` multiplies result by `clamp(0.1, 1.0, isolation/mean_isolation)` per blueprint D9.

### T4.1 — Nearest-neighbor cosine-distance query

#### Objective
Add `nearestNeighborDistance(memoryId, scope)` to `TriadicScoringPolicy` — single SQL via pgvector `<=>`.

#### Evidence
Blueprint D9 + D16: pgvector `<=>` operator; HNSW index makes `O(log N)` per memory.

#### Files to edit
```
src/local/eviction/triadic-scoring-policy.ts — extend with nearestNeighborDistance() method
src/local/eviction/__tests__/nearest-neighbor.test.ts — RED test
```

#### Deep Dives

- **SQL:** `SELECT 1 - (m.embedding <=> $1::vector) FROM memories m WHERE m.scope = $2 AND m.id != $3 AND m.t_invalid IS NULL ORDER BY m.embedding <=> $1::vector ASC LIMIT 1;`
- **`isolation_distance = 1 - cosine_similarity`** → `[0, 2]` range; clamp to [0, 1] for the multiplier formula.
- **Empty-scope edge case:** if scope has only 1 memory (the one being scored), `isolation_distance = 1.0` (max isolation; full protection). Test this.

#### Tasks

1. RED test: seed 3 memories with known embeddings; assert nearest-neighbor returns the geometrically-closest one.
2. RED edge case: scope with 1 memory only → `isolation_distance = 1.0`.
3. Implement.
4. GREEN.
5. REFACTOR: extract `MIN_ISOLATION` + `MAX_ISOLATION` constants.

#### TDD

```
RED:      test_nearest_neighbor_returns_geometrically_closest
RED:      test_isolation_distance_one_for_singleton_scope
RED:      test_excludes_self_from_neighbor_search
RED:      test_excludes_invalidated_rows_from_neighbor_search
GREEN:    Implement nearestNeighborDistance
REFACTOR: Constants for clamp bounds
VERIFY:   npm test -- src/local/eviction/__tests__/nearest-neighbor.test.ts
```

#### Acceptance Criteria

- [ ] All 4 RED tests GREEN
- [ ] HNSW index used (verify via `EXPLAIN ANALYZE`)
- [ ] Pass: complexity / coverage / lint / size

### T4.2 — Multiplier integration into `scoreMemory`

#### Objective
Combine D9 multiplier with T2.1 additive score; the eviction-score consumed by `selectVictims` is `score × multiplier`.

#### Files to edit
```
src/local/eviction/triadic-scoring-policy.ts — extend scoreMemory + selectVictims
src/local/eviction/__tests__/multiplier-integration.test.ts — RED test
```

#### Deep Dives

- **`mean_isolation_distance` per pass:** computed ONCE per `selectVictims` invocation across all candidate memories of that pass. Cached in `ScoreContext`. NOT per-memory recompute.
- **Clamp formula:** `protection_multiplier = max(0.1, min(1.0, isolation_distance / mean_isolation_distance))`.
- **Multiplier semantics:** LOWER multiplier = STRONGER protection (lower eviction-score = stays longer). At multiplier=0.1, the memory effectively gets a 10× score advantage relative to baseline (=1.0).

#### Tasks

1. RED test: 2 memories with same triadic score; one in dense cluster (low isolation), one isolated (high isolation); assert the isolated one survives a `selectVictims(fraction=0.5)` call.
2. Implement multiplier in scoreMemory.
3. GREEN.
4. REFACTOR: cache `mean_isolation_distance` on `ScoreContext`.

#### TDD

```
RED:      test_isolated_memory_survives_when_score_tied_with_clustered_sibling
RED:      test_multiplier_clamped_to_0_1
RED:      test_mean_isolation_computed_once_per_pass
GREEN:    Apply multiplier in scoreMemory
REFACTOR: Cache mean_isolation_distance in ScoreContext
VERIFY:   npm test -- src/local/eviction/__tests__/multiplier-integration.test.ts
```

#### Acceptance Criteria

- [ ] 3 RED tests GREEN
- [ ] Pass: complexity / coverage / lint / size

---

## Phase T5: `EvictionTrigger` impls (capacity + time)

**Objective:** Ship `CapacityBasedTrigger` + `TimeBasedTrigger` per blueprint D10.

### T5.1 — `CapacityBasedTrigger`

#### Objective
On `remember()` write, check `count(memories WHERE scope) > maxMemoriesPerScope`; if so, invoke `EvictionPolicy.selectVictims(fraction=overflow/total)` + `evict()`.

#### Files to edit
```
src/local/eviction/capacity-based-trigger.ts — NEW
src/local/eviction/__tests__/capacity-trigger.test.ts — RED integration test
```

#### Deep Dives

- **Hook into `remember()`:** post-write COUNT query; on overflow trigger eviction synchronously (foreground responsiveness expected).
- **`overflow_fraction = (current_size - maxMemoriesPerScope) / current_size`** capped at 0.5 (never evict more than 50% in one pass).
- **EC-2 absorption (concurrent overflow race):** two concurrent `remember()` writes could BOTH see count > capacity and BOTH trigger 30% eviction → over-evict to 60% loss. Mitigation: `SELECT pg_try_advisory_xact_lock(hashtext($scope))` BEFORE the COUNT+evict path; if lock not acquired, SKIP eviction this pass (the other writer's eviction will resolve the overflow). Lock auto-released at transaction commit. ≤ 5 LoC added. Acceptance: `test_concurrent_remember_does_not_double_evict` RED test (see TDD).

#### Tasks

1. RED test: seed 100 memories (cap = 50); write 1 more; assert post-write count == 50 (50 evicted via `t_invalid`).
2. Implement.
3. GREEN.
4. REFACTOR: extract `computeOverflowFraction` for testability.

#### TDD

```
RED:      test_capacity_trigger_fires_on_overflow
RED:      test_capacity_trigger_evicts_lowest_score_memories
RED:      test_capacity_trigger_caps_eviction_fraction_at_half
RED:      test_capacity_trigger_no_op_when_below_threshold
RED:      test_concurrent_remember_does_not_double_evict — EC-2: two concurrent writes share scope, advisory lock serializes eviction
GREEN:    Implement CapacityBasedTrigger + pg_try_advisory_xact_lock guard
REFACTOR: Helper for overflow_fraction
VERIFY:   npm test -- src/local/eviction/__tests__/capacity-trigger.test.ts
```

#### Acceptance Criteria

- [ ] 4 RED tests GREEN
- [ ] Pass: complexity / coverage / lint / size

### T5.2 — `TimeBasedTrigger` (cron via `croner`)

#### Objective
Cron-scheduled background eviction passing `fraction=0.30` per CLAUDE.md Item 6 acceptance.

#### Files to edit
```
src/local/eviction/time-based-trigger.ts — NEW (REUSES `croner` from v0.4a)
src/local/eviction/__tests__/time-trigger.test.ts — RED test
```

#### Deep Dives

- **`croner` reuse:** v0.4a's `SleepTimeReflectionPolicy` already pulled `croner`. v0.4b imports the SAME instance pattern; ZERO new runtime dep (honors blueprint Q2 Rule 9: ALL THREE npm candidates REJECTED).
- **Test pattern:** override cron expression via config to fire on-demand (NOT clock mocking — per v0.4a EC-4 precedent reinforced in blueprint D11).

#### Tasks

1. RED test: configure trigger with cron `* * * * * *` (every second) + `evictionFraction=0.30`; seed 100 memories; wait 2s; assert ≈ 30 evicted (within ±5).
2. Implement using `croner` Cron schedule.
3. GREEN.
4. REFACTOR: extract `runEvictionPass(fraction)` reusable helper.

#### TDD

```
RED:      test_time_trigger_fires_per_cron_schedule
RED:      test_time_trigger_evicts_configured_fraction
RED:      test_time_trigger_lifecycle_start_stop
RED:      test_croner_supports_second_level_cron_or_fallback — EC-9: assert `new Cron('* * * * * *')` parses; if not, fallback to 5-field `* * * * *` minute-cron + test runtime adjusts to 90s
GREEN:    Implement TimeBasedTrigger + 6-field/5-field guard at construction
REFACTOR: Helper for runEvictionPass
VERIFY:   npm test -- src/local/eviction/__tests__/time-trigger.test.ts
```

#### Acceptance Criteria

- [ ] 3 RED tests GREEN
- [ ] Pass: complexity / coverage / lint / size

---

## Phase T6: Soft-delete via `t_invalid` (D17)

**Objective:** `EvictionPolicy.evict(ids)` UPDATE-soft-deletes; never DELETEs.

### T6.1 — `evict()` impl + `EvictionResult` contract

#### Files to edit
```
src/local/eviction/triadic-scoring-policy.ts — extend with evict() method
src/local/eviction/__tests__/evict-soft-delete.test.ts — RED test
```

#### Deep Dives

- **`UPDATE memories SET t_invalid = NOW() WHERE id = ANY($1::uuid[]) AND t_invalid IS NULL RETURNING id`** — RETURNING distinguishes `soft_deleted` (now invalidated) from `already_invalid` (NOT in RETURNING set).
- **`EvictionResult`** aggregates; per-row errors captured but do NOT roll back the transaction (per `architecture.md § 9`: partial failures logged, graceful).
- **EC-4 absorption (OTel counter wiring):** after RETURNING set is computed, emit `meter.createCounter('theo.memory.eviction.soft_deletes_total').add(result.soft_deleted, { policy: 'triadic_scoring' })`. Reuses the OTel meter wired in v0.1 (`src/local/telemetry.ts`). Wiring triad (c) pillar — this counter MUST be observed non-zero in T7.1 integration workload via in-memory OTel exporter. Without this emission, `check_wiring.py` fails on pillar (c).

#### Tasks

1. RED test: evict 3 IDs (2 valid + 1 already-invalid); assert result.soft_deleted == 2, already_invalid == 1, errors == [].
2. RED: post-evict, `recall()` does NOT return soft-deleted rows.
3. RED: `WHERE t_invalid IS NOT NULL` query DOES return them (audit trail).
4. Implement.
5. GREEN.

#### TDD

```
RED:      test_evict_soft_deletes_via_t_invalid
RED:      test_evict_distinguishes_already_invalid
RED:      test_evict_never_physical_deletes
RED:      test_recall_filters_out_soft_deleted
RED:      test_audit_query_returns_soft_deleted
RED:      test_evict_empty_array_no_op — EC-10: WHERE id = ANY('{}'::uuid[]) returns zero; result = { soft_deleted: 0, already_invalid: 0, errors: [] }
RED:      test_evict_emits_otel_counter — EC-4: theo.memory.eviction.soft_deletes_total incremented by result.soft_deleted via in-memory exporter
GREEN:    Implement evict() with RETURNING + OTel counter emit + empty-array short-circuit
REFACTOR: SQL constant + counter constant
VERIFY:   npm test -- src/local/eviction/__tests__/evict-soft-delete.test.ts
```

#### Acceptance Criteria

- [ ] 5 RED tests GREEN
- [ ] Pass: complexity / coverage / lint / size

---

## Phase T7: THE GOAL TEST + guardrail (acceptance)

**Objective:** Implement the two CLAUDE.md Item 6 acceptance criteria verbatim.

### T7.1 — THE GOAL TEST: 1000 memories + 50 rare-targets + recall@10

#### Objective
Integration test against real `ankane/pgvector:v0.5.1`: seed 1000 memories with 50 marked "rare" targets; trigger 30% eviction; assert `recall@10` on rare-query set ≥ 0.70.

#### Evidence
CLAUDE.md § Macro roadmap Item 6 acceptance verbatim.

#### Files to edit
```
tests/integration/forgetting/triadic-eviction.test.ts — NEW: THE GOAL TEST
tests/integration/forgetting/fixtures/rare-target-seed.ts — NEW: deterministic seed of 1000 memories + 50 rare
```

#### Deep Dives

- **Seed shape:** 950 memories drawn from 5 dense topical clusters (frequent siblings); 50 marked "rare" — embedded far from clusters (high isolation_distance). Queries crafted to retrieve the rare ones.
- **Eviction call:** `CapacityBasedTrigger({ maxMemoriesPerScope: 700 })` — 300 evictions = 30% of 1000.
- **Assertion:** for each of the 50 rare queries, `recall(query, { topK: 10 })`; count how many include the matching rare target. `recall@10 = total_hits / 50 ≥ 0.70`.
- **Threshold locked at 0.70:** chosen because under random eviction (no triadic + no multiplier) the expected recall@10 is ≈ 0.40 (with 30% removed the rare memory has 0.7 survival prob × top-10 retrieval probability ≈ 0.5). Triadic + multiplier should beat 0.70 by design.

#### Tasks

1. Write deterministic seed fixture (1000 memories, 50 rare-tagged).
2. RED test: seed → trigger eviction → run 50 rare queries → assert `recall@10 ≥ 0.70`.
3. Verify GREEN against real pgvector.
4. REFACTOR: extract `seedThousand` + `runRareQueries` helpers for reusability in evaluation doc.

#### TDD

```
RED:      test_thousand_memories_30_percent_evicted_recall_at_10_above_threshold
RED:      test_rare_targets_survive_disproportionately
GREEN:    Run against real pgvector container
REFACTOR: Extract fixture helpers
VERIFY:   npm test -- tests/integration/forgetting/triadic-eviction.test.ts
```

#### Acceptance Criteria

- [ ] Both RED tests GREEN against `ankane/pgvector:v0.5.1`
- [ ] Test runtime ≤ 120s (acceptable for integration tier)
- [ ] Pass: complexity / coverage / lint / size

### T7.2 — Guardrail unit test (rare survives ≥ 5 LRU passes)

#### Objective
Unit test (NO pgvector dependency — use in-memory adapter v0.1 fixture): seed 1 rare-isolated memory + 100 frequent-cluster siblings; run 5 consecutive `CapacityBasedTrigger` passes (each evicting 30%); assert rare survives all 5.

#### Files to edit
```
src/local/eviction/__tests__/guardrail-long-tail.test.ts — NEW
```

#### Deep Dives

- **In-memory pgvector stub:** v0.1 ships `InMemoryVectorStore` adapter; use it for unit-tier (no Docker dependency, < 100ms per test).
- **5 passes simulating "wave" of frequent writes:** between passes, simulate `access_count++` on a random 50% of frequent siblings (driving up their score) — rare memory's `access_count` stays at 0 but its multiplier protects it.

#### Tasks

1. RED test: seed 1 rare + 100 frequent (all same scope); 5 passes of `CapacityBasedTrigger({ maxMemoriesPerScope: 70 })`; assert rare row's `t_invalid IS NULL` after all 5.
2. Implement test using in-memory adapter.
3. GREEN.

#### TDD

```
RED:      test_rare_isolated_survives_five_consecutive_lru_passes
GREEN:    Run test with in-memory adapter
VERIFY:   npm test -- src/local/eviction/__tests__/guardrail-long-tail.test.ts
```

#### Acceptance Criteria

- [ ] RED test GREEN
- [ ] Test runtime ≤ 500ms (unit tier)
- [ ] Pass: complexity / coverage / lint / size

### T7.3 — `docs/forgetting-evaluation.md` artifact

#### Objective
Reproducible Markdown report + companion `docs/forgetting-evaluation/run.ts` script that re-runs T7.1 with verbose metrics output.

#### Files to edit
```
docs/forgetting-evaluation.md — NEW: methodology + recall@10 matrix
docs/forgetting-evaluation/run.ts — NEW: reproducible script
docs/forgetting-evaluation/README.md — NEW: how to reproduce
```

#### Deep Dives

- **Methodology section:** explain the 1000-memory seed shape; the 50-rare-target construction; the eviction fraction; the metric formula.
- **Matrix:** recall@10 for (a) baseline random eviction, (b) pure LRU eviction (no multiplier), (c) triadic eviction (no multiplier), (d) triadic + multiplier. The matrix VALIDATES the multiplier's contribution honestly.
- **Reproducibility:** `npm run eval:forgetting` reproduces the matrix from scratch.

#### Tasks

1. Write methodology + matrix template.
2. Write `run.ts` invoking T7.1's fixtures + emitting metrics.
3. Add `npm` script `eval:forgetting`.
4. Run + commit matrix.

#### Acceptance Criteria

- [ ] `docs/forgetting-evaluation.md` exists + has matrix
- [ ] `npm run eval:forgetting` reproduces the matrix (CI may run a smoke check)
- [ ] Methodology cites blueprint D11

---

## Phase T8: Integration Validation (MANDATORY)

**Objective:** Full chain (`npm test`, `npm run typecheck`, `npm run lint`, `npm run test:coverage`) green with zero regressions on v0.1 + v0.4a tests.

### T8.1 — Run full validation chain + wiring triad

#### Tasks

1. `npm test` — assert green (unit + integration). Total tests after v0.4b: estimate +50 from this plan → ≈ 350 total.
2. `npm run typecheck` — zero errors.
3. `npm run lint` — zero warnings on changed files.
4. `npm run test:coverage` — ≥ 90% on changed files; 100% on `src/local/eviction/triadic-scoring-policy.ts` (critical path math).
5. Wiring triad check via `.claude/skills/implement/scripts/check_wiring.py`:
   - (a) Static caller: `TriadicScoringPolicy` constructed somewhere in user-facing factory path (`src/local/index.ts` exports it).
   - (b) Integration test exists at `tests/integration/forgetting/`.
   - (c) Runtime metric: `theo.memory.eviction.soft_deletes_total` counter observed non-zero in T7.1 run.

#### Acceptance Criteria

- [ ] All test suites green
- [ ] Coverage ≥ 90% on changed files
- [ ] Zero typecheck errors
- [ ] Zero lint warnings
- [ ] Wiring triad: 3/3 pillars pass
- [ ] No regression on v0.1 / v0.4a tests

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `EvictionPolicy` DIP missing | T1.1 | New 8th DIP at `src/core/dip/eviction-policy.ts` |
| 2 | `last_accessed_at` + `access_count` + `half_life_seconds` columns | T0.1 | Drizzle migration `0003_eviction_columns.sql` |
| 3 | HLR exponential time decay | T2.1 | `recency_component = 1 - 2^(-Δ/h)` |
| 4 | Additive triadic scoring (vs multiplicative) | T2.1 | `score = w_r·R + w_f·F + w_i·I` |
| 5 | Lazy `half_life_seconds` backfill from `llm_importance_score` | T2.2 | `h = h_base × (0.1 + 2.9 × importance)` + persist on first scoring |
| 6 | `recall()` write-back LRU/LFU bookkeeping | T3.1 | Batched UPDATE post-SELECT in `pgvector-store.ts` |
| 7 | Long-tail protection multiplier | T4.1 + T4.2 | pgvector `<=>` nearest-neighbor + `clamp(0.1, 1.0, isolation/mean)` |
| 8 | `CapacityBasedTrigger` | T5.1 | Post-write count + selectVictims + evict |
| 9 | `TimeBasedTrigger` (cron) | T5.2 | REUSES `croner` from v0.4a |
| 10 | Soft-delete via `t_invalid` (not DELETE) | T6.1 | UPDATE memories SET t_invalid = NOW() RETURNING |
| 11 | Acceptance: 1000 memories + 50 rare + recall@10 ≥ 0.70 | T7.1 | Integration test against real pgvector |
| 12 | Guardrail: rare survives ≥ 5 LRU passes | T7.2 | Unit test with in-memory adapter |
| 13 | `docs/forgetting-evaluation.md` artifact | T7.3 | Methodology + matrix + reproducible script |
| 14 | Integration Validation | T8.1 | Full chain green; wiring triad pass |

**Coverage: 14/14 gaps covered (100%).**

## Dependencies

### Existing (REUSED — zero new deps per blueprint Q2 Rule 9 verdict)

| Dep | Version | Where REUSED | Source ADR |
|---|---|---|---|
| `pg` | `^8.11.0` | `pgvector-store.ts` (T3.1) + `evict()` UPDATE (T6.1) | v0.1 |
| `drizzle-orm` | `^0.36.0` | schema + migrations (T0.1) | v0.1 |
| `drizzle-kit` | `^0.30.0` | `0003_eviction_columns.sql` push | v0.1 |
| `croner` | (pinned at v0.4a; verify exact at /implement) | `TimeBasedTrigger` (T5.2) | v0.4a ADR D10 |
| `pgvector` extension | `v0.5.1` | `<=>` operator for nearest-neighbor (T4.1) | v0.1 |
| `vitest` | `^2.x` | all RED tests | v0.1 |

### New

NONE. Per blueprint Q2 Rule 9 verdict: `lru-cache`, `quick-lru`, `keyv` ALL REJECTED for wrong-abstraction-layer reasons. The triadic scoring math is ≈ 100 LoC of TypeScript across T2-T4; pulling any external cache library would violate Rule 9's caveat ("the abstraction is so fine that the dependency external costs more than the implementation").

### Removed

NONE.

## Global Definition of Done

### Code

- [ ] All 8 phases completed (T0 through T8)
- [ ] All RED tests GREEN
- [ ] `EvictionPolicy` DIP exported via `src/core/dip/index.ts`
- [ ] `TriadicScoringPolicy` exported via `src/local/eviction/index.ts` AND `src/local/index.ts`
- [ ] Migration `0003_eviction_columns.sql` applies cleanly via `drizzle-kit push`

### Tests

- [ ] `npm test` green (target +50 new tests = ≈ 350 total)
- [ ] Integration tests pass against `ankane/pgvector:v0.5.1`
- [ ] Guardrail unit test passes with in-memory adapter
- [ ] `docs/forgetting-evaluation.md` matrix reproducible via `npm run eval:forgetting`

### Quality gates (per `architecture.md § Module hygiene`)

- [ ] Every changed file ≤ 500 LoC
- [ ] Every function cyclomatic complexity ≤ 10
- [ ] Coverage ≥ 90% on changed files; 100% on `triadic-scoring-policy.ts` (critical path)
- [ ] `npm run typecheck` zero errors
- [ ] `npm run lint` zero warnings

### Wiring triad (per `cycle-implement.md` § Hard gate 4-6)

- [ ] (a) Static caller: `TriadicScoringPolicy` referenced in `src/local/index.ts` user-facing barrel
- [ ] (b) Integration test exists: `tests/integration/forgetting/triadic-eviction.test.ts`
- [ ] (c) Runtime metric: counter `theo.memory.eviction.soft_deletes_total` emitted in T6.1 (EC-4 absorbed) AND observed non-zero in T7.1 integration workload via in-memory OTel exporter

### Documentation

- [ ] `docs/forgetting-evaluation.md` committed with methodology + recall@10 matrix
- [ ] `docs/forgetting-evaluation/run.ts` reproduces the matrix
- [ ] CHANGELOG.md `[Unreleased]` entry under `Added` (once `CHANGELOG.md` exists in repo)

### Architecture compliance

- [ ] `src/core/dip/eviction-policy.ts` has ZERO imports from `src/local/` or `src/cloud/` (DIP boundary per `architecture.md § 3`)
- [ ] `src/local/eviction/` imports ONLY from `src/core/` and `src/local/schema.ts` (own runtime)
- [ ] No new public API mutation methods (ADD-only preserved per ADR-0003)
- [ ] Soft-delete via `t_invalid` honors ADR-0006 bi-temporal schema

### Plan archival (per `audit-trail-rotation.md`)

- [ ] After `/review` returns `READY_TO_MERGE` AND PR merged to `main`, move this plan to `.claude/knowledge-base/plans/completed/v0-4b-forgetting-pipeline-plan.md`
- [ ] Discovery artifacts (blueprint + edge-case review + confidence report + snapshots) stay in place per rotation policy

## Final Phase: Integration Validation (already declared as Phase T8)

See Phase T8 above.

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/v0-4b-forgetting-pipeline-plan.md` (v1.1)
- Discovery blueprint: `.claude/knowledge-base/discoveries/blueprints/v0-4b-forgetting-pipeline-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89/100 — 2026-05-26)
- Edge-case review: `.claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-edge-cases-2026-05-26.md`
- Confidence report: `.claude/knowledge-base/reviews/v0-4b-forgetting-pipeline-confidence-2026-05-26.md.json`
- Companion v0.4a plan: `.claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md` (PRE-REQ — must reach `completed/` first)
- CLAUDE.md § Macro roadmap Item 6 (OPEN PROBLEM #1 — empirically grounded by blueprint)
- Architecture rule: `.claude/rules/architecture.md § 3 (DIP)` + `§ 2 (ADD-only)`
- Testing rule: `.claude/rules/testing.md § Pyramid`
- Cycle rule: `.claude/rules/cycle-plan.md` (this plan honors v1.1 chain)
- Inquebrável Rule 9 (Não Reinvente): honored — zero new deps adopted; in-house implementation chosen per blueprint Q2 Rule 9 verdict
