# Discovery Plan — entity-boost-recall-contribution

- **Version:** 1.1 (MUST FIX EC-1/EC-2 do `/discover-edge-cases` absorvidos 2026-07-24)
- **Slug:** `entity-boost-recall-contribution`
- **Owner:** implementador
- **Created:** 2026-07-24
- **Milestone:** M15 (ROADMAP.md) — tracked theo-memory#122

## Context

O componente `entity` do nosso `combineScores` é **sempre `0`**: `packages/core/src/domain/retrieval/pipeline.ts:451` cria `entityBoostById` vazio e nunca o popula — o próprio comentário diz *"v0.1 ships without entity store integration; numLinked=0 always"*. A constante `ENTITY_BOOST_WEIGHT = 0.5` (`domain/scoring.ts`), a flag `entityBoost` (ADR-0007, default `true`) e a coluna `entity` do recall-trace existem e estão ociosas.

Desde então o grafo passou a ser populado de verdade (M13 — extração LLM-primary com types semânticos + `entity-noise-filter.ts` aplicado em `entity-linking.ts:104`). Ou seja: o sinal existe no banco e continua desconectado do ranking.

A análise comparativa com o `mem0` (2026-07-24) mostrou que este é o único sinal estrutural em que teríamos vantagem sobre o recall deles — o OSS deles é vetorial + filtros, e o reranker é feature paga da plataforma. Antes de ligar o cabo, precisamos saber **como a arte do estado faz isso sem estragar o ranking**.

## Objective

Produzir um blueprint que responda **como injetar um sinal estrutural de grafo no ranking de recall** — mecanismo de combinação, normalização, salvaguardas contra amplificação de ruído e ressuscitação de candidato sub-threshold, e **como medir o ganho** — com evidência citada do `graphiti`.

**Critério de sucesso mensurável:** o blueprint permite escrever o plano do M15 sem nenhuma decisão de design em aberto sobre (a) onde o sinal entra no pipeline, (b) como é normalizado, (c) que guarda impede regressão de qualidade, (d) que métrica prova o ganho.

## In-scope / Out-of-scope

### `knowledge-base/references/graphiti/` (referência primária)

- **In scope:** `graphiti_core/search/` (`search_utils.py`, `search_config.py`, `search_config_recipes.py`, `search.py`), `tests/utils/search/`, `tests/evals/`, `pyproject.toml`.
- **Out of scope:** `graphiti_core/driver/` (adaptadores de banco — nosso store é outro), `graphiti_core/prompts/` exceto `eval.py`, `graphiti_core/llm_client/`, `graphiti_core/embedder/`, `mcp_server/`, `server/`, `examples/`.

### `knowledge-base/references/mem0/`

- **Out of scope INTEIRO para este discovery.** Justificativa em ADR-D2: o clone não tem módulo de grafo (`find mem0 -name "*graph*" -name "*.py"` retorna vazio) e a análise de 2026-07-24 já estabeleceu que o recall OSS deles é vetorial + filtros, sem sinal estrutural. Não há o que aprender aqui para esta pergunta.

## ADRs

### ADR-D1 — Referência única (graphiti), não comparativo

**Decisão:** investigar só o `graphiti`.
**Rationale:** ele é a única referência clonada que implementa rerank estrutural de grafo (`node_distance_reranker`, `episode_mentions_reranker`). **Alternativa rejeitada:** comparativo graphiti vs mem0 — o mem0 não tem o mecanismo (evidência acima), então o "comparativo" seria uma coluna vazia, inflando o esforço sem sinal.

### ADR-D2 — mem0 fora de escopo

**Decisão:** zero perguntas sobre mem0.
**Rationale:** ausência verificada do módulo de grafo no clone. **Alternativa rejeitada:** olhar a doc da plataforma deles — o reranker é caixa-preta paga, sem fonte para citar; blueprint com citação não-verificável viola o hard cap.

### ADR-D3 — Orçamento de tempo: 3h no graphiti

**Decisão:** 3h, com parada por pergunta.
**Rationale:** o alvo é um mecanismo bem localizado (3 funções em `search_utils.py` + os recipes + os testes). **Alternativa rejeitada:** 6h com leitura do `search.py` inteiro — o orquestrador não muda a resposta sobre normalização/combinação.

## Research questions

| # | Corner | Pergunta | Método | Forma da resposta esperada |
|---|---|---|---|---|
| Q1 | Techniques | Como o `node_distance_reranker` transforma distância no grafo em score, e como esse score se combina com o do retriever (substitui, multiplica, soma)? **E existe corte/limiar de score aplicado ANTES ou DEPOIS do rerank — um candidato fora do corte pode voltar por efeito do rerank?** (EC-1) | `Read graphiti/graphiti_core/search/search_utils.py` (âncora: linha 1798; localizar por `Grep 'def node_distance_reranker'`) | Pseudocódigo da fórmula + onde o resultado entra na lista final + posição do corte relativa ao rerank |
| Q2 | Techniques | O `episode_mentions_reranker` (contagem de menções — análogo do nosso `numLinked`) normaliza a contagem antes de ranquear? Como evita que um nó muito citado domine? | `Read search_utils.py` (a partir da 1860) | Fórmula de normalização + qualquer cap/saturação |
| Q3 | Techniques | O `rrf` (Reciprocal Rank Fusion) é a via canônica deles para fundir sinais? Um candidato que aparece em UM só sinal consegue subir acima de um que aparece em dois? | `Read search_utils.py` (a partir da 1780) + `Grep 'rrf(' graphiti/graphiti_core/search/` | Fórmula do RRF + resposta sim/não com evidência |
| Q4 | Techniques | Os `search_config_recipes` expõem presets que LIGAM/DESLIGAM o rerank estrutural? Qual é o default? | `Read graphiti/graphiti_core/search/search_config_recipes.py` + `Read search_config.py` | Lista de recipes com o reranker de cada + qual é o default |
| Q5 | Integration tests | Como eles testam que um reranker MELHORA a ordem (e não só que roda)? Existe asserção sobre posição relativa? **Fallback (EC-2): se não houver asserção de ordem relativa, a resposta é "não testam qualidade de ranking" + transcrever o que de fato asseveram.** | `Read graphiti/tests/utils/search/search_utils_test.py` | Padrão de teste (fixture + asserção) transcrito, OU a constatação da ausência com evidência |
| Q6 | Tools | Que harness eles usam para medir qualidade de retrieval de ponta a ponta, e com que métrica? | `Read graphiti/tests/evals/eval_cli.py` + `ls graphiti/tests/evals/data/longmemeval_data` | Nome do harness, dataset, métrica reportada |
| Q7 | Dependencies | O caminho de rerank estrutural puxa alguma dependência além do driver de grafo (ex.: numpy/scipy para scoring)? | `Read graphiti/pyproject.toml` + `Grep '^import\|^from' graphiti/graphiti_core/search/search_utils.py` | Lista de deps do caminho de scoring, com versão |

**Orçamento:** 7 perguntas, ≤3 por corner (Techniques 4 → ver nota), min 1 por corner.

> Nota de orçamento: Techniques tem 4 perguntas, acima do teto de 3. Justificativa: Q1/Q2/Q3 são três MECANISMOS distintos (distância, menções, fusão) e Q4 é a política de ativação — dobrar duas delas numa só produziria resposta ambígua justamente no ponto que decide o design. Registrado conscientemente como desvio do teto, não como descuido.

## Coverage Matrix

| Corner | Perguntas | Coberto? |
|---|---|---|
| Techniques | Q1, Q2, Q3, Q4 | sim |
| Integration tests | Q5 | sim |
| Tools | Q6 | sim |
| Dependencies | Q7 | sim |

100% dos corners cobertos; nenhum deferido.

## Halt-loop checkpoints

Antes de marcar uma pergunta como `done`, a iteração DEVE ter:

1. Citação com `knowledge-base/references/graphiti/{path}:{linha}` que resolve no disco.
2. Resposta na forma declarada na coluna "forma esperada" (fórmula = fórmula, não prosa).
3. Nenhuma conclusão de design nossa misturada à resposta — o blueprint descreve o que ELES fazem; a decisão nossa vai para o `/to-plan`.
4. (EC-3) Localizar por SÍMBOLO (`Grep 'def <nome>'`) antes de ler por offset — as linhas citadas são âncora de partida, não endereço fixo.
5. (EC-4) A leitura de `search.py` fica limitada a localizar os SITES DE INVOCAÇÃO dos rerankers; qualquer leitura além disso encerra a pergunta (orçamento do ADR-D3 é para o mecanismo, não para o fluxo inteiro).
6. (EC-5) O harness de eval é LIDO, nunca executado — `knowledge-base/references/` é read-only e rodar exigiria chave de LLM.

## Acceptance Criteria

- As 7 perguntas com status `done` ou `blocked` com motivo.
- Toda citação resolve (`Path.exists`) — hard cap de citação fabricada.
- Os quatro corners com conteúdo não-placeholder.
- ≥1 ADR no blueprint sintetizando o que se aplica ao nosso pipeline aditivo (e o que NÃO se aplica — eles rerankeiam listas, nós somamos componentes; a diferença precisa estar explícita).

## Global Definition of Done

- `/discover-edge-cases` executado e MUST-FIX absorvidos.
- `/discover-plan-confidence` ≥ SHIPPABLE_WITH_CAVEATS.
- `/discover-execute` emitindo `BLUEPRINT_COMPLETE`.
- `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS, per `rules/discover-blueprint-golden-rule.md`.

## Rules citadas

- `rules/architecture.md` — qualquer padrão trazido respeita a direção de dependência: o scoring vive no domínio, o acesso ao grafo entra por porta DIP (o `MemoryEntityStore` já existe), nunca o domínio importando o adaptador pg.
- `rules/testing.md` — o teste que provar o ganho do boost é de comportamento (ordem relativa), não de estrutura; e precisa de caso negativo (o boost NÃO ressuscita sub-threshold), conforme § 4.1.
