# Edge Case Review — v0-4b-forgetting-pipeline (implementation plan, NOT discovery)

Data: 2026-05-26
Plano analisado: `.claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md` v1.0
Tasks analisadas: 16 (T0.1, T1.1, T2.1, T2.2, T3.1, T4.1, T4.2, T5.1, T5.2, T6.1, T7.1, T7.2, T7.3, T8.1 + 2 placeholders cobertos por DoD)
Edge cases encontrados: 12 (MUST FIX: 4, SHOULD TEST: 6, DOCUMENT: 2)

> Sibling deste report: `v0-4b-forgetting-pipeline-edge-cases-2026-05-26.md` (edge cases do DISCOVERY plan v1.0; absorvido em v1.1). Este report cobre o IMPLEMENTATION plan v1.0 produzido por `/to-plan`.

## MUST FIX

### EC-1: T2.2 stale `half_life_seconds` quando `llm_importance_score` é re-escrito

- **Task afetada:** T2.2 (Lazy half_life backfill)
- **Família:** State
- **Cenário:** v0.4a's `llm_importance_score` é cacheado por content-hash, mas se o conteúdo de uma memória for re-extraído (rare path, mas existe via `recall@v0.4a` updates) e a importância cair de 0.8 para 0.2, o `half_life_seconds` persistido em T2.2 fica STALE — eviction-score continua usando o `h` antigo (90 dias) em vez do recalculado (3 dias). A guarda `IS NULL` da UPDATE em D14 protege contra DOUBLE backfill mas NÃO contra divergência importance ↔ half_life.
- **Impacto:** Eviction-score errado por horizontes longos (90 dias em vez de 3 dias) — memória de baixa importância não é evictada porque seu `h` ainda é o computado da importância anterior.
- **Fix sugerido:** Acrescentar trigger SQL OR observer Drizzle: quando `llm_importance_score` é UPDATEd, set `half_life_seconds = NULL` no mesmo statement. Próximo scoring re-computa. Documentar na T2.2 Deep Dive: "When `llm_importance_score` is updated by re-extraction, `half_life_seconds` MUST be reset to NULL to trigger re-backfill."

### EC-2: T5.1 race condition em concurrent `remember()` — eviction sobre-disparada

- **Task afetada:** T5.1 (`CapacityBasedTrigger`)
- **Família:** Timing
- **Cenário:** Dois callers chamam `remember()` simultaneamente em scope cheio. Cada um vê count=N+1 (over capacity), cada um dispara `selectVictims(fraction)`, ambos evictam 30%. Resultado: scope perde ~60% em vez de ~30%. Pgvector + Drizzle não têm advisory locks declarados no plano.
- **Impacto:** Data loss (memórias evictadas além da necessidade); test instabilidade em integration tier sob carga.
- **Fix sugerido:** Acrescentar Postgres advisory lock por scope antes do COUNT + eviction: `SELECT pg_try_advisory_xact_lock(hashtext(scope))`. Se lock não obtido, SKIP eviction nessa write — o próximo remember() pega. Adicionar ≤ 5 LoC em T5.1 + 1 RED test `test_concurrent_remember_does_not_double_evict`.

### EC-3: T7.2 guardrail unit test pode FALHAR — `InMemoryVectorStore` v0.1 pode não suportar cosine-distance nearest-neighbor

- **Task afetada:** T7.2 (guardrail long-tail)
- **Família:** Integration
- **Cenário:** Plano declara que T7.2 usa "in-memory adapter v0.1 fixture" para evitar dependência Docker no unit tier. Mas D9/T4.1 nearest-neighbor query usa pgvector `<=>` operator que NÃO existe no `InMemoryVectorStore` (v0.1 adapter Map-backed). Sem fallback, T4.1+T4.2 falham contra o adapter in-memory → o guardrail test simplesmente não roda OR roda sem o multiplier ativo → assertion "rare survives ≥ 5 passes" passa por coincidência (não pelo mecanismo testado).
- **Impacto:** Test verde mas semanticamente vazio — falso positivo da capability sendo testada (verifica nada).
- **Fix sugerido:** Adicionar sub-task em T7.2: "Confirm `InMemoryVectorStore` exposes O(N) linear-scan equivalent of cosine-distance nearest-neighbor; if absent, add 15-LoC linear scan to it as part of T4.1's barrel export." OU promover T7.2 para integration tier (real pgvector + Docker) — perdendo unit-tier velocity mas ganhando semantic validity.

### EC-4: T8.1 wiring triad (c) — counter `theo.memory.eviction.soft_deletes_total` NÃO definido em nenhuma task

- **Task afetada:** T8.1 (Integration Validation) + T6.1 (evict)
- **Família:** Boundary / Wiring
- **Cenário:** Global DoD § Wiring triad cita o counter `theo.memory.eviction.soft_deletes_total` como evidência runtime. Nenhuma task T0-T7 menciona criar esse counter, emiti-lo via OTel, ou wired-up no `evict()` execution path. `check_wiring.py` falhará no pillar (c).
- **Impacto:** `/implement-validate` HALT no wiring triad gate; ralph-loop loop-back desnecessário até T6.1 ser corrigido.
- **Fix sugerido:** Adicionar sub-task em T6.1: "Emit OTel counter `theo.memory.eviction.soft_deletes_total` incremented by `result.soft_deleted` count after UPDATE RETURNING. Wire via existing OTel meter from v0.1." Acceptance criterion atualizado: "Counter observed non-zero in T7.1 integration workload via in-memory OTel exporter."

---

## SHOULD TEST

### EC-5: T1.1 `selectVictims(fraction)` com fraction fora do range [0, 1]

- **Task afetada:** T1.1 (EvictionPolicy interface)
- **Teste sugerido:** `test_select_victims_rejects_invalid_fraction` — assertar `expect(() => selectVictims(scope, -0.1)).toThrow` E `expect(() => selectVictims(scope, 1.5)).toThrow`. Interface contract test (type-level + runtime guard). 3 LoC.

### EC-6: T2.1 scoring com `w_r = w_f = w_i = 0` (caller passa weights zerados)

- **Task afetada:** T2.1 (TriadicScoringPolicy core math)
- **Teste sugerido:** `test_score_throws_when_all_weights_zero` — weights normalization deve recusar `{0, 0, 0}` (division by zero ao normalizar). Lança `InvalidWeightsError`. Edge case raro mas pode acontecer via config externa.

### EC-7: T2.1 `access_count NULL` em rows pré-v0.4b que pegaram backfill `DEFAULT 0` mas algum dev rodou ALTER manual incorreto

- **Task afetada:** T2.1 (frequency_component)
- **Teste sugerido:** `test_frequency_handles_null_access_count_as_zero` — defensive: `frequency_component(null) === frequency_component(0) === 0`. 2-LoC guard `access_count ?? 0`. Belt-and-suspenders contra ALTER manual fora-do-plano.

### EC-8: T3.1 `recall()` retornando o mesmo ID múltiplas vezes na mesma chamada (não acontece em v0.1 mas vai acontecer pós-merge)

- **Task afetada:** T3.1 (batched UPDATE)
- **Teste sugerido:** `test_recall_update_idempotent_on_duplicate_ids_in_results` — `UPDATE ... WHERE id = ANY($1::uuid[])` é idempotente em Postgres por design, mas `access_count = access_count + 1` faria DOUBLE-increment se o array tem dupes. Adicionar `SELECT DISTINCT` na UPDATE OR use `WITH dedup AS (SELECT DISTINCT unnest($1) AS id) UPDATE ... USING dedup`. 1-line SQL change + 1 test.

### EC-9: T5.2 `croner` sub-minute cron `* * * * * *` (every second) — verify support

- **Task afetada:** T5.2 (TimeBasedTrigger)
- **Teste sugerido:** `test_croner_supports_second_level_cron` — assertion na startup: `new Cron('* * * * * *')` parses sem throw. Se `croner` NÃO suportar 6-field cron, fallback para 5-field `* * * * *` (every minute) + integration test runtime se ajusta para 90s (3 ciclos). Acceptance criterion na T5.2 já assume sub-minute; confirmar antes do RED.

### EC-10: T6.1 `evict([])` empty array — UPDATE with empty ANY($1::uuid[])

- **Task afetada:** T6.1 (evict soft-delete)
- **Teste sugerido:** `test_evict_empty_array_returns_zero_no_op` — Postgres aceita `WHERE id = ANY('{}'::uuid[])` (0 rows affected); test assert `result = { soft_deleted: 0, already_invalid: 0, errors: [] }`. SKIP the SQL roundtrip se array vazio para microbench.

---

## DOCUMENT

### EC-11: T5.2 multi-process duplicate cron triggers (deployment-level, NOT v0.4b scope)

- **Risco aceito:** Se TheMemory rodar em N instâncias (cluster mode), cada uma terá `TimeBasedTrigger` ativo + cada uma fará eviction pass à mesma hora-cron. Resultado: N×30% eviction em vez de 30%. Mitigação: distributed lock (Redis SETNX, Postgres advisory) ou single-leader pattern — OUT OF SCOPE para v0.4b local-only runtime. Documentar em `## Accepted risks` do plano + flag para v0.5 cloud runtime.

### EC-12: T7.1 OpenAI cost CI para seed de 1000 memórias

- **Risco aceito:** T7.1 seed de 1000 memórias produz 1000 embedding calls (ou 5-10 batches via v0.1's batch-embed pipeline). Em CI gratuito (GitHub Actions sem secret), seria $0; com OpenAI fixture, ~$0.02 por run × 50 runs/mês = ~$1/mês. Documentar em DoD que o fixture usa `StubEmbedder` (deterministic 1536-dim vectors derivadas de hash do text) para CI; integration tier real-LLM rodada manual local. Mitigação aceita; KISS.

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 (migration) | 0 | 0 | 0 | 0 |
| T1.1 (EvictionPolicy DIP) | 1 | 0 | 1 (EC-5) | 0 |
| T2.1 (scoring math) | 2 | 0 | 2 (EC-6, EC-7) | 0 |
| T2.2 (lazy half_life backfill) | 1 | 1 (EC-1) | 0 | 0 |
| T3.1 (recall write-back) | 1 | 0 | 1 (EC-8) | 0 |
| T4.1 (nearest-neighbor) | 0 | 0 | 0 | 0 |
| T4.2 (multiplier integration) | 0 | 0 | 0 | 0 |
| T5.1 (CapacityBasedTrigger) | 1 | 1 (EC-2) | 0 | 0 |
| T5.2 (TimeBasedTrigger) | 2 | 0 | 1 (EC-9) | 1 (EC-11) |
| T6.1 (evict soft-delete) | 1 | 0 | 1 (EC-10) | 0 |
| T7.1 (THE GOAL TEST) | 1 | 0 | 0 | 1 (EC-12) |
| T7.2 (guardrail) | 1 | 1 (EC-3) | 0 | 0 |
| T7.3 (evaluation doc) | 0 | 0 | 0 | 0 |
| T8.1 (Integration Validation) | 1 | 1 (EC-4) | 0 | 0 |
| **Total** | **12** | **4** | **6** | **2** |

**Veredicto:** PLANO PRECISA DE AJUSTE

4 MUST FIX são execution-feasibility (não tocam ADRs, escopo, ou shape). Sugiro bump v1.0 → v1.1 com:

1. **EC-1 absorption (T2.2):** adicionar Deep Dive nota + RED test `test_half_life_reset_on_importance_update` + 1-line trigger/observer SQL.
2. **EC-2 absorption (T5.1):** adicionar `pg_try_advisory_xact_lock` em CapacityBasedTrigger.shouldEvict + RED test `test_concurrent_remember_does_not_double_evict`.
3. **EC-3 absorption (T7.2):** confirmar `InMemoryVectorStore` capability OR promover T7.2 ao integration tier; decisão documentada como ADR D18 no plano.
4. **EC-4 absorption (T6.1 + T8.1):** adicionar sub-task em T6.1 para emitir OTel counter `theo.memory.eviction.soft_deletes_total` + atualizar wiring triad (c) assertion.
5. **6 SHOULD TEST absorbed** como RED tests adicionais nos blocos TDD existentes (~12 LoC total spread across T1.1, T2.1, T3.1, T5.2, T6.1).
6. **EC-11 + EC-12 DOCUMENTed** em § Accepted Risks (1 entry cada).

Após v1.0 → v1.1 absorption, plano pronto para `/deps-audit` + `/plan-confidence`.

---

## Anti-patterns NÃO cometidos

- NÃO sugeri retry+circuit-breaker em fire-and-forget UPDATE (já é graceful per architecture.md § 9)
- NÃO sugeri nova abstração para tratar EC-2 (advisory lock é 1 linha SQL, não um `ConcurrencyManager` class)
- NÃO inflei budget — token-budget já cobre /implement de v0.4b sem ajuste
- NÃO ampliei escopo (multi-process cron documentado mas NÃO adicionado)
- NÃO especulei sobre versões futuras de pgvector/Postgres
