## Impacto

`entityBoost(numLinked)` (`packages/core/src/domain/scoring.ts`) é **decrescente** em `numLinked`. Depois do M15 (#122), que passou a alimentar essa função com "quantas entidades **da query** estão ligadas a esta memória", a monotonicidade ficou invertida em relação à intenção:

| `numLinked` | boost |
|---|---|
| 1 | 0.5000 |
| 2 | 0.4995 |
| 3 | 0.4980 |
| 5 | 0.4921 |
| 10 | 0.4625 |
| 25 | 0.3173 |

Uma memória que casa **três** entidades citadas na busca recebe *menos* impulso que uma que casa **uma**. O esperado seria o contrário: casar mais entidades da query é sinal de maior relevância, não menor.

**Severidade: LOW.** O efeito é numericamente ínfimo na faixa realista (0.500 vs 0.498 entre 1 e 3 casamentos), então o boost se comporta essencialmente como binário — presente ou ausente — e é por isso que o benchmark do M15 mede ganho real (precision@1 de 0.64 → 1.00). Não há bug observável hoje. É uma imprecisão semântica que vai incomodar quando alguém quiser diferenciar "casou 1" de "casou 5".

## Causa

A fórmula veio de uma semântica **diferente** de `numLinked`. A documentação da função diz:

```
Spread-attenuated entity boost — prevents a single memory with many entity
matches from dominating the ranking.
```

Ali `numLinked` era "quantas entidades esta memória tem no total" — e a penalidade de espalhamento faz sentido: uma memória ligada a 40 entidades é genérica, não específica.

O M15 passou a alimentar a mesma função com outra quantidade: a **interseção** entre as entidades da query e as da memória. Nessa leitura, mais é melhor, e a penalidade age na direção errada.

## Por que não foi corrigido no M15

O ADR D1 do plano `entity-boost-recall-contribution` decidiu explicitamente **não alterar `scoring.ts`**: o trabalho daquele milestone era popular o mapa, não redesenhar o score, e mexer numa fórmula portada e testada seria retrabalho especulativo dentro de uma task de wiring. A decisão está registrada com as alternativas rejeitadas.

## Sugestão de fix

Duas direções, ambas exigindo medição antes de escolher:

1. **Separar as duas quantidades.** Manter a atenuação por espalhamento sobre o total de entidades da memória (a semântica original) e aplicar um fator crescente sobre a interseção com a query. Preserva a intenção das duas.
2. **Trocar por sigmoid crescente sobre a interseção**, que é o que o DoD do ROADMAP M15 pedia textualmente ("normalização na mesma escala do BM25 (sigmoid)"). Mais simples, mas descarta a proteção contra memórias genéricas.

Em qualquer caso o gate é o mesmo do M15: **sem ganho medido no benchmark, não muda**. O corpus atual (`tests/integration/entity-boost/precision-benchmark.test.ts`) precisaria ganhar tópicos com número variável de entidades casadas para que a diferença sequer apareça na métrica — hoje todos casam exatamente uma.

## Escopo / relacionados

- Descoberto ao validar o DoD do ROADMAP M15, item "normalização na mesma escala do BM25".
- Contexto e números do M15: `docs/benchmarks/entity-boost-m15.md`.
- Decisão de não tocar `scoring.ts` no M15: ADR D1 do plano `entity-boost-recall-contribution`.

---

_Como foi encontrado: verificação da monotonicidade da curva ao fechar os itens de DoD do M15. Sem secrets no corpo._
