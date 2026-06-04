# Edge Case Review — semantic-recall-cache-v1-5

**Data:** 2026-06-03
**Plano analisado:** `.claude/knowledge-base/plans/semantic-recall-cache-v1-5-plan.md` v1.0
**Tasks analisadas:** 9 (T0.1, T0.2, T1.1, T1.2, T2.1, T2.2, T2.3, T3.1, T4.1, T5.1, T5.2) + Final Phase
**Edge cases encontrados:** 14 (MUST FIX: 6, SHOULD TEST: 5, DOCUMENT: 3)

**Veredicto:** **PLANO PRECISA DE AJUSTE** — 6 MUST FIX são absorpções obrigatórias (composição com features pré-existentes + IEEE 754 NaN gap + LRU race). Sem absorpção, v1.5.0 quebra v1.1 contract (bi-temporal `asOf` + `attributedTo`) E v0.6 contract (skill scope) silenciosamente.

## Filosofia da revisão

Plano é estruturalmente sólido — 9 tasks, 7 ADRs com alternatives, dependency graph claro, Coverage 23/23. O blueprint (89/100 SHIPPABLE_WITH_CAVEATS) já travou as decisões de design corretamente per evidências de Q1-Q8.

Os edges abaixo NÃO indicam defeito de design — indicam pontos onde o plano não compôs explicitamente com FEATURES PRÉ-EXISTENTES (v1.1 bi-temporal, v0.6 skill scope, v0.4a reflect()) OU com PROPRIEDADES SUTIS DE TIPO/CONCORRÊNCIA (IEEE 754 NaN, Postgres concurrent UPDATE/DELETE). Todos têm fixes ≤1 frase ou ≤3 linhas de código.

## MUST FIX

### EC-1: Validador de `threshold` aceita NaN e Infinity (IEEE 754 NaN comparison gap)

- **Task afetada:** T0.1
- **Família:** Input / Format
- **Cenário:** Validador planejado em § Deep Dives: `if (config.threshold < 0 || config.threshold > 1) throw ...`. Mas `NaN < 0` é `false` E `NaN > 1` é `false` (IEEE 754 — TODA comparison com NaN retorna false exceto `!=`). Consumer passa `threshold: NaN` ou `threshold: Number.POSITIVE_INFINITY` (ex: env var parsing falha silenciosa) → validador passa → SQL `>= NaN` retorna FALSE para tudo → cache fica permanentemente em estado MISS-only sem warning. Silent quality regression.
- **Impacto:** Cache aparenta funcionar (sem erro) mas hit rate fica 0%. Violation de Inquebrável Rule 3 (silent failure).
- **Fix sugerido (≤3 linhas):** Adicionar `Number.isFinite(config.threshold)` no validador ANTES da range check:
  ```ts
  if (config.threshold !== undefined && !Number.isFinite(config.threshold)) {
    throw new InvalidCacheConfig(`threshold must be a finite number; got ${config.threshold}`);
  }
  if (config.threshold !== undefined && (config.threshold < 0 || config.threshold > 1)) { ... }
  ```
  Mesmo precedente já shipped no v1.4 `embeddingDim` validator (adapters-openrouter-local-embedder T0.1 — `Number.isInteger` guard).

### EC-2: Embedding-dim mismatch silencioso quando consumer troca embedder mid-deployment

- **Task afetada:** T0.2 + T1.1 + T2.1
- **Família:** Boundary (schema vs runtime)
- **Cenário:** Migration `0010_recall_cache.sql` cria `query_embedding vector(N)` onde N é parametric (mesmo precedente do v1.4 `runMigrations(pool, { embeddingDim })`). Consumer A roda com `LocalTransformerEmbedder` (dim 384) → migra cache table com N=384 → escreve rows. Consumer A depois troca para `OpenAIEmbedder` (dim 1536) sem rodar dim-change → `PgvectorRecallCacheStore.get()` recebe embedding 1536-dim mas tabela armazena 384-dim → pgvector `<=> $2` falha com `expected 384 dimensions, not 1536`. Mensagem de erro é DE BIBLIOTECA não da TheMemory — consumer fica confuso.
- **Impacto:** Runtime crash com mensagem de baixo nível. Não é blueprint-bug porque blueprint não previa multi-embedder lifecycle, mas é gap real para consumer que já rodou adapters-openrouter-local-embedder dim-change.
- **Fix sugerido (≤3 linhas):** No factory T2.1, ao construir `PgvectorRecallCacheStore`, validar que `embedder.dim` matches a coluna `query_embedding`:
  ```ts
  // Antes de wirear o cache, probe a tabela
  const cacheDim = await probeCacheTableDim(pool); // SELECT atttypmod FROM pg_attribute
  if (cacheDim !== embedder.dim) {
    throw new InvalidCacheConfig(`embedder dim ${embedder.dim} mismatches cache table dim ${cacheDim}; run runMigrations({ embeddingDim }) OR clear recall_cache`);
  }
  ```
  Reusa o mesmo `atttypmod` probe pattern já shipped no v1.4.

### EC-3: `skill` scope tier não tem TTL default (D3 cobre só user/agent/session)

- **Task afetada:** T0.1 (config types) + T2.1 (factory wiring)
- **Família:** State (incomplete coverage)
- **Cenário:** ADR D3 declara `ttlSecondsByScopeTier` com 3 chaves: `user` (24h), `agent` (1h), `session` (10min). Mas v0.6 RepoScope (ADR-0010, shipped 2026-05-30) adiciona o 4º tier `skill` — `memory.skills(repoId).recall(...)`. Quando consumer chama recall via skill scope, `getScopeTierTtl(scope.kind)` recebe `'skill'` → retorna `undefined` → `set()` insere com `ttl_seconds=undefined` → SQL `NOW() + ($4 || ' seconds')::INTERVAL` tenta concatenar `undefined` → erro de tipo OU NULL em `expires_at` (depende de qual jeito o driver coerce).
- **Impacto:** Skill-scope recall via cache OR crasha OR escreve `expires_at=NULL` (nunca expira, viola TTL discipline).
- **Fix sugerido (≤1 frase):** Adicionar quarta chave em `ScopeTierTtlConfig`: `skill: number` com default razoável (60min — skill consolidation é mid-frequency). Atualizar D3 ADR para 4 tiers. Implementar fallback `?? config.threshold ?? 3600` no resolver.

### EC-4: Cache key não inclui `asOf` (bi-temporal v1.1) — viola contrato

- **Task afetada:** T1.1 (cache key composition)
- **Família:** State (cross-feature composition)
- **Cenário:** v1.1 shipped 2026-06-03 lift `BiTemporalNotSupportedLocally` para `recall({ asOf: histDate })` honrando `(t_valid <= asOf) AND (t_invalid > asOf)` predicate. Cache key planejado é `(scope_key, query_embedding)` per D4. Consumer chama:
  ```ts
  // 1. recall(query) → populates cache with CURRENT results
  await memory.user('alice').recall("café");
  // 2. recall(query, { asOf: yesterday }) → cache HIT (same scope+query+embedding) returns CURRENT results!
  //    But consumer asked for historical state. CORRECTNESS BUG.
  await memory.user('alice').recall("café", { asOf: yesterday });
  ```
- **Impacto:** Cache serves CURRENT results when consumer explicitly asked for historical state. Silent violation of v1.1 bi-temporal contract. Inquebrável Rule 3 (honesty).
- **Fix sugerido (≤1 frase):** Em `Memory.recall()` wrap (T2.1), BYPASS cache se `opts.asOf !== undefined` (don't get, don't set). Simpler than adding asOf to cache key (which would inflate cardinality and expire quickly anyway). Documentar como ADR amendment.

### EC-5: Cache key não inclui `attributedTo` (v1.1) — viola contrato (mesma raiz que EC-4)

- **Task afetada:** T1.1 (cache key) + T2.1 (recall wrap)
- **Família:** State (cross-feature composition — same root)
- **Cenário:** v1.1 também adicionou `RecallOptions.attributedTo?: string` filter. Cache key não inclui. `recall(q, { attributedTo: 'system' })` → cache MISS → populates with system-filtered results. Próxima `recall(q, { attributedTo: 'user' })` → cache HIT same scope+query+embedding → serves SYSTEM-filtered results to caller who asked for USER-filtered. **CORRECTNESS BUG.**
- **Impacto:** Cache serves wrong filter slice. Could leak data across attribution boundaries.
- **Fix sugerido (≤1 frase):** Mesmo fix de EC-4 — em `Memory.recall()` wrap, BYPASS cache se `opts.attributedTo !== undefined`. Documentar combined ADR amendment com EC-4: "cache só vale para query simples sem filters bi-temporal/attribution; v1.5.x pode adicionar filters ao cache key se evidence demandar".

### EC-6: `reflect()` não está em T2.2 lista de write-trigger invalidation

- **Task afetada:** T2.2 (only `remember` + `forget` hooked)
- **Família:** State (incomplete coverage)
- **Cenário:** `Memory.reflect()` produz derived memories (v0.4a) + potencialmente novos rows na `memories` table via distillation pipeline (v0.7). Plano D3 + T2.2 só hookam `remember()` e `forget()`. Consumer chama:
  ```ts
  await memory.user('alice').recall("preferences");  // populate cache
  await memory.user('alice').reflect();              // creates derived memories
  await memory.user('alice').recall("preferences");  // CACHE HIT — misses the new derived memories
  ```
- **Impacto:** Cache serve stale results após reflect. Mesma classe de bug que EC-4/EC-5 mas em surface diferente.
- **Fix sugerido (≤1 frase):** Adicionar reflect() à T2.2 lista — hookar `invalidateScope(scope)` após reflect() success. Documentar em D3 amendment.

### EC-7: LRU eviction tem race condition entre 2 chamadas `set()` concorrentes

- **Task afetada:** T1.2 (capacity eviction)
- **Família:** Concurrency
- **Cenário:** T1.2 § Deep Dives mostra: `SELECT COUNT(*) → if >= max, DELETE 1 oldest → INSERT new` dentro de `withTransaction`. Mas Postgres default isolation level (READ COMMITTED) permite WRITE/WRITE conflicts onde 2 transações vejam count = 1000 antes que qualquer uma faça DELETE → AMBAS deletam 1 row → AMBAS inserem → final state: 1000 rows ainda (não 999) MAS o invariant `oldest is gone` perde a propriedade desejada (deletam 2 oldest, não 1).
- **Impacto:** Capacity overflow NÃO acontece (boa propriedade preservada por DELETE+INSERT mas via race). O REAL bug é: 2 calls competindo deletam 2 rows ao invés de 1 — perda EXTRA de cache que poderia ser mantida. Menor impacto que EC-4/EC-5 mas é race that violates invariant intent.
- **Fix sugerido (≤3 linhas):** Usar `SELECT ... FOR UPDATE` no count query (Postgres advisory lock) OU usar SERIALIZABLE isolation OU upsert pattern com `INSERT ... ON CONFLICT (scope_key, query_embedding) DO UPDATE`. Recomendo SERIALIZABLE para essa transação específica:
  ```ts
  await tx.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  // ... existing logic
  ```
  Adicionar retry-on-serialization-failure (1 retry sufficient per Postgres docs).

## SHOULD TEST

### EC-8: Zero-norm embedding from embedder produces NaN cosine

- **Task afetada:** T1.1 (get path)
- **Teste sugerido:** `test_get_with_zero_norm_query_returns_undefined_not_crash` — assert que `get(zerosVector, scope)` retorna `undefined` (sem hit) ao invés de crashar via pgvector NaN comparison. `cosine_similarity(0_vec, X) = 0/0 = NaN`. SQL `>= 0.8` filtra NaN out (correct behavior), mas worth pinning the test.

### EC-9: Concurrent `get()` + `clearExpired()` — Postgres MVCC guarantee

- **Task afetada:** T1.1 + T1.2 / T2.1 (scheduled clearExpired sweep)
- **Teste sugerido:** `test_concurrent_get_during_clearExpired_sweep_serves_consistent_snapshot` — sleep entre Phase 0 (cache populate) e Phase 1 (start clearExpired + start parallel get). Assert get() retorna result OR undefined consistente com Postgres snapshot isolation, nunca a partial state. Test confidence; race-free per MVCC.

### EC-10: forget(memoryId) scope-derivation strategy needs concrete decision

- **Task afetada:** T2.2
- **Teste sugerido:** `test_forget_invalidates_only_scope_of_forgotten_memory` — verify SCOPE extraction strategy. Plano deixa em aberto ("look up scope from memory record OR fallback to invalidate all — pick one and justify"). Decisão concreta: implementar `SELECT scope_key FROM memories WHERE id = $memoryId` ANTES do DELETE; invalidate só esse scope. Documentar fallback to `invalidateAll()` se memoryId não encontrar memory (já-deletado). Cobertura completa do happy path + fallback.

### EC-11: Cache hit serving stale during in-flight invalidation — sequential await discipline

- **Task afetada:** T2.2
- **Teste sugerido:** `test_remember_awaits_invalidateScope_before_returning` — assert que `remember()` retorna SOMENTE após `invalidateScope()` completar. Test: pre-warm cache; await remember() em scope A; PARALELO chamar cache.get(scope=A) immediately após remember() resolves. Assertion: cache.get() retorna undefined (cache foi limpo antes de remember resolver). Sem esse await sequential, race é possible.

### EC-12: `result_set` JSONB com payload grande (10MB+)

- **Task afetada:** T1.1 (set path)
- **Teste sugerido:** `test_set_with_oversized_result_set_handles_gracefully` — `recall(q, { topK: 100 })` poderia retornar 100 MemoryItems com 8KB cada = 800KB. Multiply by big metadata = could approach 1MB row size. Test boundary: passar 5000-char content per item × 100 items → assert set() either succeeds OR fails with typed error (not silent corruption). Pgvector JSONB suporta até 1GB row em teoria; prática é < 100MB. Documentar limite + log warn se aproximar.

## DOCUMENT

### EC-13: `maxSizePerScope=1` degenerate case

- **Risco aceito:** Consumer pode passar `maxSizePerScope: 1` → cada set() deleta a row anterior → cache constantly thrashes; hit rate ≈ 0. Validator T0.1 só checa `> 0`; não recomenda mínimo. Documentar em README: "valores < 10 produzem thrashing; default 1000 é o sweet spot empírico per blueprint Q4".

### EC-14: Stub warning noise em test suites

- **Risco aceito:** T2.3 emite 3-line stderr warning a cada `createLocalMemory({ recallCache, embedder: stub })`. Em test suites que criam memory factory dezenas de vezes (existing 956 tests baseline), o stderr fica poluído. Solução: tests que QUEREM ver o warning fazem `vi.spyOn(process.stderr, 'write')`; tests que NÃO querem instalam o spy mock também (consistente com run-server.test.ts EC-6 precedent). Documentar em § Testing nota.

### EC-15: pgvector `ef_construction = 64` + `m = 16` tuning conservativo

- **Risco aceito:** Plano T0.2 hardcoda HNSW params no migration. Esses são valores GENÉRICOS para pgvector. Para max_size=1000/scope com N total scopes, real query performance pode beneficiar de tuning (mais m, menos ef_construction OR vice-versa). Defer a v1.5.x evidence-driven tuning per Inquebrável Rule 11 (YAGNI). Documentar ADR-acceptance em D7 amendment OR no Coverage Matrix row.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 (DIP + types) | 2 | 1 (EC-1 NaN) | 0 | 1 (EC-13) |
| T0.2 (migration 0010) | 2 | 1 (EC-2 dim-mismatch) | 0 | 1 (EC-15) |
| T1.1 (PgvectorRecallCacheStore) | 4 | 2 (EC-4 asOf, EC-5 attributedTo via T2.1 wrap) | 2 (EC-8, EC-12) | 0 |
| T1.2 (LRU eviction) | 2 | 1 (EC-7 race) | 1 (EC-9) | 0 |
| T2.1 (factory wiring) | 2 | 1 (EC-3 skill TTL) | 0 | 1 (EC-14) |
| T2.2 (write-trigger) | 3 | 1 (EC-6 reflect) | 2 (EC-10 forget, EC-11 sequential) | 0 |
| T2.3 (stub warning) | 1 | 0 | 0 | 1 (EC-14) |
| T3.1 (OTel metrics) | 0 | 0 | 0 | 0 |
| T4.1 (subpath) | 0 | 0 | 0 | 0 |
| T5.1 (THE GOAL TEST) | 0 | 0 | 0 | 0 |
| T5.2 (docs) | 0 | 0 | 0 | 0 |
| **Total** | **14** | **6** | **5** | **3** |

**Veredicto: PLANO PRECISA DE AJUSTE.**

## Próxima ação

Patch do plano absorvendo todos os 14 ECs inline (v1.0 → v1.1):

**6 MUST FIX** (absorvidos como sub-tasks OR ADR amendments):
- EC-1 → T0.1 validator amendment (`Number.isFinite` guard)
- EC-2 → T2.1 factory amendment (atttypmod probe + InvalidCacheConfig throw)
- EC-3 → T0.1 + T2.1 amendment (add `skill` to ScopeTierTtlConfig with 1h default) + ADR D3 amendment (4 tiers, not 3)
- EC-4 + EC-5 → T2.1 amendment (bypass cache when `asOf` OR `attributedTo` set) + new ADR D8 documenting the v1.5.0 cache-applicability boundary
- EC-6 → T2.2 amendment (hook reflect() in addition to remember/forget) + ADR D3 amendment
- EC-7 → T1.2 amendment (SERIALIZABLE isolation + retry-on-serialization-failure)

**5 SHOULD TEST** (inline em TDD blocks das tasks afetadas):
- EC-8 → T1.1 TDD
- EC-9 → T1.1/T1.2 TDD
- EC-10 → T2.2 TDD + concrete decision documented
- EC-11 → T2.2 TDD
- EC-12 → T1.1 TDD

**3 DOCUMENT** (notas inline OR ADR amendments):
- EC-13 → README + T0.1 acceptance criteria note
- EC-14 → T2.3 + Testing section note
- EC-15 → ADR D7 amendment (HNSW params deferred to v1.5.x)

Após absorption (v1.0 → v1.1), invocar `/deps-audit semantic-recall-cache-v1-5` → `/plan-confidence semantic-recall-cache-v1-5`.

Path: `.claude/knowledge-base/reviews/semantic-recall-cache-v1-5-edge-cases-2026-06-03.md`
