# Blueprint: LLM Entity Re-extraction — batch backfill mechanics (M13, corrige #111)

> **Slug:** `llm-entity-reextraction` · **Date:** 2026-07-23 · **Verdict:** (preenchido pelo /discover-confidence)
> Discovery plan: `.claude/knowledge-base/discoveries/plans/llm-entity-reextraction-plan.md` (v1.1, plan-gate SHIPPABLE_WITH_CAVEATS 89)
> Baseline de ruído: `.claude/knowledge-base/audits/m13-entity-noise-baseline-2026-07-23.md`

## Context

A Phase A do blueprint `multilingual-entity-extraction` estancou a FONTE do ruído de
entidades; ficou o ESTOQUE (1658 entidades; 129 ALL-CAPS; 106 nomes ≤3 chars; types de
mecanismo PROPER 1409/COMPOUND 231/QUOTED 18) e **1029 memórias vivas sem grafo** (gap
D1→D2: `infer:false` e importadas não extraem mais inline). O M13 do `ROADMAP.md` exige
backfill batch idempotente (dry-run, custo bounded), types SEMÂNTICOS nas escritas novas e
no backfill, metas de ruído verificáveis (ALL-CAPS ≤10; ≤3 chars ≤10) e o desbloqueio da
coluna TYPE do dashboard (theo-cloud#253 Fase 2). Esta discovery investigou a MECÂNICA:
graphiti (primária — engine de KG com bulk/dedup/types), mem0 (secundária — batch
semantics) e o nosso pipeline interno.

**O achado que reenquadra tudo:** o prompt de Phase 2 JÁ pede e o LLM JÁ emite types
semânticos (`PERSON|ORG|PLACE|PRODUCT|CONCEPT|OTHER` — `packages/core/src/domain/extraction/prompt.ts:77`;
`LlmEntity.type?` em `packages/core/src/domain/extraction/entity-linking.ts:60-63`) — mas o
linking os DESCARTA quando não há ontology configurada, forçando `'PROPER'`
(`entity-linking.ts:150`; endpoints em `entity-linking.ts:245`). Para escritas novas o M13 é
majoritariamente destravar um gate — não construir extração nova. O segundo achado
estrutural: `type` integra o UNIQUE de dedup
(`packages/core/src/infrastructure/db/pg-memory-entity-store.ts:25-27`) e o adapter é
INSERT-only — re-extrair sem migração criaria linhas paralelas às `PROPER` (ver D2).

## Objective

Definir a mecânica executável da re-extração batch — substituição idempotente do grafo,
taxonomia semântica, batching/custo/resume e metodologia de benchmark — reusando o pipeline
Phase 2 existente (zero segundo stack), para o `/to-plan` do M13 decompor em tasks.

## Coverage Corner 1 — Integration Tests

**Q6 — como o graphiti testa extração/dedup/exclusão (`done`):**

- Dois regimes deliberados: **LLM REAL + DB real** para comportamento fim-a-fim
  (`.claude/knowledge-base/references/graphiti/tests/test_entity_exclusion_int.py:26,66` —
  `pytestmark = pytest.mark.integration`, client default exige `OPENAI_API_KEY`) e
  **LLM STUB determinístico + DB real** para mecânica de merge
  (`.claude/knowledge-base/references/graphiti/tests/test_add_triplet.py:32-51` — `Mock(spec=LLMClient)`
  com `AsyncMock` fixo; embedder mockado com embeddings determinísticos por nome em
  `tests/helpers_test.py:131-181`).
- Padrão de asserts espelha o regime: **tolerantes com LLM real** (containment/contagem —
  `test_entity_exclusion_int.py:103-107,161-170,216-218`) e **igualdade exata com stub**
  (`test_add_triplet.py:136-141,282-284`). Negative cases com `pytest.raises(ValueError, match=...)`
  (`test_add_triplet.py:556,622,678`) — alinhado ao nosso `testing.md § 4.1`.

**Q8 — ponto de acoplamento no NOSSO pipeline (`done`):**

```
runExtractionPipeline()                       packages/core/src/domain/extraction/pipeline.ts:49
  ├─ Phase 2: prompt + parse → llmEntities    pipeline.ts:106-147 / prompt.ts:203-209
  ├─ applyOntologyToEntities (coerção OTHER)  pipeline.ts:235-241 → pipeline-helpers.ts:42-60
  └─ Phase 7: linkEntities                    pipeline.ts:434 → entity-linking.ts:75
       ├─ type := ontology ? (e.type ?? 'PROPER') : 'PROPER'   entity-linking.ts:150   ← O GATE
       ├─ upsertAndLink (INSERT-only; UNIQUE inclui type)      pg-memory-entity-store.ts:25-27,36-86
       └─ endpoints de edges: 'OTHER'|'PROPER'                 entity-linking.ts:245
```

Um `themory reextract` chama, nesta ordem (zero stack novo): `resolveOntology`
(`packages/core/src/domain/ontology.ts:107`) → texto via `vectorStore.list` →
`generateAdditiveExtractionPrompt` + `llm.generateResponse` + `AdditiveExtractionSchema.parse`
(`packages/core/src/domain/extraction/prompt.ts:193`) → `applyOntologyToEntities`
(`pipeline-helpers.ts:42`) → `linkEntities` (`entity-linking.ts:75`). Testes de integração a
estender: `tests/integration/ontology.test.ts` (remember→coerção→type real no pg;
`ontology.test.ts:92-112`) e `tests/integration/entities/extract.test.ts` (GOAL test incl.
`infer:false`; `extract.test.ts:61-78,122-135`).

## Coverage Corner 2 — Dependencies

**Q4 — deps do bulk LLM no graphiti (`done`):**

| Dep | Versão | Papel | Nosso equivalente |
|---|---|---|---|
| `openai` ≥1.91.0 (`.claude/knowledge-base/references/graphiti/pyproject.toml:16`) | client default `AsyncOpenAI` (`graphiti_core/llm_client/openai_client.py:61`) | chamadas + structured `responses.parse` (`openai_client.py:85,103`) | `openai` já instalada (nosso LLM DIP) |
| `pydantic` ≥2.11.5 (`pyproject.toml:14`) | `response_model` por chamada; schema no prompt (`llm_client/client.py:215-221`) | — | `zod` (`AdditiveExtractionSchema`, `prompt.ts:193`) |
| `tenacity` ≥9.0.0 (`pyproject.toml:17`) | retry backoff exponencial: `stop_after_attempt(4)`, `wait_random_exponential(multiplier=10, min=5, max=120)`, retenta 429/5xx/JSON inválido (`client.py:62-72,120-130`) | — | retry já existente no nosso LLM client; o JOB adiciona retry por chunk |
| (nenhum rate-limiter client-side) | — | vazão controlada por **concorrência bounded**: `semaphore_gather` + `SEMAPHORE_LIMIT=20` env-overridável (`graphiti_core/helpers.py:38,122-133`; usos no bulk `graphiti_core/utils/bulk_utils.py:113,309,340,355,389,501,545`) | mesma técnica; nosso default conservador ≤5 (ADR D3) |

**Expectativa confirmada: ZERO dependência nova para o M13** — client LLM, zod e semáforo
já existem no nosso stack.

**Q5 — mem0: decisão batch sobre memórias existentes (`done`):**

- O prompt clássico ADD/UPDATE/DELETE/NONE existe no clone mas está **ÓRFÃO** do write path
  (`.claude/knowledge-base/references/mem0/mem0/configs/prompts.py:176-449` —
  `get_update_memory_messages` só referenciado em teste).
- O pipeline real (V3) é **ADD-only com linking**: recall top-10 com ids inteiros
  anti-alucinação (`mem0/mem0/memory/main.py:879-894`), LLM só ADD
  (`ADDITIVE_EXTRACTION_PROMPT`, `mem0/mem0/configs/prompts.py:468-472`), dedup por hash MD5
  (`main.py:961-980`); UPDATE/DELETE são operações explícitas por ID
  (`main.py:1972-2036,2038-2066`).
- **Lição:** o mercado convergiu para o NOSSO shape (ADD-only + dedup determinístico +
  mutação explícita — ADR-0003). A decisão de substituição do backfill NÃO deve ser um
  prompt-diff LLM (o próprio mem0 o abandonou); deve ser determinística por identidade (D2).

## Coverage Corner 3 — Tools

**Q7 — eval/benchmark de qualidade de extração (`done`; metodologia-somente per EC-2):**

- graphiti: **LLM-as-judge**, dois modos — QA binário (`EvalResponse(is_correct, reasoning)`,
  `.claude/knowledge-base/references/graphiti/graphiti_core/prompts/eval.py:33-37,102-124`) e
  **win-rate pairwise** baseline-vs-candidate (`EvalAddEpisodeResults(candidate_is_worse)`,
  `eval.py:40-47,127-156`), harness LongMemEval com baseline JSON persistido
  (`tests/evals/eval_e2e_graph_building.py:105-180`). Sem precision/recall.
- mem0: `mem0/evaluation/` é **submodule VAZIO no clone** (gitlink → memory-benchmarks,
  `mem0/.gitmodules:1-4`) — código não examinável localmente; metodologia documentada em
  `mem0/docs/core-concepts/memory-evaluation.mdx:14,67-69,83-85,103,129-132,191-240`
  (accuracy LLM-judge + tokens/query + latency; LoCoMo/LongMemEval/BEAM; CLI com
  checkpoint/`--resume`).

**Metodologia adotada para o DoD do M13 (texto + SQL; harness é task do plano):**

1. **Métricas determinísticas de ruído** (primárias — baratas, reproduzíveis, sem judge):
   as queries canônicas do baseline (`.claude/knowledge-base/audits/m13-entity-noise-baseline-2026-07-23.md`)
   re-executadas pós-backfill; veredito = ALL-CAPS ≤10 E ≤3 chars ≤10 E zero
   PROPER/COMPOUND/QUOTED em entidades novas (`created_at > início do backfill`).
2. **Cobertura de grafo**: `memories_without_graph` (query canônica) → alvo: 0 memórias
   vivas elegíveis sem link pós-backfill (excluídas: skills e vazias).
3. **Amostra qualitativa bounded** (secundária): 20 entidades aleatórias pós-backfill
   inspecionadas (tipo correto? nome é entidade real?) — registrada no relatório de release;
   sem LLM-judge no gate (custo/inconsistência documentada pelo próprio mem0: "±1 point
   confidence interval").
4. **Custo/latência do job**: contagem de chamadas LLM, tokens estimados no dry-run vs
   reais, duração por chunk — persistidos no relatório do benchmark (M13 DoD "DADOS E
   VALIDAÇÕES EM BENCHMARK").

## Coverage Corner 4 — Techniques

**Q1 — ingestão bulk do graphiti (`done`):** entrypoint `add_episode_bulk`
(`.claude/knowledge-base/references/graphiti/graphiti_core/graphiti.py:1230`): persiste TODOS
os episódios ANTES de qualquer LLM (`graphiti.py:1336-1343`); extração por episódio em
paralelo (`graphiti_core/utils/bulk_utils.py:263-292,330-371`); dedup do lote + resolução
contra o grafo com `uuid_map` union-find (`bulk_utils.py:69-98,374-486`); persist final único
transacional (`graphiti.py:1400-1408`). **Não há chunking de lote nem checkpoint/resume**
(grep vazio; `CHUNK_SIZE=10` órfão em `bulk_utils.py:66`) — crash re-roda tudo confiando em
MERGE-por-uuid + dedup best-effort (juiz LLM ⇒ idempotência NÃO estrita). Nosso dedup por
`(scope, type, normalized_key)` é determinístico — vantagem estrutural que o D3 explora
para checkpoint/resume seguros.

**Q2 — substituição/dedup sem duplicar (`done`):** cascata em 3 estágios — recall por
cosseno (15 candidatos, ≥0.6 — `graphiti_core/utils/maintenance/node_operations.py:64-65,418-450`);
determinístico exact-match + gate de entropia + MinHash Jaccard ≥0.9
(`graphiti_core/utils/maintenance/dedup_helpers.py:31-42,220-279`); LLM judge só no resto
(`node_operations.py:467-624`). Invalidação de edges é **SOFT bi-temporal, nunca delete**:
`invalid_at = nova.valid_at; expired_at = now()`
(`graphiti_core/utils/maintenance/edge_operations.py:538-573`). Mapeamento para nosso
Postgres: `t_invalid` ≈ `invalid_at`; **`superseded_by` não existe lá** (relação implícita)
— ponteiro explícito é extensão nossa (Princípio 3); `derived_from` ≈ `episodes[]`
(append em duplicata, `edge_operations.py:693-694`).

**Q3 — taxonomia de types (`done`; EC-4 confirmado):** o graphiti **NÃO tem vocabulário
default** — types são delegados ao caller (só o catch-all `Entity`;
`graphiti_core/utils/maintenance/node_operations.py:156-169`); classificação por
`entity_type_id` int com **fallback silencioso** para `Entity` fora do range
(`node_operations.py:302-306`). Nossa taxonomia ancora no que JÁ existe: menu do prompt
`PERSON|ORG|PLACE|PRODUCT|CONCEPT|OTHER` (`packages/core/src/domain/extraction/prompt.ts:77`)
como vocabulário fechado default, `OTHER` como coerção (mesma semântica de
`ONTOLOGY_FALLBACK_TYPE`, `packages/core/src/domain/ontology.ts:21`, e de
`applyOntologyToEntities` + evento `ontology_type_coerced`,
`pipeline-helpers.ts:42-60`); ontologias Item 15 seguem substituindo o default quando
configuradas. Diferença deliberada vs graphiti: nossa coerção é OBSERVÁVEL (evento OTel),
não silenciosa.

## Cross-cutting Comparison

| Dimensão | graphiti | mem0 (clone) | Nosso M13 (decidido) |
|---|---|---|---|
| Fluxo batch | fonte primeiro → extrai paralelo → dedup → 1 persist tx (`graphiti.py:1336-1408`) | ADD-only V3, dedup MD5 (`main.py:835-1064`) | fonte já persistida; re-extrai por chunk; upsert determinístico |
| Idempotência | best-effort (judge LLM) | hash MD5 exato | determinística por `(scope,type,normalized_key)` + checkpoint |
| Substituição | soft bi-temporal em edges; sem ponteiro | UPDATE/DELETE explícitos por ID | supersede com `superseded_by` explícito (D2) |
| Types | delegado ao caller; fallback silencioso `Entity` | n/a (sem módulo graph no clone) | vocabulário fechado default + coerção observável; Item 15 override |
| Concorrência | semaphore 20 | n/a | semaphore ≤5 (LLM real, custo) |
| Checkpoint/resume | ausente | benchmark CLI tem `--resume` (docs) | obrigatório (D3) |
| Benchmark | LLM-judge win-rate | LLM-judge + custo/latência (submodule ausente) | métricas SQL determinísticas + amostra qualitativa bounded + custo do job |

## ADRs

### D1 — Escritas novas: destravar o type semântico no gate existente

**Decision:** honrar SEMPRE o type do LLM com coerção ao vocabulário fechado
(`PERSON|ORG|PLACE|PRODUCT|CONCEPT|OTHER`) — remover a condição `deps.ontology !== undefined`
de `entity-linking.ts:150` (e o análogo de endpoints em `entity-linking.ts:245`), aplicando
coerção default quando não há ontology; Item 15 continua substituindo o vocabulário quando
configurado.
**Rationale:** o prompt já pede e o LLM já emite (prompt.ts:77) — descartar é o bug;
parcimônia rungs 1–4 (capacidade instalada); coerção observável via `ontology_type_coerced`
(Princípio 3) supera o fallback silencioso do graphiti (Q3). Alternativas rejeitadas:
(a) exigir ontology para ter types — fricção sem ganho; (b) NER dedicado (GLiNER) — já
rejeitado na Phase A (D7).
**Consequences:** entidades novas nascem semânticas; identidade de dedup correta desde o
primeiro write; exige D2 para o estoque não colidir.

### D2 — Estoque: supersede dirigido por identidade, nunca linhas paralelas nem delete

**Decision:** o backfill re-extrai por memória (pipeline Phase 2 reusado), upserta pela
identidade nova `(scope, type_semântico, normalized_key)` e MIGRA o estoque: links de
`memory_entities` re-apontados para a entidade nova; a antiga recebe `superseded_by =
<nova.id>` (coluna nova nullable em `entities`) e sai das listagens (`superseded_by IS
NULL`); edges preservadas por re-apontamento de endpoints. Nunca DELETE.
**Rationale:** `type` está no UNIQUE (`pg-memory-entity-store.ts:25-27`) e o adapter é
INSERT-only — sem migração, re-tipagem duplica em vez de limpar. Ponteiro explícito >
relação implícita do graphiti (Q2) — auditabilidade da troca (Princípio 3); soft-supersede
segue a lição do graphiti (nunca delete) e a nossa (incidente #252: destrutivo em massa só
com verificação fail-closed). Alternativas rejeitadas: (a) `UPDATE entities SET type`
in-place — quebra o arbiter do ON CONFLICT e o histórico; (b) aceitar duplicação — dobra o
ruído.
**Consequences:** migração additive `entities.superseded_by`; operação de supersede
transacional no adapter; listagens/graph/entities filtram supersedidas.

### D3 — Batching/custo/resume: o que o graphiti não tem e o DoD exige

**Decision:** `themory reextract` processa em chunks bounded por CONTAGEM E BYTES (lição
#112/#109), `--dry-run` conta alvos e estima chamadas/custo ANTES de qualquer LLM,
checkpoint persistente por memória processada (resume idempotente — re-rodar nunca
duplica, garantido pelo dedup determinístico), concorrência via semáforo default ≤5.
**Rationale:** graphiti não tem checkpoint/resume (Q1) — crash re-roda tudo; nosso DoD
exige idempotência + custo bounded + benchmark de custo; `error-handling.md` (fail-fast
tipado por chunk; nunca engolir falha de LLM — skip contabilizado e reportado). Alternativas
rejeitadas: (a) transação única gigante — locks/latência; (b) sem dry-run — viola DoD e o
risco R1 do grill.
**Consequences:** estado de checkpoint do job (tabela ou arquivo versionado); OTel por chunk
(Princípio 3); relatório de benchmark do job vira artefato do release.

## Recommendations

1. **(Q8/D1)** Task de write-path: remover o gate de ontology na tipagem
   (`entity-linking.ts:150,245`) com coerção default ao vocabulário fechado + testes RED
   estendendo `tests/integration/ontology.test.ts` (caminho SEM ontology persiste type
   semântico; out-of-vocab → OTHER + evento).
2. **(Q2/D2)** Task de migração: `entities.superseded_by` (nullable) + operação
   transacional de supersede no `PgMemoryEntityStore` (re-aponta `memory_entities` e
   endpoints de edges; nunca delete) + filtro `superseded_by IS NULL` nas superfícies de
   listagem (list/graph/summary).
3. **(Q1/Q5/D3)** Task do job: `themory reextract` (CLI) — seleção de alvos (memórias vivas
   sem grafo + entidades de mecanismo), chunks contagem+bytes, semáforo ≤5, checkpoint/resume,
   `--dry-run` com estimativa, relatório final (chamadas, tokens, duração, contagens).
4. **(Q6)** Testes em dois regimes como o graphiti: stub LLM determinístico para a mecânica
   (igualdade exata) + 1 GOAL test integração com LLM real tolerante (containment/contagem);
   negative cases tipados (`testing.md § 4.1`).
5. **(Q7)** Benchmark do DoD: re-executar as queries canônicas do baseline pós-backfill +
   amostra qualitativa de 20 + custo do job — persistir em
   `knowledge-base/audits/m13-entity-noise-post-backfill-{date}.md` como evidência do release.
6. **(Q3)** Dashboard (theo-cloud, pós-provider): coluna TYPE + filtro na tela Entities
   (destrava #253 Fase 2) — fora deste repo; sequenciar após o deploy do provider.

## Blocked questions (if any)

Nenhuma. 8/8 `done`. Lacunas honestas registradas inline: mem0 sem módulo graph e
`mem0/evaluation/` submodule vazio no clone (Q5/Q7) — papel de mem0 limitado conforme
ADR-DP2 do plano.

## Sources

- `.claude/knowledge-base/references/graphiti/` (Apache-2.0) — paths inline.
- `.claude/knowledge-base/references/mem0/` (Apache-2.0) — paths inline.
- Repo interno: `packages/core/src/domain/extraction/`, `packages/core/src/domain/ontology.ts`,
  `packages/core/src/infrastructure/db/pg-memory-entity-store.ts`.
- Phase A: `.claude/knowledge-base/discoveries/blueprints/multilingual-entity-extraction-blueprint.md`
  (web SOTA: Zep arXiv:2501.13956, mem0 arXiv:2504.19413, GraphRAG, GLiNER).
- Baseline: `.claude/knowledge-base/audits/m13-entity-noise-baseline-2026-07-23.md`.
