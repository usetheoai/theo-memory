# SEPA Initial Brief — themory-scoped-forget-and-retrieval-counter (2026-06-20)

Key verified facts (drive the loop):
- EC-1: memory_entities.memory_id (0018) + entity_edges.source_memory_id (0019) are ALREADY `ON DELETE CASCADE` → hard DELETE cascades cleanly. DO NOT add a children-first branch (would be dead code → /code-quality hard cap). Keep test_hard_forget_of_entity_linked_memory_succeeds as a regression guard.
- T2.3 CRITICAL: LocalScopedMemory.recall has TWO return paths (cache-bypass early-return ~scoped-memory.ts:274-280; cache-aware ~282-307). The fail-soft increment MUST cover EVERY return (factor a private #countRecall or increment once before a single return). A cache-hit path that skips the increment under-counts in production. Add a cache-enabled recall test asserting increment fires on HIT.
- usageCounterStore = new OPTIONAL field on LocalMemoryConfig (mirror memoryEntityStore/memoryGraphStore), read via this.config.usageCounterStore — NOT a LocalScopedMemory constructor param.
- metricsHandler is (c, memory) today → add 3rd param usageCounterStore? + AppOptions.usageCounterStore; factory + run-server must construct against the SAME pool (config.vectorStore.poolForEviction).
- EC-3 byte-identical COALESCE(col,'') across UNIQUE (0020) + increment ON CONFLICT + getRecallCount WHERE, + TS workspace_id ?? 'default' on write AND read. The split-counter bug passes single-row tests but fails the GOAL test. test_increment_and_read_agree_on_workspace_key MUST run against real pg.
- 404-not-403 (D1): cross-subject/cross-workspace/missing all → 404; assert the victim row SURVIVES (not throw-only).
- T1.2 422-vs-404: bad memId(non-UUID)→422; bad type→404; cross-scope→404; no 403. Assert exact status codes.
- 4-field metric shape: assert Object.keys.sort() == exact 4-key set.
- EC-6: increment only in LocalScopedMemory.recall, NOT skill path; JSDoc honesty note required.

Sequencing: Phase1⟂Phase2; within Phase2 strict T2.1→T2.2→T2.3→T2.4 (T2.3 needs T2.2 factory wiring live or increment silently no-ops; T2.4 GOAL read needs T2.3 increment live).

Confidence caps are heuristic false-positives (vague_acceptance_criteria: 0 truly vague; concurrency soft-floor: the `(none — single-threaded)` escape + real Promise.all N=50/N=20 tests exist).
