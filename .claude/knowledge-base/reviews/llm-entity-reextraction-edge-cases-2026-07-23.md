# Discover Edge Case Review — llm-entity-reextraction

Date: 2026-07-23
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/llm-entity-reextraction-plan.md
Research questions analyzed: 8
Edge cases found: 6 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: Q1 grep âncora `add_episode_bulk` vive fora do arquivo-alvo
- **Affected question:** Q1
- **Family:** Method
- **Scenario:** `add_episode_bulk` está definido em `graphiti_core/graphiti.py` (verificado), não em `bulk_utils.py`. O halt-loop leria só `bulk_utils.py` e marcaria a âncora como ausente → resposta incompleta ou falso `blocked`.
- **Impact:** Q1 perde o entrypoint real do fluxo bulk (orquestração fica invisível).
- **Suggested fix:** Método da Q1 passa a incluir `Read graphiti_core/graphiti.py` (região `add_episode_bulk`) ALÉM de `bulk_utils.py`.

### EC-2: Q7 pode virar implementação de benchmark durante a discovery
- **Affected question:** Q7
- **Family:** Scope
- **Scenario:** "metodologia de benchmark executável" convida a ESCREVER o harness na discovery (a discovery produz documento, nunca código — anti-pattern do cycle).
- **Impact:** Scope creep; halt-loop estoura budget; blueprint vira meio-código.
- **Suggested fix:** Q7 entrega APENAS: métricas escolhidas + queries SQL (texto no blueprint) + procedimento baseline/pós; o harness é task do plano M13.

## SHOULD TEST

### EC-3: mem0 clone antigo pode não ter o prompt de UPDATE em `utils.py`
- **Affected question:** Q5
- **Suggested halt-loop checkpoint:** antes de fechar Q5, `grep -l "UPDATE" mem0/mem0/memory/*.py mem0/mem0/configs/prompts.py 2>/dev/null` — o prompt de decisão ADD/UPDATE/DELETE pode morar em `configs/prompts.py`; se ausente no clone, responder com o que existir e marcar a lacuna honestamente (nunca citar de memória do paper).

### EC-4: Q3 taxonomia default do graphiti pode ser aberta (não-fechada)
- **Affected question:** Q3
- **Suggested halt-loop checkpoint:** se o graphiti delegar types ao chamador (custom-only), a resposta DEVE dizer isso explicitamente e a taxonomia final vem do NOSSO Item 15 + um vocabulário fechado proposto no ADR do blueprint — não inventar um "default do graphiti" inexistente.

## DOCUMENT

### EC-5: Licenças dos refs para além de leitura
- **Accepted risk:** graphiti é Apache-2.0 e mem0 Apache-2.0 (catalog) — leitura e adaptação de PADRÕES ok; nunca copiar prompt verbatim sem reescrita (higiene já praticada na Phase A).

### EC-6: Budget de 4.5h pode ser apertado se bulk_utils tiver alta densidade
- **Accepted risk:** `bulk_utils.py` tem 15 defs; se a leitura estourar o budget do ADR-DP3, o halt-loop marca as questões restantes `blocked` com razão — o gate de confidence decide se o blueprint fica SHIPPABLE_WITH_CAVEATS. Preferimos honestidade a resposta rasa.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 1 | 0 | 0 |
| Q3 | 1 | 0 | 1 | 0 |
| Q5 | 1 | 0 | 1 | 0 |
| Q7 | 1 | 1 | 0 | 0 |
| Global | 2 | 0 | 0 | 2 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (2 MUST FIX → absorver e bump v1.1)
