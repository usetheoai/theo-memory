---
slug: pipeline-decomposition-behavior-frozen
milestone_id: M19
created_at: 2026-07-25
goal: Decompor pipeline.ts (726 linhas) em módulos de estágio abaixo do teto de 300, com zero mudança de comportamento provada por suíte + benchmark antes/depois idênticos.
---

# Plan: pipeline-decomposition-behavior-frozen (M19 — #124)

- **Version:** 1.0
- **Slug:** `pipeline-decomposition-behavior-frozen`
- **Milestone:** M19 (`ROADMAP.md`) — theo-memory#124
- **Depends:** M18 (tocou `scoring.ts` no mesmo caminho; feito — evita refatorar duas vezes).

## Goal

Reduzir `packages/core/src/domain/retrieval/pipeline.ts` de 726 para abaixo do teto de 300 linhas do `check_quality.py`, extraindo os estágios coesos (rerank, threshold-filter, trace, adaptive-relax, graph-expansion, row-mapping) para módulos próprios, com **zero mudança de comportamento** — provado por (a) a suíte inteira passando sem alterar nenhuma asserção e (b) o benchmark do M18 re-executado antes/depois com os mesmos três números.

Sucesso é observável por: `wc -l pipeline.ts` < 300; `npx vitest run` (contract + integração) verde sem editar asserção; `docs/benchmarks/entity-boost-m18.json` idêntico (churn 0, monotonic 0, precision 1.0) na re-execução pós-refactor.

## Baseline Context

HEAD `6221051` (v0.46.1 released, M18 [x]). Branch `develop`.

### Files that will be touched

| Arquivo | LoC | Papel |
|---|---|---|
| `packages/core/src/domain/retrieval/pipeline.ts` | 726 | orquestrador + 7 helpers inline — o alvo a decompor |
| `packages/core/src/domain/retrieval/stages/threshold-filter.ts` | (NEW) | `filterAtThreshold` + tipos `ScoredRow`/`DroppedCandidate` |
| `packages/core/src/domain/retrieval/stages/rerank.ts` | (NEW) | `applyRerankStage` |
| `packages/core/src/domain/retrieval/stages/recall-trace.ts` | (NEW) | `writeRecallTrace` |
| `packages/core/src/domain/retrieval/stages/adaptive-relax.ts` | (NEW) | `applyAdaptiveAssessStage` |
| `packages/core/src/domain/retrieval/stages/graph-expansion.ts` | (NEW) | `applyGraphExpansionStage` |
| `packages/core/src/domain/retrieval/stages/row-mapping.ts` | (NEW) | `rowToItem` + `scopeFromFilters` + `payloadToScore` |

### Current structure (function boundaries, cited)

- `RetrievalDeps` interface (`pipeline.ts:43`)
- `scopeFromFilters` (`:106`), `payloadToScore` (`:119`)
- `applyRerankStage` (`:132`), `filterAtThreshold` (`:180`), `writeRecallTrace` (`:234`), `applyAdaptiveAssessStage` (`:285`), `applyGraphExpansionStage` (`:372`)
- `runRetrievalPipeline` (`:431-726`) — orquestrador de 8 steps inline.

### Current callers / dependents

- `runRetrievalPipeline` — caller de produção: `scoped-retrieval.ts` (via `Memory.recall`). É a única export pública consumida fora; os helpers são file-private.
- `filterAtThreshold` é chamado 2× dentro do arquivo (`:511` inicial, `:325` no adaptive-relax) — a extração deve preservar essa reutilização.
- Testes: toda a suíte de `tests/integration/entity-boost/`, `reranker`, `entities/graph`, `cache` exercita o pipeline transitivamente.

### Architecture boundaries affected

`pipeline.ts` é domínio (`architecture.md § 1`). Os novos módulos `stages/` ficam na mesma camada de domínio — nenhuma fronteira DIP cruzada. As funções extraídas mantêm assinaturas idênticas; só mudam de arquivo. `runRetrievalPipeline` importa dos novos módulos.

## Prior Art & Related Work

- (nenhuma patterns skill casa) — refactor interno mecânico.
- Interno: o padrão "Pipeline com estágios sequenciais" já é a forma do arquivo (Step 1..8.5); a extração apenas materializa cada estágio como módulo (`architecture.md § 3` — coesão de módulo).

## Coverage Matrix

| # | Afirmação do Goal | Task(s) | Coberto? |
|---|---|---|---|
| C1 | `pipeline.ts` < 300 linhas | T1.1..T1.6 (extrações) | sim |
| C2 | Zero mudança de comportamento (suíte inteira verde sem editar asserção) | T2.1 (freeze gate) | sim |
| C3 | Blocos duplicados extraídos (threshold reuse, row-mapping) | T1.1, T1.6 | sim |
| C4 | Fronteiras seguem #124 (rerank, threshold, trace, expansion) | T1.1..T1.5 | sim |
| C5 | Benchmark M18 re-executado antes/depois com mesmos números | T2.2 | sim |

100% mapeado.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (nenhuma) | | | Refactor puro — movimentação de código, sem nova dependência. |

### New / Removed

(none)

## ADRs

### D1 — Extração por estágio para `stages/`, assinaturas inalteradas

**Decisão:** cada helper file-private de `pipeline.ts` vira um módulo em `retrieval/stages/` com assinatura idêntica; `runRetrievalPipeline` importa-os. Os tipos compartilhados (`ScoredRow`, `DroppedCandidate`, `Candidate`) migram para o módulo que os possui (threshold-filter) e são reexportados onde necessário.

**Rationale:** coesão de módulo (`architecture.md § 3`) — cada estágio tem uma responsabilidade e uma razão para mudar. Assinatura inalterada = zero risco de comportamento (`architecture.md § 6` — evitar abstração prematura; aqui não há abstração nova, só realocação). O teto de 300 do `check_quality.py` é o driver.

**Alternativas rejeitadas:**
- **Uma classe `RetrievalPipeline` com métodos privados.** Rejeitada: introduz estado/OO onde o fluxo é funcional puro; muda a forma sem necessidade (YAGNI) e aumenta o risco de comportamento.
- **Deixar como está + allowlist do teto.** Rejeitada: o DoD do #124 exige a decomposição; suprimir o gate perpetua o bloqueio de edição do caminho crítico.

### D2 — Comportamento congelado por suíte + benchmark, não por confiança

**Decisão:** nenhuma asserção de teste é alterada. O refactor é validado rodando a suíte inteira (contract + integração) e re-executando o benchmark M18 antes e depois, comparando os três números.

**Rationale:** o risco #1 do #124 é "bug sutil de ranking introduzido por refactor" — exatamente o que adiou o trabalho no M15. A única prova aceitável é a suíte verde sem tocar asserção + benchmark idêntico (`testing.md § 1` — testes protegem comportamento). Um refactor que precisa mudar um teste NÃO é comportamento-preservador.

**Alternativas rejeitadas:**
- **Confiar na revisão visual do diff.** Rejeitada: um shift de ordem de sort ou de reuso do `maxScore` é invisível à leitura mas mensurável no benchmark.

## Phase 1 — Extração por estágio

### T1.1 — Extrair `filterAtThreshold` + tipos para `stages/threshold-filter.ts`

#### Files to edit

- `packages/core/src/domain/retrieval/stages/threshold-filter.ts`
- `packages/core/src/domain/retrieval/pipeline.ts`

#### Deep file dependency analysis

`filterAtThreshold` (`pipeline.ts:180-233`) é chamado 2× (`:511`, `:325`). Os tipos `ScoredRow`, `DroppedCandidate`, `Candidate` são usados por ele e pelo orquestrador. Extrair a função + tipos; `pipeline.ts` e `adaptive-relax.ts` importam.

#### Why this step

**Ação:** mover `filterAtThreshold` + tipos para o módulo próprio; `pipeline.ts` importa. **Raciocínio:** é o bloco mais reutilizado (2 call sites) e o núcleo do gate — isolá-lo primeiro fixa os tipos compartilhados que os outros estágios consomem. Cita ADR D1.

#### TDD

RED: test_threshold_filter_module_exports — importar `filterAtThreshold` de `stages/threshold-filter.js` e confirmar que retorna as mesmas linhas para um input fixo (semantic gate + combine + drop). Falha antes da extração (módulo não existe).

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `filterAtThreshold` vive em `stages/threshold-filter.ts`; `pipeline.ts` importa-o.
- A suíte inteira passa sem editar asserção.

#### DoD

- `npm run typecheck` exit 0; `npx vitest run tests/integration/entity-boost/` verde.

### T1.2 — Extrair `applyRerankStage` para `stages/rerank.ts`

#### Files to edit

- `packages/core/src/domain/retrieval/stages/rerank.ts`
- `packages/core/src/domain/retrieval/pipeline.ts`

#### Deep file dependency analysis

`applyRerankStage` (`:132-179`) usa o `Reranker` DIP + `MemoryItemWithScore`. Sem call site interno duplicado; move direto.

#### Why this step

**Ação:** mover o estágio de rerank. **Raciocínio:** fronteira já mapeada no #124; estágio opcional pós-threshold, coeso. ADR D1.

#### TDD

RED: test_rerank_stage_module_exists — importar `applyRerankStage` de `stages/rerank.js`; a suíte de reranker (`tests/integration/reranker.test.ts`) passa inalterada.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `applyRerankStage` em `stages/rerank.ts`; `reranker.test.ts` verde sem edição.

#### DoD

- `npx vitest run tests/integration/reranker.test.ts` verde.

### T1.3 — Extrair `writeRecallTrace` para `stages/recall-trace.ts`

#### Files to edit

- `packages/core/src/domain/retrieval/stages/recall-trace.ts`
- `packages/core/src/domain/retrieval/pipeline.ts`

#### Deep file dependency analysis

`writeRecallTrace` (`:234-284`) escreve o trace de drops (explainable-recall S1). Usa `DroppedCandidate` (de threshold-filter, T1.1) + o recall-trace store DIP. Move direto.

#### Why this step

**Ação:** mover o estágio de trace. **Raciocínio:** fronteira #124; fail-soft, isolado. ADR D1.

#### TDD

RED: test_recall_trace_stage_module_exists — importar de `stages/recall-trace.js`; os testes de recall-trace passam inalterados.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `writeRecallTrace` em `stages/recall-trace.ts`; testes de trace verdes.

#### DoD

- `npx vitest run` dos testes que exercitam recall-trace verde.

### T1.4 — Extrair `applyAdaptiveAssessStage` para `stages/adaptive-relax.ts`

#### Files to edit

- `packages/core/src/domain/retrieval/stages/adaptive-relax.ts`
- `packages/core/src/domain/retrieval/pipeline.ts`

#### Deep file dependency analysis

`applyAdaptiveAssessStage` (`:285-371`) chama `filterAtThreshold` (importado de T1.1) no re-filter de relax. Preservar essa dependência inter-módulo.

#### Why this step

**Ação:** mover o estágio adaptativo. **Raciocínio:** fronteira #124; o maior helper (~87 linhas), maior ganho de LoC. Cita a reutilização do `filterAtThreshold` de T1.1. ADR D1.

#### TDD

RED: test_adaptive_relax_stage_module_exists — importar de `stages/adaptive-relax.js`; os testes de adaptive/relax passam inalterados.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- Estágio em `stages/adaptive-relax.ts`, reusando `filterAtThreshold` importado.

#### DoD

- Testes de adaptive-relax verdes sem edição.

### T1.5 — Extrair `applyGraphExpansionStage` para `stages/graph-expansion.ts`

#### Files to edit

- `packages/core/src/domain/retrieval/stages/graph-expansion.ts`
- `packages/core/src/domain/retrieval/pipeline.ts`

#### Deep file dependency analysis

`applyGraphExpansionStage` (`:372-430`) usa o graph-expansion store DIP. Move direto.

#### Why this step

**Ação:** mover o estágio de expansão de grafo. **Raciocínio:** fronteira #124; isolado. ADR D1.

#### TDD

RED: test_graph_expansion_stage_module_exists — importar de `stages/graph-expansion.js`; `tests/integration/entities/graph.test.ts` verde inalterado.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- Estágio em `stages/graph-expansion.ts`; `graph.test.ts` verde.

#### DoD

- `npx vitest run tests/integration/entities/graph.test.ts` verde.

### T1.6 — Extrair `rowToItem` + `scopeFromFilters` + `payloadToScore` para `stages/row-mapping.ts`

#### Files to edit

- `packages/core/src/domain/retrieval/stages/row-mapping.ts`
- `packages/core/src/domain/retrieval/pipeline.ts`

#### Deep file dependency analysis

`rowToItem` (inline em `runRetrievalPipeline`, `:534-560+`) mapeia `ScoredRow` → `MemoryItemWithScore`, hoisting attributed_to / confirmation_count / created_at. `scopeFromFilters` (`:106`) e `payloadToScore` (`:119`) são helpers de mapeamento. Agrupá-los no módulo de mapeamento; o `rowToItem` precisa de `scope` + `now` como parâmetros (hoje capturados do closure) — passar explicitamente para extrair sem mudar comportamento.

#### Why this step

**Ação:** extrair o mapeamento row→DTO + helpers de scope/score, passando `scope`/`now` como args. **Raciocínio:** é o maior bloco inline do orquestrador; extraí-lo é o que leva `pipeline.ts` abaixo de 300. O `rowToItem` usa closure (`scope`, `now`) — a extração deve parametrizar, não mudar o valor. ADR D1.

#### TDD

RED: test_row_mapping_preserves_dto_fields — dado um `ScoredRow` com payload contendo attributed_to/confirmation_count/created_at, `rowToItem(row, scope, now)` retorna o DTO com os mesmos campos hoisted que a versão inline. Falha antes da extração.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `rowToItem`/`scopeFromFilters`/`payloadToScore` em `stages/row-mapping.ts`, com `scope`/`now` parametrizados.
- `pipeline.ts` < 300 linhas após esta extração.

#### DoD

- `wc -l pipeline.ts` < 300; `npm run typecheck` exit 0.

## Phase 2 — Congelamento de comportamento

### T2.1 — Gate: suíte inteira verde sem editar asserção

#### Files to edit

- (nenhum — verificação)

#### Deep file dependency analysis

Após todas as extrações, a suíte inteira (contract 1355 + integração) deve passar sem que NENHUMA asserção tenha sido tocada. Um `git diff` das extrações deve conter apenas movimentação + imports, nunca mudança em `*.test.ts`.

#### Why this step

**Ação:** rodar a suíte inteira e confirmar verde + confirmar que nenhum `.test.ts` foi editado. **Raciocínio:** D2 — comportamento congelado; um teste alterado invalida a prova de preservação.

#### TDD

RED: (meta) `git diff --name-only origin/main..HEAD -- '*.test.ts'` deve retornar APENAS arquivos de teste NOVOS de shape (test_*_module_exists), nunca edição de asserção existente. `npx vitest run` (contract + integração) exit 0.

#### Concurrency tests

(none — single-threaded)

#### Failure scenarios

(none — no external I/O touched pelo refactor; os testes de integração tocam pg, cobertos pela suíte existente)

#### Acceptance criteria

- Suíte inteira verde; nenhuma asserção existente editada.

#### DoD

- `npx vitest run --config vitest.contract.config.ts` exit 0; `npx vitest run --config vitest.integration.config.ts tests/integration/entity-boost/ tests/integration/reranker.test.ts tests/integration/entities/` exit 0.

### T2.2 — Benchmark M18 re-executado: mesmos três números

#### Files to edit

- (nenhum — verificação; opcionalmente `docs/benchmarks/pipeline-refactor-m19.md` registrando o antes/depois)

#### Deep file dependency analysis

`tests/integration/entity-boost/precision-benchmark.test.ts` escreve `entity-boost-m18.json`. Re-executar pós-refactor e comparar: `monotonic_violations`, `recall_set_churn_sensitive`, precision devem ser idênticos (o refactor não toca scoring nem ranking).

#### Why this step

**Ação:** re-rodar o benchmark e comparar os três números antes/depois. **Raciocínio:** DoD explícito do #124 — prova de que o refactor não mexeu no ranking. Cita o risco #1.

#### TDD

RED: test_benchmark_unchanged_after_refactor — os três números do `entity-boost-m18.json` pós-refactor são iguais aos pré-refactor (churn 0, monotonic 0, precision withBoost 1.0).

#### Concurrency tests

(none — single-threaded)

#### Failure scenarios

Ver `## Failure scenarios`.

#### Acceptance criteria

- Benchmark re-executado com os mesmos três números.

#### DoD

- `entity-boost-m18.json` pós-refactor: `monotonicViolations=0`, `recallSetChurnSensitive.churn=0`, `precisionAtK.withBoost=1`.

## Failure scenarios

| Cenário | Comportamento esperado |
|---|---|
| Postgres indisponível na re-execução do benchmark/suíte | Os testes de integração FALHAM alto (é o gate). O refactor não introduz novo I/O; o caminho de produção mantém o timeout/degradação do entity-boost (M16) inalterado. |

## Drawbacks & Risks

| Risco | Por que é real | Mitigação |
|---|---|---|
| Bug sutil de ranking introduzido pela extração | Risco #1 do #124; um shift de sort/reuse de `maxScore` é invisível na leitura | Comportamento congelado por suíte + benchmark antes/depois (D2); assinaturas inalteradas (D1) |
| `rowToItem` usa closure (`scope`, `now`) | Extrair sem parametrizar mudaria o valor capturado | T1.6 parametriza `scope`/`now` explicitamente; teste de preservação de DTO |
| Ciclo de import entre `stages/` e `pipeline.ts` | `adaptive-relax` importa `filterAtThreshold` | Threshold-filter é folha (não importa os outros); grafo de import acíclico |

## Unresolved Questions

(none — every decision is resolved at plan time; a extração segue as fronteiras já mapeadas no #124.)

## Test Plan

- **Sem novos testes de comportamento** — o refactor é congelado pela suíte existente. Apenas testes de shape `test_*_module_exists` provam que a extração aconteceu.
- **Integração:** suíte inteira contra pg real, verde sem editar asserção.
- **Benchmark:** re-execução antes/depois com os mesmos três números.

## Critical paths

- `packages/core/src/domain/retrieval/pipeline.ts`

## Global Definition of Done

- `wc -l pipeline.ts` < 300.
- Suíte inteira (contract + integração) verde, nenhuma asserção existente editada.
- Benchmark M18 re-executado: mesmos três números.
- `npm run typecheck` exit 0; `npm run lint` 0 avisos.
- `/code-quality` PASS; `/review` READY_TO_MERGE.

## Final Phase: Integration Validation

`run_validation.py pipeline-decomposition-behavior-frozen`, depois `/code-quality`, depois `/review`. O plano não está completo até a suíte inteira passar e o benchmark reproduzir os três números.
