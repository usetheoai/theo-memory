# Edge Case Review — entity-boost-monotonic-and-non-evicting (M18)

Date: 2026-07-24
Tasks analyzed: 7 (T1.1, T1.2, T2.1, T2.2, T3.1, T3.2)
Cases found: 5 (EDGE: 3, NEGATIVE: 2 | MUST FIX: 0, SHOULD TEST: 4, DOCUMENT: 1)

O código de produção alterado (`scoring.ts`) é aritmética pura, sem I/O, sem parsing, sem
concorrência. As fronteiras reais são: (1) o domínio de `entityBoost(numLinked)` — um inteiro não
negativo vindo do `Map.size` em `entity-boost-step.ts:100`; (2) o clamp de `combineScores`. Não há
fronteira de rede/disco no caminho alterado, então a maioria dos NEGATIVE-cases clássicos (null,
encoding, timeout) não se aplica — o input já é validado pela origem (contagem de um Map). Os
edge-cases que importam são os extremos numéricos da nova curva.

## SHOULD TEST

### EC-1: saturação numérica em numLinked muito grande
- **Affected task:** T1.1
- **Kind:** EDGE (extremo de valor válido)
- **Suggested test:** `test_entity_boost_saturates_and_never_exceeds_weight` — para `numLinked` = 1000 e 100000, `entityBoost(n)` ≤ `ENTITY_BOOST_WEIGHT` e não retorna `NaN`/`Infinity`. A forma `W·(1-1/(1+n))` é numericamente estável nesse range, mas o teste ancora o teto. Já previsto no plano (T1.1 RED `test_entity_boost_saturates_at_weight`) — confirmar que cobre n≥1000, não só um valor.

### EC-2: numLinked = 1 é o caso comum e é onde a nova curva mais diverge da antiga
- **Affected task:** T3.1
- **Kind:** EDGE (extremo inferior do domínio útil — 1 é o mínimo com boost > 0)
- **Suggested test:** `test_precision_not_regressed_when_num_linked_is_one` — no corpus onde a maioria dos relevantes casa exatamente 1 entidade, `precision@k` novo ≥ antigo. É o risco #1 do plano (n=1 cai de 0.50 para 0.25). O benchmark de T3.1 já mede precision novo-vs-antigo; garantir que o corpus contenha o caso n=1 dominante, senão o teste não morde o risco real.

### EC-3: clamp quando semantic + bm25 já saturam e o boost empurra além de 1.0
- **Affected task:** T2.1
- **Kind:** EDGE (extremo superior do score combinado)
- **Suggested test:** `test_combined_score_clamped_at_one_when_all_signals_max` — semantic=1.0, bm25=1.0, boost=W, na forma numerador-only: o score final é exatamente 1.0, nunca > 1.0. Já previsto (T2.1 RED `test_combined_score_never_exceeds_one`) — confirmar que testa o caso de TODOS os sinais no máximo, não só um.

### EC-4: numLinked = 0 continua retornando 0 exato (não epsilon)
- **Affected task:** T1.1
- **Kind:** NEGATIVE (ausência de vínculo — o "sem sinal")
- **Suggested test:** `test_zero_links_returns_exact_zero` — `entityBoost(0) === 0` estritamente (não `0.0000...1`). A forma `W·(1-1/(1+0))` = `W·(1-1)` = 0 exato; ancorar para que uma futura troca de forma não introduza epsilon que ligaria o sinal para candidatos sem vínculo. Já previsto (T1.1 RED `test_zero_links_still_returns_zero`).

## DOCUMENT

### EC-5: numLinked negativo ou não-inteiro é inalcançável pelo caller
- **Kind:** NEGATIVE (input inválido)
- **Accepted risk:** `entityBoost` recebe `numLinked` de `matchedCounts.get(memoryId)` — o `.size`/valor de um `Map` construído por contagem, sempre inteiro ≥ 0. Um `numLinked` negativo ou fracionário exigiria corromper a contagem a montante, o que os testes de `entity-boost-step` já cobrem na origem. Adicionar validação defensiva dentro de `entityBoost` (função de domínio puro, hot path do recall) violaria KISS — a validação pertence à fronteira (`entity-boost-step`), não à função matemática. Documentado, não corrigido.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 2 | 1 | 0 | 3 | 0 |
| T1.2 | 0 | 0 | 0 | 0 | 0 |
| T2.1 | 1 | 0 | 0 | 1 | 0 |
| T2.2 | 0 | 0 | 0 | 0 | 0 |
| T3.1 | 1 | 0 | 0 | 1 | 0 |
| T3.2 | 0 | 0 | 0 | 0 | 0 |
| (domain) | 0 | 1 | 0 | 0 | 1 |

**Coverage check:** todos os SHOULD TEST já estão previstos nas seções `#### TDD` das tasks do
plano — este review confirma que os REDs cobrem os extremos certos (n grande, n=1 dominante, clamp
com todos os sinais no máximo, zero exato), não apenas um valor de amostra. EC-2 é o único que exige
ajuste no plano: o corpus de T3.1 DEVE conter o caso `numLinked=1` dominante, senão o teste de
não-regressão de precisão não exercita o risco real da nova curva.

**Verdict:** PLAN OK — os MUST-FIX são zero; EC-2 é absorvido como refinamento do corpus de T3.1
(uma frase: "o corpus inclui tópicos onde o relevante casa exatamente 1 entidade, o caso comum").
