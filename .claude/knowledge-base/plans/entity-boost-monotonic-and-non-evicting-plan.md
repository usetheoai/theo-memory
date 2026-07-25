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

**Decisão:** substituir `ENTITY_BOOST_WEIGHT * 1/(1 + 0.001·(n-1)²)` (decrescente) pela forma **`ENTITY_BOOST_WEIGHT * n/(n+c)`** — não-decrescente, satura em `ENTITY_BOOST_WEIGHT`, com `c` uma constante de módulo. `n=0 → 0` (preserva o zero exato, pois o numerador é `n`); monótona para qualquer `c>0`; `n=1 → W/(1+c)`. `c=0.25` é escolhido pelo critério de **magnitude do caso comum `n=1`** (→ 0.40, o mais próximo do pico legado 0.50 mantendo monotonicidade). Nota de honestidade (reconciliada no `/review`, F-tests-1): a precisão do benchmark é **c-invariante** neste corpus — qualquer `c>0` produz boost positivo, promove o relevante acima dos distractors empatados e dá precision 1.0, então uma varredura por precisão não discrimina `c`. O benchmark portanto **confirma não-regressão** em `c=0.25` (precision 1.0), não elege `c` por precisão; a magnitude é o critério real.

**Rationale:** a fórmula atual veio de OUTRA semântica de `numLinked` ("quantas entidades a memória tem no total", onde penalizar genéricas faz sentido). O M15 passou a alimentá-la com a INTERSEÇÃO query↔memória, onde mais é melhor. A curva decrescente é o oposto da intenção (`scoring.ts:45`, medido em #125). `W·n/(n+c)` mantém a proteção contra dominação (teto em `ENTITY_BOOST_WEIGHT`) sem inverter a monotonicidade, e o parâmetro `c` deixa o benchmark arbitrar a magnitude do caso comum em vez de fixá-la a priori (SEPA initial brief, 2026-07-24).

**Alternativas rejeitadas:**

- **Manter a atenuação por espalhamento sobre o total de entidades da memória** e um fator crescente sobre a interseção. Rejeitada: exigiria passar DUAS quantidades para `entityBoost` (total + interseção), mudando a assinatura e o caller; complexidade que o benchmark não justifica sem evidência de que a proteção contra genéricas importa aqui.
- **Contagem linear sem teto** (`min(n·k, W)`). Rejeitada: satura abruptamente; a forma suave `W·(1 - 1/(1+n))` ou `W·n/(n+c)` cresce continuamente e o benchmark escolhe a constante.
- **Não mexer** (status quo). Rejeitada: é o defeito que o milestone existe para corrigir.

### D2 — Revisitar ADR-M15-D1: o denominador para de eliminar candidatos

**Decisão:** eliminar o efeito de renormalização do #127 via **numerador-only**: `maxPossible` deixa de somar `ENTITY_BOOST_WEIGHT` (remove o bloco entity, `scoring.ts:73-75`); `combineScores` fica INALTERADO (já soma `entityBoostScore` ao numerador e faz clamp em 1.0, `scoring.ts:99-100`). Assim o denominador não infla, e um candidato sem vínculo tem score idêntico com/sem o sinal entity ativo para outros. Confirmado contra o código real (SEPA initial brief): `maxPossible` é chamado uma única vez (`pipeline.ts:501`) e o mesmo `maxScore` alimenta os dois passes de filtro (inicial `:511`, adaptive-relax `:325`) consistentemente — não há denominador separado a corrigir.

**PRECONDIÇÃO CRÍTICA (SEPA initial brief):** o corpus de teste (T2.1 unit + T3.1 benchmark) NÃO pode ter semantic saturado em 1.0. No corpus M15 todos os candidatos têm cosine=1.0; sob numerador-only o distractor sem vínculo E o relevante com vínculo AMBOS batem no clamp 1.0 → empate → discriminação perdida (a discriminação do M15 era comprada pela própria renormalização que o #127 remove). O relevante DEVE ter headroom semântico abaixo de 1.0 (distractors ~0.85, relevante ~0.85 mas linkado) para o boost discriminar: distractor 0.85, relevante `min(0.85+0.25, 1.0)` = 1.0. Sem headroom, T3.1 fica VACUAMENTE verde (churn=0 e new≥old triviais no empate). Isso subsume EC-2.

**Rationale:** o ADR-M15-D1 aceitou o efeito NA CONDIÇÃO de que seria medido. Foi medido: 75 exclusões no threshold 0.8. Um candidato sem vínculo de entidade não deveria SUMIR só porque o boost ligou para outros — ele não ficou pior, o denominador é que mudou.

**Alternativa headroom rejeitada:** `base + (1-base)·boost_normalizado` reescreve `combineScores` (precisa de `W`/boost normalizado passado), é mais invasiva, e FALHA identicamente no corpus saturado (base=1.0 → 0 headroom). Numerador-only é a escolha parcimoniosa e a mudança de superfície mínima (uma função).

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

RED: test_entity_boost_saturates_at_weight — expect(entityBoost(10000)).toBeLessThanOrEqual(ENTITY_BOOST_WEIGHT) e toBeGreaterThan(ENTITY_BOOST_WEIGHT * 0.9). O teto de `W·n/(n+c)` é preservado (n grande → W).

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

- `packages/core/src/domain/retrieval/entity-boost-step.test.ts`

(NEW — unit test co-locado provando a monotonicidade end-to-end através do step. Nenhuma mudança de produção: `entity-boost-step.ts` já chama `entityBoost(numLinked)` com um argumento.)

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

`maxPossible` (`scoring.ts:66`) soma `ENTITY_BOOST_WEIGHT` quando entity liga; `combineScores` divide por ele. Numerador-only (ADR D2): remover o bloco entity de `maxPossible` (`scoring.ts:73-75`); `combineScores` fica inalterado. Isso também invalida os testes unitários de `maxPossible` (`scoring.test.ts:74-80`, "semantic+entity→1.5", "all three→2.5") e o JSDoc (`scoring.ts:62`, set {0,1.0,1.5,2.0,2.5}) — ambos DEVEM ser atualizados nesta task, não deixados mortos.

#### Why this step

**Ação:** implementar o numerador-only, com teste unitário provando que um candidato sem vínculo mantém o mesmo score normalizado com e sem o boost ligado para OUTROS, usando fixture com headroom semântico (semantic < 1.0). **Raciocínio:** é o núcleo do #127; a precondição de headroom (SEPA CRITICAL) evita que o teste fique vacuamente verde no clamp.

#### TDD

RED: test_unlinked_candidate_score_unchanged_when_boost_active_for_others — candidato com semantic=0.85 e boost=0. Seu score com o denominador numerador-only (maxPossible = semantic+bm25, SEM entity) é IGUAL com e sem o sinal entity ativo para OUTROS. Falha contra a renormalização atual (0.85/1.0=0.85 vs 0.85/1.5=0.567).

RED: test_linked_candidate_ranks_above_unlinked_with_headroom — dois candidatos com semantic=0.85; o linkado (boost 0.25) fica ACIMA do não-linkado. `min(0.85+0.25,1.0)=1.0 > 0.85`. Prova que numerador-only discrimina COM headroom (não empata no clamp).

RED: test_maxPossible_excludes_entity_term — `maxPossible({semantic:true, bm25:true, entity:true})` retorna 2.0 (não 2.5); `maxPossible({semantic:true, entity:true})` retorna 1.0 (não 1.5). Substitui os testes antigos que assertavam 2.5/1.5.

RED: test_combined_score_never_exceeds_one — clamp preservado (semantic=1.0+bm25=1.0+boost, /2.0, clampa em 1.0).

#### Concurrency tests

(none — single-threaded)

#### Failure scenarios

(none — no external I/O touched; é aritmética pura)

#### Acceptance criteria

- `npm test -- scoring` exit 0 com os 4 REDs.
- O candidato sem vínculo tem score idêntico com/sem o sinal entity ativo para outros (fixture com headroom, semantic < 1.0).
- Os testes antigos de `maxPossible` (2.5/1.5) foram SUBSTITUÍDOS por 2.0/1.0, não deixados mortos; o JSDoc foi atualizado.

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
- `docs/benchmarks/entity-boost-m18.json`

(o `.json` é escrito pelo próprio benchmark ao rodar — os três números medidos.)

#### Deep file dependency analysis

O corpus atual liga cada relevante a UMA entidade (`link(relevant, ...)` uma vez, linha 143) E fixa todos os candidatos em cosine=1.0 (distractors compartilham o vetor hot-dim do relevante). O #125 só aparece com `numLinked` variável; e o #127 só é TESTÁVEL com headroom semântico. Mudanças:

1. **Headroom semântico (PRECONDIÇÃO CRÍTICA, SEPA):** os candidatos NÃO podem ter cosine=1.0. Sob numerador-only, distractor sem vínculo e relevante com vínculo ambos batem no clamp 1.0 → empate → o benchmark fica vacuamente verde. Dar ao relevante headroom (~0.85) para o boost discriminar: distractor 0.85, relevante `min(0.85+boost, 1.0)`. Sem isso o benchmark não mede nada.
2. **numLinked variável:** tópicos onde a relevante casa 1, 2, 3 entidades da query — incluindo o caso comum `numLinked=1` (subsume EC-2).
3. **Escolha de `c`:** `c=0.25` fixo, pelo critério de magnitude `n=1` (0.40). A precisão é c-invariante neste corpus (qualquer `c>0` → precision 1.0), então o benchmark confirma não-regressão em 0.25, não elege `c` por precisão (F-tests-1 reconciliado no `/review`).

Mede `monotonic_violations`, `recall_set_churn_sensitive` (threshold 0.8), e precision@k novo-vs-antigo.

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

- `docs/benchmarks/entity-boost-m18.md`
- `tests/unit/docs/entity-boost-m18-doc.test.ts`
- `CHANGELOG.md`

(o `.md` é NOVO; o teste sentinela NOVO trava o antes/depois no doc.)

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
| A nova curva enfraquece o caso comum (`numLinked=1`) | `W·n/(n+c)` dá `W/(1+c)` em n=1 (c=1→0.25, c=0.25→0.40) vs 0.50 hoje; a maioria casa 1 entidade | `c=0.25` escolhido pela magnitude n=1 (0.40, mais próximo de 0.50). O benchmark de T3.1 confirma precision não-regredida (1.0) em 0.25; precision é c-invariante aqui, então a magnitude é o critério. O Goal exige não-regressão — atingido. |
| **Corpus saturado torna o fix intestável (SEPA CRITICAL)** | No corpus M15 todo cosine=1.0; sob numerador-only distractor e relevante empatam no clamp 1.0 → benchmark vacuamente verde | PRECONDIÇÃO absorvida em T2.1/T3.1: fixture e corpus DEVEM ter headroom semântico (~0.85), não 1.0. Sem isso o boost é inerte e o teste não mede nada. |
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
