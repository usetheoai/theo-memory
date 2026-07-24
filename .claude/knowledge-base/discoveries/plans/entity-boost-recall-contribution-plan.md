# Discovery Plan: entity-boost-recall-contribution

- **Version:** 1.3 (v1.1 EC-1/EC-2; v1.2 template canônico; v1.3 Q4→tools + densidade de citação)
- **Slug:** `entity-boost-recall-contribution`
- **Owner:** implementador
- **Created:** 2026-07-24
- **Milestone:** M15 (ROADMAP.md) — tracked theo-memory#122

## Context

O componente `entity` do nosso `combineScores` é **sempre `0`**: `packages/core/src/domain/retrieval/pipeline.ts:451` cria `entityBoostById` vazio e nunca o popula — o próprio comentário diz *"v0.1 ships without entity store integration; numLinked=0 always"*. A constante `ENTITY_BOOST_WEIGHT = 0.5` (`domain/scoring.ts`), a flag `entityBoost` (ADR-0007, default `true`) e a coluna `entity` do recall-trace existem e estão ociosas.

Desde então o grafo passou a ser populado de verdade (M13 — extração LLM-primary com types semânticos + `entity-noise-filter.ts` aplicado em `entity-linking.ts:104`). O sinal existe no banco e continua desconectado do ranking.

O `graphiti` implementa exatamente o mecanismo que nos falta — `.claude/knowledge-base/references/graphiti/graphiti_core/search/search_utils.py` traz `rrf` (~1780), `node_distance_reranker` (~1798) e `episode_mentions_reranker` (~1860), com presets em `.claude/knowledge-base/references/graphiti/graphiti_core/search/search_config_recipes.py`, testes em `.claude/knowledge-base/references/graphiti/tests/utils/search/search_utils_test.py` e harness de avaliação em `.claude/knowledge-base/references/graphiti/tests/evals/eval_cli.py`.

A análise comparativa com o `mem0` (2026-07-24) mostrou que este é o único sinal estrutural em que teríamos vantagem sobre o recall deles — o OSS deles é vetorial + filtros, e o reranker é feature paga da plataforma. Antes de ligar o cabo, precisamos saber como a arte do estado faz isso sem estragar o ranking.

## Objective

Produzir um blueprint que responda **como injetar um sinal estrutural de grafo no ranking de recall** — mecanismo de combinação, normalização, salvaguardas contra amplificação de ruído e ressuscitação de candidato sub-threshold, e como medir o ganho — com evidência citada do `graphiti`.

**Critério de sucesso mensurável:** o blueprint permite escrever o plano do M15 sem nenhuma decisão de design em aberto sobre (a) onde o sinal entra no pipeline, (b) como é normalizado, (c) que guarda impede regressão de qualidade, (d) que métrica prova o ganho.

## In-Scope

### `.claude/knowledge-base/references/graphiti/` (referência primária)

- **In scope:** `graphiti_core/search/` (`search_utils.py`, `search_config.py`, `search_config_recipes.py`, `search.py`), `tests/utils/search/`, `tests/evals/`, `pyproject.toml`.
- **Out of scope:** `graphiti_core/driver/` (adaptadores de banco — nosso store é outro), `graphiti_core/prompts/` exceto `eval.py`, `graphiti_core/llm_client/`, `graphiti_core/embedder/`, `mcp_server/`, `server/`, `examples/`.

### `.claude/knowledge-base/references/mem0/`

- **Out of scope INTEIRO.** Justificativa em D2: o clone não tem módulo de grafo (`find mem0 -name "*graph*" -name "*.py"` retorna vazio) e a análise de 2026-07-24 já estabeleceu que o recall OSS deles é vetorial + filtros, sem sinal estrutural.

## ADRs

### D1 — Referência única (graphiti), não comparativo

**Decisão:** investigar só o `graphiti`.
**Rationale:** é a única referência clonada que implementa rerank estrutural de grafo (`node_distance_reranker`, `episode_mentions_reranker`). **Alternativa rejeitada:** comparativo graphiti vs mem0 — o mem0 não tem o mecanismo (evidência acima), então o comparativo seria uma coluna vazia, inflando esforço sem sinal.

### D2 — mem0 fora de escopo

**Decisão:** zero perguntas sobre mem0.
**Rationale:** ausência verificada do módulo de grafo no clone. **Alternativa rejeitada:** ler a doc da plataforma deles — o reranker é caixa-preta paga, sem fonte para citar; citação não-verificável viola o hard cap de citação fabricada.

### D3 — Orçamento de tempo: 3h no graphiti

**Decisão:** 3h, com parada por pergunta.
**Rationale:** o alvo é um mecanismo localizado (3 funções em `search_utils.py` + os recipes + os testes). **Alternativa rejeitada:** 6h lendo `search.py` inteiro — o orquestrador não muda a resposta sobre normalização/combinação.

## Research Questions

Cada pergunta declara as duas fases: **Fase A** (localizar por símbolo — barato, produz o mapa de hotspots) e **Fase B** (ler em profundidade cada hotspot, capturando intenção + comentários + edge-cases, com citação linha-exata).

| # | Question | Corner | Reference project(s) | Fase A (broad — localizar) | Fase B (deep — Read no hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Como o `node_distance_reranker` transforma distância no grafo em score, e como esse score se combina com o do retriever (substitui, multiplica, soma)? E existe corte/limiar aplicado ANTES ou DEPOIS do rerank — um candidato fora do corte pode voltar por efeito do rerank? (EC-1) | techniques | `.claude/knowledge-base/references/graphiti/` | `Grep 'def node_distance_reranker' graphiti/graphiti_core/search/search_utils.py` (âncora ~1798) + `Grep 'node_distance_reranker(' graphiti/graphiti_core/search/` para achar os sites de invocação | Read a função inteira + o site de invocação em `search.py`, capturando a ordem relativa a qualquer corte/limite | Pseudocódigo da fórmula + onde o resultado entra na lista final + posição do corte relativa ao rerank, com citação `path:line` |
| Q2 | O `episode_mentions_reranker` (contagem de menções — análogo do nosso `numLinked`) normaliza a contagem antes de ranquear? Como evita que um nó muito citado domine? | techniques | `.claude/knowledge-base/references/graphiti/` | `Grep 'def episode_mentions_reranker' graphiti/graphiti_core/search/search_utils.py` (âncora ~1860) | Read a função inteira, capturando qualquer normalização, cap ou saturação | Fórmula de normalização + qualquer cap/saturação, com citação `path:line` |
| Q3 | O `rrf` (Reciprocal Rank Fusion) é a via canônica deles para fundir sinais? Um candidato presente em UM só sinal consegue superar um presente em dois? | techniques | `.claude/knowledge-base/references/graphiti/` | `Grep 'def rrf' graphiti/graphiti_core/search/search_utils.py` (âncora ~1780) + `Grep 'rrf(' graphiti/graphiti_core/search/` | Read a função + 1 site de invocação; derivar o comportamento do denominador de rank | Fórmula do RRF + resposta sim/não fundamentada, com citação `path:line` |
| Q4 | Os `search_config_recipes` expõem presets que LIGAM/DESLIGAM o rerank estrutural? Qual é o default que vem pronto para uso? | tools | `.claude/knowledge-base/references/graphiti/` | `Grep 'reranker' graphiti/graphiti_core/search/search_config_recipes.py` + `Grep 'class .*Config' graphiti/graphiti_core/search/search_config.py` | Read os recipes que mencionam reranker + a definição do enum/campo de reranker no config | Lista de recipes → reranker de cada + qual é o default, com citação `path:line` |
| Q5 | Como eles testam que um reranker MELHORA a ordem (e não só que roda)? Existe asserção sobre posição relativa? Fallback (EC-2): se não houver asserção de ordem, a resposta é "não testam qualidade de ranking" + transcrever o que de fato asseveram | tests | `.claude/knowledge-base/references/graphiti/` | `Grep 'rerank' graphiti/tests/utils/search/search_utils_test.py` para listar os testes relevantes | Read cada teste encontrado: fixture, entrada, asserção | Padrão de teste (fixture + asserção) transcrito, OU a constatação da ausência com evidência `path:line` |
| Q6 | Que harness eles usam para medir qualidade de retrieval de ponta a ponta, e com que métrica? | tools | `.claude/knowledge-base/references/graphiti/` | `ls graphiti/tests/evals/` + `Grep 'def main\|metric\|score' graphiti/tests/evals/eval_cli.py` | Read `eval_cli.py` (apenas LIDO, jamais executado — EC-5) + listar `tests/evals/data/longmemeval_data` | Nome do harness + dataset + métrica reportada, com citação `path:line` |
| Q7 | O caminho de rerank estrutural puxa dependência além do driver de grafo (ex.: numpy/scipy para scoring)? | deps | `.claude/knowledge-base/references/graphiti/` | `Grep '^import\|^from' graphiti/graphiti_core/search/search_utils.py` | Read a seção de dependências de `graphiti/pyproject.toml` cruzando com os imports achados | Lista de deps do caminho de scoring com versão, com citação `path:line` |

**Orçamento:** 7 perguntas (teto 15), 4 corners cobertos, min 1 por corner.

> Nota: `techniques` fica com os três MECANISMOS (distância, menções, fusão). Q4 é a política de ativação/default — pergunta de configuração operacional ("o que vem ligado pronto para uso"), por isso mapeia para `tools`, não para o mecanismo em si.

## Coverage Matrix

| Corner | Perguntas | Coberto? |
|---|---|---|
| techniques | Q1, Q2, Q3 | sim |
| tests | Q5 | sim |
| tools | Q4, Q6 | sim |
| deps | Q7 | sim |

100% dos corners cobertos; nenhum deferido.

## Halt-loop Checkpoints

Antes de marcar uma pergunta como `done`, a iteração DEVE ter:

1. Citação `.claude/knowledge-base/references/graphiti/{path}:{linha}` que resolve no disco.
2. Resposta na forma declarada na coluna "Expected answer shape" (fórmula = fórmula, não prosa).
3. Nenhuma conclusão de design nossa misturada — o blueprint descreve o que ELES fazem; a decisão nossa vai para o `/to-plan`.
4. (EC-3) Localizar por SÍMBOLO na Fase A antes de ler por offset — as linhas citadas são âncora, não endereço fixo.
5. (EC-4) A leitura de `search.py` limita-se aos SITES DE INVOCAÇÃO dos rerankers; leitura além disso encerra a pergunta (orçamento do D3 é para o mecanismo, não para o fluxo inteiro).
6. (EC-5) O harness de eval é LIDO, nunca executado — `references/` é read-only e rodar exigiria chave de LLM.

## Acceptance Criteria

- As 7 perguntas com status `done` ou `blocked` com motivo.
- Toda citação resolve (`Path.exists`) — hard cap de citação fabricada.
- Os quatro corners com conteúdo não-placeholder.
- ≥1 ADR no blueprint sintetizando o que se aplica ao nosso pipeline **aditivo** e o que NÃO se aplica — eles reordenam listas, nós somamos componentes antes do top-K; essa diferença precisa estar explícita (EC-6).

## Global Definition of Done

- `/discover-edge-cases` executado e MUST-FIX absorvidos (feito — v1.1).
- `/discover-plan-confidence` ≥ SHIPPABLE_WITH_CAVEATS.
- `/discover-execute` emitindo `BLUEPRINT_COMPLETE`.
- `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS, per `rules/discover-blueprint-golden-rule.md`.

## Rules citadas

- `rules/architecture.md` — qualquer padrão trazido respeita a direção de dependência: o scoring vive no domínio, o acesso ao grafo entra por porta DIP (o `MemoryEntityStore` já existe), nunca o domínio importando o adaptador pg.
- `rules/testing.md` — o teste que provar o ganho do boost é de comportamento (ordem relativa), não de estrutura; e precisa de caso negativo (o boost NÃO ressuscita sub-threshold), conforme § 4.1.
