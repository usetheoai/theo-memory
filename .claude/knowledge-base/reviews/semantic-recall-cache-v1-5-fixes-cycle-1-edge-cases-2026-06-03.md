# Edge Case Review — semantic-recall-cache-v1-5-fixes-cycle-1

Data: 2026-06-03
Tasks analisadas: 8 (T0.1, T1.1, T2.1, T2.2, T2.3, T3.1, T3.2, T4.1)
Edge cases encontrados: 10 (MUST FIX: 4, SHOULD TEST: 3, DOCUMENT: 3)

**Veredicto: PLANO PRECISA DE AJUSTE** — 4 MUST FIX bloqueiam o `/implement` rodar limpo se não absorvidos. Todos têm fix ≤3 linhas no plano.

## Fronteiras mapeadas por task

| Task | Tipo | Fronteira primária | Estado mutável |
|---|---|---|---|
| T0.1 | Doc edit | Plan markdown file | Plano v1.1 → v1.2 |
| T1.1 | Code + integration test | Postgres (BEGIN/COMMIT tx) | `applyDimChange` canary block + `dim-change.test.ts` |
| T2.1 | Contract test | In-process FakeCache | `factory-recall-cache.test.ts` |
| T2.2 | Integration test | Postgres + LLM stub + ReflectionPolicy | `recall_cache` rows + persisted derived memories |
| T2.3 | Integration test | Postgres | `recall_cache` rows + `memories` t_invalid |
| T3.1 | Doc edit | README + CHANGELOG | Markdown content |
| T3.2 | JSDoc edit | TS source files | DIP type docstrings |
| T4.1 | Meta-skill | Spawn 7 agents | Audit trail + review report |

---

## MUST FIX

### EC-1: Commit ORDER between T0.1 and T1.1/T3.2 — circular reference

- **Task afetada:** T0.1 + T1.1 + T3.2 + T3.1
- **Família:** State / Sequence
- **Cenário:** T0.1 writes ADR D9 + D10 INTO the source plan. T1.1's canary error message + T3.2's JSDoc + T3.1's CHANGELOG entry all `cite ADR D9` and `cite ADR D10`. If T1.1/T3.x commit BEFORE T0.1, those citations point to text not yet in plan → dangling refs.
- **Impacto:** PR diff legibility broken; cross-validation reviewer flags "ADR D9 cited but missing" as a fresh F-xval finding.
- **Fix sugerido:** Add to plan § Dependency Graph: "**T0.1 MUST commit FIRST** before any T1.x/T2.x/T3.x commit cites D9/D10. Sequential discipline non-negotiable."

### EC-2: T2.2 stub LLM cannot satisfy `validateProvenance` — reflect() throws before invalidateScope

- **Task afetada:** T2.2
- **Família:** Boundary / Integration
- **Cenário:** `reflect()` runs `executeReflection` (LLM call) → produces drafts → `validateProvenance(drafts, sourceIds)` throws if `draft.derivedFrom` IDs are not subsets of `sourceIds`. A static `DeterministicStubLLM` can't know the runtime-generated source UUIDs. The reflect() throws BEFORE reaching the post-success `invalidateScope` block — test asserts cache=0 but reflect crashed → test FAILS for WRONG REASON.
- **Impacto:** Test ships green but masks the actual EC-6 hook regression it's supposed to guard.
- **Fix sugerido:** Plan T2.2 Deep Dive must say: "Use a custom LLM stub that captures the prompt at runtime and emits a draft whose `derivedFrom` includes ALL passed sourceIds. Mirror precedent `tests/integration/reflection/threshold-policy.test.ts`'s `generateChat` capture-and-echo pattern."

### EC-3: T2.1 deferred-Promise FakeCache can hang the test suite

- **Task afetada:** T2.1
- **Família:** Timing / Resource
- **Cenário:** Plan T2.1 Deep Dive says "split the FakeCache's `invalidateScope` into a deferred Promise that resolves on the next microtask. Assert that BEFORE the deferred resolves, `remember()` does NOT return." If the deferred Promise NEVER resolves (e.g., the `setTimeout` callback is never scheduled because vitest uses fake timers), `remember()` awaits forever → vitest test-timeout (5s default) → suite hangs 5s per run.
- **Impacto:** Flaky CI; 998th test adds 5s to total runtime if Promise gating mis-aligns with vitest timer config.
- **Fix sugerido:** Plan T2.1 Deep Dive must say: "Use a `Promise` that resolves on the NEXT MICROTASK via `Promise.resolve().then(() => resolve(0))` (NOT `setTimeout`). Plus add explicit `vi.useRealTimers()` at top of the test block."

### EC-4: T2.3 cross-scope isolation test assumes bob's cache survives — but the v0.4b forget() soft-deletes the row, leaving `t_invalid IS NOT NULL`. The next `recall()` for bob would still see bob's memory (filtered IN, since recall reads from `memories WHERE t_invalid IS NULL` is bob's memory not alice's).

- **Task afetada:** T2.3
- **Família:** State / Cross-feature composition
- **Cenário:** Plan T2.3 Deep Dive says: "write 1 memory under user:bob, pre-warm bob's cache, call `forget(aliceMemoryId)`, verify bob's cache row count UNCHANGED (= 1)." This is correct IFF `deriveScopeFromPayload(aliceMemory.payload)` returns `{kind:'user', userId:'alice'}` AND the scope_key derivation produces `'user:alice'` (NOT `'user:bob'`). But if `deriveScopeFromPayload` reads the WRONG payload key (e.g., gets confused by a 4-tier scope row), bob's cache could be wiped → test FAILS.
- **Impacto:** Test PASSES against current code (correct), but a hypothetical regression in `deriveScopeFromPayload` would silently invalidate the wrong scope without being caught — UNLESS the test explicitly seeds the alice memory's `payload['user_id']='alice'` and verifies the FakeCache (or real cache table) captures `'user:alice'` as the scope_key, not just "bob's row count is 1".
- **Fix sugerido:** Plan T2.3 Acceptance gains explicit clause: "Bonus assertion: `SELECT scope_key FROM recall_cache` after forget() shows ONLY `'user:bob'` rows — verifies EC-10 derived the correct scope, not just that bob's row count is unchanged by coincidence."

---

## SHOULD TEST

### EC-5: T1.1 canary defensive missing-row branch — pre-v1.5 DB path

- **Task afetada:** T1.1
- **Teste sugerido:** `test_applyDimChange_succeeds_without_recall_cache_table` — in `tests/integration/migrations/dim-change.test.ts`, set up a DB at v0.9 schema (no `recall_cache` table), call `applyDimChange(pool, 384)`, assert it completes without throwing AND the verify-canary's recall_cache assertion is SKIPPED (not failed). Verifies the symmetric `DO $$ IF EXISTS` guard that T1.1 adds.

### EC-6: T2.1 await ORDER test — also assert no race when `invalidateScope` rejects

- **Task afetada:** T2.1
- **Teste sugerido:** `test_remember_awaits_invalidateScope_even_when_it_rejects` — extend the new T2.1 test: configure FakeCache.invalidateScope to throw `Error('cache backend down')`. Assert `remember()` STILL returns successfully (existing T2.2-RED-5 contract) AND the throw is caught + logged via console.error spy — verifies the loud-but-degrade policy is intact under the EC-11 sequential-await regime.

### EC-7: T2.2 reflect() with persisted.length === 0 path — verify NO invalidate

- **Task afetada:** T2.2
- **Teste sugerido:** `test_reflect_with_zero_persisted_drafts_does_NOT_invalidate_cache` — seed cache row; configure LLM stub to emit drafts=[] (LLM returned "no consolidation" sentinel); call reflect(); assert cache row count is UNCHANGED. Verifies the implementation's `persisted.length > 0` gate at `src/local/index.ts` works (avoids spurious invalidations on empty-reflection runs).

---

## DOCUMENT

### EC-8: T3.2 `@deprecated` on REQUIRED field emits ESLint warning in existing tests

- **Risco aceito:** `ScopeTierTtlConfig.repo` is REQUIRED in the type. Adding `@deprecated` JSDoc surfaces as `eslint-plugin-deprecation` warnings (or TS 5.x native deprecation) on EVERY existing test that constructs the full 4-tier config (e.g., `src/core/dip/__tests__/recall-cache-store.test.ts` T0.1-RED-5 explicitly builds `{user, agent, session, repo}`). Either accept warnings as informational, OR add `/* eslint-disable @typescript-eslint/no-deprecated */` blocks. Document in T3.2: "Expect existing tests to surface `repo is deprecated` lint warnings on next CI run — acceptable until v1.5.x wiring lands and the marker is lifted." No code change to suppress; honest signal.

### EC-9: T4.1 `/review` re-spawn token cost (~150-300k)

- **Risco aceito:** Re-running `/review semantic-recall-cache-v1-5` for the second time in 24h spawns 7 fresh agents (NOT reusing the 2026-06-03 audit). Use `--date 2026-06-04` (or whatever the cycle finish date is) to avoid colliding with the existing `.claude/agents/review-semantic-recall-cache-v1-5-2026-06-03/` dir. Token cost is intentional per cycle-review.md § Cost honesty — the gate is "MAIS RIGOROSO". Document in T4.1: "Expected cost ~200k tokens; if budget-constrained, defer T4.1 to a separate slice and merge this cycle WITH_CAVEATS instead."

### EC-10: EC-10 fallback path is largely theoretical for current schema

- **Risco aceito:** ADR D9 reconciles the "scope undiscoverable → SKIP invalidation" branch. In practice, every row written via `remember()` since v0.1 carries `user_id` OR `session_id` OR `agent_id` columns (extraction pipeline populates `filtersFromScope` output). The undiscoverable branch only fires for: (a) hypothetical pre-v0.1 rows (none exist in production); (b) manually-INSERT-ed rows that bypass the pipeline (consumer-side abuse). T2.3 doesn't need to test this branch — it's defensive against future schema changes. Document in T3.2's `deriveScopeFromPayload` JSDoc: "Returns `undefined` is a defensive branch — every v0.1+ row carries a scope column."

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 1 | EC-1 | — | — |
| T1.1 | 1 | — | EC-5 | — |
| T2.1 | 2 | EC-3 | EC-6 | — |
| T2.2 | 2 | EC-2 | EC-7 | — |
| T2.3 | 1 | EC-4 | — | — |
| T3.1 | 0 | — | — | — |
| T3.2 | 2 | — | — | EC-8 + EC-10 |
| T4.1 | 1 | — | — | EC-9 |

**Veredicto: PLANO PRECISA DE AJUSTE.** Bump v1.0 → v1.1 absorbing EC-1 + EC-2 + EC-3 + EC-4 (MUST FIX). EC-5/6/7 (SHOULD TEST) add to T1.1/T2.1/T2.2 TDD blocks. EC-8/9/10 (DOCUMENT) inline in respective tasks' Deep Dives. Re-roda `/plan-confidence semantic-recall-cache-v1-5-fixes-cycle-1` após absorção.
