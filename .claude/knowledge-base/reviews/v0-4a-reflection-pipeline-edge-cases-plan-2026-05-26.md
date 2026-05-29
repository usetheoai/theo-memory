# Edge Case Review (Plan) — v0-4a-reflection-pipeline

Data: 2026-05-26
Plan analisado: `.claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md` (v1.0, 1215 LoC)
Tasks analisadas: 13 (T0.1, T0.2, T1.1, T1.2, T2.1, T3.1, T4.1, T4.2, T4.3, T5.1, T5.2, T6.1, T7.1)
Edge cases encontrados: 18 (MUST FIX: 7, SHOULD TEST: 7, DOCUMENT: 4)

---

## MUST FIX

### EC-1: Zero-weight divide-by-zero in `AdditiveWeightedScoring`

- **Task afetada:** T1.2
- **Família:** Input / Boundary
- **Cenário:** Consumer instantiates `new AdditiveWeightedScoring({ recency: 0, relevance: 0, importance: 0 })`. The weighted-sum normalization in plan D3 divides by the sum of weights (`(0+0+0) = 0`) → NaN. Downstream `score >= threshold` comparisons silently become `false`; reflection never fires. Silent breakage.
- **Impacto:** Memory.recall ranking produces NaN; downstream sort + threshold gates misbehave.
- **Fix sugerido:** Constructor validation — `if (recency + relevance + importance === 0) throw new InvalidScoringWeightsError("at least one weight must be > 0")`. New error class adjacent to `ReflectionProvenanceMissingError` in `src/core/errors.ts`.

### EC-2: Counter integer overflow on `reflection_counters.count`

- **Task afetada:** T0.2, T2.1
- **Família:** Resource / State
- **Cenário:** Plan D4 + T0.2 declares `count: integer().notNull().default(0)`. Postgres `integer` is 32-bit signed (max 2,147,483,647). A popular scope receiving 10 writes/second sustained overflows in ~6.8 years; 100/sec overflows in ~8 months. Once it overflows, Postgres throws `integer out of range` on next bump → write path fails for that scope.
- **Impacto:** Production write outage on high-traffic scopes; manual DB intervention required to fix.
- **Fix sugerido:** Use `bigint` (`bigserial` is already used elsewhere in v0.1 schema — `history.id`). Change `count: integer()` → `count: bigint({ mode: 'number' })` or `bigint({ mode: 'bigint' })`. Bigint max is ~9.2 × 10^18 — outlasts the heat-death of the cache.

### EC-3: All-NULL scope row collision in `reflection_counters` composite UNIQUE index

- **Task afetada:** T0.2, T2.1
- **Família:** State / Format
- **Cenário:** Plan D4 + T0.2 declares composite UNIQUE on `(scope_user_id, scope_session_id, scope_agent_id)`. Postgres `UNIQUE` index treats NULL values as DISTINCT — so `(NULL, NULL, NULL)` rows are NOT considered duplicates. If a consumer ever calls `shouldReflect()` with an all-NULL scope, every call creates a NEW counter row (instead of incrementing the existing one). The atomic `ON CONFLICT` clause does NOT fire because there's no conflict. Counter never increments; threshold never fires; reflection never runs.
- **Impacto:** Silent failure mode — reflection appears to "do nothing" for all-NULL scopes.
- **Fix sugerido:** TWO options, pick one in T0.2: (a) explicit constraint `CHECK (scope_user_id IS NOT NULL OR scope_session_id IS NOT NULL OR scope_agent_id IS NOT NULL)` rejecting all-NULL scopes (matches `architecture.md § 1` three-tier semantics — at least one tier must be specified); (b) use `COALESCE(scope_user_id, '')` (and siblings) in the composite UNIQUE index expression so NULLs collapse. Recommend (a) — fails loudly + aligns with the 3-tier rule.

### EC-4: Invalid cron expression silently breaks `SleepTimeReflectionPolicy`

- **Task afetada:** T3.1
- **Família:** Input / Boundary
- **Cenário:** Plan T3.1 doesn't specify where `cronExpression` is validated. croner's `new Cron(invalidExpr)` throws ONLY when `.nextRun()` is called or the cron is scheduled. If validation happens lazily at `start()` time but consumer never calls `start()` (e.g., misconfigured app), the bad cron sits silently. Worse: if cron is partially valid (e.g., "0 * * * 8" — day-of-week 8 doesn't exist), croner may parse but never fire.
- **Impacto:** SleepTime policy silently no-ops; user assumes reflection runs but it doesn't.
- **Fix sugerido:** Constructor validation — invoke `new Cron(cronExpression, { paused: true })` in the constructor and catch the throw → re-throw as `InvalidCronExpressionError` with the offending pattern. Also reject `cronExpression === ''` early.

### EC-5: Empty source memories list calls LLM with empty input

- **Task afetada:** T4.1, T4.3
- **Família:** Input / Boundary / Resource
- **Cenário:** `Memory.reflect({ scope: 'alice' })` called on a scope with ZERO memories. Plan T4.1 doesn't short-circuit. LLM gets a prompt with `Messages: ` (empty body) — wastes an LLM call AND may produce hallucinated drafts referencing IDs that don't exist (the LLM "fills in" because the prompt looks under-specified).
- **Impacto:** Wasted LLM cost; provenance validation in T4.2 then fails with `ReflectionProvenanceMissingError` from hallucinated IDs (confusing error — root cause is empty input, not bad LLM).
- **Fix sugerido:** Add to `Memory.reflect()` orchestrator (T4.3 file `src/core/memory.ts`): `if (sourceMemories.length === 0) return { derivedMemoriesCreated: 0, reason: 'no-source-memories' }` BEFORE the LLM call. Also document minimum N (perhaps N=2) below which reflection is no-op.

### EC-6: Transaction boundary unspecified for multi-draft persist + provenance fail-fast

- **Task afetada:** T4.3
- **Família:** State / I/O
- **Cenário:** Plan T4.3 says "Ensure transactional integrity — either all drafts persist or none (use Postgres BEGIN/COMMIT)" — but in the REFACTOR step, NOT in the AC. The "where does the transaction begin?" question is open. If LLM returns 3 drafts and the second one fails embedding generation, the first is already persisted unless wrapped in BEGIN. Plan D7 says fail-fast aborts the cycle, but does NOT specify rollback.
- **Impacto:** Orphan rows in `memories` table with `kind='derived'` from partial reflection runs.
- **Fix sugerido:** Lock the transaction boundary in T4.3 Acceptance Criteria: "`Memory.reflect()` wraps the whole persist phase in `db.transaction(async (tx) => { for each draft: insert; if any throws → rollback })` — Drizzle's `db.transaction()` API. Test asserts orphan-free DB state when one of N drafts fails."

### EC-7: `memory.flushReflections()` helper undefined but THE GOAL TEST depends on it

- **Task afetada:** T6.1 (and indirectly T2.1 / T4.3)
- **Família:** Timing / Integration
- **Cenário:** Plan T6.1 RED scenario uses `await memory.flushReflections()` to await pending fire-and-forget reflection tasks. This helper is NOT a task in T2.1, T3.1, OR T4.3. If `ThresholdReflectionPolicy` uses `queueMicrotask(() => memory.reflect(...))` per blueprint D7, the test can't deterministically observe completion without a flush mechanism. **The Goal Test CANNOT pass as written.**
- **Impacto:** THE GOAL METRIC unreachable; T6.1 test flaky or stuck.
- **Fix sugerido:** Add to T4.3 Acceptance: "`Memory` instance exposes `flushReflections() → Promise<void>` that awaits all in-flight reflection tasks. Implementation: keep a `Set<Promise<void>>` of pending reflection promises; `flushReflections` does `await Promise.allSettled(this._pendingReflections)`." Add unit test in T4.3.

---

## SHOULD TEST

### EC-8: Min-max normalization divides by zero when all input scores equal

- **Task afetada:** T1.2
- **Teste sugerido:** `test_additive_weighted_scoring_handles_zero_variance` — score N memories where all 3 dimensions return identical values (e.g., all recency=0.5, all relevance=0.5, all importance=0.5). Assert no NaN; assert all final scores equal a stable value (e.g., 0 OR 0.5 OR 1.0 — pick and document). Min-max with min==max needs a fallback.

### EC-9: Reflecting on derived memories (transitive provenance)

- **Task afetada:** T4.3
- **Teste sugerido:** `test_reflect_includes_derived_in_source_set` — seed 50 extracted memories, run `reflect()` once → produces N derived memories. Run `reflect()` AGAIN on same scope. The new derived memory's `derived_from` may now include IDs of memories that themselves have `kind='derived'`. Assert the CHECK constraint still passes (jsonb_array_length >= 1 doesn't check kind). Document the policy: "Derived memories ARE valid sources for further reflection — provenance chains are allowed and audit-traceable." If not desired, filter source set in T4.1 to `kind='extracted'` only.

### EC-10: Migration ordering — `ADD COLUMN` before `ADD CONSTRAINT`

- **Task afetada:** T0.2
- **Teste sugerido:** `test_migration_applies_to_v01_populated_db` — populate a fresh pgvector container with 100 v0.1 memories first; THEN run the v0.4a migration `0001_reflection_columns.sql`. Assert (a) all v0.1 rows have `kind='extracted'` post-migration (DEFAULT applied), (b) CHECK constraint creates AFTER the DEFAULT backfill (Postgres ALTER TABLE ADD COLUMN ... DEFAULT is atomic but the CHECK addition is a separate statement; order matters).

### EC-11: Idempotent `start()` on `SleepTimeReflectionPolicy`

- **Task afetada:** T3.1
- **Teste sugerido:** `test_sleep_time_policy_start_twice_is_idempotent` — call `start()` twice without `stop()` in between. Assert only ONE croner job ticks (not two; not a leak). Recommend: track `this._started: boolean`; second `start()` is a no-op with a warning log.

### EC-12: `shouldReflect()` returns true but `reflect()` invocation fails (LLM down)

- **Task afetada:** T2.1
- **Teste sugerido:** `test_counter_state_when_reflect_throws` — set threshold=3, write 3 memories; intercept the reflection task and force it to throw (mock LLM down). Assert: counter row exists with `count=3`; next write bumps to count=4; modular check `4 % 3 === 1` ≠ 0 → does NOT re-fire. Document: a failed reflect() does NOT auto-retry. Consumer must invoke `memory.reflect(scope)` manually if they want a retry.

### EC-13: LLM returns valid `[]` (no drafts) is success path, not error

- **Task afetada:** T4.1, T4.3
- **Teste sugerido:** `test_reflect_returns_zero_drafts_when_llm_no_consolidation` — mock LLM returns `[]` (valid JSON, valid empty array). Assert (a) NO `ReflectionLLMResponseError` thrown, (b) `Memory.reflect()` returns `{ derivedMemoriesCreated: 0 }`, (c) no rows added to `memories`. This is the LLM honestly saying "nothing to consolidate".

### EC-14: Stale source-memory ID race (deleted between fetch + persist)

- **Task afetada:** T4.2, T4.3
- **Teste sugerido:** `test_reflect_handles_concurrent_forget_during_reflection` — start a reflect() cycle; while LLM call is in-flight (mock with delay), call `memory.forget(sourceId)` on one of the source memories. When persist runs, the derived memory's `derived_from` references a now-deleted row. Two options: (a) accept stale link (current plan D7 implicit behavior — provenance validation only checks IDs were in source set at fetch time); (b) FK constraint on `derived_from` array. Recommend (a) — simpler + matches Mem0's lack-of-FK pattern. Test should document the chosen behavior.

---

## DOCUMENT

### EC-15: croner default timezone is UTC; consumer cron expressions are timezone-naive

- **Task afetada:** T3.1
- **Risco aceito:** croner v10.x defaults to system timezone (per croner docs) UNLESS explicitly configured. Plan T3.1 doesn't document this. Consumer writing `'0 9 * * *'` (9am daily) gets 9am in WHATEVER timezone the Node process runs in — could be UTC in containers, local in dev. Add to T3.1 DoD documentation: "Cron expressions are evaluated in the timezone of the Node process. For deterministic behavior, set `process.env.TZ='UTC'` OR pass `timezone` option to `croner.Cron`." Future enhancement: expose timezone option on `SleepTimeReflectionPolicy` constructor — F-followup.

### EC-16: LLM-importance cache permanence vs PROMPT_VERSION evolution

- **Task afetada:** T5.1, T5.2
- **Risco aceito:** Plan D8 + F-importance-prompt-versioning: cache is permanent (no TTL); prompt is versioned. If `IMPORTANCE_PROMPT_VERSION` bumps from `'1.0'` to `'1.1'`, OLD cached scores were computed against `'1.0'` prompt. New cache lookups still return the old score (cache hits don't know about version). Consequence: a graceful migration would clear `llm_importance_score` column on prompt bump (one-line UPDATE). v0.4a does NOT ship this migration tooling — it's a future concern. Document in T5.2 DoD: "Cache invalidation on prompt version bump is OUT OF SCOPE for v0.4a. When `IMPORTANCE_PROMPT_VERSION` bumps in a future release, the release PR MUST include a migration `UPDATE memories SET llm_importance_score = NULL;` OR an explicit ADR explaining why the old scores are still acceptable."

### EC-17: MD5 hash collision risk on content cache

- **Task afetada:** T5.2
- **Risco aceito:** Plan D8 leverages v0.1's existing `memories_hash_unique_idx` on MD5 hash. MD5 collision probability is ~10^-29 per pair; for a million memories the collision probability is ~10^-19. **Acceptable for the cache use case.** If two pieces of content hash to the same MD5, the second write will (a) fail at the UNIQUE constraint (v0.1 behavior) before even reaching the cache lookup — so collision behavior is "second-write rejected", not "wrong-score-returned". The cache is collision-safe by virtue of v0.1's existing UNIQUE constraint. No fix needed; document.

### EC-18: Reflection LLM context-window overflow on huge source sets

- **Task afetada:** T4.1
- **Risco aceito:** A scope with thousands of memories sends thousands of memory texts to the LLM in one prompt. Most LLMs cap at 200k-1M tokens; pathological case overflows. Blueprint R11 (carried from Q4's Letta `simple_summary` 4-fallback chain) recommends a similar fallback for TheMemory: try → on context-window error, truncate → retry → on second failure, abort. v0.4a does NOT ship this fallback (YAGNI; uncommon at v0.4a usage scale). Document: "v0.4a's `Memory.reflect()` does NOT implement context-window fallbacks. Consumers running on scopes with >500 memories should chunk reflection (call `reflect()` with a sliding window, OR add a `maxSourceMemories` option). v1.x will add the Letta-style 4-fallback chain per R11." F-followup: F-reflect-context-window-fallback.

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T0.2 | 3 | 2 (EC-2, EC-3) | 1 (EC-10) | 0 |
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 2 | 1 (EC-1) | 1 (EC-8) | 0 |
| T2.1 | 3 | 2 (EC-2, EC-3 shared) | 1 (EC-12) | 0 |
| T3.1 | 3 | 1 (EC-4) | 1 (EC-11) | 1 (EC-15) |
| T4.1 | 2 | 1 (EC-5) | 1 (EC-13) | 1 (EC-18) |
| T4.2 | 1 | 0 | 1 (EC-14) | 0 |
| T4.3 | 3 | 2 (EC-6, EC-7) | 1 (EC-9) | 0 |
| T5.1 | 1 | 0 | 0 | 1 (EC-16) |
| T5.2 | 1 | 0 | 0 | 1 (EC-17) |
| T6.1 | 1 | 1 (EC-7 / flushReflections) | 0 | 0 |
| T7.1 | 0 | 0 | 0 | 0 |
| **Total** | **18** | **7** | **7** | **4** |

**Veredicto:** PLANO PRECISA DE AJUSTE

Os 7 MUST FIX são todos **boundary / state / timing** edges concretos com fixes de ≤ 3 linhas de código ou ≤ 1 frase. Não tocam ADRs lockados, não pedem novas abstrações. Resumo dos fixes:

1. **EC-1** (T1.2): Constructor reject `{0,0,0}` weights → `InvalidScoringWeightsError`.
2. **EC-2** (T0.2/T2.1): `count: bigint()` instead of `integer()` em `reflection_counters`.
3. **EC-3** (T0.2/T2.1): CHECK constraint forbidding all-NULL scope rows OR COALESCE-based composite index.
4. **EC-4** (T3.1): Validate cron expression at constructor → `InvalidCronExpressionError`.
5. **EC-5** (T4.1/T4.3): Short-circuit empty source set BEFORE LLM call.
6. **EC-6** (T4.3): Lock transaction boundary via `db.transaction()` em Memory.reflect orchestrator; assert orphan-free on partial failure.
7. **EC-7** (T6.1 + T4.3): Define `Memory.flushReflections()` helper as a NEW T4.3 sub-task — THE GOAL TEST depends on it.

7 SHOULD TEST viram new test cases dentro dos tasks existentes (não adicionam fases). 4 DOCUMENT viram notas no plano (timezone + cache permanence + MD5 collision + LLM context overflow).

Sugestão de bump v1.0 → v1.1 para `/to-plan v0-4a-reflection-pipeline-plan.md`:

1. **T0.2 ACs:** add `count: bigint`, CHECK NOT NULL scope, migration ordering test.
2. **T1.2 ACs:** add InvalidScoringWeightsError + zero-variance test.
3. **T2.1 ACs:** add counter-state-on-failure test (EC-12).
4. **T3.1 ACs:** add InvalidCronExpressionError + idempotent start() test + timezone documentation note.
5. **T4.1 ACs:** add empty-source short-circuit + LLM returns `[]` test.
6. **T4.2 ACs:** add stale-source-ID concurrency test (EC-14).
7. **T4.3 ACs:** add transaction-boundary lock + `flushReflections()` helper + reflecting-on-derived test (EC-9).
8. **T5.1/T5.2 DoD:** add EC-16 + EC-17 documentation notes.
9. **T4.1 Footnote:** add F-reflect-context-window-fallback to Followups list per EC-18.

Após v1.1 absorption, plano fica pronto para `/deps-audit v0-4a-reflection-pipeline` → `/plan-confidence v0-4a-reflection-pipeline`.

---

## Anti-patterns explicitamente NÃO cometidos

- NÃO sugeri novo `ErrorRecoveryManager` ou similar — fixes são `if`/`throw`/`db.transaction()`.
- NÃO especulei sobre futuras versões de croner / Postgres.
- NÃO propus retry+circuit-breaker+fallback para o LLM (mantive na zona de DOCUMENT — R11 do blueprint já endereça).
- NÃO adicionei novas fases ou tasks de feature; apenas refino de AC + 1 helper (flushReflections) que THE GOAL TEST já assumia.
- NÃO marcaria EC-9 (reflecting on derived) como MUST FIX — comportamento ambíguo mas não corrompe dados; SHOULD TEST + decisão documentada é suficiente.
