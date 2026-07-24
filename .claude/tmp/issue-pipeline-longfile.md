## Impacto

`packages/core/src/domain/retrieval/pipeline.ts` tem **729 linhas** contra um teto de **300** definido pelo próprio gate de qualidade do repositório (`.claude/hooks/check_quality.py`, ativo desde 2026-07-20). A função `runRetrievalPipeline` sozinha tem **293 linhas**.

O efeito prático apareceu no M15: o hook é `PostToolUse` e checa o arquivo inteiro a cada edição, então **qualquer** mudança no pipeline — inclusive uma de 5 linhas — dispara bloqueio. Hoje isso empurra quem edita a duas saídas ruins: fazer um refactor grande de 400+ linhas no caminho mais crítico do produto no meio de uma task de feature, ou conviver com o bloqueio.

**Severidade: MEDIUM** — não há bug de comportamento. É atrito de manutenção sobre o caminho de leitura mais quente do sistema, e o risco real é alguém fazer o refactor com pressa dentro de outra entrega.

## Evidência

```
wc -l packages/core/src/domain/retrieval/pipeline.ts   # 729
awk 'NR>=435' packages/core/src/domain/retrieval/pipeline.ts | wc -l   # 293 (runRetrievalPipeline)
```

O hook também aponta 4 blocos duplicados, todos anteriores ao M15:

| Linha | Bloco |
|---|---|
| 197 | `drops?.push({ memoryId: id, ... })` |
| 354 | `error: err instanceof Error ? err.name : 'unknown'` |
| 481 | `bm25: bm25NormalizedById.get(r.id) ?? 0` |
| 589 | `scope.kind, ...` |

## Fronteiras naturais já mapeadas

O arquivo tem estágios coesos que saem quase sem costura:

| Faixa | Conteúdo | Módulo sugerido |
|---|---|---|
| 110–161 | `scopeFromFilters`, `payloadToScore`, `applyRerankStage` | `rerank-stage.ts` |
| 163–236 | tipos `Candidate`/`ScoredRow`/`DroppedCandidate` + `filterAtThreshold` | `threshold-stage.ts` |
| 237–287 | `writeRecallTrace` | `trace-stage.ts` |
| 288–433 | `applyAdaptiveAssessStage`, `applyGraphExpansionStage` | `expansion-stage.ts` |

Precedente no próprio M15: o Step 6 saiu para `entity-boost-step.ts` e a leitura pg saiu para `pg-linked-keys.ts`, ambos por SRP genuíno. Extrair os quatro acima levaria o arquivo a ~400 linhas; chegar abaixo de 300 exige também decompor `runRetrievalPipeline` internamente.

## Sugestão

Tratar como cycle próprio (`/to-plan` → `/implement` → `/review`), **não** como carona em outra feature. O pipeline é o caminho de leitura mais crítico do produto e um refactor apressado ali é como se introduz um bug sutil de ranking que nenhum teste unitário pega.

Enquanto o refactor não acontece, decidir explicitamente entre: (a) manter o bloqueio e aceitar o atrito, ou (b) dar ao hook um mecanismo de baseline/isenção para dívida pré-existente, que é o que falta hoje — ele não distingue "violação nova" de "arquivo que já nasceu grande".

## Escopo / relacionados

- Descoberto durante o M15 (#122), ao tentar wirar o Step 6. Fora do escopo daquele plano.
- Precedente de dívida semelhante registrada e não corrigida na hora: `pgvector-store.ts` (1344 linhas), `run-mcp-server.ts` (433), `handlers.test.ts` (521).

---

_Como foi encontrado: gate de qualidade bloqueando a fase IMPLEMENT do M15. Sem secrets no corpo._
