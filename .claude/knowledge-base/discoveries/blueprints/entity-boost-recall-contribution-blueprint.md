# Blueprint: entity-boost-recall-contribution

- **Version:** 1.0
- **Slug:** `entity-boost-recall-contribution`
- **Plan:** `.claude/knowledge-base/discoveries/plans/entity-boost-recall-contribution-plan.md` (v1.3, SHIPPABLE_WITH_CAVEATS 89)
- **Date:** 2026-07-24
- **Milestone:** M15 — tracked theo-memory#122
- **Reference investigated:** `.claude/knowledge-base/references/graphiti/`

## Context

Nosso componente `entity` do `combineScores` é sempre `0` (`packages/core/src/domain/retrieval/pipeline.ts:451` — `entityBoostById` criado vazio e nunca populado). O grafo existe e está populado (M13); o sinal está desconectado do ranking. Este blueprint levanta como o `graphiti` — a única referência clonada com rerank estrutural de grafo — injeta sinal de grafo no ranking, para embasar a decisão do M15 sem design em aberto.

## Objective

Responder, com evidência citada, **como um sinal estrutural de grafo entra no ranking**: mecanismo de combinação, normalização, posição do corte de score, e como se mede o ganho. O blueprint descreve o que ELES fazem; a decisão nossa fica para o `/to-plan`.

## Coverage Corner 1 — Integration Tests

**Q5 — Como testam que um reranker MELHORA a ordem?**

**Resposta: não testam.** Os testes de search asseveram cardinalidade e pertinência de conjunto, nunca ordem relativa produzida por um reranker.

Evidência em `.claude/knowledge-base/references/graphiti/tests/utils/search/search_utils_test.py`:

```python
assert len(results) == 3                                        # :36
assert set(node.uuid for node in results) == {'1', '2', '3'}    # :37
assert set(node.name for node in results) == {'Alice','Bob','Charlie'}  # :38
assert mock_fulltext_search.call_count == 2                     # :41
```

O único assert posicional (`results[0].name == 'Alice'`, `:81`) está num caso de **resultado único** — não prova ordenação, só que o item veio.

**Consequência para nós:** não há padrão de referência para copiar sobre "provar que o boost melhora". O teste que o M15 exige (ordem relativa + caso negativo de não-ressuscitação) é desenho nosso, sem precedente aqui. Aplicado o fallback EC-2 do plano.

## Coverage Corner 2 — Dependencies

**Q7 — O caminho de rerank estrutural puxa dependência extra?**

**Resposta: não, exceto `numpy` — e apenas para MMR.**

Imports de `.claude/knowledge-base/references/graphiti/graphiti_core/search/search_utils.py:17-26`:

```python
import logging
from collections import defaultdict     # :18  (usado por rrf)
from time import time                   # :19
from typing import Any
import numpy as np                      # :22  (usado por maximal_marginal_relevance)
from numpy._typing import NDArray       # :23
```

`rrf`, `node_distance_reranker` e `episode_mentions_reranker` são **Python puro + consultas ao grafo** — zero dependência numérica. Só o MMR usa `numpy`.

**Consequência para nós:** ligar o entity boost **não exige nova dependência** (parsimony rung 4 — nada a adicionar). Nosso MMR já existe e já resolve o que o numpy deles resolve.

## Coverage Corner 3 — Tools

**Q4 — Presets ligam/desligam o rerank estrutural? Qual o default?**

Cinco rerankers por tipo de entidade, em enums (`.claude/knowledge-base/references/graphiti/graphiti_core/search/search_config.py:53-75`):

```python
class EdgeReranker(Enum):        # :53
    rrf = 'reciprocal_rank_fusion'
    node_distance = 'node_distance'
    episode_mentions = 'episode_mentions'
    mmr = 'mmr'
    cross_encoder = 'cross_encoder'
```
`NodeReranker` é idêntico; `EpisodeReranker` e `CommunityReranker` só têm `rrf` + `cross_encoder`.

Os presets vivem em `search_config_recipes.py`: `COMBINED_HYBRID_SEARCH_RRF` (`:34`, `reranker=EdgeReranker.rrf` em `:37`), `COMBINED_HYBRID_SEARCH_MMR` (`:56`), etc. — **41 recipes** no arquivo.

**Achado estrutural:** o reranker é **um campo escalar por configuração** — os rerankers são **mutuamente exclusivos**, nunca compostos. Escolhe-se RRF **ou** node_distance **ou** MMR. RRF é o preset-base (o primeiro recipe combinado).

**Q6 — Harness de qualidade e métrica**

`.claude/knowledge-base/references/graphiti/tests/evals/eval_cli.py` orquestra `build_baseline_graph` + `eval_graph` (`:27`, `:36`) sobre o dataset **LongMemEval oracle** (`.claude/knowledge-base/references/graphiti/tests/evals/data/longmemeval_data/longmemeval_oracle.json`).

A métrica é **LLM-as-judge binário**, não precision@k — `.claude/knowledge-base/references/graphiti/graphiti_core/prompts/eval.py:33-36`:

```python
class EvalResponse(BaseModel):
    is_correct: bool = Field(..., description='boolean if the answer is correct or incorrect')
    reasoning: str = Field(..., description='why you determined the response was correct or incorrect')
```

**Consequência para nós:** a métrica deles é cara (chamada de LLM por item), não-determinística e mede QA ponta-a-ponta — não isola a contribuição do reranker. Para o DoD do M15 ("benchmark provando o delta"), precision@k determinística sobre corpus fixo é mais barata, reproduzível e **isola** o efeito do boost. Não copiar o harness deles.

## Coverage Corner 4 — Techniques

**Q1 — `node_distance_reranker`: fórmula, combinação e posição do corte**

`.claude/knowledge-base/references/graphiti/graphiti_core/search/search_utils.py:1798-1858`:

1. Filtra o próprio nó-centro da lista.
2. Consulta Cypher: vizinhos **diretos** (`(center)-[:RELATES_TO]-(n)`) recebem `score = 1`.
3. Todo uuid sem resultado recebe `scores[uuid] = float('inf')`.
4. Ordena **ascendente** por `scores` (menor distância primeiro).
5. O nó-centro, se estava na lista, recebe `0.1` e é **prependido**.
6. Retorna `1/scores[uuid]`, filtrando `(1/scores[uuid]) >= min_score`.

```python
return [uuid for uuid in filtered_uuids if (1 / scores[uuid]) >= min_score], [
    1 / scores[uuid] for uuid in filtered_uuids if (1 / scores[uuid]) >= min_score
]
```

**Combinação: SUBSTITUIÇÃO, não mistura.** O score retornado é puramente `1/distância` — o score do retriever (cosine/BM25) é **descartado**. Não há soma nem produto com o sinal semântico.

**Posição do corte (EC-1):** o `min_score` é aplicado **DEPOIS** do rerank, sobre o score do rerank. Um candidato pode ser **eliminado** pelo rerank (não-vizinho → `inf` → `1/inf = 0` → cai se `min_score > 0`), mas **não pode ser ressuscitado**: o reranker opera sobre um conjunto **já recuperado**, nunca reintroduz quem não foi recuperado.

**Q2 — `episode_mentions_reranker`: normaliza a contagem?**

`.claude/knowledge-base/references/graphiti/graphiti_core/search/search_utils.py:1860-1898`:

1. Usa `rrf(node_uuids)` como pré-ranker.
2. Consulta `count(*)` de `(episode:Episodic)-[:MENTIONS]->(n:Entity)`.
3. Uuid sem menção recebe `float('inf')`.
4. `sorted_uuids.sort(key=lambda cur_uuid: scores[cur_uuid])` — **ascendente**.

**Resposta: NÃO normaliza — nem cap, nem saturação, nem escala.** É a contagem crua.

**Anomalia observada (reportada honestamente, não copiada):** a ordenação é **ascendente sobre uma contagem**, ou seja **menos-mencionado primeiro**, e o comentário acima da linha é `# rerank on shortest distance` — texto copiado do `node_distance_reranker`, onde ascendente é correto (distância). Para contagem de menções, ascendente inverte a intenção aparente. Além disso, não-mencionados recebem `inf`, que em semântica de contagem significaria "infinitamente mencionado". Não afirmamos ser bug do projeto deles — afirmamos que **a forma não é copiável** para o nosso `numLinked`.

**Q3 — `rrf`: fusão canônica e comportamento de rank**

`.claude/knowledge-base/references/graphiti/graphiti_core/search/search_utils.py:1780-1795`:

```python
scores: dict[str, float] = defaultdict(float)
for result in results:
    for i, uuid in enumerate(result):
        scores[uuid] += 1 / (i + rank_const)      # rank_const = 1
```

**É aditivo sobre RANKS**, não sobre scores brutos — cada lista contribui `1/(posição+1)`. O corte `min_score` é aplicado no final, sobre o score fundido.

**Um candidato de UM só sinal pode superar um de DOIS?** **Sim.** Rank 0 numa lista = `1/1 = 1.0`. Rank 5 em duas listas = `1/6 + 1/6 ≈ 0.33`. O RRF premia **posição alta** acima de **presença múltipla**.

## Cross-cutting Comparison

| Dimensão | graphiti | theo-memory (hoje) |
|---|---|---|
| Modelo de combinação | **Substituição** (o reranker reescreve o score) ou **fusão por rank** (RRF) | **Soma ponderada** de componentes brutos normalizados (`combineScores`) |
| Composição de sinais | Rerankers **mutuamente exclusivos** (um por config) | Componentes **somados juntos** (semantic + bm25 + entity) |
| Normalização | RRF normaliza por construção (rank); `node_distance` inverte (`1/d`); `episode_mentions` **não normaliza** | sigmoid por tamanho de query no BM25; entity **sem normalização definida** (nunca rodou) |
| Posição do corte | `min_score` **depois** do rerank; rerank nunca reintroduz não-recuperado | threshold semântico **antes** da combinação |
| Teste de qualidade de ranking | **inexistente** (assert de conjunto/cardinalidade) | inexistente para entity (o componente é 0) |
| Métrica de qualidade | LLM-as-judge binário sobre LongMemEval | benchmark determinístico já usado no M14 (fração medida) |
| Dependências do scoring | Python puro; `numpy` só para MMR | Python-free; já temos MMR |

**A diferença que mais importa:** eles **reordenam listas**; nós **somamos componentes antes do top-K**. O `node_distance_reranker` não é portável para o nosso `combineScores` — ele descarta o sinal semântico, coisa que nosso modelo aditivo por construção não faz. O que **é** portável é a lição do RRF: normalizar por **rank** em vez de por escala bruta elimina o problema de "qual sinal domina a soma".

## ADRs

### D1 — O modelo aditivo nosso NÃO deve virar substituição

**Decisão:** manter `combineScores` aditivo; NÃO adotar o padrão `node_distance_reranker` de substituir o score.
**Rationale:** a substituição descarta o sinal semântico — num corpus onde o grafo tem ruído conhecido (#111 mediu 83% antes dos gates), deixar a estrutura decidir sozinha a ordem é frágil. O aditivo degrada suavemente: se o boost for 0 (memória sem entidade ligada), o ranking permanece o de hoje. **Alternativa rejeitada:** portar `node_distance_reranker` como pós-processo — quebraria a propriedade de degradação suave e exigiria refazer o threshold gate.

### D2 — Normalizar o boost por rank ou sigmoid, jamais contagem crua

**Decisão:** o componente `entity` entra normalizado, como o BM25 já entra (sigmoid), ou por rank ao estilo RRF.
**Rationale:** `episode_mentions_reranker` usa contagem crua e por isso não tem escala comparável a nada; se somássemos `numLinked` cru ao nosso score, uma entidade hub dominaria a soma. **Alternativa rejeitada:** contagem crua com `ENTITY_BOOST_WEIGHT` compensando — o peso é constante e a contagem não é limitada, então não há constante que segure a cauda.

### D3 — O corte permanece ANTES da combinação (não copiar a ordem deles)

**Decisão:** manter o threshold semântico antes do `combineScores`; o boost soma **depois** do gate.
**Rationale:** o efeito prático coincide com o deles — o rerank deles opera só sobre já-recuperados, e nosso boost soma só sobre já-aprovados no gate; em nenhum dos dois um candidato barrado volta. Nosso arranjo satisfaz o DoD de não-ressuscitação **por construção**, sem código de guarda extra. **Alternativa rejeitada:** mover o gate para depois da soma (que é o arranjo deles, `min_score` pós-rerank) — permitiria ao boost ressuscitar sub-threshold, exatamente o que o M15 proíbe.

### D4 — Benchmark determinístico, não LLM-as-judge

**Decisão:** medir o delta do boost com precision@k determinística sobre corpus fixo.
**Rationale:** o harness deles (LongMemEval + juiz LLM) mede QA ponta-a-ponta, é caro, não-determinístico e **não isola** a contribuição do reranker. O M15 precisa do delta atribuível ao boost. **Alternativa rejeitada:** replicar LongMemEval — custo de LLM por item e ruído de julgamento maiores que o sinal que queremos medir.

## Recommendations

1. **Popular `entityBoostById`** a partir de `entities` + `memory_entities` no escopo, mantendo a soma aditiva (D1).
2. **Normalizar antes de somar** — sigmoid como o BM25, ou posição-rank ao estilo RRF (D2). Nunca `numLinked` cru.
3. **Não mover o gate** — o arranjo atual (threshold antes da soma) já entrega a não-ressuscitação exigida (D3); o teste negativo do DoD documenta a propriedade, não precisa de código novo para garanti-la.
4. **Benchmark determinístico** com/sem boost, precision@k sobre corpus com entidades reais (D4). Sem ganho medido, não ligar por default — o próprio DoD do M15 já prevê isso.
5. **Não copiar `episode_mentions_reranker`** — contagem crua + ordenação ascendente com comentário copiado; a forma não é referência utilizável.
6. **Zero dependência nova** — o caminho de scoring deles é Python puro; o nosso também será.

## Open questions

Nenhuma. As quatro decisões que o Objective exigia — (a) onde o sinal entra, (b) como normaliza, (c) que guarda impede regressão, (d) que métrica prova — estão fechadas em D1–D4.
