---
slug: llm-entity-reextraction
milestone_id: M13
created_at: 2026-07-23
goal: Substituir o grafo de entidades ruidoso por extração LLM com types semânticos — gate destravado no write path, supersede por identidade no estoque e job de backfill idempotente — medido pelas queries canônicas do baseline (ALL-CAPS 129→≤10; nomes ≤3 chars 106→≤10; 0 types de mecanismo em entidades novas; 0 memórias vivas elegíveis sem grafo).
---

# Plan: LLM Entity Re-extraction — types semânticos + backfill idempotente (M13, #111)

> v1.1 — MUST FIX EC-1/EC-2/EC-3 do edge-case review absorvidos; SHOULD TEST EC-4/EC-5 como testes.

## Goal

Eliminar o ruído do grafo de entidades ativando types semânticos no write path (gate de
`entity-linking.ts:150` destravado com vocabulário fechado + coerção observável), migrando o
estoque por supersede dirigido de identidade (`entities.superseded_by`) e executando o
backfill via `themory reextract` (chunks bounded, checkpoint/resume, `--dry-run` com
estimativa de custo) — VERIFICADO pelas queries canônicas do baseline
(`knowledge-base/audits/m13-entity-noise-baseline-2026-07-23.md`): ALL-CAPS ≤10, nomes ≤3
chars ≤10, zero PROPER/COMPOUND/QUOTED em entidades novas, zero memórias vivas elegíveis sem
grafo.

## Context

Fase B do blueprint `multilingual-entity-extraction` (Phase A shipped estancou a fonte;
ficou o estoque + 1029 memórias sem grafo). Discovery dedicada:
`knowledge-base/discoveries/blueprints/llm-entity-reextraction-blueprint.md`
(SHIPPABLE_WITH_CAVEATS 89) — achado central: o prompt de Phase 2 JÁ emite types semânticos
(`PERSON|ORG|PLACE|PRODUCT|CONCEPT|OTHER`) e o linking os DESCARTA no gate de ontology.
Milestone M13 do `ROADMAP.md` (grill:
`knowledge-base/grills/llm-entity-reextraction-feature-grill.md`). Issue: theo-memory#111.
Regras consumidas: `architecture.md` (DIP — engine atrás do factory/CLI), `testing.md § 4.1`
(edge + negative), `error-handling.md` (fail-fast tipado), `parsimony-ladder.md` (reuso do
pipeline Phase 2 — zero segundo stack), Unbreakable Rule 6 (CHANGELOG).

## Baseline Context (deep review of current state)

Verificado em `fc9b4f6` (develop, 2026-07-23).

### Files that will be touched

| File | LoC | Last commit | Papel hoje |
|---|---|---|---|
| `packages/core/src/domain/extraction/entity-linking.ts` | 276 | 23e97f8 | Phase 7: linking/persist; O GATE (`:150` nós; `:245` endpoints) que força `PROPER` sem ontology |
| `packages/core/src/domain/extraction/pipeline.ts` | 440 | 23e97f8 | Orquestra Phases 1–7; chama `applyOntologyToEntities` (`:235-241`) e `linkEntities` (`:434`) |
| `packages/core/src/domain/extraction/pipeline-helpers.ts` | 275 | 3de5325 | `applyOntologyToEntities` (`:42-60`) — coerção out-of-vocab → OTHER + evento |
| `packages/core/src/domain/ontology.ts` | 117 | 23e97f8 | Item 15: `ONTOLOGY_FALLBACK_TYPE='OTHER'` (`:21`), `resolveOntology` (`:107`) |
| `packages/core/src/infrastructure/db/pg-memory-entity-store.ts` | 144 | 7ccb953 | `upsertAndLink` INSERT-only; UNIQUE arbiter inclui `type` (`:25-27`); `list` (agregação) |
| `packages/core/src/domain/dip/memory-entity-store.ts` | 79 | 23e97f8 | Porta DIP (`UpsertAndLinkParams`, `EntityToLink{type,...}`) |
| `packages/core/src/infrastructure/db/pg-graph-expansion-store.ts` | — | — | Traversal 1-2 hop (ganha filtro de supersedidas) |
| `packages/core/src/infrastructure/db/migrations/` (NEW `0027_*.sql`) | — | 0026 é a última | Migração `entities.superseded_by` |
| `packages/cli/src/cli.ts` + (NEW) `packages/cli/src/reextract/` | — | — | Verbo `themory reextract` (precedente M12: `import claude-code` em `cli.ts:257-260`) |
| `packages/api/src/server/handlers/entities.ts` / `graph.ts` | — | — | Superfícies que filtram supersedidas (via store) |

### Current callers / dependents

- `linkEntities`: único caller de produção é `pipeline.ts:434` (grep 2026-07-23; demais hits
  são o próprio módulo + noise-filter).
- `upsertAndLink`: callers de produção `entity-linking.ts:123-128,252-257`; porta em
  `memory-entity-store.ts:72`; impl `pg-memory-entity-store.ts:36-86`.
- `PgMemoryEntityStore.list`: `packages/api/src/server/handlers/entities.ts` (via
  `memoryEntityStore.list`) — a agregação que o dashboard lê.
- Cross-repo: theo-cloud BFF consome `/v1/scopes/:type/:id/entities|graph` — NENHUMA mudança
  de contrato REST neste plano (filtro de supersedidas é server-side, shape inalterado).

### Domain glossary

- **Type de mecanismo**: `PROPER|COMPOUND|QUOTED` — rótulo do EXTRATOR heurístico antigo,
  persistido como `entities.type`; não é semântica de domínio.
- **Type semântico**: `PERSON|ORG|PLACE|PRODUCT|CONCEPT|OTHER` — vocabulário fechado default
  (menu já existente no prompt Phase 2, `prompt.ts:77`); ontologias Item 15 o substituem.
- **Supersede**: troca auditável de entidade — a antiga ganha `superseded_by=<nova.id>` e sai
  das listagens; links/edges re-apontados; nunca DELETE (Princípio 3).
- **Reextract**: job batch que re-roda a extração LLM Phase 2 sobre memórias-alvo e persiste
  via Phase 7 — mesmo pipeline do write, caller novo.

### Architecture boundaries affected

- Domain (`extraction/`) permanece sem I/O novo; o engine do reextract vive em
  `packages/cli/src/reextract/` (composition root — igual precedente M12 import) consumindo
  APENAS exports públicos de `@usetheo/memory` (DIP preservado).
- Porta `MemoryEntityStore` ganha UMA operação additive (`supersedeEntity`) — dentro da
  disciplina ADR-0008 (read/write da mesma tabela que a porta já possui).

## Prior Art & Related Work

- Blueprint desta fase: `knowledge-base/discoveries/blueprints/llm-entity-reextraction-blueprint.md`
  (ADRs D1–D3 deste plano derivam de lá; citações graphiti/mem0 com path:line).
- Phase A: `knowledge-base/discoveries/blueprints/multilingual-entity-extraction-blueprint.md`.
- Precedente de job batch idempotente no repo: M12 `packages/cli/src/import/migrate-claude-code.mjs`
  (chunk por contagem+bytes `CHUNK_MAX_BYTES`, dry-run, relatório) — o reextract segue o
  mesmo shape de engine CLI.
- Precedente de supersede: `memories.superseded_by` (skills, v0.6) — mesma semântica
  aplicada a `entities`.

## Objective

Ao final: (1) toda escrita nova persiste type semântico (coerção observável, zero rótulo de
mecanismo novo); (2) o estoque re-extraído está supersedido sem perda de provenance;
(3) `themory reextract` é idempotente, resumível e reporta custo; (4) benchmark do DoD
persistido como evidência.

## ADRs

### D1 — Destravar o type semântico no gate existente (write path)

**Decision:** `entity-linking.ts` passa a honrar o type do LLM SEMPRE: sem ontology
configurada, aplica coerção ao vocabulário fechado default `PERSON|ORG|PLACE|PRODUCT|
CONCEPT|OTHER` (novo `DEFAULT_ENTITY_TAXONOMY` em `ontology.ts`, reusando o mesmo
`applyOntologyToEntities`); com ontology Item 15, comportamento atual (vocabulário da
ontologia) inalterado. Endpoints auto-criados de edges usam `OTHER` (não mais `PROPER`).
**Rationale:** o LLM já emite os types (blueprint Q8; `prompt.ts:77`) — descartá-los é o
bug (#111). Parcimônia rungs 1–4 (capacidade instalada); coerção OBSERVÁVEL via
`ontology_type_coerced` (Princípio 3) — deliberadamente diferente do fallback silencioso do
graphiti (blueprint Q3). **Alternativas rejeitadas:** (a) exigir ontology para ter types —
fricção sem ganho; (b) NER dedicado (GLiNER) — rejeitado no blueprint da Phase A; (c) manter `PROPER`
como fallback — perpetua o rótulo de mecanismo que o DoD zera.
**Consequences:** identidade de dedup `(scope, type, key)` correta desde o primeiro write;
exige D2 para o estoque não colidir; a nota de review F-dom-db-1 (fragmentação de identidade)
é resolvida pela migração dirigida, não por manter o placeholder.

### D2 — Supersede dirigido por identidade no estoque (nunca linhas paralelas, nunca delete)

**Decision:** migração additive `0027_entities_superseded_by.sql`
(`superseded_by uuid NULL REFERENCES entities(id)` + índice parcial `WHERE superseded_by IS
NULL`); nova operação transacional `supersedeEntity({oldId, newId})` no
`PgMemoryEntityStore`: re-aponta `memory_entities` (INSERT ... ON CONFLICT DO NOTHING +
DELETE dos links antigos), re-aponta endpoints em `entity_edges`, seta `superseded_by`;
listagens/graph/summary filtram `superseded_by IS NULL`.
**Rationale:** `type` integra o UNIQUE (`pg-memory-entity-store.ts:25-27`) e o adapter é
INSERT-only — sem migração, re-tipagem duplica (blueprint Q8 caveat). Ponteiro explícito
supera a relação implícita do graphiti (blueprint Q2) — auditabilidade (Princípio 3); soft
sempre (lição graphiti + incidente theo-cloud#252). **Alternativas rejeitadas:** (a) `UPDATE
entities SET type` in-place — muda a identidade sob o arbiter do ON CONFLICT e apaga o
histórico do rótulo; (b) aceitar duplicação por type — dobra o ruído; (c) hard-delete das
antigas — viola Princípio 3 e a lição do #252.
**Consequences:** superfícies de leitura ganham 1 predicado; o GC de entidades (#110)
NÃO coleta supersedidas (têm ponteiro, não são órfãs) — documentado no teste.

### D3 — Job `themory reextract`: chunks bounded, checkpoint/resume, dry-run

**Decision:** engine em `packages/cli/src/reextract/` (composition root; consome exports
públicos de `@usetheo/memory` — mesmo shape do M12 import engine); alvos = (a) memórias
vivas sem NENHUM link + (b) memórias linkadas a entidades de type de mecanismo; chunks
bounded por CONTAGEM (default 25) E BYTES (512KB, constante compartilhada com o import);
concorrência: semáforo de 5 chamadas LLM; checkpoint JSON persistente por memória concluída
(resume pula concluídas; idempotência garantida pelo dedup determinístico por identidade +
supersede idempotente); `--dry-run` conta alvos, estima chamadas e tokens (chars/4) SEM
nenhuma chamada LLM; relatório final (alvos, chamadas, tokens estimados/reais, duração,
skips tipados).
**Rationale:** graphiti não tem checkpoint/resume (blueprint Q1) — nosso DoD exige; batching
por contagem+bytes é lição #112/#109; semáforo ≤5 porque cada chamada é LLM real pago
(graphiti usa 20 para workload próprio — blueprint Q4); `error-handling.md`: falha de LLM em
uma memória = skip TIPADO contabilizado, nunca aborta o lote inteiro silenciosamente, e o
resume re-tenta skips. **Alternativas rejeitadas:** (a) transação única gigante — locks e
re-trabalho total em crash; (b) sem dry-run — viola DoD/risco R1 do grill; (c) rodar no
servidor via endpoint REST — job operacional é do CLI (superfície admin), não da API pública.
**Consequences:** verbo novo no CLI (sancionado pelo M13 do ROADMAP — locked names
estendidos via processo, mesmo precedente do M12 `import claude-code`); OTel/relatório por
chunk.

## Drawbacks & Risks

| # | Risco | Severidade | Mitigação | Owner |
|---|---|---|---|---|
| 1 | Custo/latência LLM do backfill (~1029 memórias sem grafo + re-tipagem) | ALTA | `--dry-run` obrigatório antes do run real (estimativa exibida); chunks bounded; semáforo 5; checkpoint permite parar/retomar | executor do M13 |
| 2 | Substituição destrutiva mal feita (perda de links/edges) | ALTA | supersede transacional testado em integração (links re-apontados verificados por contagem antes/depois); NUNCA delete; validação fail-closed do alvo (id existe + não-supersedida) — lição #252 | executor do M13 |
| 3 | Extração LLM não-determinística muda nomes entre runs (entidade "nova" a cada run) | MÉDIA | identidade por `normalized_key` (case/space-insensitive) absorve variação de caixa; teste GOAL tolerante (containment) como no graphiti Q6; resíduo aceito e medido no benchmark | executor do M13 |
| 4 | Coluna TYPE do dashboard (theo-cloud#253 F2) depende deste deploy | BAIXA | fora deste repo; sequenciada pós-release (Recommendation 6 do blueprint) | próximo ciclo theo-cloud |

## Unresolved Questions

(none — every decision is resolved at plan time; a lacuna mem0/evaluation está documentada
no blueprint e não bloqueia nenhuma task.)

## Dependencies

| Dependency | Versão | Já instalada? | Papel | Rule 9 (não reinventar) |
|---|---|---|---|---|
| `openai` | ^4.77.0 | SIM (`packages/core/package.json` optionalDeps) | chamadas LLM do pipeline reusado | client oficial; retry próprio já existente |
| `zod` | ^3.25.0 | SIM | `AdditiveExtractionSchema` (parse estruturado) | idem |
| `pg` | ^8.13.0 | SIM | migração + supersede transacional | driver oficial |
| `commander` | (via cli) | SIM | verbo `reextract` | idem |

**ZERO dependência nova** (confirmado no blueprint Q4).

## Dependency Graph

```
Phase 1 (write path D1)  ──┐
                           ├──► Phase 3 (job D3) ──► Phase 4 (benchmark/backfill live)
Phase 2 (store D2)       ──┘                          │
                                                      ▼
                                        Final Phase: Integration Validation
```

Phases 1 e 2 são independentes (paralelizáveis); Phase 3 consome ambas; Phase 4 é o run
live + evidência.

## Phase 1: Write path — types semânticos por default (D1)

### T1.1 — Destravar o gate de tipagem com vocabulário fechado default

#### Objective
Escritas novas persistem o type semântico do LLM (coerção a `PERSON|ORG|PLACE|PRODUCT|
CONCEPT|OTHER`; out-of-vocab → `OTHER` + evento), sem exigir ontology configurada.

#### Why this step (action + reasoning — ReAct discipline)
Ação: introduzir `DEFAULT_ENTITY_TAXONOMY` em `ontology.ts` e usar o `applyOntologyToEntities`
existente também no caminho SEM ontology; remover o fallback `'PROPER'` do linking
(`entity-linking.ts:150,245` → `'OTHER'` p/ endpoints). Razão: ADR D1 — o LLM já emite os
types (blueprint Q8/`prompt.ts:77`); o único lugar onde eles morrem é o gate; reusar a
coerção existente mantém a observabilidade (`ontology_type_coerced`) e evita um segundo
mecanismo (DRY).

#### Evidence
`entity-linking.ts:150` (`type: deps.ontology !== undefined ? (e.type ?? 'PROPER') : 'PROPER'`);
`entity-linking.ts:245` (endpoints); `pipeline-helpers.ts:42-60` (coerção + evento);
`prompt.ts:77` (menu); baseline: 1409 PROPER/231 COMPOUND/18 QUOTED.

#### Files to edit
- `packages/core/src/domain/ontology.ts`
- `packages/core/src/domain/extraction/entity-linking.ts`
- `packages/core/src/domain/extraction/pipeline.ts`
- `packages/core/src/domain/extraction-phase7.test.ts`
- `tests/integration/ontology.test.ts`
- `tests/integration/entities/extract.test.ts`
- `CHANGELOG.md`

#### Deep file dependency analysis
`pipeline.ts:235-241` chama a coerção só com ontology; o default entra ali (uma taxonomy
resolvida SEMPRE). `entity-linking.ts` não importa ontology hoje — recebe o resultado já
coagido via `llmEntities`; a mudança no gate usa `e.type ?? 'OTHER'`. O UNIQUE
`(scope,type,key)` do adapter passa a receber types semânticos — nova identidade coexiste
com linhas antigas até a Phase 2/3 migrar (documentado; sem quebra: INSERT-only).

#### Deep Dives
Edge: LLM omite `type` → `OTHER` (nunca crash). Edge: type em caixa diferente
("person") → coerção normaliza (uppercase) antes de validar. Negative: type fora do menu
("ANIMAL") → `OTHER` + `ontology_type_coerced` (assert do evento).

#### Pseudo-code / Signatures
```ts
// ontology.ts
export const DEFAULT_ENTITY_TAXONOMY: ReadonlySet<string> =
  new Set(['PERSON','ORG','PLACE','PRODUCT','CONCEPT','OTHER']);
// pipeline.ts (Phase 2 pós-parse): SEM ontology → coerceToDefaultTaxonomy(llmEntities)
// entity-linking.ts:150 → type: e.type ?? 'OTHER'   (endpoints :245 → 'OTHER')
```

#### Tasks
1. RED unit + integração; 2. GREEN mínima; 3. REFACTOR; 4. wiring (caller = pipeline
existente; métrica = `ontology_type_coerced` já existente).

#### TDD
- `test_no_ontology_write_persists_semantic_type` (integração, `tests/integration/ontology.test.ts`):
  Given remember() SEM ontology e LLM stub emitindo `{name:'Ada Lovelace', type:'PERSON'}`;
  When o write completa; Then `SELECT type FROM entities WHERE name='Ada Lovelace'` →
  `expect(row.type).toBe('PERSON')` (hoje seria 'PROPER' — RED garante a falha).
- `test_out_of_vocab_type_coerces_to_other_with_event` (integração): LLM emite
  `type:'ANIMAL'` → `expect(row.type).toBe('OTHER')` e evento `ontology_type_coerced`
  observado no tracer stub.
- `test_missing_type_defaults_to_other` (unit, `extraction-phase7.test.ts`): entidade sem
  `type` → `upsertAndLink` chamado com `type:'OTHER'` (assert no stub — igualdade exata).
- `test_ontology_configured_keeps_item15_vocabulary` (integração, OBRIGATÓRIO — EC-2):
  com ontology `code`, um type válido da ontologia (ex. `FUNCTION`) SOBREVIVE intacto
  (nunca coagido ao default); a coerção default e a da ontologia são MUTUAMENTE EXCLUSIVAS
  (um único call-site decide qual taxonomy aplicar).

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- `grep -c "'PROPER'" packages/core/src/domain/extraction/entity-linking.ts` retorna 0 (nenhum literal de mecanismo restante no linking).
- `npx vitest run tests/integration/ontology.test.ts` exit 0 com o teste `test_out_of_vocab_type_coerces_to_other_with_event` assertando o evento `ontology_type_coerced` no tracer stub.
- `npx vitest run packages/core/src/domain/extraction-phase7.test.ts` exit 0 (4 testes novos verdes).

#### DoD (Definition of Done)
- `npx vitest run tests/integration/ontology.test.ts packages/core/src/domain/extraction-phase7.test.ts` verde.
- `npm run typecheck && npm run lint` limpos. CHANGELOG atualizado.

## Phase 2: Store — supersede por identidade (D2)

### T2.1 — Migração `entities.superseded_by` + operação transacional de supersede

#### Objective
`PgMemoryEntityStore.supersedeEntity({oldId, newId})`: re-aponta links e edges e marca a
antiga — transacional, idempotente, nunca delete.

#### Why this step (action + reasoning — ReAct discipline)
Ação: migração `0027_entities_superseded_by.sql` + método na porta/adapter. Razão: ADR D2 —
sem isso a re-tipagem cria linhas paralelas (UNIQUE inclui type); ponteiro explícito dá a
auditabilidade que o graphiti não tem (blueprint Q2); precedente interno
`memories.superseded_by`.

#### Evidence
`pg-memory-entity-store.ts:25-27` (arbiter com type); blueprint Q2 (soft bi-temporal);
`memory_entities` PK `(memory_id, entity_id)` — re-apontamento precisa de ON CONFLICT DO
NOTHING.

#### Files to edit
- `packages/core/src/infrastructure/db/migrations/0027_entities_superseded_by.sql`
- `packages/core/src/domain/dip/memory-entity-store.ts`
- `packages/core/src/infrastructure/db/pg-memory-entity-store.ts`
- `tests/integration/entities/supersede.test.ts`
- `CHANGELOG.md`

#### Deep file dependency analysis
`entity_edges` referencia entities por `source_entity_id/target_entity_id` (FK ON DELETE
CASCADE — por isso NUNCA delete); re-apontar endpoints preserva provenance
(`source_memory_id` intacto). `memory_entities` FK CASCADE idem. In-memory store: stub
honesto (`supersedeEntity` no-op documentado — não há entity store in-memory).

#### Deep Dives
Edge: supersede de entidade já supersedida → no-op idempotente (retorna false). Edge: old e
new com links à MESMA memória → ON CONFLICT DO NOTHING evita violação de PK. Negative:
`newId` inexistente → erro tipado `EntityNotFound`-like ANTES de qualquer write (validação
fail-closed — lição #252).

#### Pseudo-code / Signatures
```ts
// porta
supersedeEntity(params: { oldId: string; newId: string; workspaceId: string }): Promise<boolean>;
// SQL (uma tx): valida old+new no workspace → INSERT INTO memory_entities SELECT ON CONFLICT
// DO NOTHING → DELETE links antigos → UPDATE entity_edges endpoints → UPDATE entities SET
// superseded_by=$new WHERE id=$old AND superseded_by IS NULL
```

#### Tasks
1. RED integração; 2. GREEN migração+impl; 3. REFACTOR; 4. wiring (caller chega em T3.1;
nesta task o teste de integração é o caller — pillar (b); métrica em T2.2).

#### TDD
- `test_supersede_repoints_links_and_edges_and_marks_old` (integração, DB isolado): Given
  entidade OLD (2 links, 1 edge) e NEW; When `supersedeEntity`; Then links de OLD = 0, NEW
  contém os 2, edge endpoint aponta NEW, `old.superseded_by === new.id` — igualdades exatas
  por contagem SQL.
- `test_supersede_is_idempotent` : segunda chamada retorna `false` e nada muda (contagens
  iguais).
- `test_supersede_rejects_missing_target_before_any_write`: `newId` inexistente →
  `await expect(...).rejects.toThrow(/not found/i)` E contagens intactas (fail-closed).
- `test_shared_memory_link_no_pk_violation`: OLD e NEW linkados à mesma memória → sucesso,
  1 link resultante.
- `test_no_orphan_edges_after_supersede` (EC-5): contagem de edges igual antes/depois e
  zero edges com endpoint inexistente/supersedido.

#### Concurrency tests
- `test_concurrent_supersede_same_old_single_winner` — concurrent test com atomic-counter invariant:
  duas chamadas paralelas de `supersedeEntity` sobre o MESMO old → exatamente uma retorna true
  (predicado `superseded_by IS NULL` no UPDATE é o árbitro atômico); contagens consistentes.

#### Acceptance Criteria
- `runMigrations(pool)` aplicado 2x consecutivas em DB isolado exit 0 nas duas (idempotência da 0027 verificada por re-run).
- `THEOMEM_PG_URI=... npx vitest run tests/integration/entities/supersede.test.ts` exit 0 com 6 testes (5 funcionais + 1 concurrency) contra `ankane/pgvector:v0.5.1` real.

#### DoD
`THEOMEM_PG_URI=... npx vitest run tests/integration/entities/supersede.test.ts` verde;
typecheck/lint; CHANGELOG.

### T2.2 — Superfícies de leitura filtram supersedidas

#### Objective
`list` (agregação Entities), graph expansion e summary ignoram entidades supersedidas.

#### Why this step (action + reasoning — ReAct discipline)
Ação: predicado `superseded_by IS NULL` em `PgMemoryEntityStore.list` e
`pg-graph-expansion-store.ts` (+ summary LATERAL). Razão: ADR D2 consequences — sem o filtro
o dashboard mostraria dobrado durante/pós backfill; espelha o precedente `t_invalid IS NULL`
(#115).

#### Evidence
`pg-memory-entity-store.ts` list SQL (JOIN memories já filtra live — #115);
`pg-graph-expansion-store.ts` (traversal).

#### Files to edit
- `packages/core/src/infrastructure/db/pg-memory-entity-store.ts`
- `packages/core/src/infrastructure/db/pg-graph-expansion-store.ts`
- `tests/integration/entities/supersede.test.ts`
- `CHANGELOG.md`

#### Deep file dependency analysis
`entities.ts`/`graph.ts` handlers consomem os stores — shape REST inalterado (zero mudança
cross-repo). O GC (#110) coleta por "zero links"; supersedidas têm zero links MAS ponteiro —
adicionar guarda `superseded_by IS NULL` ao GC? NÃO: supersedidas SEM links podem ser
coletadas pelo GC de hard-forget apenas se a FK do ponteiro permitir — decisão: o GC ignora
linhas com `superseded_by` OU referenciadas por ele (documentado no teste
`test_gc_ignores_superseded`).

#### Deep Dives
Edge: entidade supersedida que ainda é TARGET de `superseded_by` de outra (cadeia A→B→C) —
listagem mostra só C. Negative: consulta de graph com endpoint supersedido re-apontado —
edge aparece no nó novo, nunca duplicada.

#### Pseudo-code / Signatures
(predicados SQL `AND e.superseded_by IS NULL` nos SELECTs de list/expansion/summary.)

#### Tasks
RED (extensão do teste de supersede com asserts de listagem) → GREEN → REFACTOR → wiring
(métrica: contagens da listagem já observáveis via endpoints; pillar (c) coberto pelo
benchmark Phase 4).

#### TDD
- `test_superseded_entity_disappears_from_list`: Given OLD supersedida por NEW; When
  `store.list(...)`; Then `expect(rows.find(r => r.name === OLD)).toBeUndefined()` e
  `expect(kept.memoryCount).toBe(<links migrados>)` (contagem exata).
- `test_graph_expansion_skips_superseded`: Given memória re-apontada; When expansão 1-hop;
  Then `expect(nodes).toContain(NEW)` e `expect(nodes).not.toContain(OLD)`.
- `test_gc_ignores_superseded` (em `tests/integration/scoped-forget.test.ts` estendido):
  Given OLD supersedida sem links; When hard-forget de memória linkada a NEW; Then
  `expect(entityStillExists(OLD)).toBe(true)` (guarda do GC).

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- `store.list` pós-supersede retorna 0 linhas para OLD e a contagem de NEW igual à soma dos links migrados (asserts de igualdade no teste `test_superseded_entity_disappears_from_list`).
- `npx vitest run tests/integration/entities/supersede.test.ts tests/integration/scoped-forget.test.ts` exit 0 (inclui `test_gc_ignores_superseded`).

#### DoD
Integração verde; typecheck/lint; CHANGELOG.

## Phase 3: Job — `themory reextract` (D3)

### T3.1 — Engine de re-extração (seleção, chunks, semáforo, checkpoint, dry-run)

#### Objective
Engine em `packages/cli/src/reextract/engine.ts`: seleciona alvos, processa em chunks
bounded, re-extrai via pipeline público, superseda entidades de mecanismo, checkpoint
resumível, dry-run com estimativa.

#### Why this step (action + reasoning — ReAct discipline)
Ação: módulo novo no composition root do CLI consumindo `@usetheo/memory` (factory + verbos)
— mesmo shape do M12 import engine. Razão: ADR D3; DIP (`architecture.md`) — domínio não
conhece o job; parcimônia — o engine ORQUESTRA funções existentes (`resolveOntology`,
prompt+parse, `applyOntologyToEntities`, `linkEntities` via um remember-like caller ou
export dedicado documentado no blueprint Q8).

#### Evidence
Blueprint Q8 (lista exata de funções); M12 `migrate-claude-code.mjs` (chunk/dry-run
precedente); baseline (1029 alvos sem grafo).

#### Files to edit
- `packages/cli/src/reextract/engine.ts`
- `packages/cli/src/reextract/engine.test.ts`
- `packages/core/src/index.ts` OU `packages/core/src/local/index.ts` (export público mínimo
  necessário p/ o engine — somente se algo do Q8 não estiver exportado; additive)
- `tests/integration/reextract.test.ts`
- `CHANGELOG.md`

#### Deep file dependency analysis
Seleção de alvos por SQL via pool (mesmo acesso que `themory migrate` usa):
(a) memórias vivas `kind <> 'skill'` sem link; (b) memórias com links a entidades
`type IN ('PROPER','COMPOUND','QUOTED')` não-supersedidas. Checkpoint: arquivo JSON
(`.reextract-checkpoint.json` no cwd, shape `{done: [memoryId...], startedAt}`) — arquivo,
não tabela (KISS; job de operador, single-writer).

#### Deep Dives
Edge: memória com texto vazio/curto (< 10 chars) → skip tipado `target_skipped_empty`.
Edge: chunk cujo total de bytes excede o teto com 1 item → processa o item sozinho (lição
#109: item único acima do teto NÃO é skip silencioso — reextract processa, pois a chamada é
por memória; o teto de bytes limita o CHUNK, não o item). Negative: LLM falha numa memória
(timeout/429) → skip tipado `target_failed_llm` contabilizado; resume re-tenta. Negative:
checkpoint corrompido → erro tipado com instrução de `--restart` (nunca ignora
silenciosamente).

#### Pseudo-code / Signatures
```ts
export interface ReextractOptions { dryRun: boolean; limit?: number; resume: boolean;
  concurrency: number /* default 5 */; chunkSize: number /* 25 */; chunkMaxBytes: number /* 512KB */ }
export interface ReextractReport { targets: number; processed: number; skipped:
  Record<string, number>; llmCalls: number; estTokens: number; durationMs: number;
  entitiesCreated: number; entitiesSuperseded: number }
export async function runReextract(deps: { pool; memory; llm }, opts): Promise<ReextractReport>
```
Loop: alvos → chunks → (semáforo 5) por memória: deriva `Filters` DA PRÓPRIA LINHA
(`workspace_id, user_id, session_id, agent_id` — EC-1: isolação M8; a entidade re-extraída
HERDA exatamente o escopo da memória-fonte) → extrai → coage → linkEntities(filters da
memória) → supersede por identidade (EC-3: NEW = linha retornada pelo upsert do linking,
existente OU criada; OLD→NEW casando `normalized_key` no MESMO escopo — nunca cria
terceira) → checkpoint append. Input da extração truncado ao teto de chars do precedente
#109 (EC-4) — memórias importadas de 40K+ chars não estouram contexto.

#### Tasks
RED unit (stubs) → RED integração (LLM stub determinístico) → GREEN → REFACTOR → wiring
(caller = verbo CLI T3.2; integração = reextract.test.ts; métrica = relatório + evento OTel
`reextract_chunk_done`).

#### TDD
- `test_dry_run_makes_zero_llm_calls_and_estimates` (unit): Given 7 alvos stub; When
  `runReextract({dryRun:true})`; Then `llm.generateResponse` chamado 0 vezes E
  `report.targets === 7` E `report.estTokens > 0`.
- `test_chunking_respects_count_and_bytes` (unit): 60 alvos pequenos → 3 chunks (25/25/10);
  alvos grandes → chunk fecha no teto de bytes (asserts nas fronteiras).
- `test_resume_skips_checkpointed_targets` (unit): checkpoint com 3 done → só 4 processadas;
  `report.processed === 4`.
- `test_llm_failure_is_typed_skip_not_abort` (unit): stub falha na 2ª memória → relatório
  `skipped.target_failed_llm === 1`, demais processadas (nunca throw do lote).
- `test_reextract_end_to_end_supersedes_mechanism_entities` (integração, DB isolado): Given
  memória com entidade `PROPER` "codex" linkada; LLM stub emite `{name:'Codex',
  type:'PRODUCT'}`; When run real (não-dry); Then nova entidade PRODUCT existe, antiga tem
  `superseded_by`, link re-apontado, re-run é no-op (`entitiesSuperseded === 0` na 2ª).
- `test_reextracted_entity_inherits_source_memory_scope` (integração, EC-1): memória
  SESSION-tier (workspace ws1, user alice, session s1) re-extraída → entidade nova carrega
  EXATAMENTE `(ws1, alice, s1)` nas colunas de escopo (igualdade por SELECT).
- `test_supersede_targets_existing_semantic_identity` (integração, EC-3): a identidade
  semântica JÁ existe por outra memória → supersede aponta para ELA (contagem de entidades
  não cresce; nunca cria terceira linha).
- `test_large_memory_input_truncated_not_crashed` (unit, EC-4): memória de 40K chars →
  prompt recebe input truncado ao teto; extração completa sem erro.

#### Concurrency tests
- `test_semaphore_bounds_inflight_llm_calls` — concurrent test com atomic-counter invariant:
  LLM stub com gate assíncrono registra max in-flight; com `concurrency: 5` e 20 alvos →
  `maxInFlight <= 5` (invariante atômico do contador no stub).

#### Acceptance Criteria
- `grep -rn "from '@usetheo/memory" packages/cli/src/reextract/engine.ts` mostra que TODO import de domínio vem do pacote público (0 imports relativos a packages/core/src — DIP verificável).
- `npx vitest run packages/cli/src/reextract/engine.test.ts tests/integration/reextract.test.ts` exit 0 (9 testes: 6 unit + 3 integração, incluindo o concurrency `test_semaphore_bounds_inflight_llm_calls`).
- `ReextractReport` retornado contém os 8 campos declarados (assert de shape no unit).

#### DoD
`npx vitest run packages/cli/src/reextract/engine.test.ts tests/integration/reextract.test.ts`
verde; typecheck/lint; CHANGELOG.

### T3.2 — Verbo CLI `themory reextract`

#### Objective
`themory reextract [--dry-run] [--resume] [--limit N] [--concurrency N] [--json]` wired ao
engine, com saída honesta (relatório) e exit codes (0 ok; 1 falhas parciais; 2 config).

#### Why this step (action + reasoning — ReAct discipline)
Ação: subcomando no `cli.ts` (precedente `import claude-code`, `cli.ts:257-260`) montando
pool+memory+llm do env (mesmo bootstrap do `themory server`/`migrate`). Razão: ADR D3 — job
operacional pertence ao CLI; DoD do M13 nomeia o comando.

#### Evidence
`cli.ts:172-310` (verbos existentes); DoD M13 bullet 1.

#### Files to edit
- `packages/cli/src/cli.ts`
- `packages/cli/src/reextract/run-reextract.ts`
- `packages/core/src/cli-locked-names.test.ts`
- `tests/integration/reextract-cli.test.ts`
- `CHANGELOG.md`

#### Deep file dependency analysis
Locked names: a lista de verbos do CLI é sentinel-guarded (`cli-locked-names.test.ts`) —
o teste é ATUALIZADO deliberadamente (extensão sancionada pelo M13 do ROADMAP, mesmo
processo do M12).

#### Deep Dives
Negative: env sem `THEOMEM_PG_URI`/LLM key → exit 2 com mensagem acionável (sem stack trace
cru). Edge: `--dry-run --json` → JSON parseável (consumível por scripts).

#### Pseudo-code / Signatures
(commander `.command('reextract').option('--dry-run')...` → `runReextractCli(opts)`.)

#### Tasks
RED (CLI dry-run spawn) → GREEN → REFACTOR → wiring (caller = usuário/operador; métrica =
relatório impresso + exit code).

#### TDD
- `test_cli_reextract_dry_run_reports_targets_and_exits_zero` (integração): Given DB isolado
  semeado com 3 alvos; When spawn `node dist/... reextract --dry-run --json`; Then
  `expect(json.targets).toBe(3)`, `expect(exitCode).toBe(0)` e ZERO chamadas LLM (env
  aponta para stub inexistente — dry-run nem tenta).
- `test_cli_reextract_missing_env_exits_2`: Given env sem PG URI; When spawn; Then
  `expect(exitCode).toBe(2)` e `expect(stderr).toContain('THEOMEM_PG_URI')`.
- `test_cli_locked_names_includes_reextract` (sentinela atualizada): Then
  `expect(lockedVerbs).toContain('reextract')`.

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- `node dist/agent-tools/cli.js reextract --help` exit 0 e stdout contém `--dry-run`, `--resume`, `--limit`, `--concurrency`.
- `npx vitest run tests/integration/reextract-cli.test.ts packages/core/src/cli-locked-names.test.ts` exit 0 (dry-run E2E + sentinela com `reextract` na lista).

#### DoD
Suites T3.2 verdes; typecheck/lint; CHANGELOG; `node dist/agent-tools/cli.js reextract
--help` imprime uso (smoke pós-build).

## Phase 4: Backfill live + benchmark (evidência do DoD)

### T4.1 — Dry-run + backfill na base live e relatório de benchmark

#### Objective
Executar o job na base live (app-dev) com evidência completa: dry-run → run real →
re-execução das queries canônicas → amostra qualitativa 20 → relatório persistido.

#### Why this step (action + reasoning — ReAct discipline)
Ação: deploy do provider (CD + host-run), rodar `themory reextract --dry-run` (registrar
estimativa), rodar real com checkpoint, re-executar as queries do baseline e escrever
`knowledge-base/audits/m13-entity-noise-post-backfill-2026-07-XX.md`. Razão: DoD do M13
bullets 3–4 + exigência do owner ("DADOS E VALIDAÇÕES EM BENCHMARK"); metodologia do
blueprint Q7 (métricas determinísticas primárias; sem LLM-judge no gate).

#### Evidence
Baseline: `knowledge-base/audits/m13-entity-noise-baseline-2026-07-23.md` (queries canônicas).

#### Files to edit
- `knowledge-base/audits/m13-entity-noise-post-backfill-{date}.md`
- `CHANGELOG.md`

#### Deep file dependency analysis
Run live usa o host-run provider OU acesso direto ao DB do servidor (mesma base themem);
checkpoint permite pausar se custo exceder a estimativa em 2x (guarda operacional).

#### Deep Dives
Edge: metas não atingidas na 1ª passada (ex.: ALL-CAPS 15 > 10) → segunda passada dirigida
apenas aos resíduos; se ainda falhar, relatório honesto + task de follow-up (NUNCA maquiar o
número). Negative: custo real >2x estimado no 1º chunk → pausa + reavaliação (guarda).

#### Pseudo-code / Signatures
(operacional: comandos ssh + CLI; queries do baseline verbatim.)

#### Tasks
1. Deploy; 2. dry-run (persistir saída); 3. run com monitor; 4. queries pós; 5. amostra 20;
6. relatório.

#### TDD
- `test_benchmark_noise_targets_met` (operacional-determinístico): Given o backfill live
  concluído; When as queries canônicas re-executam; Then `expect(all_caps_tokens).toBeLessThanOrEqual(10)`,
  `expect(very_short_names).toBeLessThanOrEqual(10)` (conjunto não-supersedido),
  `expect(memories_without_graph_elegiveis).toBe(0)` e `expect(new_mechanism_entities).toBe(0)` —
  registrado como SQL + saída no relatório (executável por qualquer revisor).

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- As 2 queries canônicas re-executadas na base live retornam `all_caps_tokens <= 10` E `very_short_names <= 10` (conjunto `superseded_by IS NULL`) E `memories_without_graph` elegíveis = 0 — saída SQL colada no relatório.
- O relatório `knowledge-base/audits/m13-entity-noise-post-backfill-*.md` contém a tabela dry-run vs real (chamadas, tokens, duração) e 20 linhas de amostra com veredito cada.
- `SELECT count(*) FROM entities WHERE created_at > '<início>' AND type IN ('PROPER','COMPOUND','QUOTED')` retorna 0 (zero mecanismo novo).

#### DoD
Metas numéricas atingidas + relatório commitado + CHANGELOG.

## Coverage Matrix

| Claim do Goal / DoD M13 | Task(s) |
|---|---|
| Types semânticos nas escritas novas (zero mecanismo novo) | T1.1 |
| Backfill idempotente com provenance + dry-run/custo bounded | T3.1, T3.2 |
| Supersede sem perda (links/edges preservados; nunca delete) | T2.1, T2.2 |
| Metas de ruído (ALL-CAPS ≤10; ≤3 chars ≤10) medidas | T4.1 |
| Memórias verbatim/importadas ganham grafo | T3.1 (alvos a) + T4.1 |
| Dashboard TYPE desbloqueado (dependência externa) | Riscos #4 (theo-cloud, pós-release) |
| Benchmark com dados persistidos | T4.1 |

100% dos claims mapeados.

## Global Definition of Done

- [ ] `THEOMEM_PG_URI=... npx vitest run tests/integration/ontology.test.ts tests/integration/entities/supersede.test.ts tests/integration/reextract.test.ts tests/integration/reextract-cli.test.ts packages/cli/src/reextract/engine.test.ts packages/core/src/domain/extraction-phase7.test.ts` exit 0 (todas as suites do plano verdes).
- [ ] `npm run typecheck` exit 0 E `npm run lint` reporta 0 errors.
- [ ] `python3 .claude/skills/implement/scripts/run_validation.py llm-entity-reextraction` exit 0 (inclui /code-quality ∉ {FAIL_HARD, INVALID}).
- [ ] `python3 .claude/skills/implement/scripts/check_wiring.py --symbol runReextract` e `--symbol supersedeEntity` reportam pillar (a) PASS (caller de produção existe) e pillar (b) PASS (teste de integração referencia o símbolo).
- [ ] `grep -c "reextract\|superseded_by\|DEFAULT_ENTITY_TAXONOMY" CHANGELOG.md` ≥ 3 (uma entry por task shippada — Rule 6).
- [ ] Benchmark T4.1: as 2 queries canônicas re-executadas retornam `all_caps_tokens <= 10` E `very_short_names <= 10` (conjunto não-supersedido) E `memories_without_graph` elegíveis = 0; relatório commitado em `knowledge-base/audits/m13-entity-noise-post-backfill-*.md`.

## Failure scenarios (when I/O external)

| Dependência externa | Cenário de falha | Reprodução no teste | Comportamento esperado |
|---|---|---|---|
| LLM (OpenAI via gateway) | timeout/429/5xx numa memória do chunk | stub rejeita na N-ésima chamada (`test_llm_failure_is_typed_skip_not_abort`) | skip tipado contabilizado; lote continua; resume re-tenta |
| LLM | resposta não-JSON/fora do schema | stub retorna lixo → `AdditiveExtractionSchema.parse` falha | mesmo caminho de skip tipado (`target_failed_parse`) |
| Postgres | conexão cai no meio do supersede | teste de tx: erro injetado após 1º statement | rollback total (transação única); re-run idempotente |
| Filesystem (checkpoint) | checkpoint corrompido | arquivo com JSON inválido | erro tipado com instrução `--restart`; nunca ignora silenciosamente |

## Final Phase: Integration Validation (MANDATORY)

### Execution
1. `npm run build` (workspace) — dist íntegro (rewrite-aliases inclui novos subpaths se houver).
2. `npx vitest run` das suites do plano + suites de regressão de entidades
   (`tests/integration/entities/`, `ontology.test.ts`, `scoped-forget.test.ts`).
3. `npm run typecheck && npm run lint`.
4. `python3 .claude/skills/implement/scripts/run_validation.py llm-entity-reextraction`.
5. Smoke: `node dist/agent-tools/cli.js reextract --help` + `--dry-run` contra DB isolado.

### Acceptance Criteria
- Cadeia completa verde; zero regressão nas suites de entidades/forget.
- Chaos pass dos failure scenarios (testes acima) verde.

### If Validation Fails
Loop de fix no `/implement` (validation halt-loop) — nunca avançar para /review com FAIL.
