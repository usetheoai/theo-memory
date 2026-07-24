# Implementation — entity-boost-recall-contribution (M15 / theo-memory#122)

Plan: `.claude/knowledge-base/plans/entity-boost-recall-contribution-plan.md` (v1.1, SHIPPABLE_WITH_CAVEATS 89)
Branch: `develop`. Started 2026-07-24.

## Wiring deferrals (explicit, auditable)

<!-- ADR-DEFER-WIRING-A: T1.1 e T1.2 -->
`matchEntityKeysInQuery` and `countMatchedEntitiesPerMemory` (Phase 1) are pure domain
functions whose production caller is introduced by **T3.1**, per the plan's own phasing —
Phase 1 builds the matching logic, Phase 3 wires it into `pipeline.ts` Step 6.

At T1.1/T1.2 commit time `check_wiring.py` reports pillar (a) FAIL with zero production
callers. That is the truthful state and it is recorded here rather than papered over with a
no-op call, which the wiring gate exists precisely to catch.

Closure condition: **T3.1 MUST bring pillar (a) to PASS for both symbols.** The
post-halt-loop `run_validation.py` re-derives symbols from the committed diffs and re-runs
`check_wiring.py` independently, so a Phase 1 symbol left permanently uncalled fails the
handoff gate. This deferral is therefore bounded by a gate, not by trust.

<!-- ADR-DEFER-WIRING-B: T1.1 e T1.2 -->
Same rationale for pillar (b): the integration test that exercises these functions through a
real boundary is `tests/integration/entity-boost/ranking.test.ts`, created by T3.2. Unit
coverage is complete at Phase 1 (8 + 3 assertions); the boundary test follows the caller.

## Deviation from the plan's T1.1 Deep dive (recorded, not silent)

The plan's T1.1 Deep dive prose said the entity key would have its underscore reverted to a
space before comparison. Implementing that literally makes two of the task's own RED tests
mutually unsatisfiable: reverting `user_id` to `user id` stops it matching the query "o campo
user_id está nulo", while `são_paulo` needs the reversion to match "moro em São Paulo".

The `_` produced by `normalizeEntityKey` is ambiguous once written — it encodes both "was a
space" and "was a literal underscore" — so rewriting it back is lossy in the wrong direction.

The implementation inverts the direction instead: the **query** is normalized into the key's
alphabet with the same `normalizeEntityKey`, and `_` is treated as a word boundary. Both
cases then hold, and the normalization rule keeps a single authoritative representation,
which is what plan ADR D3 actually requires. The plan's TDD section — the binding contract —
is satisfied in full. Surfaced by the SEPA pre-RED consultation.

## Phase 1 boundary mini review — PHASE_REVIEW_NEEDS_FIX (2026-07-24)

Report: `.claude/knowledge-base/mini-reviews/entity-boost-recall-contribution-phase1-review-2026-07-24.md`.
Two HIGH findings. Both are recorded honestly rather than worked around.

**`wiring_pillar_a_fail` — real, known, bounded.** `matchEntityKeysInQuery` and
`countMatchedEntitiesPerMemory` have no production caller yet. This is the deferral declared
above, and it is a genuine consequence of the plan's phasing: the caller is T3.1, which
cannot run before the Phase 2 port supplies the linked keys. Until then the two symbols are,
accurately, uncalled exports. The finding is NOT dismissed — it is scheduled, and its closure
is enforced by two independent gates: the Phase 3 boundary mini review, and
`run_validation.py`, which re-derives symbols from the committed diffs and re-runs
`check_wiring.py` at handoff. If T3.1 fails to wire them, the handoff fails.

**`scope_drift` — gate calibration, not a violation.** The flagged file is
`entity-boost-recall-contribution-implementation.md`, this very document, which the halt-loop
driver mandates as the implementation working contract. The check compares modified files
against each task's `#### Files to edit` and has no allowance for the loop's own bookkeeping
artifact (`CHANGELOG.md` is allowed; this file is not). No production source outside the
declared scope was touched — the Phase 1 commits contain exactly
`entity-query-match.ts`, `entity-query-match.test.ts` and `CHANGELOG.md`.

Neither finding is a reason to weaken a test or fabricate a caller. Phase 2 proceeds; the
Phase 3 boundary is where the wiring finding must genuinely clear.

## Task log

| Task | Status | Commit | Wiring (a/b/c) | Note |
|---|---|---|---|---|
| T1.1 | committed | `94cc7d8` | defer→T3.1 / defer→T3.2 / n/a | 10 unit tests green (8 do plano + 2 pedidos pelo SEPA: ocorrência não-fronteiriça e chave vazia que travaria o laço) |
| T1.2 | committed | `cc0396e` | defer→T3.1 / defer→T3.2 / n/a | 14 testes verdes no arquivo; casamento por chave distinta, não por memória |

### File-size note

T1.1's acceptance criterion budgeted the file under 120 lines and it was 95 at T1.1 commit
time. T1.2 legitimately adds a second function to the same file, per its own declared
`#### Files to edit`, taking it to 139. The two functions are one cohesive concern
(query↔entity matching); splitting them to satisfy a per-task budget measured after a later
task would be the kind of structure-for-the-metric the parsimony ladder warns against.
Recorded rather than silently passed.

## Phase 2 + T3.1 (2026-07-24)

| Task | Status | Commit | Wiring (a/b/c) | Note |
|---|---|---|---|---|
| T2.1 + T2.2 | committed | `a1c85e8` | defer→T3.1 / pass / n/a | Um commit só: um método OBRIGATÓRIO na interface não pode ser commitado sem seu implementador sem deixar o typecheck vermelho, e "suíte verde antes do commit" é gate por iteração. 13 dublês atualizados em 7 arquivos. 5 testes de integração contra Postgres real, incluindo a prova de que 20 candidatos custam **1** consulta |
| T2.3 | committed | (ver git log) | n/a / pass / n/a | Nenhuma migration: a PK `(memory_id, entity_id)` já tem `memory_id` como coluna líder |
| T3.1 | committed | `c5f66b0` | **pass** / defer→T3.2 / pass | Fecha a deferral da Fase 1 |

### Duas correções ao desenho dos meus próprios testes

**T2.3 — o teste estava errado, não o código.** A primeira versão proibia `Seq Scan on
memory_entities` na consulta inteira. Errado: quando o outro lado da junção é amplo o planner
legitimamente faz hash, e proibir isso testaria o gosto do planner, não a cobertura de índice.
Depois, com 3000 linhas, o planner escolhia seq scan e estava **certo** (custo 68 sobre ~13
páginas). O risco que a task guarda é degradação em **escala**, então a semeadura subiu para
50k, onde o índice de fato vence. O plano real do Postgres foi consultado antes de concluir.

**T3.1 — o stub de tracer não batia com a API.** `emitEvent` usa `startActiveSpan`, não
`startSpan`. O teste falhava por defeito do dublê, não do código.

### Elo de produção da T3.1

Além do Step 6, `scoped-retrieval.ts` passa a porta nos **dois** call sites do pipeline (com e
sem cache). Sem isso o boost existiria no pipeline e nunca rodaria para um usuário real —
seria o #122 numa camada acima.

### Dívida pré-existente exposta pelo gate (fora de escopo, rastreada)

`pipeline.ts` tem 729 linhas contra o teto de 300 do `check_quality.py`, e
`runRetrievalPipeline` sozinha tem 293. O hook é `PostToolUse` e checa o arquivo inteiro, então
qualquer edição no pipeline dispara bloqueio. Conformidade total exigiria decompor o caminho de
leitura mais crítico do produto dentro de uma task de feature — exatamente como se introduz um
bug sutil de ranking. Registrado em **#124** com as fronteiras de extração já mapeadas, para ser
tratado como cycle próprio. Os 4 blocos duplicados que o hook aponta (linhas 197, 354, 481, 589)
são todos anteriores ao M15.

Precedente do repo para dívida pré-existente registrada e não corrigida na hora:
`pgvector-store.ts` (1344 linhas), `run-mcp-server.ts` (433), `handlers.test.ts` (521).

## Phase 3 + T4.1 benchmark (2026-07-24)

| Task | Status | Wiring (a/b/c) | Note |
|---|---|---|---|
| T3.2 + T3.3 | committed | pass / pass / pass | 4 asserções contra Postgres real |
| T3.4 | committed | n/a | comentário corrigido + sentinela |
| T4.1 | committed | n/a / pass / n/a | benchmark determinístico |

### O resultado medido

| Métrica | Valor |
|---|---|
| precision@1 sem boost | 0.64–0.68 (faixa; ver abaixo) |
| precision@1 com boost | **1.00** |
| delta | **+0.32 a +0.36** |
| `recall_set_churn` (pós-threshold) | **0** |
| `boostedCandidateCount` | medido de forma **estrutural** (ver correção do /review) |

Documento com método e ressalvas: `docs/benchmarks/entity-boost-m15.md`. Bruto:
`docs/benchmarks/entity-boost-m15.json`.

**Correção de honestidade (2026-07-24).** A primeira versão desta seção publicava valores
pontuais (0.64 / +0.36 / 9) e afirmava reprodução exata. A segunda execução do benchmark
desmentiu: baseline 0.68, delta +0.32, contagem 8. Sem o boost os candidatos de um tópico
empatam exatamente e a ordem entre empatados é decidida pela ordem física das linhas no
Postgres, que não é estável entre execuções. O lado que importa — com boost — é estável em
1.00. A leitura honesta é uma faixa.

### Três honestidades sobre o benchmark

1. **A base não é o piso de desempate aleatório** (~0.25 com quatro empatados). A memória
   relevante é inserida primeiro em cada tópico e isso parece enviesar o desempate a favor
   dela. O efeito é conservador: eleva a base e encolhe o delta, então a faixa reportada é
   **limite inferior**.
2. **`boostedCandidateCount` é 9, não 25.** O boost mudou o resultado nos 9 tópicos onde a
   relevante ainda não estava em primeiro por sorte de desempate; nos outros 16 confirmou uma
   posição já correta. A asserção existe para que um boost morto não passe calado — que é
   exatamente o defeito do #122.
3. **Não é comparação com outro sistema.** É medição interna antes/depois. `public-copy.md` § 4
   exige reprodução independente para claim comparativo, e este benchmark não a tem.

### Desvio registrado em T3.2

O plano pedia asserção sobre `trace.components.entity`. O recall trace grava uma linha por
candidato **descartado** (accountable forgetting), então uma memória **mantida** não tem linha
de trace, e a asserção como escrita era impossível. Substituída pela diferença de score sobre o
mesmo controle de embeddings idênticos, que prova a mesma coisa.

### Aviso de lint pré-existente corrigido

`packages/cli/src/reextract/run-reextract.ts` carregava um aviso de espaçamento de import
anterior a este cycle (último commit do arquivo é do M13). O DoD exige zero avisos; a correção
é whitespace, risco zero, registrada aqui por tocar arquivo fora do escopo declarado.

## DoD do ROADMAP M15 — item a item, com evidência

| # | Item do DoD | Estado | Evidência |
|---|---|---|---|
| 1 | `entityBoostById` populado no Step 6 a partir de `entities` + `memory_entities`, scoped, zero vazamento cross-scope | **feito** | `entity-boost-step.ts` + `pipeline.ts` Step 6; `linked-keys.test.ts` prova que workspace estrangeiro não retorna vínculo |
| 2 | Boost aditivo, roda DEPOIS do gate semântico; teste provando que sub-threshold NÃO é ressuscitado | **feito** | `ranking.test.ts::test_sub_threshold_candidate_is_not_resurrected_by_boost` — a memória irrelevante **é** candidata (a busca devolve as 3) e cai no threshold |
| 3 | Normalização na mesma escala do BM25 (sigmoid) antes do `ENTITY_BOOST_WEIGHT` | **divergência registrada** | ver abaixo |
| 4 | Benchmark obrigatório: precisão@k COM e SEM boost, delta registrado | **feito** | `docs/benchmarks/entity-boost-m15.md` — 0.64–0.68 → 1.00, churn 0, custo +6,2 ms/busca |
| 5 | Comentário-guarda de `recall-trace-store.ts` atualizado | **feito** | T3.4 + sentinela `recall-trace-entity-comment.test.ts` |
| 6 | Custo controlado: sem round-trip não-bounded; medir latência antes/depois | **feito** | 1 consulta para 20 candidatos (`linked-keys.test.ts`); índice servido a 50k linhas (`query-plan.test.ts`); latência por query no JSON do benchmark, com asserção de teto |
| 7 | ADR-0007 revisitado | **feito** | ADR-0023 — a flag passa a governar os dois lados; `CLAUDE.md` atualizado |

### Item 3 — a divergência, e por que ela fica registrada em vez de corrigida

O DoD pedia normalização por **sigmoid**. A implementação usa `entityBoost(numLinked)`, que já
normaliza — o resultado é limitado a `[0, ENTITY_BOOST_WEIGHT]`, e `maxPossible` soma
exatamente esse teto — mas por **atenuação de espalhamento**, não por sigmoid. O ADR D1 do
plano decidiu explicitamente não alterar `scoring.ts`, e o benchmark confirma que a intenção do
item (o componente não domina a soma) está satisfeita: o teto do boost é 0.5 contra 1.0 de cada
um dos outros dois sinais.

Ao verificar isso encontrei algo pior que a divergência de forma. A curva é **decrescente**:

| `numLinked` | boost |
|---|---|
| 1 | 0.5000 |
| 3 | 0.4980 |
| 10 | 0.4625 |

Uma memória que casa três entidades da query recebe *menos* impulso que uma que casa uma. A
fórmula veio de outra semântica de `numLinked` — "quantas entidades esta memória tem no total",
onde a penalidade faz sentido porque memória ligada a 40 entidades é genérica. O M15 passou a
alimentá-la com a **interseção** query↔memória, onde mais deveria ser melhor.

Na faixa realista o efeito é ínfimo (0.500 contra 0.498), o boost se comporta como binário, e é
por isso que o ganho medido é real. Não há bug observável hoje. Mas é imprecisão semântica que
vai incomodar quando alguém quiser diferenciar "casou 1" de "casou 5", então está registrada em
**#125** com as duas direções de correção e o mesmo gate do M15: sem ganho medido, não muda.

## T4.2 — validação final consolidada (2026-07-24)

### Resultado das suítes

| Suíte | Resultado |
|---|---|
| `npm test` (contract) | **1340 passed**, 1 skipped, **0 erros de tipo** |
| `npm run test:integration` | **618 passed**, 56 skipped, **4 failed** — ver abaixo |
| `npm run lint` | **0 erros, 0 avisos** |
| `npm run typecheck` | **0 erros** |

### As 4 falhas de integração são ambientais, com prova

Todas em `tests/integration/entity-label-language-determinism.test.ts`:

```
× an English input persists English entity labels (not translated to Portuguese)
× a Portuguese input persists Portuguese entity labels (not translated to English)
× a Portuguese input persists a Portuguese fact (not translated to English)
× an English input persists an English fact (not translated to Portuguese)
```

O arquivo declara na própria cabeçalho: *"This is an LLM-behavioral property, so it uses a REAL
OpenAI LLM (a stub would prove nothing about real label-following)"*, e roda sob
`describe.skipIf(ROOT_PG_URI === '' || !HAS_KEY)`.

A chave existe no `.env` — então o `skipIf` não pula — mas **está inválida**:

```
curl -s -o /dev/null -w "%{http_code}" https://api.openai.com/v1/models -H "Authorization: Bearer $KEY"
→ 401
```

O M15 não toca extração, tradução nem o caminho de LLM. A relação é: chave presente porém
inválida faz o `skipIf` não pular e as chamadas falharem. Corrigir isso é rotacionar a chave,
não mudar código deste milestone.

### Uma invocação errada minha, corrigida

A primeira tentativa de "suíte completa" usou `npx vitest run` sem config, que varre 511
arquivos misturando contract, integration e e2e — resultado: 293 arquivos falhando, que eu
poderia ter reportado como catástrofe. O repo tem três configs separados
(`vitest.contract.config.ts`, `vitest.integration.config.ts`, `vitest.e2e.config.ts`) e é assim
que o CI roda. Com o comando certo, os números acima.

### Sentinela que fez o trabalho dela

`memory-event.test.ts` falhou exigindo 48 eventos quando a união passou a ter 49. Não é ruído:
é o gate que força reconhecimento explícito quando a união tipada `MEMORY_EVENTS` cresce.
Atualizada para 49 com o nome do evento novo na descrição.

## Next task

**T3.2** — the ranking integration test at `tests/integration/entity-boost/ranking.test.ts`:
two semantically equivalent memories, one linked to the query's entity, asserting RELATIVE
POSITION (not set membership) against real Postgres. It also closes the last wiring deferral
(pillar b) for the three Phase 1/3 symbols.

Environment note for the next iteration: integration tests need `THEOMEM_PG_URI`. The
project's own container is up on port 5442 —
`export THEOMEM_PG_URI="postgres://themem:themem@localhost:5442/themem"`. Do NOT point at
`therag_pgvector` (port 5433): that instance belongs to a sibling project and
`createIsolatedDb` creates databases in whatever server it is given.

Also note: tests import `@usetheo/memory`, which resolves to `dist/`. After changing
`packages/core/src`, run `npm run build` or the integration tests exercise stale code.
