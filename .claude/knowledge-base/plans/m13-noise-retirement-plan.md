---
slug: m13-noise-retirement
milestone_id: M13
created_at: 2026-07-23
goal: Aposentar o ruído mecânico não-reconfirmado pelo backfill M13 — unlink dos links falsos + coleta GC das linhas órfãs de mecanismo, via engine testado e CLI commit-gated — fechando as queries canônicas do DoD (ALL-CAPS mecanismo ≤10; ≤3 chars mecanismo ≤10) sem SQL manual em base viva.
---

# Plan: M13 noise retirement — aposentadoria auditável do ruído mecânico (#111)

> Follow-up declarado no relatório de benchmark do plano pai (`knowledge-base/audits/m13-entity-noise-post-backfill-2026-07-23.md` § Achado estrutural): o supersede por identidade (ADR D2 do plano pai) re-tipa, mas não aposenta ruído sem sucessor semântico.

## Goal

Fechar o DoD numérico do M13 aposentando as entidades de mecanismo (`PROPER|COMPOUND|QUOTED`)
que o backfill completo NÃO reconfirmou: remover seus links falsos (`memory_entities`) e as
edges com endpoint nelas, e coletar as linhas então órfãs pelo MESMO contrato do GC #110
(evento tipado + contagens no relatório) — via `themory reextract --retire-mechanism`
(dry-run por default; `--commit` executa). VERIFICADO pelas queries canônicas do baseline:
ALL-CAPS vivo ≤10 e ≤3-chars vivo ≤10 no conjunto de mecanismo, âncoras de supersede
intactas, zero entidade semântica tocada.

## Context

Pós-benchmark do plano pai `llm-entity-reextraction` (2 passadas live: 819 supersedes; residual
1401 linhas de mecanismo vivas — amostra 20 no relatório: 17/20 ruído puro tipo
HIGH/OK/PASS/READYTOMERGE que o LLM corretamente não re-emite). Operação DESTRUTIVA em base
viva → plano + testes obrigatórios (lição theo-cloud#252 / regra bulk-delete fail-closed).
Regras: `error-handling.md` (fail-fast tipado), `testing.md § 4.1`, `parsimony-ladder.md`
(reuso do GC #110 — zero mecanismo novo de deleção), Princípio 3 (IGNORE/forget observável).

## Baseline Context (deep review of current state)

Verificado em `dd55184` (develop, 2026-07-23).

### Files that will be touched

| File | LoC | Last commit | Papel hoje |
|---|---|---|---|
| `packages/cli/src/reextract/engine.ts` | 296 | 0291b27 | Engine do plano pai (seleção/chunks/semáforo/supersede) — ganha `retireMechanism` |
| `packages/cli/src/reextract/batching.ts` | 92 | 0291b27 | Mecânica pura (chunk/checkpoint/semáforo) — inalterado |
| `packages/cli/src/reextract/run-reextract.ts` | 125 | 0291b27 | Composition root do verbo — ganha flags `--retire-mechanism`/`--commit` |
| `packages/cli/src/cli.ts` | ~600 | 4d49e39 | Registro do verbo (opções novas no MESMO comando `reextract`) |
| `packages/core/src/domain/memory-event.ts` | ~230 | d9a92fb | União `MEMORY_EVENTS` — ganha `reextract_noise_retired` |
| `packages/cli/src/reextract/engine.test.ts` | 219 | 0291b27 | Unit suite — casos novos |
| `tests/integration/reextract.test.ts` | 178 | d9a92fb | Integração pgvector — casos novos |

### Current callers / dependents

- `runReextract`: único caller `run-reextract.ts:97` (verbo CLI). O retirement é função IRMÃ
  no mesmo módulo (mesmo deps bag `ReextractDeps`), exportada e chamada só pelo verbo.
- GC precedente: `pgvector-store.ts:717-775` (`deleteInScope` hard) — deleta edges de
  endpoint órfão e entidades zero-link com guarda de âncora de supersede (plano pai), emitindo
  `entity_gc_collected`. O retirement REUSA a mesma ordem (edges → entities) e a mesma
  guarda, em batches próprios.
- Superfícies de leitura: NENHUMA mudança — listagem/graph/expansion já filtram por links
  vivos e `superseded_by IS NULL`; linhas coletadas simplesmente deixam de existir.

### Domain glossary

- **Ruído não-reconfirmado**: entidade de mecanismo viva após backfill COMPLETO — o LLM
  re-processou toda memória-fonte e não re-emitiu o nome (se tivesse, o supersede por
  identidade a teria aposentado).
- **Âncora de supersede**: linha com `superseded_by` preenchido OU referenciada por um
  `superseded_by` — trilha de auditoria; NUNCA coletada (guarda do plano pai reusada).
- **Retirement**: unlink dos links falsos + coleta GC da linha órfã — evento
  `reextract_noise_retired` com contagens (Princípio 3: o forget é observável).

### Architecture boundaries affected

Composition root only (`packages/cli/src/reextract/`) + 1 literal na união de eventos do
domain. Zero mudança de porta DIP, zero migração, zero mudança REST/MCP.

## ADRs

### D1 — Retirement = unlink + coleta GC (não supersede-sentinela, não coluna nova)

Decisão: aposentar ruído removendo os links falsos e deletando a linha órfã no contrato GC
#110 (evento tipado, contagens, guarda de âncora). Alternativas rejeitadas: (a) entidade
sentinela "[retired]" como alvo de supersede — polui o grafo e o dashboard com um nó
artificial; (b) coluna `t_invalid` em `entities` — nova superfície bi-temporal para dado que
é RUÍDO confirmado (YAGNI); (c) manter para sempre — DoD numérico inatingível e a tabela
cresce com lixo. O link falso não é trilha de auditoria (é índice derivado, reconstruível
por re-extração); a decisão de coleta fica auditável no evento + relatório + CHANGELOG.

### D2 — Escopo da seleção: TODA entidade de mecanismo viva não-âncora; comando commit-gated

Decisão: a seleção é determinística e independente de checkpoint — `type IN
('PROPER','COMPOUND','QUOTED') AND superseded_by IS NULL` menos âncoras. A justificativa
"não-reconfirmado" vem da PRÉ-CONDIÇÃO operacional (backfill completo executado — benchmark do plano pai) e
não de estado de arquivo; o comando imprime dry-run por DEFAULT e só executa com `--commit`
explícito (precedente `themory import claude-code`; lição #252 fail-closed). Alternativa
rejeitada: validar reprocessamento por checkpoint — o arquivo é efêmero/parcial (pass 2
sobrescreveu o da pass 1) e criaria acoplamento frágil.

## Phase 1: Engine + CLI

### T1.1 — `retireMechanism` no engine + flags no verbo

#### Objective
Função `retireMechanism(deps, {commit})` + `themory reextract --retire-mechanism [--commit] [--json]` com relatório tipado e evento OTel.

#### Why this step (action + reasoning — ReAct discipline)
Ação: irmã de `runReextract` no mesmo módulo, reusando `ReextractDeps.pool` e a ordem/guarda
do GC #110. Razão: ADR D1/D2; parcimônia rung 4 (contrato de coleta já existe); a operação
destrutiva ganha teste + dry-run em vez de SQL manual (#252).

#### Evidence
`pgvector-store.ts:717-775` (GC + guarda de âncora do plano pai); relatório de benchmark do plano pai (residual 1401);
`run-reextract.ts` (flag-mapper precedente).

#### Files to edit
- `packages/cli/src/reextract/engine.ts`
- `packages/cli/src/reextract/run-reextract.ts`
- `packages/cli/src/cli.ts`
- `packages/core/src/domain/memory-event.ts`
- `packages/cli/src/reextract/engine.test.ts`
- `tests/integration/reextract.test.ts`
- `CHANGELOG.md`

#### Deep file dependency analysis
SQL em UMA transação por batch (500 ids): (1) SELECT ids alvo (mecanismo vivo, não-âncora:
`superseded_by IS NULL AND NOT EXISTS (SELECT 1 FROM entities o WHERE o.superseded_by =
e.id)`); (2) DELETE `entity_edges` com endpoint no conjunto; (3) DELETE `memory_entities`
dos ids; (4) DELETE `entities` dos ids. Contagens somadas no relatório
`{candidates, retired, edgesRemoved, linksRemoved, dryRun}`. Dry-run = só o SELECT + counts
(zero escrita). `engine.ts` está a 296/300 linhas — a função nova vai em
`packages/cli/src/reextract/retire.ts` (novo módulo, mesmo padrão batching.ts) para
respeitar o budget; `engine.ts` só re-exporta.

#### Deep Dives
Edge: entidade de mecanismo que é âncora (referenciada por `superseded_by`) → NUNCA
coletada (guarda no SELECT). Edge: batch parcial falha → ROLLBACK do batch, batches
anteriores permanecem (idempotente: re-run coleta o resto). Negative: `--commit` sem
`--retire-mechanism` → erro de uso exit 2. Negative: falha de conexão mid-run → erro tipado
sobe (fail-fast), relatório parcial NÃO é impresso como sucesso.

#### Pseudo-code / Signatures
```ts
export interface RetireReport { candidates: number; retired: number; linksRemoved: number;
  edgesRemoved: number; dryRun: boolean; durationMs: number }
export async function retireMechanism(deps: Pick<ReextractDeps,'pool'|'tracer'>,
  opts: { commit: boolean; batchSize?: number }): Promise<RetireReport>
```

#### Tasks
RED unit (dry-run zero-write; guarda de âncora no SQL) → RED integração (E2E retire) →
GREEN → REFACTOR → wiring (caller = verbo CLI; integração = reextract.test.ts; métrica =
evento `reextract_noise_retired`).

#### TDD
- `test_retire_dry_run_counts_without_writes` (integração): Given 2 mecanismo + 1 semântica
  + 1 âncora; When `retireMechanism({commit:false})`; Then `expect(report.candidates).toBe(2)`
  E `expect(report.retired).toBe(0)` E contagem de linhas na tabela inalterada (SELECT
  count).
- `test_retire_commit_removes_mechanism_keeps_semantic_and_anchors` (integração): When
  `{commit:true}`; Then mecanismo sumiu (`SELECT ... = 0`), semântica intacta, âncora E a
  linha que ela referencia intactas, links/edges dos coletados removidos
  (`expect(orphan_links).toBe(0)`).
- `test_retire_is_idempotent` (integração): segunda chamada `{commit:true}` retorna
  `expect(report.retired).toBe(0)`.
- `test_retire_emits_typed_event` (unit): tracer stub captura `reextract_noise_retired`
  com `expect(attrs.retired).toBeGreaterThan(0)`.
- `test_cli_retire_requires_explicit_commit` (unit do flag-mapper): sem `--commit` →
  relatório dryRun=true; `--commit` sem `--retire-mechanism` → exit 2.

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- `npx vitest run packages/cli/src/reextract tests/integration/reextract.test.ts` exit 0 (novos casos inclusos).
- `grep -n "reextract_noise_retired" packages/core/src/domain/memory-event.ts` retorna 1 linha (literal registrado).
- Dry-run em DB semeado: `retired === 0` E snapshot de contagens da tabela idêntico antes/depois (assert no teste).

#### DoD
Suites verdes; typecheck/lint; CHANGELOG.

## Phase 2: Execução live + re-benchmark

### T2.1 — Retirement live + queries canônicas finais

#### Objective
Rodar dry-run → `--commit` na base app-dev e re-executar as queries canônicas; anexar ao relatório de benchmark do plano pai.

#### Why this step (action + reasoning — ReAct discipline)
Ação: deploy via CD, `docker exec` do verbo, queries byte-a-byte do baseline. Razão: DoD do
M13 exige números na base live; o relatório de benchmark do plano pai declara este fechamento.

#### Evidence
`knowledge-base/audits/m13-entity-noise-post-backfill-2026-07-23.md` (números pré-retirement + método).

#### Files to edit
- `.claude/knowledge-base/audits/m13-entity-noise-post-backfill-2026-07-23.md`
- `CHANGELOG.md`

#### Deep file dependency analysis
Mesma mecânica operacional do benchmark pai (docker exec no container `themory_app`; psql no
`themem_pgvector`). O deploy carrega o binário novo via CD (push develop).

#### Deep Dives
Edge: retirement colide com escrita de sessão concorrente (entidade mecanismo nova? NÃO —
write path D1 não cria mais mecanismo, comprovado `new_mechanism=0`). Negative: queries pós
ainda >10 → investigar composição de novo e reportar honesto (nunca maquiar).

#### Pseudo-code / Signatures
(operacional: comandos do relatório § Reprodução + `--retire-mechanism --commit --json`.)

#### Tasks
1. Deploy; 2. dry-run (persistir); 3. commit; 4. queries; 5. apêndice no relatório.

#### TDD
- `test_benchmark_final_targets_met` (operacional-determinístico): Given retirement
  executado; When queries canônicas re-executam; Then
  `expect(all_caps_mechanism_live).toBeLessThanOrEqual(10)` E
  `expect(short_mechanism_live).toBeLessThanOrEqual(10)` E
  `expect(anchors_intactas).toBe(true)` (count de âncoras igual antes/depois) — SQL + saída
  coladas no relatório.

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- `SELECT count(*) FROM entities WHERE superseded_by IS NULL AND type IN ('PROPER','COMPOUND','QUOTED')` na base live retorna ≤ 20 (âncoras-alvo não contam: são `superseded_by IS NOT NULL`; sobram só linhas referenciadas por supersede — reportadas).
- Queries de ruído (`name ~ '^[A-Z]{2,}$'` / `length<=3`) restritas a mecanismo vivo retornam ≤ 10 cada — saída SQL colada no apêndice do relatório.
- Contagem de âncoras (`superseded_by IS NOT NULL`) idêntica antes/depois do retirement (evidência no apêndice).

#### DoD
Apêndice commitado; CHANGELOG; números atingidos OU relatório honesto + follow-up.

## Coverage Matrix

| Claim do Goal | Task |
|---|---|
| Unlink + coleta GC via engine testado | T1.1 |
| CLI commit-gated (dry-run default) | T1.1 |
| Evento tipado (Princípio 3) | T1.1 |
| Âncoras de supersede intactas | T1.1 (guarda) + T2.1 (evidência live) |
| Queries canônicas ≤10 na base live | T2.1 |
| Sem SQL manual em base viva | T1.1+T2.1 (todo o caminho é engine+CLI) |

## Dependencies

| Dependência | Versão | Já instalada? | Rule 9 (não reinventar) |
|---|---|---|---|
| (nenhuma nova) | — | — | Reusa `pg` (pool já injetado) + contrato GC #110 já shipped; zero dependência adicionada |

## Drawbacks & Risks

| # | Risco | Severidade | Mitigação | Owner |
|---|---|---|---|---|
| 1 | Deleção física de linhas de entidade (operação destrutiva) | ALTA | Só mecanismo não-âncora (ruído confirmado por reprocessamento completo); dry-run default; `--commit` explícito; evento com contagens; testes de guarda; dado reconstruível por re-extração | executor do M13 |
| 2 | Régua bruta do DoD conta siglas semânticas legítimas | MÉDIA | Fechamento medido no recorte de MECANISMO; as duas leituras (bruta + recorte) coladas no apêndice do relatório — nunca maquiar | executor do M13 |
| 3 | Escritas concorrentes durante o retirement | BAIXA | Write path novo não cria mecanismo (comprovado `new_mechanism=0`); batch tx idempotente re-coleta em re-run | executor do M13 |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Prior Art

- GC de órfãs #110 (`pgvector-store.ts:717-775`) — contrato de coleta + evento.
- Listagem live-only #115; guarda de âncora do plano pai (`fa9cc6c`).
- `themory import claude-code` (M12) — precedente dry-run-default + `--commit`.
- Incidente theo-cloud#252 — por que operação destrutiva exige eco/flag explícita + testes.

## Failure scenarios

- **DB indisponível mid-batch** → tx do batch faz ROLLBACK; erro tipado sobe (exit ≠ 0);
  batches anteriores persistem; re-run coleta o resto (idempotência testada).
- **Timeout de conexão no dry-run** → erro sobe fail-fast; zero escrita por construção.
- **Deploy sem o binário novo** → flag desconhecida → commander exit ≠ 0 (nunca executa
  parcial).

## Test Plan

Unit (flag-mapper + evento) e integração pgvector real (4 casos da task 1.1) via as suites já
existentes do reextract; a task 2.1 é operacional-determinístico com SQL colado no relatório.
Pirâmide respeitada: lógica de seleção/guarda provada na integração (fronteira real), CLI
no unit.
