# Review: v0-7-distillation-pipeline

**Date:** 2026-06-02
**Verdict:** **NEEDS_FIXES**
**Reviewers (spawned agents — all 7 completed):**
- architecture
- tests
- wiring
- cross-validation
- domain-pgvector-schema
- domain-memory-layer
- domain-db-migrations

**Scope:** delta `bab7a02^..HEAD` (15+ commits implementing the v0.7 episodic→semantic distillation pipeline + the v0.7.1 LLM-MEASURED follow-up `a15d9eb`).

**Note on automated consolidation:** the `consolidate_findings.py` script reported 0/0/0/0/0 because the agents' YAML files use multi-line `reviewer_note:` block scalars that the parser doesn't recognize. The aggregation below is manual, based on each agent's structured summary.

## Findings summary

**Raw aggregate (pre-dedup):**
- BLOCKER: 0
- CRITICAL: 3
- MAJOR: 16
- MINOR: 19
- INFO: 45

**Consolidated (post-dedup; some issues flagged by 2-4 agents):**
- BLOCKER: 0
- **CRITICAL: 3** (consolidated from 4 raw — 2 schema/wiring issues converged with architecture+pgvector+db-migrations reviewers)
- MAJOR: 11
- MINOR: 12
- INFO: 7 thematic positive confirmations across 45 raw

**Verdict rationale:** per `cycle-review.md § Hard gates`, CRITICAL findings require HALT before merge unless explicitly dismissed with ADR-style rationale. The 3 CRITICALs below are NOT yet dismissed; fix-up cycle required.

---

## CRITICAL findings (MUST resolve before merge OR dismiss with ADR)

### F-C1 — `recallConsolidationCandidates` does NOT cluster; mass-tombstones unrelated memories

- **Severity:** CRITICAL
- **Found by:** domain-memory-layer (F-dom-mem-1)
- **File:** `src/local/pgvector-store.ts:555-577`
- **Plan reference:** T2.1 (Mem0 entity-link precedent: cosine clustering at threshold ≥ 0.95)
- **Problem:** the shipped implementation `SELECT * FROM memories WHERE user_id=$1 AND t_invalid IS NULL` returns the ENTIRE active scope as a single bag. Combined with `LastWriteWinsConflictPolicy` returning `{ kept: 1, rejected: ALL OTHERS }`, calling `reflect({ conflictResolution: LWW })` against a scope of 50 unrelated memories will soft-delete 49 of them.
- **Why integration tests miss it:** existing integration tests use 2-memory contradiction pairs — clustering is trivially correct at N=2. THE GOAL TEST + the v0.7.1 LLM-MEASURED test use 10 hand-authored unambiguous pairs of unrelated facts each in isolation; they exercise the policy correctness but NOT the cluster-recall correctness.
- **Recommended action — choose one:**
  - **(a) FIX:** add cosine clustering inside `recallConsolidationCandidates` (per plan T2.1 Mem0 precedent: ≥ 0.95 threshold). Mirror v0.4b nearest-neighbor pattern at `src/local/eviction/`.
  - **(b) DISMISS:** add explicit ADR in plan v1.2 amending T2.1 to "consolidation is whole-scope by design; consumer responsibility to scope-isolate before calling reflect()". Update LJM system prompt accordingly. Add per-policy guards against mass-tombstones at N ≥ TBD threshold.

### F-C2 — `recallConsolidationCandidates` does NOT filter `kind != 'skill'` nor `superseded_by IS NULL`

- **Severity:** CRITICAL
- **Found by:** domain-memory-layer (F-dom-mem-2) + architecture (F-arch-2)
- **File:** `src/local/pgvector-store.ts:555` (no `AND kind = 'extracted'` clause)
- **Plan reference:** T2.1 (episodic→semantic boundary)
- **Problem:** v0.6 Voyager skill rows (`kind='skill'`) and already-superseded skill chains enter the consolidation cluster. A consumer running `reflect({ conflictResolution })` on an `agent_id` scope that ALSO holds a `memory.skills(repoId)` library will mass-tombstone the skill library. Same applies to already-derived rows (`kind='derived'`) — they get re-consolidated on the 2nd reflect() call, breaking the episodic→semantic boundary.
- **Recommended action:** add `AND kind = 'extracted'` filter to `recallConsolidationCandidates`. One-line change. Add an integration test that seeds a `memory.skills(repoId)` library + extracted memories in the same scope, runs `reflect({ conflictResolution: LWW })`, and asserts the skill library survives.

### F-C3 — `consolidation_history` table is NOT declared in `src/local/schema.ts`; `drizzle-kit push` workflow loses data

- **Severity:** CRITICAL
- **Found by:** domain-db-migrations (F-dom-db-1) + domain-pgvector-schema (F-dom-pgvector-1) + architecture (F-arch-1) + wiring (F-wire-4) — **4 reviewers flagged**
- **File:** `src/local/schema.ts` (missing `consolidationHistory` pgTable export) vs migration `0007_distillation_columns.sql` (creates the table) + `meta/0007_snapshot.json:577-680` (declares it)
- **Plan reference:** T3.2 § EC-11 + `docs/distillation-evaluation/README.md:48` (eval workflow uses `npm run db:push`)
- **Problem:** `drizzle.config.ts:20` points drizzle-kit at `./src/local/schema.ts`, and the plan explicitly requires `npm run db:push` as a dev workflow path. `package.json:76 "db:push"` chains `drizzle-kit push && node scripts/apply-trigger-migrations.mjs` — neither replays the SQL migration file 0007. An operator following the documented workflow ends up with a DB lacking the table; integration tests would fail with `relation "consolidation_history" does not exist`. Worse: push-flow against an already-migrated DB would compute a destructive DROP TABLE diff and silently lose all GDPR-survival audit rows.
- **Recommended action:** add `consolidationHistory` pgTable export to `src/local/schema.ts` mirroring the snapshot's column shape (uuid PK, `keptMemoryId.references(() => memories.id, { onDelete: 'set null' })`, two JSONB arrays, `reason`/`policyName` text NOT NULL, `createdAt` timestamptz, plus the two btree indexes); extend `tests/integration/config-parity.test.ts` to assert every table in `meta/*_snapshot.json` is declared in `schema.ts`. One mechanical commit.

---

## MAJOR findings (11 consolidated)

- **F-M1** (arch F-arch-3): `src/local/index.ts` ballooned to **1078 LoC** (> 500 budget per architecture.md § Module hygiene). Refactor: extract `applyDimChange + runMigrations` to `migrations.ts`; extract `LocalScopedMemory + LocalMemory` to `local-memory.ts`.
- **F-M2** (arch F-arch-4): `src/local/pgvector-store.ts` at **686 LoC** (> 500). Mirror v0.6.1 skill-store composition split.
- **F-M3** (tests F-tests-1 + wiring F-wire-1 — same root): LWW wiring path emits ZERO `distillation.consolidation.*` counters; only LJM fires them from its own `consolidate()`. Plan T2.1 acceptance + Global DoD required policy-agnostic counters non-zero on integration test. Fix: lazy-init counters at the wiring layer (mirrors v0.4b pg-evictor precedent).
- **F-M4** (tests F-tests-2 + wiring F-wire-2): no integration test installs a non-default `MeterProvider` via `@opentelemetry/sdk-metrics`; lazy resolution at integration depth is unverified. Fix: add `reflect-with-policy-otel.test.ts` with `InMemoryMetricExporter`.
- **F-M5** (tests F-tests-3): `the-goal-test-llm-measured.test.ts` reports 1.000/1.000/1.000 against 10 categorically-distinct hand-authored fixtures. The test header does NOT acknowledge this limitation; reads as if it validates ambiguous-fixture quality. Fix: amend docstring + add explicit caveat in CHANGELOG entry.
- **F-M6** (domain-memory F-dom-mem-3): plan T2.1 declared wiring locus = `src/core/reflection/execute.ts`; shipped locus = `src/local/index.ts`. Plan-vs-code drift; ADR D1's "logic-layer extension" claim is technically incorrect (it's runtime-layer). Fix: amend plan v1.1 + ADR D1 OR refactor wiring.
- **F-M7** (domain-memory F-dom-mem-4): `recallConsolidationCandidates` only checks `t_invalid IS NULL`; missing `t_valid <= NOW()` guard for forward-compat with v0.5 cloud bi-temporal.
- **F-M8** (domain-memory F-dom-mem-5): baseline T3.3 GOAL TEST uses LWW (no LLM); LLM-MEASURED test `describe.skipIf(...)` skips silently when `OPENROUTER_KEY` absent. CLAUDE.md Item 9 row reads as shipped but baseline has no LLM-quality signal in non-OpenRouter environments.
- **F-M9** (domain-memory F-dom-mem-6): `persistConsolidations` is atomic INTERNALLY (EC-8 absorbed), but the outer `reflect()` flow is NOT — if `executeReflection` LLM call throws AFTER `persistConsolidations` commits, the consolidation is irreversible while the derivation never happens.
- **F-M10** (domain-db-migrations F-dom-db-2): FK constraint naming drift — SQL creates `consolidation_history_kept_memory_id_fkey` (PG `_fkey` suffix) but the snapshot expects `consolidation_history_kept_memory_id_memories_id_fk` (Drizzle's `_<table>_<col>_fk` convention used by every other FK in the codebase). Future `drizzle-kit generate` would emit cleanup ALTERs.
- **F-M11** (domain-db-migrations F-dom-db-3): 0007 SQL omits `ON UPDATE NO ACTION` while all prior migrations declare it explicitly AND the snapshot expects it.

---

## MINOR findings (12 consolidated)

- **F-Mi1** (arch F-arch-5): `void options;` at `src/local/index.ts:335` is dead code (line 382 uses options.conflictResolution).
- **F-Mi2** (arch F-arch-8): `/api/memory/distill` checks `OPENAI_API_KEY` BEFORE `getSingleton()` (which does OpenRouter env-shift). In `local-openrouter` cold-start, the route 422s misleadingly.
- **F-Mi3** (cross-val F-xval-1): T3.3 does not directly `SELECT ... AND derived_from IS NOT EMPTY` (upheld by v0.4a invariant but not directly asserted).
- **F-Mi4** (cross-val F-xval-2 + domain-memory F-dom-mem-7): `LlmJudgedMergeConflictPolicy` accepts `{temperature, seed}` in constructor but defers forwarding (referenced non-existent ADR-DEFER-LLM-TEMP-SEED in JSDoc).
- **F-Mi5** (cross-val F-xval-3): `llm-judged-merge.ts` at 122 LoC vs ≤ 120 plan hint.
- **F-Mi6** (tests F-tests-4): `reflect-with-policy.test.ts:85` uses "+" conjunction in test name (anti-pattern).
- **F-Mi7** (tests F-tests-5): `precision-recall.test.ts:56` Jaccard runs 3 cases in one `it()`; refactor to `test.each`.
- **F-Mi8** (tests F-tests-6): `reflect-atomic-rollback.test.ts` mock setup ~17 lines (testing.md anti-pattern: > 5 lines).
- **F-Mi9** (tests F-tests-8): `the-goal-test-llm-measured.test.ts` mutates `process.env` at module-load; leaks under thread-pool nondeterminism.
- **F-Mi10** (wiring F-wire-3): stale line-number reference in `src/local/index.ts:375` comment (says "line 317", actual at 355).
- **F-Mi11** (domain-pgvector F-dom-pgvector-5): plan T0.1 acceptance bullet #3 required JSDoc inline on `kept_memory_id` column (rationale: GDPR hard-delete survival); present at file level but not inline.
- **F-Mi12** (domain-db-migrations F-dom-db-4): `scripts/db-repair-v0-7-partial-state.mjs` exists but is NOT registered as an npm script. v0.4b precedent IS registered. Ops UX regression.

---

## INFO (positive confirmations — high-trust signal)

- **architecture × 20**: ConflictResolutionPolicy DIP minimal-method shape correct; zero `src/local` imports from `src/core/conflict-resolution/*`; OTel lazy-init faithful to F-dom-6 / v0.4b T10.1 precedent; LJM Strategy + sibling-DIP precedent; migration 0007 idempotency well-crafted; `withTransaction` atomicity canonical; LLM-MEASURED test correctly isolates JUDGE LLM from EXTRACTION LLM via empty-stub; EC-10 honest BLEU correction preserves zero-new-deps promise.
- **cross-validation × 4**: All 9 plan tasks fully implemented with verifiable commit attribution. All 6 ADRs respected. All 11 ECs absorbed with explicit code/test markers. No plan drift (plan v1.1 frozen at `7321d73`, first /implement commit at 16:24). Exemplary honesty (EC-10 catch — `natural.BleuScore` was fabricated; corrected inline to `natural.NGrams + WordTokenizer`).
- **tests × 13**: 35 unit + 7 integration. TDD discipline PASS. EC-1/EC-3/EC-5/EC-7/EC-8 fully covered.
- **wiring × 8**: 11/11 pillar (a) static caller; 10/11 pillar (b) integration test. No orphan modules. No DIP boundary violations. No concurrent-safety regressions.
- **domain-pgvector × 5**: cross-cycle alignment with `applyDimChange` accurate; bi-temporal compatibility preserved.
- **domain-memory × 2**: ADD-only invariant preserved; Letta sleeptime rejection faithful; EC-1 lex tie-break correctly implemented.
- **domain-db-migrations × 3**: idempotency pattern sound; FK declaration ordering correct; ON DELETE SET NULL consistent with v0.6 precedent; journal monotonic + prevId chain intact; EC-3 GDPR survival test comprehensive.

---

## Edge-case coverage report

- **Covered (8/11):** EC-1 LWW lex tie-break, EC-3 FK ON DELETE SET NULL, EC-5 EC-5 3-run stability, EC-7 empty-scope graceful no-op, EC-8 atomic-tx rollback, EC-9 ADR D3 honesty, EC-10 BLEU fabrication catch, EC-11 eval pre-conditions documented.
- **Partial (3/11):** EC-2 LJM parse semantic-validate (unit-level lazy spy, downstream counter increments never asserted), EC-4 OTel lazy-init (counters declared but not asserted in integration), EC-6 cluster cap ≤ 20 (unit-level but no integration scenario at N > 20).

---

## Cross-validation summary

- **Plan tasks:** 9 (T0.1 / T1.1-T1.3 / T2.1 / T3.1-T3.3 / T4.1)
- **Fully implemented:** 9/9 with verifiable commit attribution
- **Partially:** 0
- **Missing:** 0
- **Honest divergences:** 1 (F-M6 wiring locus drift — `src/core/reflection/execute.ts` → `src/local/index.ts`, acknowledged)
- **Semantic bugs not authorized by plan:** F-C1 + F-C2 (mass-tombstone risks)

---

## Quality gates summary

- **npm test (contract)**: PASS — 680 passed + 2 skipped
- **npm run typecheck**: PASS — 0 errors
- **npm run lint**: PASS — 0 warnings
- **Integration distillation**: 7/7 PASS (gated by `THEOMEM_PG_URI` + `OPENROUTER_(API_)KEY`)
- **v0.7.1 LLM-MEASURED**: precision=1.000, recall=1.000, conflict-accuracy=1.000 on 10/10 hand-authored contradiction-pair fixtures against `openai/gpt-4o-mini` via OpenRouter (~21s, ~$0.01-0.05)
- **Coverage on critical paths**: not measured (would surface in v1.0 benchmark cycle per Item 10)
- **Wiring triad**: 11/11 (a) + 10/11 (b) + 0/5 (c) — pillar (c) gap is F-M3 + F-M4

---

## Spawned agents (audit trail)

- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02/architecture.md` + `findings/architecture.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02/tests.md` + `findings/tests.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02/wiring.md` + `findings/wiring.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02/cross-validation.md` + `findings/cross-validation.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02/domain-memory-layer.md` + `findings/domain-memory-layer.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02/domain-pgvector-schema.md` + `findings/domain-pgvector-schema.yml`
- `.claude/agents/review-v0-7-distillation-pipeline-2026-06-02/domain-db-migrations.md` + `findings/domain-db-migrations.yml`

---

## Handoff decision

**Verdict: NEEDS_FIXES** — cannot merge to main until the 3 CRITICALs are FIXED or DISMISSED with ADR-style rationale.

**Recommended path (Recomendado):** FIX. The 3 CRITICALs are mechanical:

1. **F-C3** (schema.ts drift): add `consolidationHistory` pgTable to `src/local/schema.ts` + extend `tests/integration/config-parity.test.ts` to assert snapshot-vs-schema alignment.
2. **F-C2** (`kind` filter): one-line `AND kind = 'extracted'` in `recallConsolidationCandidates` + integration test seeding a skill library that survives reflect().
3. **F-C1** (clustering): either add cosine clustering per plan T2.1 Mem0 precedent (preferred) OR amend plan v1.2 to dismiss with documented scoping requirement on consumers + add per-policy mass-tombstone guard.

Estimated scope: 1 plan v1.2 amendment + 3 mechanical fix commits + 1 audit commit. Plus optionally fix-up the 11 MAJORs (file-size budget, OTel counter assertions, etc.) in the same fix-up cycle.

Then re-run `/review v0-7-distillation-pipeline` and expect READY_TO_MERGE.

**Anti-pattern check:** per `cycle-review.md § Anti-patterns`, NEVER approve unresolved CRITICAL without explicit ADR-style dismissal. The 3 CRITICALs here are NOT dismissed; merge BLOCKED.

**v0.7 roadmap status correction:** CLAUDE.md § Phase III Item 9 was prematurely flipped to `Shipped 2026-06-02` (commit `f1b4867`/`a15d9eb` chain) BEFORE this `/review` ran. The roadmap row should be amended in the fix-up cycle to reflect `NEEDS_FIXES` status, OR the fix-up commits should ship before any downstream consumer reads the v0.7 surface.
