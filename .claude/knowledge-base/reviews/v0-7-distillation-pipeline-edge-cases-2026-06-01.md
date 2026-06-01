# Edge Case Review — v0-7-distillation-pipeline

Data: 2026-06-01
Plan analisado: `.claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md` v1.0
Tasks analisadas: 9 (T0.1, T1.1, T1.2, T1.3, T2.1, T3.1, T3.2, T3.3, T4.1)
Edge cases encontrados: 11 (MUST FIX: 4, SHOULD TEST: 4, DOCUMENT: 3)

## MUST FIX

### EC-1: `LastWriteWinsConflictPolicy` sem tie-break determinístico em `created_at` empatado

- **Task afetada:** T1.2
- **Família:** State / Determinism
- **Cenário:** Mem0's V3 Phase 6 batch-persist (per blueprint Q1) escreve N memórias em UM commit — todas com `created_at` IDÊNTICO via `datetime.now(timezone.utc)` no início do request. Cluster pós-extração tem 2+ memórias com mesmo timestamp; `Math.max(...candidates, m => m.created_at)` retorna a primeira ou indefinido depending on JavaScript sort stability.
- **Impacto:** Política "deterministic" não-determinística → `npm run eval:distillation` produz matriz diferente entre runs → THE GOAL TEST (T3.3) flaky. /implement halt-loop fail.
- **Fix sugerido (1 linha):** trocar comparator de `m => m.created_at` para `(a, b) => b.created_at - a.created_at || b.memory_id.localeCompare(a.memory_id)` — tie-break lexicográfico por `memory_id` é determinístico + documentado em JSDoc.

### EC-2: `LlmJudgedMergeConflictPolicy` aceita JSON sintaticamente válido mas semanticamente inválido (LLM hallucinou IDs)

- **Task afetada:** T1.3
- **Família:** Format / Boundary
- **Cenário:** Cycle 2 OpenAILLM JSON-parse fallback (EC-10 absorption) cobre `non_json_response`. MAS: LLM retorna `{"kept_id":"x","rejected_ids":["y"],"reason":"..."}` onde `x` OU `y` não está no cluster ORIGINAL (LLM-hallucinated UUIDs). Plan T1.3 GREEN test só cobre o ID-válido case + non_json case.
- **Impacto:** v0.7 escreve `consolidation_history.rejected_memory_ids = ['fake-uuid']` → invalid FK in `consolidation_history.kept_memory_id` → INSERT viola constraint → transaction rollback ABORTA o reflect() inteiro (não só o cluster afetado).
- **Fix sugerido (3 linhas):** em `parseConsolidationResponse(raw, clusterIds): ConsolidationResult | null`, validate `clusterIds.has(parsed.kept_id) && parsed.rejected_ids.every(id => clusterIds.has(id) && id !== parsed.kept_id)` antes de retornar. Se invalid → return null → abstain → OTel `distillation.consolidation.abstain` increment.

### EC-3: `consolidation_history` FK não-especificada para GDPR `forget({hard:true})`

- **Task afetada:** T0.1
- **Família:** State / Permission (GDPR hard-delete)
- **Cenário:** v0.4b T7.1 (PR #24) shipped `Memory.forget(id, { hard: true })` — physical DELETE for GDPR. v0.7's `consolidation_history.kept_memory_id` is `REFERENCES memories(id)` sem ON DELETE clause. Consumer chama `forget(memId, {hard:true})` onde `memId` aparece em `consolidation_history.kept_memory_id` ou dentro de `rejected_memory_ids[]` JSONB → forget() crashes com FK violation OR (se ON DELETE CASCADE for default) cascades + lose audit trail.
- **Impacto:** GDPR hard-delete quebra inteiro OR perde audit history (regulatory blocker).
- **Fix sugerido (1 frase + SQL):** T0.1 migration SQL DECLARA `ON DELETE SET NULL` em `kept_memory_id` (preserve audit row mas nullify reference) + adicionar JSDoc note: rejected_memory_ids JSONB array é mantido por valor (no FK), so naturally survives hard-delete. Plus add sub-step to T0.1: include `ON DELETE SET NULL` in CREATE TABLE statement.

### EC-4: OTel counters `distillation.*` declarados sem citar lazy-init precedent (F-dom-6 / v0.4b T10.1)

- **Task afetada:** T1.3, T2.1, T3.3
- **Família:** Integration
- **Cenário:** Plan T1.3 + T2.1 + T3.3 acceptance criteria mention OTel counters (`distillation.consolidation.{kept,rejected,abstain}` + `distillation.goal_test.pass`). PRECEDENT (v0.4b T10.1 F-dom-6 MAJOR finding ): if counter is materialized at module-load via `metrics.getMeter(...)`, it captures the no-op default `MeterProvider` permanently when consumers call `setGlobalMeterProvider(...)` AFTER importing `@usetheo/memory`. Plan does NOT mention lazy resolution — engineer who implements T1.3 may repeat the bug.
- **Impacto:** Consumer-side telemetry silently no-ops; THE GOAL TEST passes locally but counters don't fire for end-users; F-dom-6 regression.
- **Fix sugerido (1 linha):** T1.3 + T2.1 acceptance bullets reference `src/local/eviction/pg-evictor.ts:56-58` lazy-counter pattern verbatim. Add to ADR D2: "All v0.7 OTel counters MUST use lazy-init per F-dom-6 / v0.4b T10.1 precedent."

## SHOULD TEST

### EC-5: THE GOAL TEST flaky por LLM não-determinismo

- **Task afetada:** T3.3
- **Teste sugerido:** `test_the_goal_test_stable_across_3_consecutive_runs` — chama THE GOAL TEST em loop 3× com `LlmJudgedMergeConflictPolicy({ temperature: 0, seed: 42 })`; asserta delta `< 0.05` em precision/recall/accuracy entre runs. Documenta no plano que `temperature=0` + (when available) `seed` é REQUIRED para THE GOAL TEST configuration. (`Math.abs(run1.precision - run2.precision) < 0.05` etc.)

### EC-6: Cluster size estoura prompt token budget

- **Task afetada:** T1.3, T2.1
- **Teste sugerido:** `test_llm_judged_merge_caps_cluster_size_at_20` — given cluster of 50 memories, `consolidate(candidates, ctx)` chunks into batches of ≤ 20 OR returns abstain + OTel counter `distillation.consolidation.cluster_too_large`. Asserts behavior is documented + observable. Without cap, prompt > 100k tokens crashes OpenAI call mid-reflect.

### EC-7: Empty scope (`recall.length === 0`) — reflect() with conflictResolution graceful no-op

- **Task afetada:** T2.1
- **Teste sugerido:** `test_reflect_with_policy_empty_scope_no_op` — given scope with 0 memories, `memory.user('new-user').reflect({ conflictResolution: P })` returns cleanly + 0 LLM calls + 0 `consolidation_history` rows + no exceptions. Verifies the early-exit guard at top of execute.ts modification.

### EC-8: Atomic transaction rollback when `consolidation_history` INSERT fails mid-transaction

- **Task afetada:** T2.1
- **Teste sugerido:** `test_consolidation_atomic_rollback_on_history_insert_failure` — mock `pgvector-store.insertConsolidationHistory()` to throw on second invocation; verify that `t_invalid` updates on rejected memories ARE NOT persisted (rollback works); zero rows in `consolidation_history`; reflect() raises typed error. Uses v0.6.1 `withTransactionFn` pattern.

## DOCUMENT

### EC-9: `derived_from` schema change misclaimed em ADR D3 — already JSONB shipped v0.4a

- **Risco aceito:** Plan ADR D3 says "extends `memories.derived_from` JSONB type". Verificação pós-plan: `src/local/pgvector-store.ts:71` shows `derived_from` is already `JSON.stringify(row.derived_from)` — JSONB column already accepts arrays. NO migration needed for this part; only `consolidation_history` table is new. Document in T0.1 commit body: "derived_from already accepts JSONB arrays per v0.4a; only consolidation_history is added by 0007 migration".

### EC-10: BLEU implementation — `natural` lib already shipped (v0.6.1)

- **Risco aceito:** Plan T3.2 mentions "BLEU + entity-overlap-Jaccard" without specifying lib. Verification: `package.json` already has `natural: "^8.1.0"` in `optionalDependencies` per v0.6.1 voyager precedent. `natural.BleuScore` is the canonical implementation. Document in T3.2 acceptance: "use `natural.BleuScore` (shipped v0.6.1)". Zero new deps (per ADR D6). Honest.

### EC-11: `npm run eval:distillation` requires `THEOMEM_PG_URI` + `OPENAI_API_KEY` env

- **Risco aceito:** Per Q6 dev story, eval requires pgvector container + OpenAI key. Plan T3.2 doesn't list pre-conditions for the npm script. Document in T3.2 + `docs/distillation-evaluation/README.md`: "Pre-conditions: (a) `npm run compose:up` (pgvector container running on port 5432); (b) `.env.local` with `OPENAI_API_KEY=sk-...`; (c) `npm run db:push` against the container. Eval costs ~$0.50 in OpenAI per full run (200 fixtures × 3 policies × LLM-judged-merge calls)."

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 (migration) | 2 | 1 (EC-3) | 0 | 1 (EC-9) |
| T1.1 (DIP) | 0 | 0 | 0 | 0 |
| T1.2 (Noop + LastWriteWins) | 1 | 1 (EC-1) | 0 | 0 |
| T1.3 (LlmJudgedMerge) | 3 | 2 (EC-2, EC-4 share) | 1 (EC-6) | 0 |
| T2.1 (wire reflect) | 4 | 1 (EC-4 share) | 2 (EC-7, EC-8) | 0 |
| T3.1 (fixtures) | 0 | 0 | 0 | 0 |
| T3.2 (eval script) | 2 | 0 | 0 | 2 (EC-10, EC-11) |
| T3.3 (THE GOAL TEST) | 2 | 0 (EC-4 share) | 1 (EC-5) | 0 |
| T4.1 (validation) | 0 | 0 | 0 | 0 |
| **Total** | **11** | **4** | **4** | **3** |

EC-4 (OTel lazy-init) cuts across T1.3 + T2.1 + T3.3; counted once.

**Veredicto:** PLANO PRECISA DE AJUSTE — bump v1.0 → v1.1 absorvendo 4 MUST FIX (EC-1 tie-break, EC-2 semantic-validate, EC-3 FK ON DELETE SET NULL, EC-4 lazy-init pattern). 4 SHOULD TEST viram sub-bullets dos tasks TDD existentes (EC-5/6/7/8). 3 DOCUMENT viram notas no plano (EC-9 corrige claim de ADR D3; EC-10/11 documentam pré-condições).

### Honest acknowledgment

- Os 4 MUST FIX são bugs de protótipo (não invalidam o design); cada um tem fix em ≤3 linhas. Plan v1.1 absorbe sem mudar estrutura.
- EC-4 (lazy-init) é especialmente importante — F-dom-6 já bit-nos uma vez no v0.4b; replay seria caro (review re-rejects + fixup cycle).
- EC-9 é honesty fix: ADR D3 v1.0 over-claimed schema change; corrigir em v1.1 evita /plan-confidence cap por fabricated claim about existing infra.
- Gold-set (T3.1) e dev-story (T4.1) saíram clean — bom sinal sobre fidelity ao blueprint.

### Próximos passos (chain inquebrável)

1. **Usuário absorve 4 MUST FIX + 3 DOCUMENT em plan v1.1** (4 SHOULD TEST viram halt-loop checkpoints no TDD)
2. **`/deps-audit v0-7-distillation-pipeline`** — expected PASS (zero new deps per ADR D6)
3. **`/plan-confidence v0-7-distillation-pipeline`** — target ≥ SHIPPABLE_WITH_CAVEATS (post-absorption)
4. **`/implement v0-7-distillation-pipeline`** (sessão dedicada, ~200-400k tokens)
