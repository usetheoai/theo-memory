## Impacto

O `entity boost` — o terceiro sinal do nosso recall híbrido — **nunca contribui**. O `combineScores` soma um componente que é sempre `0`, então o que documentamos como "semântico + BM25 + entity boost" é, na prática, **semântico + BM25**.

Isso é dívida de v0.1 que ficou para trás: naquele momento não havia entity store, e o `numLinked` era legitimamente 0. Hoje o grafo **está populado** (M13/v0.11 — extração de entidades + `entity_edges` com types semânticos), então o sinal existe no banco e continua desligado no ranking.

Perda de qualidade: uma memória ligada a entidades fortemente relacionadas à query não recebe nenhum empurrão no score. É o único sinal estrutural que temos a mais que a concorrência (comparação com mem0: eles têm apenas vetorial + filtros no OSS; reranker só na plataforma paga) — e não está ligado.

**Severidade: MEDIUM** — não é bug de correção nem de segurança; é capacidade projetada, construída e não conectada.

## Evidência (código atual)

`packages/core/src/domain/retrieval/pipeline.ts:451-452`:

```ts
// Step 6: entity boost (v0.1 ships without entity store integration; numLinked=0 always)
const entityBoostById = new Map<string, number>();
```

O `Map` é criado vazio e **nunca é populado**. Todos os consumidores caem no default:

```ts
entity: entityBoostById.get(r.id) ?? 0,     // pipeline.ts:460 e 470
entity: entityBoostById.size > 0,           // pipeline.ts:480  -> sempre false
```

A infraestrutura de scoring está pronta e ociosa:

- `packages/core/src/domain/scoring.ts` — `export const ENTITY_BOOST_WEIGHT = 0.5;`
- `combineScores(scores: CandidateScores, maxPossibleValue)` já recebe o componente `entity`.
- `packages/core/src/domain/memory-config.ts:55` — `readonly entityBoost?: boolean;` (ADR-0007, default `true`) — a flag existe e não liga nada.
- `packages/core/src/domain/dip/recall-trace-store.ts:46` — o próprio código avisa: *"the `entity` component is uniformly `0` in v0.1 (`entityBoostById` is never populated) ... Do NOT read signal into it today."*

## Repro

1. Fazer `remember` de um texto cujo grafo gere entidades (write pipeline M13 popula `entities` + `memory_entities`).
2. Fazer `recall` com uma query que mencione uma dessas entidades.
3. Inspecionar o trace (`explain_recall` / `recall_traces`): a coluna `entity` do componente é `0` para todos os candidatos, independentemente de quantas entidades da query estão ligadas à memória.

Confirmado por leitura de código; o `Map` vazio torna o resultado determinístico.

## Sugestão de fix

Popular `entityBoostById` no Step 6 a partir do grafo já existente, mantendo a aritmética aditiva atual (nada de mudar o modelo de score):

1. Extrair as entidades da query (reusar o extractor já usado no write path, ou casar por `normalized_key` contra `entities` no escopo).
2. Buscar as memórias ligadas a essas entidades via `memory_entities` (scoped por `(workspace, user[, session, agent])`, o mesmo predicado `COALESCE` do resto).
3. `entityBoostById.set(memoryId, f(numLinked))` — normalizado como o BM25 já é (sigmoid), para o componente entrar na mesma escala antes do `ENTITY_BOOST_WEIGHT`.
4. Atualizar o comentário de `recall-trace-store.ts:46` — hoje ele instrui a NÃO ler sinal da coluna; com o boost ligado, a coluna passa a ser significativa.

Guard-rails para o fix:
- O boost é **aditivo** e roda **depois** do threshold semântico (o gate atual não pode ser afetado — não queremos que o boost ressuscite candidato sub-threshold sem decisão explícita).
- Precisa de teste que prove o delta: mesma query, memória-com-entidade-ligada rankeando acima da memória-sem, com o componente `entity > 0` no trace.
- Cuidado com custo: a expansão por entidade não pode virar um segundo round-trip caro por recall — medir antes/depois.

## Escopo / relacionados

- Não confundir com o **graph-aware recall** (v0.19), que é expansão 1-2 hop como caminho separado. Este issue é sobre o **componente aditivo no score principal**, que é outra coisa e está morto.
- ADR-0007 (`entityBoost` default `true`) descreve um comportamento que hoje não acontece — vale revisitar o ADR junto com o fix.
- Contexto competitivo: análise comparativa com mem0 (2026-07-24) mostrou que este é o único sinal estrutural onde teríamos vantagem sobre o recall deles; hoje não temos porque está desligado.

---

_Como foi encontrado: análise comparativa de qualidade de memória (mem0 vs theo-memory), lendo o fonte dos dois lados. Sem secrets no corpo._
