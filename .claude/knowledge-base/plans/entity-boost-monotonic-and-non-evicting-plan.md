---
slug: entity-boost-monotonic-and-non-evicting
milestone_id: M18
created_at: 2026-07-24
goal: Tornar o entity boost não-decrescente em numLinked e provar por benchmark que ligá-lo não elimina candidato do conjunto pós-threshold.
---

# Plan: entity-boost-monotonic-and-non-evicting (M18 — #125, #127)

- **Version:** 1.0
- **Slug:** `entity-boost-monotonic-and-non-evicting`
- **Milestone:** M18 (`ROADMAP.md`) — tracked theo-memory#125, #127
- **Prior art:** o próprio M15 (`entity-boost-recall-contribution`), released v0.44.0. Os dois defeitos foram expostos pelo `/review` do M15.

## Goal

Corrigir as duas impropriedades do sinal de entidades que o `/review` do M15 expôs, e provar cada correção por benchmark determinístico: `entityBoost` passa a ser **não-decrescente** em `numLinked` (#125), e ligar o boost **não remove** candidato do conjunto pós-threshold que o mesmo corte retornava sem ele (#127) — medido na banda sensível onde o efeito é aritmeticamente possível.

Sucesso é observável por três números do benchmark estendido:

1. `monotonic_violations` = 0 — para todo par `numLinked` crescente, o boost não decresce.
2. `recall_set_churn_sensitive` = 0 no threshold 0.8 (hoje é 75) — ligar o boost não elimina candidato.
3. `precision_at_k` com o novo boost ≥ `precision_at_k` com o boost antigo, no corpus com `numLinked` variável — a correção não custa precisão.

## Baseline Context

Estado do repositório na abertura do plano: branch `develop`, HEAD `7715024` (v0.46.0 released).

### Files that will be touched

| Arquivo | LoC | Último commit | Papel neste plano |
|---|---|---|---|
| `packages/core/src/domain/scoring.ts` | 101 | `23e97f8` | `entityBoost` (linha 45), `maxPossible` (linha 66), `combineScores` — o alvo dos dois fixes |
| `packages/core/src/domain/scoring.test.ts` | — | `23e97f8` | assevera a monotonicidade DECRESCENTE (linhas 59-63) — o teste que codifica o bug do #125; precisa ser invertido via TDD |
| `tests/integration/entity-boost/precision-benchmark.test.ts` | — | (M15) | corpus com `numLinked` fixo em 1; precisa de tópicos com `numLinked` variável para o #125 aparecer na métrica |
| `docs/benchmarks/entity-boost-m15.md` | — | (M15) | registra churn 75 no threshold 0.8; passa a registrar o antes/depois do M18 |

### Current callers / dependents

- `entityBoost(numLinked)` — **um** caller de produção: `entity-boost-step.ts:100` (`boostById.set(memoryId, entityBoost(numLinked))`). Nenhum outro.
- `maxPossible(signals)` — **um** caller: `pipeline.ts:501` (`const maxScore = maxPossible(signals)`).
- `combineScores(scores, maxPossibleValue)` — **um** caller: `pipeline.ts:205`.
- Testes que dependem de `entityBoost`: `scoring.test.ts` (unit, direto), e transitivamente os de integração `entity-boost/ranking.test.ts` e `precision-benchmark.test.ts`.

A superfície é pequena e inteiramente dentro do domínio — nenhum consumidor cross-repo (a função não é exportada no barrel público; só `ENTITY_BOOST_WEIGHT` e os tipos são).

### Domain glossary

- **numLinked** — quantas entidades DISTINTAS mencionadas na query estão ligadas a uma memória (`countMatchedEntitiesPerMemory`).
- **maxPossible / denominador** — o divisor da normalização; hoje soma `ENTITY_BOOST_WEIGHT` (0.5) quando o sinal entity liga, indo de 2.0 para 2.5.
- **renormalização** — o efeito do #127: com o denominador maior, candidato sem vínculo cai de `1.0/2.0` para `1.0/2.5`, abaixo do gate em threshold alto.
- **conjunto pós-threshold** — candidatos que sobreviveram ao gate do Step 8, antes do corte de topK; é onde o churn é medido honestamente.

### Architecture boundaries affected

`scoring.ts` é domínio puro (função matemática, sem I/O). Por `.claude/rules/architecture.md` § 1, é a camada mais interna — não importa nada. As mudanças ficam contidas nela; o `pipeline.ts` (também domínio) consome sem mudar assinatura. Nenhuma fronteira DIP é cruzada.

## Prior Art & Related Work

- **Interno (M15):** `entity-boost-recall-contribution`, released v0.44.0. O `/review` (5 agentes) produziu os dois issues deste plano: #125 (agente de domínio, ao verificar a curva) e #127 (o instrumento de churn corrigido mediu 75 exclusões).
- **Interno:** ADR-M15-D1 do plano do M15 decidiu NÃO alterar `scoring.ts`, aceitando o risco de renormalização **na condição** de que o D2 o mediria — mas rejeitou as alternativas (numerador-only, headroom) SEM o número que agora existe (churn 75). Este plano revisita essa decisão com o número na mesa.
- **Externo (M15 discover):** o blueprint do `graphiti` já registrou que a normalização deve ser sempre aplicada (sigmoid como o BM25), e que a contagem crua não é copiável. Isso embasa a forma não-decrescente-saturante.
- **(nenhuma patterns skill identificada)** — não há `*-patterns` em `skills/` que case com scoring/ranking.

## Coverage Matrix

| # | Afirmação do Goal | Task(s) | Coberto? |
|---|---|---|---|
| C1 | `entityBoost` não-decrescente em `numLinked` (#125) | T1.1, T1.2 | sim |
| C2 | O teste que assevera a curva decrescente é invertido (bug-fix TDD) | T1.1 | sim |
| C3 | Ligar o boost não elimina candidato do conjunto pós-threshold (#127) | T2.1, T2.2 | sim |
| C4 | Benchmark ganha corpus com `numLinked` variável | T3.1 | sim |
| C5 | `monotonic_violations`=0, `recall_set_churn_sensitive`=0, precisão não-regredida | T3.1 | sim |
| C6 | ADR-M15-D1 revisitado com o número na mesa | T2.1 (ADR D2 deste plano) | sim |
| C7 | O documento de benchmark registra o antes/depois | T3.2 | sim |

100% mapeado; nenhuma diferida.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (nenhuma) | | | Correção matemática pura + benchmark; sem dependência nova. `entityBoost` usa só `Math` nativo (degrau 2 da escada de parcimônia). |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | Avaliado: nenhuma. A forma não-decrescente-saturante é aritmética de `Math`; o benchmark reusa o harness do M15. | n/a |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## ADRs

### D1 — `entityBoost` passa a ser não-decrescente e saturante, não penalizado por espalhamento

**Decisão:** substituir `ENTITY_BOOST_WEIGHT * 1/(1 + 0.001·(n-1)²)` (decrescente) por uma forma **não-decrescente que satura em `ENTITY_BOOST_WEIGHT`** — casar mais entidades da query rende mais impulso, com teto.

**Rationale:** a fórmula atual veio de OUTRA semântica de `numLinked` ("quantas entidades a memória tem no total", onde penalizar genéricas faz sentido). O M15 passou a alimentá-la com a INTERSEÇÃO query↔memória, onde mais é melhor. A curva decrescente é o oposto da intenção (`scoring.ts:45`, medido em #125). A forma saturante mantém a proteção contra dominação (teto em `ENTITY_BOOST_WEIGHT`) sem inverter a monotonicidade.

**Alternativas rejeitadas:**

- **Manter a atenuação por espalhamento sobre o total de entidades da memória** e um fator crescente sobre a interseção. Rejeitada: exigiria passar DUAS quantidades para `entityBoost` (total + interseção), mudando a assinatura e o caller; complexidade que o benchmark não justifica sem evidência de que a proteção contra genéricas importa aqui.
- **Contagem linear sem teto** (`min(n·k, W)`). Rejeitada: satura abruptamente; a forma suave `W·(1 - 1/(1+n))` ou `W·n/(n+c)` cresce continuamente e o benchmark escolhe a constante.
- **Não mexer** (status quo). Rejeitada: é o defeito que o milestone existe para corrigir.

### D2 — Revisitar ADR-M15-D1: o denominador para de eliminar candidatos

**Decisão:** eliminar o efeito de renormalização do #127. A forma exata (somar entity só ao numerador com clamp; OU manter o denominador mas garantir que o gate rode antes da renormalização) é decidida por benchmark em T2.1, não a priori.

**Rationale:** o ADR-M15-D1 aceitou o efeito NA CONDIÇÃO de que seria medido. Foi medido: 75 exclusões no threshold 0.8. O número que faltava à decisão original agora existe. Um candidato sem vínculo de entidade não deveria SUMIR só porque o boost ligou para outros — ele não ficou pior, o denominador é que mudou. As alternativas que o M15-D1 rejeitou (numerador-only, headroom) são reavaliadas com o número.

**Alternativas rejeitadas:**

- **Numerador-only com clamp em 1.0** (`min((sem+bm25+boost)/2.0, 1.0)`). Candidato: não muda o denominador, então nada some. Risco: satura o topo (vários grudam em 1.0). O benchmark de T2.1 mede se a perda de discriminação é real no corpus.
- **Headroom** (`base + (1-base)·boost_normalizado`). Candidato: monótono, não satura, nada some. Risco: abandona o modelo aditivo; precisa de prova própria.
- **Manter o M15-D1 como está.** Rejeitada: contradiz o Goal; o churn 75 é a evidência que o D1 dizia que decidiria.

## Phase 1 — Monotonicidade (#125)

### T1.1 — Inverter o teste que codifica o bug e provar não-decrescência

#### Files to edit

- `packages/core/src/domain/scoring.test.ts`
- `packages/core/src/domain/scoring.ts`

#### Deep file dependency analysis

`scoring.test.ts:59-63` assevera hoje `entityBoost(10) < entityBoost(2) < entityBoost(1)` — o teste que trava a curva decrescente. É bug-fix: o teste precisa ser invertido ANTES do código (RED). O único caller de produção é `entity-boost-step.ts:100`, que só chama `entityBoost(numLinked)` e usa o retorno como componente aditivo — não depende do valor absoluto, só de que cresça com `numLinked`.

#### Why this step

**Ação:** substituir o teste de atenuação decrescente por um de não-decrescência, vê-lo falhar contra a fórmula atual (RED), então trocar a fórmula (GREEN). **Raciocínio:** é bug-fix, e `.claude/rules/testing.md` exige regressão-primeiro; o teste atual codifica o próprio defeito (#125), então invertê-lo É o RED. Cita ADR D1.

#### TDD

RED: test_entity_boost_is_non_decreasing_in_num_linked — para n de 1 a 25, expect(entityBoost(n+1)).toBeGreaterThanOrEqual(entityBoost(n)). Falha contra a fórmula decrescente atual.

RED: test_entity_boost_saturates_at_weight — expect(entityBoost(1000)).toBeLessThanOrEqual(ENTITY_BOOST_WEIGHT) e toBeGreaterThan(ENTITY_BOOST_WEIGHT * 0.9). O teto é preservado.

RED: test_more_matched_entities_never_scores_less — expect(entityBoost(3)).toBeGreaterThan(entityBoost(1)). O caso concreto do #125.

RED: test_zero_links_still_returns_zero — expect(entityBoost(0)).toBe(0). Preservado.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `npm test -- scoring` sai com exit code 0; os 4 REDs passam.
- A asserção antiga de decrescência (`entityBoost(10) < entityBoost(2)`) foi REMOVIDA, não deixada como morta.
- `entityBoost` continua pura, sem I/O.

#### DoD

- `grep -c "entityBoost(10)).toBeLessThan" packages/core/src/domain/scoring.test.ts` returns 0.
- `npm run typecheck` exit 0.

### T1.2 — Confirmar que o pipeline usa a nova curva sem mudança de assinatura

#### Files to edit

- (nenhum — verificação; `entity-boost-step.ts` já chama `entityBoost(numLinked)`)

#### Deep file dependency analysis

`entity-boost-step.ts:100` passa `numLinked` e usa o retorno. A assinatura de `entityBoost` não muda (um número → um número), então o caller não muda. Esta task é a prova disso.

#### Why this step

**Ação:** rodar a suíte de `entity-boost-step` e confirmar que nada quebrou com a nova curva. **Raciocínio:** wiring — a mudança de T1.1 tem que chegar ao caminho de produção sem regressão (`entity-boost-step.test.ts` já existe).

#### TDD

RED: test_step_boost_is_non_decreasing_end_to_end — através do wrapper do step (não só `entityBoost` isolado): dado dois candidatos, um com `numLinked=1` e outro com `numLinked=3`, o boost atribuído ao de `numLinked=3` é `>=` o do `numLinked=1`. Prova que a monotonicidade sobrevive à composição do step, não só à função pura. `expect(boostById.get(three)).toBeGreaterThanOrEqual(boostById.get(one))`.

RED: test_step_signature_unchanged — `entityBoost` continua sendo `(numLinked: number) => number`; o step chama com um único argumento. `expect(typeof entityBoost(1)).toBe('number')`.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `npm test -- entity-boost-step` exit 0.
- A assinatura de `entityBoost` é idêntica (um `number` → `number`).

#### DoD

- `check_wiring.py --symbol entityBoost` returns pillar (a) PASS (caller em `entity-boost-step.ts`).

## Phase 2 — Não-eliminação (#127)

### T2.1 — Eliminar a renormalização que remove candidatos, escolhida por benchmark

#### Files to edit

- `packages/core/src/domain/scoring.ts`
- `packages/core/src/domain/scoring.test.ts`

#### Deep file dependency analysis

`maxPossible` (`scoring.ts:66`) soma `ENTITY_BOOST_WEIGHT` quando entity liga; `combineScores` divide por ele. `pipeline.ts:501` chama `maxPossible`, `pipeline.ts:205` chama `combineScores`. A forma escolhida (numerador-only OU headroom, per ADR D2) muda uma dessas duas funções; o benchmark de T3.1 arbitra qual.

#### Why this step

**Ação:** implementar a forma que não elimina candidato, com teste unitário provando que um candidato sem vínculo mantém o mesmo score normalizado com e sem o boost ligado para OUTROS. **Raciocínio:** é o núcleo do #127; a escolha entre as duas formas (ADR D2) é decidida pelo churn medido, não a priori.

#### TDD

RED: test_unlinked_candidate_score_unchanged_when_boost_active_for_others — dado um candidato com semantic=1.0 e boost=0, seu score normalizado com o sinal entity ativo (para outros) é IGUAL ao score sem o sinal entity. Falha contra a renormalização atual (0.667 vs 1.0).

RED: test_linked_candidate_still_ranks_above — o candidato COM boost continua acima do sem (a correção do #127 não pode desfazer o ganho do M15).

RED: test_combined_score_never_exceeds_one — clamp preservado.

#### Concurrency tests

(none — single-threaded)

#### Failure scenarios

(none — no external I/O touched; é aritmética pura)

#### Acceptance criteria

- `npm test -- scoring` exit 0 com os 3 REDs.
- O candidato sem vínculo tem score idêntico com/sem o sinal entity ativo para outros.

#### DoD

- `npm run typecheck` exit 0; `npm run lint` 0 avisos.

### T2.2 — Prova de integração contra Postgres real: churn zero na banda sensível

#### Files to edit

- `tests/integration/entity-boost/ranking.test.ts`

#### Deep file dependency analysis

`ranking.test.ts` já tem o harness (embeddings idênticos, pg real). Adiciona um caso no threshold 0.8 provando que o candidato sem vínculo NÃO some com o boost ligado — o repro do #127.

#### Why this step

**Ação:** teste de integração no threshold sensível provando não-eliminação end-to-end. **Raciocínio:** o unitário de T2.1 prova a aritmética; este prova o comportamento pela pilha real, que é onde o #127 foi medido.

#### TDD

RED: test_high_threshold_does_not_evict_unlinked_candidate — com threshold 0.8, um candidato sem vínculo que o corte retornava sem boost continua no conjunto pós-threshold com boost. Falha contra a renormalização atual.

#### Concurrency tests

(none — single-threaded)

#### Failure scenarios

Ver `## Failure scenarios`.

#### Acceptance criteria

- `npm test -- entity-boost/ranking` exit 0 contra `ankane/pgvector:v0.5.1`.

#### DoD

- O teste falha se revertido o fix de T2.1 (prova que morde).

## Phase 3 — Benchmark e documento

### T3.1 — Benchmark com `numLinked` variável, medindo os três números

#### Files to edit

- `tests/integration/entity-boost/precision-benchmark.test.ts`

#### Deep file dependency analysis

O corpus atual liga cada relevante a UMA entidade (`link(relevant, ...)` uma vez, linha 143). O #125 só aparece com `numLinked` variável. Adiciona tópicos onde a relevante casa 1, 2, 3 entidades da query, e mede `monotonic_violations`, `recall_set_churn_sensitive`, e precision@k novo-vs-antigo. O corpus DEVE conter tópicos onde o relevante casa EXATAMENTE 1 entidade — o caso comum, e onde a nova curva mais diverge da antiga (0.25 vs 0.50); sem esse caso, o teste de não-regressão de precisão não exercita o risco real da nova curva (EC-2 do edge-case review).

#### Why this step

**Ação:** estender o corpus e produzir os três números do Goal. **Raciocínio:** é o gate do M18 — sem ganho medido e sem churn zerado na banda sensível, a mudança não entra (mesma disciplina do M15).

#### TDD

RED: test_no_monotonic_violations — para os tópicos com numLinked variável, o boost do que casa mais nunca é menor. expect(report.monotonicViolations).toBe(0).

RED: test_sensitive_churn_is_zero — expect(report.recallSetChurnSensitive).toBe(0) (hoje 75).

RED: test_precision_not_regressed — expect(report.precisionAtK.newBoost).toBeGreaterThanOrEqual(report.precisionAtK.oldBoost).

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `npm test -- entity-boost/precision-benchmark` exit 0; os três números persistidos no JSON.
- `boostedCandidateCount` > 0 (o boost dispara).

#### DoD

- `docs/benchmarks/entity-boost-m18.json` escrito com os três números.

### T3.2 — Documento de benchmark com o antes/depois

#### Files to edit

- `docs/benchmarks/entity-boost-m18.md` (NEW)
- `CHANGELOG.md`

#### Deep file dependency analysis

Espelha `docs/benchmarks/entity-boost-m15.md`. Registra churn 75 → 0 no threshold 0.8 e a monotonicidade corrigida, com o comando de reprodução.

#### Why this step

**Ação:** documentar o antes/depois e a decisão de forma (ADR D2 resolvido pelo benchmark). **Raciocínio:** Regra 6 (changelog) + o DoD do #127 exige o número registrado; sem documento, não há entrega.

#### TDD

RED: test_benchmark_doc_records_before_after — sentinela: `grep` do documento contains "75" (o antes) e "0" (o depois) no contexto de threshold 0.8.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `docs/benchmarks/entity-boost-m18.md` registra o antes/depois e o comando de reprodução.
- `CHANGELOG.md` sob `[Unreleased]` com `(#125)` e `(#127)`.

#### DoD

- `grep -c "(#125)\|(#127)" CHANGELOG.md` returns >= 1.

## Failure scenarios

O código de produção (`scoring.ts`) é aritmética pura — sem I/O externo. Os testes de integração (T2.2, T3.1) tocam Postgres:

| Cenário | Comportamento esperado |
|---|---|
| Postgres indisponível no teste de integração | O teste FALHA alto (não é caminho de produção; é o gate). Não há degradação a testar aqui — o `scoring.ts` não faz I/O. |

O caminho de produção do boost já tem o timeout e a degradação observável do M16 (`entity_boost_degraded`); este plano não toca isso.

## Drawbacks & Risks

| Risco | Por que é real | Mitigação / posição |
|---|---|---|
| A nova curva enfraquece o caso comum (`numLinked=1`) | `W·(1-1/(1+n))` dá 0.25 em n=1 vs 0.50 hoje; a maioria casa 1 entidade | O benchmark de T3.1 mede precision@k novo-vs-antigo; se regredir, a constante da forma é ajustada até não regredir. O Goal exige não-regressão. |
| Numerador-only satura o topo | Vários candidatos grudam em 1.0 e perdem discriminação | ADR D2 deixa a escolha para o benchmark; se saturar, a forma headroom é a alternativa medida. |
| Mexer em `scoring.ts` afeta todo recall | É o caminho mais crítico do produto | Superfície mínima (um caller cada), suíte de contrato + integração + `/review` com agente de domínio. O M15-D1 evitou justamente isso; agora há o número que justifica. |
| O corpus do benchmark pode não representar produção | `numLinked` real pode ser quase sempre 1 | Honestidade: o benchmark isola o comportamento sob `numLinked` variável; o documento registra que é medição de propriedade, não de distribuição de produção. |

## Unresolved Questions

- A escolha final entre numerador-only e headroom (ADR D2) é resolvida por benchmark em T2.1/T3.1 — deliberadamente deixada para a medição, não para o plano. Não é uma questão aberta no sentido de bloqueio: ambas as formas satisfazem o Goal; o benchmark escolhe a de maior precisão.

## Test Plan

- **Unidade:** `scoring.test.ts` — monotonicidade não-decrescente, saturação, não-eliminação (aritmética), em milissegundos.
- **Integração:** `ranking.test.ts` (churn zero na banda sensível) e `precision-benchmark.test.ts` (os três números) contra `ankane/pgvector:v0.5.1` real.
- **Regressão-primeiro:** T1.1 inverte o teste que codifica o bug do #125 antes de trocar a fórmula.

## Critical paths

- `packages/core/src/domain/scoring.ts`
- `tests/integration/entity-boost/precision-benchmark.test.ts`

## Prior Art & Related Work

(consolidado acima em `## Prior Art & Related Work`)

## Global Definition of Done

- Todas as tasks com status `committed`.
- `npm run typecheck` exit 0; `npm run lint` 0 avisos.
- Suíte de contrato + integração verdes contra Postgres real.
- Os três números do benchmark: `monotonic_violations`=0, `recall_set_churn_sensitive`=0, precisão não-regredida.
- `CHANGELOG.md` sob `[Unreleased]` com `(#125)` e `(#127)`.
- `/code-quality` PASS ou PASS_WITH_CAVEATS.
- `/review` READY_TO_MERGE.

## Final Phase: Integration Validation

Rodar `run_validation.py entity-boost-monotonic-and-non-evicting`, depois `/code-quality`, depois `/review`. O plano não está completo até a suíte inteira passar contra Postgres real e os três números do benchmark saírem nos alvos.
