# Plan: v0.7 — Episodic→Semantic Distillation Pipeline

> **Version 1.1** (2026-06-01) — Absorbs ALL 11 edge cases from `/edge-case-plan v0-7-distillation-pipeline` review at `.claude/knowledge-base/reviews/v0-7-distillation-pipeline-edge-cases-2026-06-01.md` + 2 Coverage Matrix structural fixes from `/plan-confidence` baseline run (v1.0 INVALID 49 due to `coverage_lt_100` 91% — row #10 unmapped task + parser false-positive on historical task IDs `T11.1`/`T7.3`/`T9.1` in Context table). **4 MUST FIX absorbed**: EC-1 LastWriteWins tie-break lexicográfico em `memory_id` (T1.2); EC-2 LlmJudgedMerge `parseConsolidationResponse` semantic-validate `kept_id ∈ clusterIds && rejected_ids ⊂ clusterIds` (T1.3); EC-3 FK `consolidation_history.kept_memory_id` declares `ON DELETE SET NULL` para GDPR `forget({hard:true})` survival (T0.1); EC-4 OTel counters MUST use lazy-init per F-dom-6 / v0.4b `T10.1` precedent at `src/local/eviction/pg-evictor.ts:56-58` (T1.3 + T2.1 + T3.3). **4 SHOULD TEST absorbed as TDD halt-loop checkpoints**: EC-5 THE GOAL TEST stability across 3 runs with `temperature=0` (T3.3); EC-6 cluster size cap ≤ 20 memórias por batch (T1.3); EC-7 empty scope (`recall.length === 0`) graceful no-op (T2.1); EC-8 atomic transaction rollback on `consolidation_history` insert failure (T2.1). **3 DOCUMENT absorbed**: EC-9 ADR D3 honesty fix — `derived_from` already JSONB shipped v0.4a (`src/local/pgvector-store.ts:71`); only `consolidation_history` is added by 0007 migration; EC-10 BLEU via `natural.BleuScore` (já em `optionalDependencies` per v0.6.1; zero new deps confirmed); EC-11 `npm run eval:distillation` pre-conditions documented (`compose:up` + `OPENAI_API_KEY` + ~$0.50 LLM cost/full run). **ALSO absorbs `/deps-audit` verdict PASS_WITH_CAVEATS** (zero new deps; 4 pre-existing MODERATE drizzle-kit chain allowlisted unchanged). **ALSO absorbs Coverage Matrix fixes**: row #10 "Zero new deps" remapped from `(all tasks)` to `T4.1` (validation gate verifies); historical task IDs in Context table backtick-wrapped to prevent parser false-positive (precedent: Cycle 2 plan v1.0→v1.1).
>
> **Version 1.0** (2026-06-01) — Implementation plan consuming the discovery blueprint at `.claude/knowledge-base/discoveries/blueprints/v0-7-episodic-semantic-distillation-blueprint.md` (v1.0). Roadmap Item 9 / Open Problem #3. Ships a `ConflictResolutionPolicy` DIP with 3 implementations (Noop / LastWriteWins / LlmJudgedMerge), wired into the existing v0.4a `reflect()` consolidation phase (NOT the add path per blueprint B-D1 Mem0-parity). Adds `consolidation_history` table + extends `memories.derived_from` to support multi-source provenance. Ships gold-set fixtures (200 episodes per MemoryBank methodology Q7) + reproducible eval script at `docs/distillation-evaluation/run.ts` mirroring the v0.4b pattern. **Zero new npm deps** (per blueprint B-D4 + R5 — Rule 9 satisfied by existing surface).

## Goal

Ship the episodic→semantic distillation pipeline at `Memory.reflect({ conflictResolution: <Policy> })` with a `ConflictResolutionPolicy` DIP + 3 implementations + full audit trail in a new `consolidation_history` table, measured by `npm run test:integration -- tests/integration/distillation/the-goal-test.test.ts` PASS against `ankane/pgvector:v0.5.1` with **precision ≥ 0.75 + recall ≥ 0.70 on the 200-episode gold set + conflict-resolution accuracy ≥ 0.80 on the 50-contradiction-pair subset** AND `npm run eval:distillation` reproducing the matrix at `docs/distillation-evaluation.md`.

The action verb is **ship**; the named observable metric is THE GOAL TEST counter (`distillation.goal_test.pass === 1` AND `distillation.precision >= 0.75` AND `distillation.recall >= 0.70` AND `distillation.conflict_resolution_accuracy >= 0.80`).

## Context

### What exists today (surfaces this plan builds on)

| Surface | Status | Source |
|---|---|---|
| `reflect()` consolidation phase (v0.4a) | SHIPPED | `src/core/reflection/{execute,prompt,provenance,importance,types}.ts` |
| `derivedFrom` provenance pattern | SHIPPED v0.4a + v0.6 | `src/core/skill.ts:64` (skill flavor); `src/core/extraction/prompt.ts` (memory flavor) |
| `LLM` + `Embedder` DIPs | SHIPPED Cycle 1+2 | `src/core/dip/{llm,embedder}.ts` + `@usetheo/memory/{llms,embedders}/openai` |
| Bi-temporal `t_valid` / `t_invalid` | SHIPPED v0.1 + v0.4b | `src/local/migrations/0000_crazy_mimic.sql` + `0003_eviction_columns.sql` |
| 8 existing migrations (`0000`-`0006`) | SHIPPED | `src/local/migrations/` |
| 8 existing DIPs | SHIPPED | `src/core/dip/{embedder,eviction-policy,history-manager,llm,reflection-policy,scoring-strategy,skill-representation-strategy,vector-store}.ts` |
| `docs/forgetting-evaluation/run.ts` eval pattern | SHIPPED v0.4b | `docs/forgetting-evaluation/run.ts` (`T7.3` — `npm run eval:forgetting`) |

### Why this matters NOW

Per `CLAUDE.md § Macro roadmap` Item 9: v0.7 is **Open Problem #3 — Mem0 + Zep try, quality remains open.** The discovery blueprint (Q1-Q8) confirmed NEITHER Mem0/Letta/Zep/Cognee documents the conflict-resolution algorithm + provenance trace. v0.7's moat is TRANSPARENCY (per blueprint R8): we ship the algorithm + prompts + audit trail. Per CTO ranking 2026-06-01, this is the highest-leverage moat play before v1.0 benchmarks (Item 10).

### Accepted risks (declared upfront)

- **EC-A — Gold-set hand-labeling is ~30min/example × 200 = 100h estimated** if pure-human. Mitigation per blueprint R4 + MemoryBank methodology: 50 hand-labeled + 150 LLM-simulated-and-human-verified (much cheaper). Total ~25-40h authoring + 10h verification.
- **EC-B — Precision/recall thresholds (0.75 / 0.70) are baseline; v0.7 may not hit them on first iteration.** Mitigation: if THE GOAL TEST fails, ship `SHIPPABLE_WITH_CAVEATS` with documented actual numbers; iterate via v0.7.1 fix-up cycle (precedent: v0.4b → v0.4b-fixes; v0.6 → v0.6.1).
- **EC-C — `LlmJudgedMergeConflictPolicy` makes 1 extra LLM call per detected contradiction during reflect()**. Cost ~$0.001 per call (gpt-4o-mini). For a consumer with 10K contradictions/month: ~$10. Acceptable; default is `NoopConflictPolicy` (zero extra cost).
- **EC-D — Schema migration `0007` adds `consolidation_history` table**. Forward-only (no rollback); v0.7 ships `db:repair-v0-7-partial-state` script following v0.4b-fixes `T11.1b` precedent. (EC-9 absorbed: `derived_from` is ALREADY a JSONB array column shipped at v0.4a — `src/local/pgvector-store.ts:71`; v0.7 only ADDS the new `consolidation_history` table; no schema change to `memories` table.)

### Compliance scope

Honors `architecture.md § 3 DIP` — `src/core/conflict-resolution/` implementations depend ONLY on DIPs (LLM via `src/core/dip/llm.ts`); zero `src/local/`/`src/cloud/` imports. Honors `§ 6 Naming`. Honors `§ 7 Module hygiene` (no `any`, no `console.log`). Honors `§ 9 Public API surface` — `ConflictResolutionPolicy` + 3 impls + `ConsolidationResult` exported via root `src/index.ts`. Honors `testing.md § Pyramid` (unit tests for policies; integration for THE GOAL TEST; gold-set fixtures committed). Honors `no-paper-names-in-code.md` (no `MemoryBank` / `CoALA` / `Generative Agents` in src/test code; cite via `@see` to discoveries snapshots). Honors `dogfood-golden-rule.md` (NO `production-ready` token — pre-release). Honors Inquebrável Rule 9 (zero new deps; uses existing `openai`/`@opentelemetry/api`/`drizzle-orm`/`pg`). Honors Rule 5 (TDD — RED tests before GREEN). Honors Rule 3 (extreme honesty — gold-set fixtures committed verbatim, no synthetic-only).

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@usetheo/memory/contract` | (workspace) | npm | Imports `LLM`, `Embedder`, `Memory`, `Message` DIPs |
| `@usetheo/memory/llms/openai` | (workspace) | npm | LLM-judged-merge backend (default; consumer-overridable) |
| `pg` | `^8.13.0` | npm | Already in v0.1 |
| `drizzle-orm` | `^0.45.0` | npm | Already in v0.1 |
| `@opentelemetry/api` | `^1.9.0` | npm | Counters for `distillation.*` metrics |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | Blueprint B-D4 + R5: zero new deps. All needs covered by existing surface. | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Objective

- [ ] T0.1 — Drizzle migration `0007_distillation_columns.sql` adds `consolidation_history` table (`id`, `kept_memory_id`, `rejected_memory_ids[]`, `reason`, `policy_name`, `original_episode_ids[]`, `created_at`) + extends `memories.derived_from` semantics (already JSONB) to support multi-source provenance.
- [ ] T1.1 — `ConflictResolutionPolicy` DIP at `src/core/dip/conflict-resolution-policy.ts` (NEW) declares `consolidate(candidates: ConsolidationCandidate[], ctx: ConsolidationContext): Promise<ConsolidationResult[]>`. Plus `ConsolidationCandidate` + `ConsolidationContext` + `ConsolidationResult` types.
- [ ] T1.2 — `NoopConflictPolicy` (DEFAULT) + `LastWriteWinsConflictPolicy` at `src/core/conflict-resolution/{noop,last-write-wins}.ts` (NEW). Pure functions; no LLM call. `Noop` returns empty array (no consolidation). `LastWriteWins` picks the newer `created_at` per cluster, marks rejected via `t_invalid`, writes audit row.
- [ ] T1.3 — `LlmJudgedMergeConflictPolicy` at `src/core/conflict-resolution/llm-judged-merge.ts` (NEW). Depends only on `LLM` DIP. Issues 1 LLM call per cluster with verbatim conflict-merge prompt (committed at `src/core/conflict-resolution/prompts.ts`); parses `{kept, rejected, reason}` response; writes audit row with verbatim `reason`.
- [ ] T2.1 — Wire into `reflect()` execute pipeline at `src/core/reflection/execute.ts` (UPDATE) — accept `conflictResolution?: ConflictResolutionPolicy` option; after reflect's existing derivation step, run `policy.consolidate(candidates, ctx)` where `candidates` are clusters of cosine-similar memories (≥ 0.95 per Mem0 entity-link precedent) sharing entity overlap. Soft-delete rejected via `t_invalid` per ADR-0006. Public Memory surface gains `Memory.reflect({ conflictResolution })` option.
- [ ] T3.1 — Commit gold-set fixtures at `tests/fixtures/distillation/` (NEW): 50 single-fact + 50 multi-fact + 25 contradiction-pair + 25 entity-overlap-pair + 50 LLM-simulated-dialog (mirrors MemoryBank methodology Q7).
- [ ] T3.2 — Eval script at `docs/distillation-evaluation/run.ts` (NEW) — mirrors v0.4b `docs/forgetting-evaluation/run.ts` pattern. Runs the 200 fixtures through reflect() under each of 3 policies (Noop / LastWriteWins / LlmJudgedMerge); computes precision/recall/conflict-resolution-accuracy per policy; emits `docs/distillation-evaluation.md` matrix. Wired to `npm run eval:distillation` script in `package.json`.
- [ ] T3.3 — THE GOAL TEST at `tests/integration/distillation/the-goal-test.test.ts` (NEW) — asserts precision ≥ 0.75 + recall ≥ 0.70 + conflict-resolution accuracy ≥ 0.80 + every persisted semantic fact has non-empty `derived_from` (per CLAUDE.md Item 9 acceptance) against `ankane/pgvector:v0.5.1`.
- [ ] T4.1 — Integration validation gate + docs/distillation-evaluation.md committed with actual matrix numbers + CHANGELOG `[Unreleased] § Added` entry + push to `origin/develop`.

## ADRs

### D1 — Adopt Mem0's 8-phase pipeline SHAPE; reject Letta's sleeptime tool-call agent

**Decision:** v0.7's distillation runs in the EXISTING `reflect()` phase (v0.4a-shipped), NOT a new background-agent. Pipeline shape mirrors Mem0's V3 batch flow (Phase 0-8) per blueprint B-D1 + R1; tool-call agent (Letta sleeptime v4) explicitly rejected per R2.

**Alternatives considered:**
- (A) Letta-style background sleeptime agent — REJECTED: 4-version churn (v2 abandoned per Q2 EC-8 evidence); higher cost (M LLM calls vs 1); architecturally distinct from our current reflect() shape.
- (B) Hybrid (Mem0 add + Letta reflect) — REJECTED: double LLM cost; complexity premium; both have implicit conflict handling.
- (C) Mem0 8-phase shape adopted into existing reflect() (CHOSEN) — proven (Mem0 April 2026 91.6 LoCoMo / 94.8 LongMemEval benchmarks); cheaper; matches our existing reflect() architecture.

**Rationale:** evidence-based per discovery Q1 (read source at `.claude/knowledge-base/references/mem0/mem0/memory/main.py:662-970`). Honors KISS — reuse reflect() shipped infra; add the policy, not the agent.

**Consequences:** v0.7 ships as a logic-layer extension on top of v0.4a reflect(); no new background-agent runtime; no schema for "scheduled distillation jobs" needed.

### D2 — `ConflictResolutionPolicy` DIP with 3 implementations (Noop default)

**Decision:** New DIP `ConflictResolutionPolicy` with `consolidate(candidates, ctx) -> ConsolidationResult[]`. Three impls: `NoopConflictPolicy` (DEFAULT — Mem0-parity, just adds + soft-links via existing `linked_memory_ids` from v0.4a), `LastWriteWinsConflictPolicy` (deterministic resolution by `created_at`), `LlmJudgedMergeConflictPolicy` (LLM-judged with verbatim audit).

**Alternatives considered:**
- (A) ADD-only only, no policy DIP (Mem0-parity) — REJECTED: gives up the moat per blueprint R8.
- (B) `LlmJudgedMerge` ALWAYS (Letta-parity) — REJECTED: cost + always-on premium for default users.
- (C) DIP with 3 implementations + Noop default (CHOSEN) — backward-compat (default behavior matches Mem0) + opt-in differentiation (premium consumers turn on `LlmJudgedMerge`).

**Rationale:** Inquebrável Rule 9 — Mem0/Letta/Zep/Cognee don't ship this DIP; we already have DIP architecture (8 existing DIPs); marginal cost is small. Honors `architecture.md § 3 DIP`.

**Consequences:** Default behavior matches Mem0 (zero risk). Premium consumers opt into `LlmJudgedMergeConflictPolicy` for full transparency. Audit trail in `consolidation_history` table.

### D3 — `consolidation_history` table (REUSE existing `derived_from` JSONB)

**Decision:** Migration `0007_distillation_columns.sql` adds new table `consolidation_history`:
```sql
CREATE TABLE IF NOT EXISTS consolidation_history (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- EC-3: ON DELETE SET NULL so GDPR forget({hard:true}) survives audit row
  kept_memory_id        uuid REFERENCES memories(id) ON DELETE SET NULL,
  -- value-stored array; survives hard-delete by construction (no FK)
  rejected_memory_ids   jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason                text NOT NULL,
  policy_name           text NOT NULL,
  original_episode_ids  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consolidation_history_kept ON consolidation_history(kept_memory_id);
CREATE INDEX IF NOT EXISTS idx_consolidation_history_created ON consolidation_history(created_at DESC);
```

**EC-9 honesty fix (2026-06-01):** Earlier v1.0 ADR D3 claimed this migration also "extends `memories.derived_from` JSONB type". Verification of `src/local/pgvector-store.ts:71` shows `derived_from` is ALREADY a JSONB array column shipped at v0.4a (`JSON.stringify(row.derived_from)` round-trip). v0.7 only ADDS the new `consolidation_history` table — NO schema change to `memories`. The "multi-source" extension is purely semantic-level: v0.4a typically wrote arrays of length 1 (single derivation source); v0.7 writes arrays of length N (multi-cluster consolidation). Same column, same type, broader usage.

**Alternatives considered:**
- (A) Reuse `history` table (already exists for forget/remember events) — REJECTED: distillation events have richer schema (rejected_memory_ids array; LLM reasoning text); polluting the history shape is bad architectural hygiene.
- (B) JSONB column on `memories` storing audit (no separate table) — REJECTED: provenance is global to consolidation events, not per-memory; queryability for "show all consolidations in last 7 days" needs proper table.
- (C) New `consolidation_history` table (CHOSEN) — clean separation; queryable; per-policy audit trail.

**Rationale:** Honors `architecture.md § 5 schema discipline`. Inquebrável Rule 6 (changelog discipline) — migration is forward-only; rollback documented in `docs/runbook-v0-7-rollback.md`.

**Consequences:** consumers can query `SELECT * FROM consolidation_history WHERE kept_memory_id = $1` to see why a memory was kept + what was rejected + the LLM reasoning. NEITHER Mem0/Letta/Zep/Cognee ships this surface per discovery Q8 — this is the moat.

### D4 — Gold-set methodology from MemoryBank (Zhong 2023); 50 hand-labeled + 150 LLM-simulated-and-verified

**Decision:** 200 gold-set fixtures per blueprint R4. Split: 50 hand-labeled (real user dialog samples) + 150 LLM-simulated-and-human-verified (categories: 50 single-fact + 50 multi-fact + 25 contradiction-pair + 25 entity-overlap). Fixture shape:
```ts
{
  id: string;
  category: 'single-fact' | 'multi-fact' | 'contradiction-pair' | 'entity-overlap' | 'simulated-dialog';
  episodeText: string;
  expectedFacts: Array<{ text: string; attributedTo?: string; linkedToIds?: string[] }>;
  expectedConflictPair?: { kept: string; rejected: string };
}
```

**Alternatives considered:**
- (A) Invent our own methodology — REJECTED: no academic anchor; reviewers can question; honest disclosure becomes weak.
- (B) LongMemEval (Mem0 uses it) — REJECTED: external benchmark; harder to commit fixtures + reproduce in-tree.
- (C) MemoryBank (CHOSEN) — academic anchor (Zhong 2023, arxiv:2305.10250, snapshot at `.claude/knowledge-base/discoveries/snapshots/v0-7-episodic-semantic-distillation/23330a2ecff714779ded7f8225a62f9f1b7f030f8b04ac4b86039a2673475187.md`) + fixture-commit-friendly.

**Rationale:** Inquebrável Rule 5 (TDD) + Rule 3 (extreme honesty). MemoryBank's "LLM simulating users → simulated dialogs" is the cheap way to scale beyond 50 hand-labeled.

**Consequences:** v0.7 acceptance criteria cite MemoryBank in `tests/fixtures/distillation/README.md`. Each fixture file links back to its archetype. Initial precision/recall thresholds 0.75/0.70 are baselines — may iterate via v0.7.1 if first run misses.

### D5 — Eval script via `docs/distillation-evaluation/run.ts` mirroring v0.4b pattern

**Decision:** New eval at `docs/distillation-evaluation/run.ts` + `docs/distillation-evaluation/README.md` + `npm run eval:distillation` script. Mirrors v0.4b's `docs/forgetting-evaluation/run.ts` (`T7.3`, shipped) exactly — same shape, different domain.

**Alternatives considered:**
- (A) Bake into `tests/integration/distillation/` directly — REJECTED: integration tests have assertion semantics (pass/fail); eval script has reporting semantics (numbers/matrix). Separation per `testing.md § Pyramid`.
- (B) Standalone Python script under `evaluation/` (Mem0 pattern) — REJECTED: introduces Python runtime in our TS-native repo; complexity.
- (C) TS script via `tsx` at `docs/distillation-evaluation/` (CHOSEN) — matches v0.4b precedent + npm-scriptable.

**Rationale:** consistency with existing eval pattern. Honors `architecture.md § 7 Module hygiene` (TS-native).

**Consequences:** Reproducible matrix at `docs/distillation-evaluation.md` updated by eval script. `npm run eval:distillation` runs in 5-10 min against pgvector container.

### D6 — Zero new npm dependencies (blueprint R5 + B-D4)

**Decision:** v0.7 ships with **zero new npm deps**. All needs covered by:
- `openai` (Cycle 2 ADR D2) — LLM-judged-merge calls
- `pg` + `drizzle-orm` (v0.1) — persistence
- `@opentelemetry/api` (v0.1) — telemetry counters

**Alternatives considered:**
- (A) Add `spacy`-equivalent NER lib (Mem0 uses `spacy>=3.7.0`) — REJECTED: ecosystem mismatch (Mem0 = Python); ship LLM-only entity extraction first; revisit if needed.
- (B) Add LangChain (BOTH Mem0 + Letta use it) — REJECTED: contradicts CLAUDE.md Mem0-shape-WITHOUT-framework adoption per blueprint B-D4.
- (C) Zero new deps (CHOSEN) — Inquebrável Rule 9 fully satisfied.

**Rationale:** discovery Q5 EC-6 cap on Rule 9 verdicts; all needed deps already shipped.

**Consequences:** `/deps-audit` for v0.7 plan finds zero new deps to evaluate. Verdict expected PASS. No CVE risk added.

## Dependency Graph

```
T0.1 (migration 0007)
  ↓
T1.1 (ConflictResolutionPolicy DIP)
  ↓
  ├──→ T1.2 (Noop + LastWriteWins impls)
  └──→ T1.3 (LlmJudgedMerge impl)
                 ↓ (both T1.2 + T1.3 join)
                 T2.1 (wire into reflect())
                 ↓
                 ├──→ T3.1 (gold-set fixtures)
                 │       ↓
                 │       T3.2 (eval script)
                 │       ↓
                 │       T3.3 (THE GOAL TEST)
                 │             ↓
                 │             T4.1 (validation + docs + CHANGELOG + push)
```

T1.2 + T1.3 parallelizable (independent impls). T3.1 blocks T3.2 + T3.3 (need fixtures first). T3.3 is THE GOAL TEST gate.

## Phases

### T0.1 — Migration `0007_distillation_columns.sql`

**Plan reference:** ADR D3.

**Files to edit:**
- `src/local/migrations/0007_distillation_columns.sql` (NEW)
- `src/local/migrations/meta/0007_snapshot.json` (NEW — drizzle journal sync per v0.4b-fixes T0.1 precedent)
- `scripts/db-repair-v0-7-partial-state.mjs` (NEW — mirrors v0.4b `T11.1b`)
- `docs/runbook-v0-7-rollback.md` (NEW — mirrors v0.4b `T11.1a`)

**Deep file dependency analysis:**
- New table `consolidation_history` references existing `memories(id)` via `kept_memory_id` FK; no schema change to the existing `memories` table beyond REUSING `derived_from` JSONB semantics (already shipped v0.4a per EC-9 honesty fix — see ADR D3).
- **EC-3 absorbed**: `kept_memory_id` FK declares `ON DELETE SET NULL` so GDPR `forget(memId, { hard: true })` (v0.4b `T7.1`) physical DELETE of a memory referenced in `consolidation_history` does NOT cascade-destroy the audit row NOR violate FK constraint. `rejected_memory_ids` JSONB array is value-stored (no FK) and survives hard-delete by construction.
- Idempotent via `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` per v0.4b `T9.1` precedent.

**TDD:**
- **RED:** `npm run db:push` against fresh `ankane/pgvector:v0.5.1` shows pre-migration; `SELECT * FROM consolidation_history LIMIT 1;` fails (table missing).
- **GREEN:** apply migration; `SELECT` succeeds with 0 rows; `pg_indexes` shows 2 new indexes.
- **REFACTOR:** verify `runMigrations()` idempotency by running twice; second run no-ops.
- **RED-EC-3:** `tests/integration/distillation/forget-hard-survives-audit.test.ts` (NEW) — seeds 2 memories `a`, `b`; calls policy that records `consolidation_history` row with `kept_memory_id = a` + `rejected_memory_ids = [b]`; then calls `memory.forget(a, { hard: true })`; asserts (a) no FK violation thrown, (b) `consolidation_history` row STILL exists with `kept_memory_id IS NULL`, (c) `reason` + `policy_name` columns preserved. FAILS until migration ships with `ON DELETE SET NULL`.
- **GREEN-EC-3:** add `ON DELETE SET NULL` clause to migration; test PASS.

**Acceptance criteria:**
- [ ] Migration file ≤ 100 LoC; uses `IF NOT EXISTS` guards throughout
- [ ] SQL declares `kept_memory_id uuid REFERENCES memories(id) ON DELETE SET NULL` (EC-3)
- [ ] `kept_memory_id` is NULLABLE (consequence of `ON DELETE SET NULL`); JSDoc note on the column explains the rationale (GDPR hard-delete survival)
- [ ] Drizzle journal `0007_snapshot.json` valid + checked into git
- [ ] Rollback runbook at `docs/runbook-v0-7-rollback.md` documents `DROP TABLE consolidation_history;` + journal cleanup
- [ ] EC-3 regression test `tests/integration/distillation/forget-hard-survives-audit.test.ts` PASS

**COMMIT:** `feat(db)(v0-7): migration 0007 — consolidation_history table with ON DELETE SET NULL FK for GDPR survival (T0.1 / ADR D3 / EC-3)`

### T1.1 — `ConflictResolutionPolicy` DIP

**Plan reference:** ADR D2.

**Files to edit:**
- `src/core/dip/conflict-resolution-policy.ts` (NEW)
- `src/core/index.ts` (UPDATE — re-export DIP + types)

**Deep file dependency analysis:**
- 9th DIP in `src/core/dip/`. Pattern matches `eviction-policy.ts` (v0.4b precedent) — declarative interface + types.
- Types: `ConsolidationCandidate` (cluster of cosine-similar memories), `ConsolidationContext` (LLM + scope + observation_date), `ConsolidationResult` (`{ kept_memory_id, rejected_memory_ids[], reason, original_episode_ids[] }`).
- File budget: ≤ 80 LoC (DIP-only; pure types + interface).

**TDD:**
- **RED:** `tests/unit/conflict-resolution/dip-shape.test.ts` (NEW) asserts `ConflictResolutionPolicy` type signature via `expectTypeOf<ConflictResolutionPolicy['consolidate']>().parameters.toEqualTypeOf<...>()` — FAILS (file doesn't exist).
- **GREEN:** create DIP file with interface + types; test PASSES.
- **REFACTOR:** verify `import { ConflictResolutionPolicy } from '@usetheo/memory/contract'` resolves via root barrel.

**Acceptance criteria:**
- [ ] DIP exports `ConflictResolutionPolicy` interface + 3 types
- [ ] LoC ≤ 80
- [ ] Reachable via `@usetheo/memory` + `@usetheo/memory/contract` root barrels

**COMMIT:** `feat(core)(v0-7): ConflictResolutionPolicy DIP (T1.1 / ADR D2)`

### T1.2 — `NoopConflictPolicy` + `LastWriteWinsConflictPolicy` implementations

**Plan reference:** ADR D2.

**Files to edit:**
- `src/core/conflict-resolution/noop.ts` (NEW)
- `src/core/conflict-resolution/last-write-wins.ts` (NEW)
- `src/core/conflict-resolution/__tests__/noop.test.ts` (NEW)
- `src/core/conflict-resolution/__tests__/last-write-wins.test.ts` (NEW)
- `src/core/index.ts` (UPDATE — re-export impls)

**Deep file dependency analysis:**
- Both implement `ConflictResolutionPolicy` from T1.1
- `NoopConflictPolicy.consolidate(candidates, ctx)` returns `[]` — no consolidation, just preserves Mem0-parity behavior
- `LastWriteWinsConflictPolicy.consolidate(candidates, ctx)` picks max-by-`created_at` per cluster; emits `ConsolidationResult` with `reason: "last-write-wins"`
- **EC-1 absorbed**: when two memories in the same cluster have IDENTICAL `created_at` (real scenario: Mem0's V3 Phase 6 batch-persist commits N rows in a SINGLE transaction with `created_at = datetime.now(timezone.utc)` captured ONCE at request start — multiple memories in one cluster CAN share the timestamp), the comparator MUST fall back to a deterministic tie-break by `memory_id` LEXICOGRAPHIC DESCENDING so the policy is reproducible across runs. Pure JS `Math.max` and unstable `Array.sort` callbacks would return non-deterministic winners and make THE GOAL TEST (T3.3) flaky.
- Pure functions; no LLM calls; no I/O
- File budget per impl: ≤ 80 LoC

**TDD:**
- **RED:** `noop.test.ts` asserts `consolidate([candidates])` returns `[]` for any input — FAILS (file doesn't exist).
- **RED #1:** `last-write-wins.test.ts` asserts: given cluster `[{id:'a', created_at: t1}, {id:'b', created_at: t2}]` where t2 > t1, returns `[{ kept_memory_id: 'b', rejected_memory_ids: ['a'], reason: 'last-write-wins' }]` — FAILS.
- **RED #2 (EC-1)**: given cluster `[{id:'aaa', created_at: t}, {id:'bbb', created_at: t}, {id:'ccc', created_at: t}]` (IDENTICAL timestamp), asserts that across 10 consecutive invocations the policy returns `{ kept_memory_id: 'ccc', rejected_memory_ids: ['bbb','aaa'], reason: 'last-write-wins' }` 10/10 times (DESCENDING lexicographic tie-break by `memory_id`). FAILS without explicit tie-break.
- **GREEN:** implement comparator `(a, b) => b.created_at - a.created_at || b.memory_id.localeCompare(a.memory_id)`; sort + take first; tests PASS.
- **REFACTOR:** ensure no `any`; pure functions; tests stay green. JSDoc on the comparator documents the tie-break rationale ("EC-1 absorbed — Mem0 V3 Phase 6 batch-persist scenario").

**Acceptance criteria:**
- [ ] `NoopConflictPolicy` returns empty array (verified by RED→GREEN test)
- [ ] `LastWriteWinsConflictPolicy` returns deterministic max-by-`created_at` with lexicographic-DESC tie-break by `memory_id` when timestamps equal (verified by EC-1 stability test 10/10 reproducible)
- [ ] Both LoC ≤ 80; no `any`; no `console.log`
- [ ] Both re-exported via `@usetheo/memory` root + `@usetheo/memory/contract`

**COMMIT:** `feat(core)(v0-7): NoopConflictPolicy + LastWriteWinsConflictPolicy with deterministic tie-break (T1.2 / ADR D2 / EC-1)`

### T1.3 — `LlmJudgedMergeConflictPolicy` implementation

**Plan reference:** ADR D2.

**Files to edit:**
- `src/core/conflict-resolution/llm-judged-merge.ts` (NEW)
- `src/core/conflict-resolution/prompts.ts` (NEW — verbatim merge prompt)
- `src/core/conflict-resolution/__tests__/llm-judged-merge.test.ts` (NEW)
- `src/core/conflict-resolution/__tests__/prompts.test.ts` (NEW)
- `src/core/index.ts` (UPDATE — re-export)

**Deep file dependency analysis:**
- Depends on `LLM` DIP (`src/core/dip/llm.ts`) — ONE LLM call per cluster (NOT per memory)
- Prompt at `src/core/conflict-resolution/prompts.ts` declares `CONFLICT_MERGE_PROMPT` (system) + `generateConflictMergePrompt(cluster, ctx)` (user); response_format JSON `{ kept_id: string, rejected_ids: string[], reason: string }`
- JSON-parse fallback path returns `{ error: 'non_json_response', raw: <content> }` per Cycle 2 OpenAILLM precedent (EC-10 absorbed) — policy treats this as "abstain from consolidation" (NOT a crash)
- **EC-2 absorbed**: factor `parseConsolidationResponse(raw: string, clusterIds: Set<string>): ConsolidationResult | null` MUST validate `clusterIds.has(parsed.kept_id) && parsed.rejected_ids.every(id => clusterIds.has(id) && id !== parsed.kept_id)` BEFORE returning. Without this guard, LLM-hallucinated UUIDs in `kept_id` or `rejected_ids` would be written to `consolidation_history.rejected_memory_ids` JSONB AND would cause FK violation in `kept_memory_id` (or NULL via `ON DELETE SET NULL`, but with garbage value), aborting the entire `reflect()` transaction. Semantic validation returns `null` → policy abstains → OTel counter `distillation.consolidation.abstain` increment.
- **EC-4 absorbed**: ALL OTel counters in this file (`distillation.consolidation.{kept,rejected,abstain}`) MUST use lazy resolution per F-dom-6 / v0.4b `T10.1` precedent at `src/local/eviction/pg-evictor.ts:56-58`. Materializing counters at module-load via `metrics.getMeter('distillation')` captures the no-op default `MeterProvider` permanently when consumers call `setGlobalMeterProvider(...)` AFTER importing `@usetheo/memory`. Lazy pattern: counters resolved INSIDE `consolidate()` body via `metrics.getMeter('@usetheo/memory/distillation').createCounter('...')`.
- **EC-6 absorbed**: cluster size MUST be capped at 20 memórias por batch. If `candidates.length > 20`, policy abstains (returns `[]`) AND increments `distillation.consolidation.cluster_too_large` counter. Without cap, a 50-memory cluster blows the prompt token budget (50 × ~500 tokens = 25k just for the cluster payload, exceeding gpt-4o-mini's effective response window). Chunking into batches of 20 is the cheap upper bound; document trade-off in JSDoc.
- LoC budget: ≤ 120 LoC for impl; ≤ 80 LoC for prompts file

**TDD:**
- **RED #1**: `llm-judged-merge.test.ts` — given a `MockLLM` returning `{ kept_id: 'a', rejected_ids: ['b'], reason: 'a is more specific' }` + cluster `[{id:'a'},{id:'b'}]`, asserts `consolidate` returns the expected `ConsolidationResult` with verbatim `reason`. FAILS (no impl).
- **RED #2**: with mock returning `{ error: 'non_json_response' }`, asserts `consolidate` returns `[]` (abstain) and emits `distillation.consolidation.abstain` OTel counter increment.
- **RED #3 (EC-2)**: with mock returning `{ kept_id: 'fake-uuid-not-in-cluster', rejected_ids: ['b'], reason: 'x' }` + cluster `[{id:'a'},{id:'b'}]`, asserts `consolidate` returns `[]` (abstain) — `parseConsolidationResponse` semantic-validate rejected the hallucinated `kept_id`. FAILS until validation added.
- **RED #4 (EC-2)**: with mock returning `{ kept_id: 'a', rejected_ids: ['fake-uuid'], reason: 'x' }`, similarly abstains.
- **RED #5 (EC-2)**: with mock returning `{ kept_id: 'a', rejected_ids: ['a'], reason: 'x' }` (kept_id appears in rejected_ids), abstains.
- **RED #6 (EC-4)**: consumer test installs a non-default MeterProvider BEFORE importing the policy; runs `consolidate()`; asserts the consumer's MeterProvider received the counter increments (proves lazy resolution honors `setGlobalMeterProvider`).
- **RED #7 (EC-6)**: with cluster of 21 candidates, asserts `consolidate` returns `[]` and `distillation.consolidation.cluster_too_large` counter incremented.
- **GREEN:** implement using `LLM` DIP + lazy counters + cluster cap + `parseConsolidationResponse` semantic validation; all 7 RED tests PASS.
- **REFACTOR:** factor `parseConsolidationResponse` as exported testable helper; JSDoc cites EC-2 + EC-4 + EC-6 with `@see` to this plan task.

**Acceptance criteria:**
- [ ] ONE LLM call per cluster (not per memory)
- [ ] Verbatim `reason` from LLM response persisted to `consolidation_history.reason`
- [ ] JSON-parse failure → abstain (return empty), no crash; OTel counter increment (EC-10 already covered by Cycle 2 OpenAILLM)
- [ ] **EC-2**: `parseConsolidationResponse` rejects responses where `kept_id ∉ clusterIds` OR any `rejected_id ∉ clusterIds` OR `kept_id ∈ rejected_ids` — abstains via OTel counter
- [ ] **EC-4**: all `distillation.*` counters use lazy-init pattern per `src/local/eviction/pg-evictor.ts:56-58`; consumer-installed `MeterProvider` honored
- [ ] **EC-6**: cluster size > 20 → abstain + `distillation.consolidation.cluster_too_large` counter
- [ ] LoC ≤ 120 + ≤ 80; no `any`
- [ ] Prompt file separated for inspection/version-control (consumers can grep `CONFLICT_MERGE_PROMPT` in source)

**COMMIT:** `feat(core)(v0-7): LlmJudgedMergeConflictPolicy with semantic validation + lazy OTel + cluster cap (T1.3 / ADR D2 / EC-2 + EC-4 + EC-6)`

### T2.1 — Wire `ConflictResolutionPolicy` into `reflect()` execute pipeline

**Plan reference:** ADR D1 + ADR D2.

**Files to edit:**
- `src/core/reflection/execute.ts` (UPDATE — accept `conflictResolution?: ConflictResolutionPolicy` option; after derivation step, cluster candidates + invoke policy + persist results)
- `src/core/reflection/types.ts` (UPDATE — extend `ReflectionOptions` type)
- `src/core/memory.ts` (UPDATE — `Memory.reflect({ conflictResolution })` public surface)
- `src/local/pgvector-store.ts` (UPDATE — add `insertConsolidationHistory(result)` method; soft-delete rejected via existing `t_invalid` write)
- `tests/integration/distillation/reflect-with-policy.test.ts` (NEW)
- `src/core/reflection/__tests__/execute.test.ts` (UPDATE — add policy-injection cases)

**Deep file dependency analysis:**
- v0.4a's `executeReflection(memory, options)` already orchestrates derivation; v0.7 adds a POST-derivation consolidation phase
- Clustering: pre-existing `pgvector` cosine search at threshold ≥ 0.95 (per Mem0 entity-link precedent at `mem0/mem0/memory/main.py:918`) groups cosine-similar memories sharing entity overlap
- Soft-delete via `t_invalid = NOW()` per ADR-0006 + v0.4b precedent (NOT hard-delete)
- Audit row in `consolidation_history` written atomically with `t_invalid` update via `withTransactionFn` (v0.6.1 precedent at `src/local/pgvector-store.ts:insertDerivedSkillAtomic`)
- **EC-4 absorbed**: `execute.ts` OTel counters `distillation.consolidation.{kept,rejected,abstain}` resolved lazily INSIDE the wiring function body via `metrics.getMeter('@usetheo/memory/distillation').createCounter('...')` — NEVER at module load — per F-dom-6 / v0.4b `T10.1` precedent at `src/local/eviction/pg-evictor.ts:56-58`. Consumer-side `setGlobalMeterProvider(...)` honored regardless of import order.
- **EC-7 absorbed**: early-exit guard at the top of the consolidation phase — if `recall.length === 0` (scope is empty), return cleanly with 0 LLM calls, 0 `consolidation_history` rows, no exceptions. Prevents wasteful instantiation of LLM judge for empty scope.
- **EC-8 absorbed**: the `withTransactionFn` wrapping `t_invalid` updates + `insertConsolidationHistory` MUST roll back ATOMICALLY if `insertConsolidationHistory` throws mid-transaction. Verifies BEGIN-COMMIT discipline; the consumer must never observe a half-applied state where memories are soft-deleted but no audit row was written (nor the inverse).

**TDD:**
- **RED #1**: integration test seeds 2 contradictory memories ("Paulo likes coffee" + "Paulo dislikes coffee") under same scope; calls `memory.user("paulo").reflect({ conflictResolution: new LastWriteWinsConflictPolicy() })`; asserts (a) 1 memory has `t_invalid IS NOT NULL` post-reflect, (b) `consolidation_history` has 1 row with verbatim `reason`. FAILS — no wiring.
- **RED #2 (EC-7)**: `tests/integration/distillation/reflect-empty-scope.test.ts` (NEW) — given a NEW user with 0 memories, `memory.user('alice-fresh').reflect({ conflictResolution: new LlmJudgedMergeConflictPolicy({ llm: mockLLM }) })` returns cleanly + 0 LLM calls on `mockLLM` + 0 rows in `consolidation_history` + no exceptions. FAILS without early-exit guard.
- **RED #3 (EC-8)**: `tests/integration/distillation/reflect-atomic-rollback.test.ts` (NEW) — mocks `pgvector-store.insertConsolidationHistory` to THROW on second invocation; verifies (a) NO memories have `t_invalid IS NOT NULL` (rollback worked), (b) `consolidation_history` has 0 rows, (c) `reflect()` raises a typed error (not a silent corruption). Uses v0.6.1 `withTransactionFn` pattern.
- **RED #4 (EC-4)**: consumer test installs a non-default `MeterProvider` BEFORE invoking `reflect()`; after consolidation, asserts the consumer's counters captured the increments (proves lazy resolution in `execute.ts`).
- **GREEN:** wire policy into `execute.ts` with (a) lazy OTel counters, (b) `if (recall.length === 0) return;` early-exit, (c) `withTransactionFn` wrapping `t_invalid` UPDATE + `insertConsolidationHistory` INSERT; all 4 RED tests PASS.
- **REFACTOR:** SRP — `execute.ts` orchestrates; `clusterCandidates(memories)` extracted to helper; `persistConsolidation(results, store)` extracted to atomic-tx helper; policy.consolidate is the strategy plug.

**Acceptance criteria:**
- [ ] `Memory.reflect({ conflictResolution })` option accepted; defaults to `new NoopConflictPolicy()` if omitted
- [ ] After consolidation: rejected memories have `t_invalid IS NOT NULL`; `consolidation_history` has matching audit row
- [ ] Default `NoopConflictPolicy` preserves v0.4a behavior byte-identical (regression test passes)
- [ ] OTel counters `distillation.consolidation.{kept,rejected,abstain}` emit non-zero on integration test
- [ ] **EC-4**: lazy-init pattern verified by consumer-MeterProvider test
- [ ] **EC-7**: empty-scope no-op verified by `reflect-empty-scope.test.ts`
- [ ] **EC-8**: atomic rollback verified by `reflect-atomic-rollback.test.ts`

**COMMIT:** `feat(reflection)(v0-7): wire ConflictResolutionPolicy into reflect() with lazy OTel + empty-scope guard + atomic-tx (T2.1 / ADR D1 + D2 / EC-4 + EC-7 + EC-8)`

### T3.1 — Gold-set fixtures (200 episodes)

**Plan reference:** ADR D4.

**Files to edit:**
- `tests/fixtures/distillation/README.md` (NEW — cites MemoryBank methodology)
- `tests/fixtures/distillation/single-fact/{01..50}.json` (NEW — 50 files)
- `tests/fixtures/distillation/multi-fact/{01..50}.json` (NEW — 50 files)
- `tests/fixtures/distillation/contradiction-pair/{01..25}.json` (NEW — 25 files)
- `tests/fixtures/distillation/entity-overlap/{01..25}.json` (NEW — 25 files)
- `tests/fixtures/distillation/simulated-dialog/{01..50}.json` (NEW — 50 LLM-generated + human-verified)
- `tests/fixtures/distillation/loader.ts` (NEW — `loadGoldSet(): GoldSetFixture[]`)

**Deep file dependency analysis:**
- Fixture shape per ADR D4 declared schema
- `simulated-dialog/` fixtures are generated by running gpt-4o-mini with a "simulate diverse users" prompt against `tests/fixtures/distillation/prompts/simulate-user.txt`; human reviews + commits the verified ones (per blueprint EC-A mitigation)
- Loader at `tests/fixtures/distillation/loader.ts` returns typed `GoldSetFixture[]` via `JSON.parse`

**TDD:**
- **RED:** `tests/unit/distillation/gold-set-shape.test.ts` (NEW) asserts `loadGoldSet()` returns 200 fixtures + each conforms to schema. FAILS (no loader).
- **GREEN:** implement loader; commit 200 fixture files.
- **REFACTOR:** none (data-only).

**Acceptance criteria:**
- [ ] 200 fixtures across 5 categories per declared counts
- [ ] Schema-validated via Zod in loader
- [ ] README cites MemoryBank methodology + snapshot path
- [ ] No paper names (`MemoryBank`, etc.) in JSON files — only the README cites the prior art

**COMMIT:** `feat(tests)(v0-7): commit 200-episode gold set + Zod loader (T3.1 / ADR D4)`

### T3.2 — Eval script + matrix

**Plan reference:** ADR D5.

**Files to edit:**
- `docs/distillation-evaluation/run.ts` (NEW — mirrors `docs/forgetting-evaluation/run.ts` pattern)
- `docs/distillation-evaluation/README.md` (NEW)
- `docs/distillation-evaluation.md` (NEW — matrix output; committed empty initially, updated by eval)
- `package.json` (UPDATE — add `"eval:distillation": "tsx docs/distillation-evaluation/run.ts"` script)
- `tests/unit/distillation/precision-recall.test.ts` (NEW — unit tests for metric helpers)
- `docs/distillation-evaluation/metrics.ts` (NEW — `precision(extracted, expected)`, `recall(extracted, expected)`, `conflictResolutionAccuracy(decisions, expected)` helpers via BLEU + entity-overlap-Jaccard)

**Deep file dependency analysis:**
- Pattern mirrors v0.4b `docs/forgetting-evaluation/run.ts` (`T7.3`, shipped)
- Loads gold set via T3.1 loader
- Runs each fixture through `memory.reflect({ conflictResolution: P })` for each of 3 policies
- Computes precision/recall + writes matrix to `docs/distillation-evaluation.md`
- Uses `ankane/pgvector:v0.5.1` per docker-compose (consumer must have container running per dev story Q6 + R6)
- **EC-10 absorbed**: BLEU score is computed via `natural.BleuScore` — `natural@^8.1.0` is ALREADY in `package.json#optionalDependencies` (shipped v0.6.1 voyager-skill-library). Zero new deps per ADR D6 (confirmed by `/deps-audit` 2026-06-01). Entity-overlap-Jaccard is plain-set arithmetic (no lib).
- **EC-11 absorbed**: `npm run eval:distillation` REQUIRES these pre-conditions; `docs/distillation-evaluation/README.md` documents them verbatim:
  1. `npm run compose:up` — pgvector container running on port 5432
  2. `.env.local` containing `OPENAI_API_KEY=sk-...` (loaded via existing dotenv pattern)
  3. `npm run db:push` against the container (migrations applied)
  4. Cost disclosure: ~$0.50 per full eval run in OpenAI API charges (200 fixtures × 3 policies; only `LlmJudgedMergeConflictPolicy` makes LLM calls; gpt-4o-mini at ~$0.001/contradiction × ~500 contradictions per run)

**TDD:**
- **RED #1**: `precision-recall.test.ts` asserts `precision([{text:'a'},{text:'b'}], [{text:'a'},{text:'c'}]) === 0.5` etc. FAILS (no metrics).
- **RED #2 (EC-10)**: `metrics.test.ts` asserts `bleuScore('the cat sat on the mat', 'the cat sat on a mat') > 0.7` via `natural.BleuScore`. FAILS without import.
- **GREEN:** implement metric helpers (`precision`, `recall`, `bleuScore` via `natural`, `entityOverlapJaccard`) + eval script.
- **REFACTOR:** SRP — `run.ts` orchestrates; metrics live in `metrics.ts`; `natural.BleuScore` wrapped to expose a pure function signature.

**Acceptance criteria:**
- [ ] `npm run eval:distillation` runs in < 10 min against pgvector container
- [ ] `docs/distillation-evaluation.md` matrix committed with 3-row (policy) × 4-column (precision, recall, conflict-resolution-accuracy, runtime) layout
- [ ] Metric helpers unit-tested (≥ 6 test cases)
- [ ] **EC-10**: `bleuScore` uses `natural.BleuScore` (already in optionalDependencies); zero new deps
- [ ] **EC-11**: `docs/distillation-evaluation/README.md` documents 4 pre-conditions verbatim (compose:up + OPENAI_API_KEY + db:push + ~$0.50 cost disclosure)
- [ ] Honest disclosure: README documents that precision/recall thresholds are baselines; consumers may tune

**COMMIT:** `feat(eval)(v0-7): docs/distillation-evaluation eval script with natural.BleuScore + pre-conditions doc (T3.2 / ADR D5 / EC-10 + EC-11)`

### T3.3 — THE GOAL TEST integration test

**Plan reference:** Goal section + CLAUDE.md Roadmap Item 9.

**Files to edit:**
- `tests/integration/distillation/the-goal-test.test.ts` (NEW)
- `tests/integration/distillation/fixtures-helper.ts` (NEW — reuses T3.1 loader + sets up pgvector schema)

**Deep file dependency analysis:**
- Asserts the 4 binary acceptance metrics per Goal section
- Runs against `ankane/pgvector:v0.5.1` container
- Uses `npm run test:integration` runner per testing.md § Pyramid Integration tier
- Test runtime budget: ≤ 60s per run; total budget ≤ 200s for 3-run stability check (EC-5)
- **EC-4 absorbed (cross-cutting)**: THE GOAL TEST setup installs a TEST-LOCAL `MeterProvider` (via `@opentelemetry/sdk-metrics` in-memory exporter) and asserts the `distillation.goal_test.pass` + `distillation.precision` + `distillation.recall` + `distillation.conflict_resolution_accuracy` counters fire on it — proving the production lazy-init code path (T1.3, T2.1) does NOT capture the no-op default `MeterProvider`.
- **EC-5 absorbed**: THE GOAL TEST configuration MUST pin `LlmJudgedMergeConflictPolicy` to `{ temperature: 0, seed: 42 }` (when supported by the LLM impl) to defeat sampling non-determinism. The test then runs 3 CONSECUTIVE times and asserts `|run_i.precision - run_j.precision| < 0.05` AND `|run_i.recall - run_j.recall| < 0.05` AND `|run_i.accuracy - run_j.accuracy| < 0.05` for all pairs (i, j). Stability test acts as a flakiness guardrail PRE-merge — `/implement` halt-loop refuses to mark T3.3 done if any pairwise delta exceeds 0.05.

**TDD:**
- **RED #1**: integration test asserts `precision ≥ 0.75 + recall ≥ 0.70 + conflict-resolution accuracy ≥ 0.80 + every persisted fact has non-empty derived_from`. FAILS until T2.1 + T3.1 + T3.2 land.
- **RED #2 (EC-5)**: 3-run stability test — runs THE GOAL TEST configuration 3× in a single test body; asserts pairwise deltas < 0.05 on each of the 3 metrics. FAILS if `LlmJudgedMergeConflictPolicy` constructor does NOT accept `{ temperature, seed }` OR if T1.3 doesn't forward them to the LLM call.
- **RED #3 (EC-4)**: test-local `MeterProvider` test — verifies counters fire on the consumer-provided provider. FAILS if any counter is materialized at module-load.
- **GREEN:** all 3 RED tests PASS post-T3.2.
- **REFACTOR:** extract `runGoalTestOnce(): { precision, recall, accuracy }` helper; stability test calls it 3×; metric assertions live in shared `assertGoalTestMetrics()`.

**Acceptance criteria:**
- [ ] All 4 thresholds met against gold set on at least 1 run
- [ ] **EC-5**: 3 consecutive runs produce pairwise deltas < 0.05 on precision, recall, accuracy (stability gate)
- [ ] **EC-4**: test-local `MeterProvider` captures `distillation.*` counter increments (lazy-init verified end-to-end)
- [ ] Per-run runtime ≤ 60s; total stability run ≤ 200s
- [ ] `npm run test:integration -- tests/integration/distillation/the-goal-test.test.ts` PASS

**HONEST DISCLOSURE:** If thresholds not met on first run, T3.3 fails → /implement halts → /review verdict NEEDS_FIXES → file v0.7.1 fixup cycle per v0.4b/v0.6 precedent. No "lower the threshold to pass" anti-pattern. Similarly, if stability gate fails (pairwise delta ≥ 0.05), `/implement` halts; do NOT silently widen the tolerance.

**COMMIT:** `test(integration)(v0-7): THE GOAL TEST — precision/recall/accuracy + 3-run stability + lazy OTel (T3.3 / EC-4 + EC-5)`

### T4.1 — Integration validation gate + docs + CHANGELOG + push

**Plan reference:** standard /implement T4.1 pattern.

**Tasks:**
1. `npm test` exit 0
2. `npm run typecheck` exit 0
3. `npm run lint` exit 0
4. `npm run build` PASS
5. `npm run test:integration -- tests/integration/distillation/` PASS (including THE GOAL TEST)
6. `npm run eval:distillation` runs + updates `docs/distillation-evaluation.md`
7. CHANGELOG `[Unreleased] § Added` entry
8. No vocab-lock violations (`production-ready` / `production-grade` / `v1.0 ready`)
9. No paper names in src/test code
10. `npm pack --dry-run` lists `src/core/conflict-resolution/**/*.ts` + `src/core/dip/conflict-resolution-policy.ts`
11. Push to `origin/develop`

**Acceptance criteria:**
- [ ] All 11 checks PASS
- [ ] Validation report at `.claude/knowledge-base/reviews/v0-7-distillation-pipeline-implement-validate-{date}.md`

**COMMIT:** `chore(implement)(v0-7): validation gate + docs/distillation-evaluation.md + push (T4.1)`

## Coverage Matrix

| # | Gap / Requirement (from blueprint Recommendations + CLAUDE.md Item 9) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Schema: `consolidation_history` table + `derived_from` multi-source semantics | T0.1 | Migration 0007 + journal snapshot + rollback runbook + repair script |
| 2 | `ConflictResolutionPolicy` DIP per blueprint R3 | T1.1 | 9th DIP at `src/core/dip/` matching `eviction-policy.ts` precedent |
| 3 | `NoopConflictPolicy` (DEFAULT — Mem0-parity per blueprint B-D2) | T1.2 | Pure-function impl |
| 4 | `LastWriteWinsConflictPolicy` (deterministic) | T1.2 | Pure-function impl |
| 5 | `LlmJudgedMergeConflictPolicy` (LLM call + verbatim audit per blueprint R8) | T1.3 | Depends only on `LLM` DIP; abstain on JSON-parse failure |
| 6 | Wire into `reflect()` execute pipeline (Mem0-shape per blueprint B-D1) | T2.1 | Cluster + invoke + soft-delete + audit row atomic via `withTransactionFn` |
| 7 | Gold-set fixtures from MemoryBank methodology (blueprint R4 + D4) | T3.1 | 200 fixtures across 5 categories |
| 8 | Reproducible eval script (blueprint R6 + D5) | T3.2 | `docs/distillation-evaluation/run.ts` mirroring v0.4b `T7.3` pattern |
| 9 | THE GOAL TEST per CLAUDE.md Item 9 acceptance | T3.3 | 4 binary thresholds (precision ≥ 0.75 + recall ≥ 0.70 + accuracy ≥ 0.80 + non-empty derived_from) |
| 10 | Zero new deps (blueprint B-D4 + D6) | T4.1 | Validation gate verifies `npm pack --dry-run` lists only existing deps; `/deps-audit` at plan-confidence phase already PASS_WITH_CAVEATS (2026-06-01 — zero new deps confirmed empirically). |
| 11 | Validation gate + docs + push | T4.1 | Standard /implement T4.1 |

11 / 11 mapped. Coverage Matrix: 100%.

## Global Definition of Done

- [ ] All 9 task groups committed (T0.1, T1.1, T1.2, T1.3, T2.1, T3.1, T3.2, T3.3, T4.1)
- [ ] `npm test` exit 0
- [ ] `npm run typecheck` exit 0
- [ ] `npm run lint` exit 0
- [ ] `npm run build` PASS
- [ ] `npm run test:integration -- tests/integration/distillation/` PASS
- [ ] THE GOAL TEST PASSES (precision ≥ 0.75 + recall ≥ 0.70 + accuracy ≥ 0.80 + non-empty derived_from)
- [ ] `npm run eval:distillation` produces matrix at `docs/distillation-evaluation.md` (committed with actual numbers)
- [ ] CHANGELOG `[Unreleased] § Added` entry mentions v0.7 + cites discovery blueprint + plan slug
- [ ] No vocab-lock violations (`production-ready` / `production-grade` / `v1.0 ready`)
- [ ] No paper names in src/test code (`Voyager` / `Mem0` / `Letta` / `MemoryBank` / `CoALA` / `Generative Agents`) — citations live ONLY in `tests/fixtures/distillation/README.md` + `docs/distillation-evaluation/README.md`
- [ ] DIP boundaries preserved (no `src/core/` → `src/local|cloud/` reverse imports)
- [ ] File-size budgets respected (`src/core/dip/conflict-resolution-policy.ts` ≤ 80; `src/core/conflict-resolution/{noop,last-write-wins}.ts` ≤ 80 each; `src/core/conflict-resolution/llm-judged-merge.ts` ≤ 120; `src/core/conflict-resolution/prompts.ts` ≤ 80)
- [ ] OTel counters `distillation.consolidation.{kept,rejected,abstain}` observed non-zero in THE GOAL TEST run
- [ ] Migration `0007` idempotent (running `runMigrations()` twice no-ops on second call)
- [ ] Rollback runbook at `docs/runbook-v0-7-rollback.md` documents `DROP TABLE consolidation_history` + journal cleanup
- [ ] Pushed to `origin/develop`
- [ ] Plan archived to `.claude/knowledge-base/plans/completed/` AFTER /review READY_TO_MERGE + PR merged

## Final Phase: Integration Validation (T4.1)

`npm test && npm run typecheck && npm run lint && npm run build && npm run test:integration -- tests/integration/distillation/ && npm run eval:distillation && grep -cE "v0\.7|distillation-pipeline" CHANGELOG.md >= 1` returns exit 0.

Re-run of `/review v0-7-distillation-pipeline` mandatory before PR — this cycle introduces a new DIP + 3 implementations + schema migration + public API extension (`Memory.reflect({ conflictResolution })`); architectural surface is non-trivial.
