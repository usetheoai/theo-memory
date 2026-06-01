# Edge Case Review — adapters-openrouter-local-embedder

Data: 2026-06-01
Plano analisado: `.claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md` v1.0
Tasks analisadas: 9 (T0.1, T0.2, T0.3, T1.1, T1.2, T2.1, T2.2, T3.1, T4.1)
Edge cases encontrados: 12 (MUST FIX: 5, SHOULD TEST: 4, DOCUMENT: 3)

---

## MUST FIX

### EC-1: `embeddingDim` validation falha em NaN/non-integer/Infinity

- **Task afetada:** T0.1 (`LocalMemoryConfig.embeddingDim` pre-flight check)
- **Família:** Input / Format
- **Cenário:** Plano descreve guard `if (config.embeddingDim !== undefined && (config.embeddingDim <= 0 || config.embeddingDim > MAX_EMBEDDING_DIM))`. JavaScript: `NaN <= 0` é `false`, `NaN > 1536` é `false` — NaN passa silenciosamente. Mesmo problema com float (384.5) ou Infinity.
- **Impacto:** Probe chama embedder com `effectiveDim = NaN`; comparação `probeResult.length !== NaN` é sempre `true` → joga `EmbeddingMismatch` com mensagem incoerente ("expected NaN, got 384"). Pior caso: float não inteiro causa pgvector `ALTER COLUMN TYPE vector(384.5)` que reject com erro críptico.
- **Fix sugerido:** Trocar guard por `if (config.embeddingDim !== undefined && (!Number.isInteger(config.embeddingDim) || config.embeddingDim <= 0 || config.embeddingDim > MAX_EMBEDDING_DIM)) throw ...`. Atualizar mensagem de erro pra incluir o valor recebido literalmente.

### EC-3: Os 2 ALTER statements em `runMigrations` não estão em transação

- **Task afetada:** T0.3 (`runMigrations` post-migration ALTER COLUMN)
- **Família:** State / Atomicity
- **Cenário:** Plano § Tasks diz "Open a new client from the pool ... Execute the ALTER statements". Não menciona `BEGIN/COMMIT`. Os 2 ALTERs (memories + entities) rodam em autocommit individual. Se o segundo falhar (race com outro processo, timeout, lock), o schema fica meio-388-meio-1536.
- **Impacto:** DB em estado inconsistente sem signaling. Retry da call não conserta (a primeira ALTER já é no-op; a segunda continua falhando). Recovery exige operador raw SQL.
- **Fix sugerido:** Wrappar em transação atômica: `await client.query('BEGIN'); try { await client.query('ALTER ... memories ...'); await client.query('ALTER ... entities ...'); await client.query('COMMIT'); } catch (err) { await client.query('ROLLBACK'); throw err; }`. Adicionar acceptance criterion: "ambos ALTERs ou nenhum".

### EC-4: HNSW indexes em `memories.embedding` + `entities.embedding` BLOQUEIAM `ALTER COLUMN TYPE`

- **Task afetada:** T0.3 (`runMigrations` ALTER COLUMN)
- **Família:** State / Resource
- **Cenário:** Empiricamente verificado em `src/local/migrations/0000_crazy_mimic.sql:44,51`:
  ```sql
  CREATE INDEX "entities_embedding_hnsw_idx" ON "entities" USING hnsw ("embedding" vector_cosine_ops);
  CREATE INDEX "memories_embedding_hnsw_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops);
  ```
  pgvector **NÃO permite** `ALTER COLUMN TYPE vector(N→M)` em coluna com índice HNSW existente — Postgres reject com erro tipo `cannot alter type of a column used in an index`. O plano hoje ignora.
- **Impacto:** Toda invocação de `runMigrations(pool, { embeddingDim: 384 })` em DB com schema completo (= produção do demo) falha. Modo `local-openrouter` nunca boota. **BLOCKER do GOAL TEST.**
- **Fix sugerido:** Sequência idempotente: `DROP INDEX IF EXISTS memories_embedding_hnsw_idx; DROP INDEX IF EXISTS entities_embedding_hnsw_idx; ALTER TABLE memories ALTER COLUMN embedding TYPE vector(${dim}) USING NULL; ALTER TABLE entities ALTER COLUMN embedding TYPE vector(${dim}) USING NULL; CREATE INDEX memories_embedding_hnsw_idx ON memories USING hnsw (embedding vector_cosine_ops); CREATE INDEX entities_embedding_hnsw_idx ON entities USING hnsw (embedding vector_cosine_ops);` — tudo dentro da transação do EC-3. Documentar como "drop+recreate" no JSDoc do helper.

### EC-11: Valor inválido em `THEOMEM_DEMO_BACKEND` cai silenciosamente em `openai`

- **Task afetada:** T2.1 (`resolveBackendMode` precedence ladder)
- **Família:** Input / Format
- **Cenário:** Plano § ADR D6 lista a ladder, terminando em `return 'openai'; // default`. Valores tipados errado (`local_openrouter` com underscore, `localopenrouter`, `OPENROUTER`) **não casam** com nenhuma das condições → caem no default `openai`. Operador acredita estar no modo local; sistema usa OpenAIEmbedder; primeiro `embed()` 429s. Diagnóstico difícil porque `/api/info` reporta `adapterSource: 'openai'` mas o operador setou outra coisa.
- **Impacto:** Modo silently wrong. Viola Inquebrável Rule 3 (Honestidade Extrema). Mesma família do EC-3 do plano v0.7 ("unknown policy returns 400 not 500").
- **Fix sugerido:** Após a ladder, antes do default, validar explicitamente: `const raw = process.env.THEOMEM_DEMO_BACKEND; if (raw !== undefined && raw !== '' && !['stub','openai','local-openrouter'].includes(raw)) throw new Error(\`Invalid THEOMEM_DEMO_BACKEND='${raw}'; expected one of stub/openai/local-openrouter\`);`. Boot falha fail-loud em vez de mode silently wrong.

### EC-13: RED tests de T2.1 sob `examples/chat-with-memory/lib/__tests__/` NÃO são reachable pelo vitest config

- **Task afetada:** T2.1 (memory.ts demo tests)
- **Família:** Boundary / Test runner config
- **Cenário:** Plano § T2.1 Files to edit lista `examples/chat-with-memory/lib/__tests__/memory.test.ts (NEW or existing — verify)`. Empiricamente confirmado em `vitest.contract.config.ts:5-9`:
  ```ts
  include: [
    'src/{core,local,theokit,agent-tools,embedders,llms}/**/__tests__/**/*.test.ts',
    'src/__tests__/**/*.test.ts',
    'tests/unit/**/*.test.ts',
  ]
  ```
  `examples/chat-with-memory/lib/__tests__/memory.test.ts` **NÃO casa** com nenhum glob. `npm test` ignora. RED nunca falha → /implement Stop Condition #4 (plan defect — Files to edit unreachable).
- **Impacto:** Replica EXATAMENTE o failure mode v0-4a T0.1 que motivou o cycle-implement.md v1.5 e a regra § Pre-flight path validation do to-plan SKILL.md. /implement halt-loop emerge BLOCKED na iteração 1.
- **Fix sugerido:** Trocar caminho dos testes pra `tests/unit/examples/chat-with-memory-memory.test.ts` (match `tests/unit/**/*.test.ts` glob existente). Atualizar T2.1 Files to edit + TDD VERIFY command. Zero mudança na lógica do teste; só path.

---

## SHOULD TEST

### EC-2: Constructor dim mismatch vs schema dim (PgvectorStore)

- **Task afetada:** T0.2
- **Teste sugerido:** `test_pgvector_store_constructor_dim_384_against_vector_1536_schema_surfaces_insert_error` — instancia `new PgvectorStore(pool, { embeddingDim: 384 })` contra schema `vector(1536)` (sem ter rodado runMigrations({dim:384})) e tenta `insert()` com vetor 384-dim. Assert: pgvector retorna erro `expected 1536 dimensions, got 384`, NÃO silently truncate ou pad.

### EC-5: Empty string input em `LocalTransformerEmbedder.embed('')`

- **Task afetada:** T1.1
- **Teste sugerido:** `test_LocalTransformerEmbedder_embed_empty_string_behavior` — chama `embed('')` e assert o comportamento canônico do Xenova (ou retorna vetor zero, ou throw TypeError com message clara). NÃO aceitar NaN-poison vector. Documentar o comportamento observado no JSDoc.

### EC-7: Warmup network failure surfaces clean error

- **Task afetada:** T1.1
- **Teste sugerido:** `test_LocalTransformerEmbedder_embed_with_blocked_huggingface_cdn_surfaces_network_error` — mocka `fetch` para `huggingface.co/*` retornando 503; chama `embed('test')`; assert que rejeita com Error contendo `huggingface` no message (não silently hang ou retornar NaN vector). Garante que CI sem internet falha LOUD em vez de timeout 30min.

### EC-10: `THEOMEM_DEMO_BACKEND=local-openrouter` + `OPENAI_BASE_URL` unset → warn

- **Task afetada:** T2.1
- **Teste sugerido:** `test_local_openrouter_mode_without_OPENAI_BASE_URL_warns_at_boot` — seta `THEOMEM_DEMO_BACKEND=local-openrouter` mas NÃO `OPENAI_BASE_URL`; assert que `getSingleton()` emite `console.warn` contendo `OPENAI_BASE_URL not set — chat will route to api.openai.com which won't accept OpenRouter keys`. NÃO bloqueia boot (pode ser legítimo se o operador tem OpenAI key real), mas avisa.

---

## DOCUMENT

### EC-6: Long inputs silently truncated por MiniLM em ~256-512 tokens

- **Risco aceito:** MiniLM (`all-MiniLM-L6-v2`) tem `max_seq_length=256` (BERT tokenizer); inputs maiores são truncados pelo Xenova pipeline sem warning. Para uma demo de chat com prompts curtos (typical < 100 tokens) isso é não-issue. Documentar no JSDoc do `LocalTransformerEmbedder` e no README; sem mitigação programática.

### EC-8: ~22 MB disk + write access em `~/.cache/transformers-js/`

- **Risco aceito:** Primeira chamada de `embed()` baixa o modelo. Read-only filesystems (containers airgapped, alguns CI runners) falham. Documentar como pré-requisito no README + JSDoc do construtor. Workaround para CI: pre-cache via `npm run prepare:transformers-cache` (não está no escopo deste cycle).

### EC-12: CI sem internet em primeira run falha por download

- **Risco aceito:** Mesmo motivo do EC-8 mas no contexto T4.1 (integration test). CI runs subsequentes têm cache; só a primeira è network-bound. Documentar na header do integration test que a pre-condição inclui `npm test -- src/embedders/__tests__/local.test.ts` rodado primeiro (warm cache via unit test). Sem mitigação programática no test file.

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 1 | 1 | 0 | 0 |
| T0.2 | 1 | 0 | 1 | 0 |
| T0.3 | 2 | 2 | 0 | 0 |
| T1.1 | 4 | 0 | 2 | 2 |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 3 | 2 | 1 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |
| T4.1 | 1 | 0 | 0 | 1 |
| **Total** | **12** | **5** | **4** | **3** |

**Veredicto:** **PLANO PRECISA DE AJUSTE** — 5 MUST FIX devem ser absorvidos no bump v1.0 → v1.1 antes de `/deps-audit` + `/plan-confidence`. Particularmente EC-4 (HNSW indexes bloqueiam ALTER) e EC-13 (test path unreachable) — ambos verified empiricamente — caso contrário /implement bata Stop Condition na primeira iteração.

## Anti-patterns evitados neste review

- NÃO sugeri criar `ConfigValidatorService` para EC-1 — um `Number.isInteger` resolve.
- NÃO sugeri retry-with-backoff para EC-3 — transação atômica resolve em uma linha.
- NÃO sugeri "embedder warmup framework" para EC-7 — um teste de erro path suficiente.
- NÃO especulei sobre "e se Xenova bumpar pra 3.x" — fora do escopo.
- NÃO sugeri scope creep adicionando providers Anthropic/Cohere/Voyage — explicitamente Out-of-Scope do plano.

## Cross-references

- Plano: [adapters-openrouter-local-embedder-plan.md](.claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md)
- Schema HNSW (evidência EC-4): `src/local/migrations/0000_crazy_mimic.sql:44,51`
- Vitest config (evidência EC-13): `vitest.contract.config.ts:5-9`
- InMemoryVectorStore dim-agnostic (false-positive evitado): `src/local/in-memory-store.ts:34-99`
- Pre-flight path validation rule: `.claude/skills/to-plan/SKILL.md § Pre-flight path validation`
- Precedente similar (EC-3 do v0.7): `.claude/knowledge-base/reviews/examples-chat-with-memory-v0-7-distillation-edge-cases-2026-06-01.md § EC-3`
