# Discover Edge Case Review — entity-boost-recall-contribution

Date: 2026-07-24
Discovery plan analyzed: `.claude/knowledge-base/discoveries/plans/entity-boost-recall-contribution-plan.md`
Research questions analyzed: 7
Edge cases found: 6 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: nenhuma pergunta captura ONDE o rerank fica em relação a um corte de score
- **Affected question:** Q1 (e Q4)
- **Family:** Interpretation
- **Scenario:** O `/discover-execute` responde Q1 com a fórmula do `node_distance_reranker` e onde ele entra na lista final — mas não registra se existe um **cutoff/threshold** antes ou depois do rerank no pipeline deles.
- **Impact:** O M15 tem um DoD explícito ("o boost NÃO ressuscita candidato sub-threshold"). Sem saber se eles cortam antes ou depois, o blueprint não consegue embasar essa guarda e o `/to-plan` decide no escuro — exatamente o tipo de decisão em aberto que o Objective diz que não pode sobrar.
- **Suggested fix:** acrescentar a Q1 a sub-pergunta "existe corte/limiar de score aplicado ANTES ou DEPOIS do rerank, e candidatos fora do corte podem retornar por efeito do rerank?".

### EC-2: Q5 não tem fallback se os testes não asseverarem melhora de ordem
- **Affected question:** Q5
- **Family:** Method
- **Scenario:** `search_utils_test.py` pode testar apenas mecânica (a função roda, retorna N itens) sem nenhuma asserção sobre **posição relativa**. O halt-loop então fica sem resposta na forma pedida ("fixture + asserção transcrita") e pode travar ou inventar.
- **Impact:** Pergunta marcada `blocked` sem necessidade, ou pior — resposta fabricada para preencher a forma esperada.
- **Suggested fix:** acrescentar a Q5 o fallback "se não houver asserção de ordem relativa, a resposta é 'não testam qualidade de ranking' + transcrever o que de fato asseveram".

## SHOULD TEST

### EC-3: números de linha podem não bater na leitura
- **Affected question:** Q1, Q2, Q3
- **Suggested halt-loop checkpoint:** localizar por SÍMBOLO (`Grep 'def node_distance_reranker'`) antes de ler por offset; as linhas citadas (1798/1860/1780) são âncora de partida, não endereço fixo.

### EC-4: `search.py` está in-scope e é vetor de scope creep
- **Affected question:** Q1, Q4
- **Suggested halt-loop checkpoint:** a leitura de `search.py` fica limitada a localizar os **sites de invocação** dos rerankers; qualquer leitura do orquestrador além disso encerra a pergunta (o orçamento de 3h do ADR-D3 é para o mecanismo, não para o fluxo inteiro).

## DOCUMENT

### EC-5: o harness de eval é lido, nunca executado
- **Accepted risk:** Q6 lê `eval_cli.py` e lista `data/longmemeval_data`; rodar o harness exigiria chave de LLM e rede, e não é necessário para responder "qual métrica eles reportam". Ler é suficiente e mantém o `knowledge-base/references/` read-only.

### EC-6: a tradução rerank→aditivo é o risco central e já está coberta
- **Accepted risk:** eles **reordenam listas**; nós **somamos componentes** antes do top-K. É um gap conceitual real, mas o Acceptance Criteria do plano já exige um ADR no blueprint explicitando o que se aplica e o que não se aplica. Não vira MUST FIX porque o mecanismo de captura já existe no plano.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 3 | 1 | 2 | 0 |
| Q2 | 1 | 0 | 1 | 0 |
| Q3 | 1 | 0 | 1 | 0 |
| Q4 | 1 | 0 | 1 | 0 |
| Q5 | 1 | 1 | 0 | 0 |
| Q6 | 1 | 0 | 0 | 1 |
| Q7 | 0 | 0 | 0 | 0 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (2 MUST FIX — ambos de 1 linha)
