# SEPA log — iteration 5 / T2.1 / pre-COMMIT

**Mode:** VERBOSE
**Verdict:** GREEN with major DB-schema discovery — T0.1 migration was idempotency-broken (CREATE TABLE IF NOT EXISTS dropped FK clause if table existed); fixed inline via split-step ALTER guarded by catalog probe.

**Diff:**
- M src/core/options.ts (+15: conflictResolution?: ConflictResolutionPolicy on ReflectOptions)
- M src/local/pgvector-store.ts (+62: recallConsolidationCandidates(filters) + persistConsolidations(results) atomic via withTransaction; ConflictResolutionResult import)
- M src/local/index.ts (+40: ConflictResolutionResult+Filters imports; VectorStoreWithConsolidation interface; T2.1 wire BEFORE executeReflection; conflict-resolution policy re-exports)
- M src/local/migrations/0007_distillation_columns.sql (+13: split CREATE TABLE / ALTER FK with catalog probe so re-running adds FK if missing — root cause of EC-3 test failure on stale DB)
- M scripts/db-repair-v0-7-partial-state.mjs (+18: FK delete_rule probe + Case E reporting)
- A tests/integration/distillation/reflect-with-policy.test.ts (~130 LoC; 1 test; LWW happy path)
- A tests/integration/distillation/reflect-empty-scope.test.ts (~95 LoC; 1 test; EC-7)
- A tests/integration/distillation/reflect-atomic-rollback.test.ts (~125 LoC; 1 test; EC-8)

**Tests:** Contract suite 606/606 PASS. Distillation tests 4/4 PASS (forget-hard-survives-audit + reflect-with-policy + reflect-empty-scope + reflect-atomic-rollback). tsc clean. Paper-names clean.

**3 EC absorbed:**
- EC-4: counters lazy-init lives at policy layer (T1.3); T2.1 just invokes consolidate() which fires them.
- EC-7: empty-scope short-circuited at existing v0.4a line 317 (BEFORE my wire); validated by RED #2.
- EC-8: persistConsolidations wraps t_invalid UPDATE + INSERT into a single withTransaction; rollback verified by RED #3.

**Architectural decisions:**
- Wire BEFORE executeReflection (not after) so LLM-extraction failure doesn't mask consolidation failure modes.
- Real createdAt via recallConsolidationCandidates query (not sourceMemories.map which uses fake new Date()) — EC-1 LWW comparator needs real timestamps.
- Single-cluster simplification: all sourceMemories pass as ONE cluster. Cluster construction (cosine ≥ 0.95 + entity overlap) deferred to T3.3 fixture setup (consumer concern per architecture).
- VectorStoreWithConsolidation interface narrowed (recallConsolidationCandidates? + persistConsolidations?) — runtime guards throw informative error if InMemoryVectorStore used with conflictResolution.

**T0.1 retrospective**: migration EC-3 contract was broken at initial commit (FK silently dropped on re-run). Fixed via split-step ALTER + IF NOT EXISTS catalog probe. Repair script extended with FK probe + Case E. Same-iteration fix because T2.1 surfaced the defect via real EC-3 integration test.

No paper-names; no production-ready tokens. Wiring a=pass b=pass c=n/a (policy emits counters; T2.1 wire doesn't add new metrics directly).
