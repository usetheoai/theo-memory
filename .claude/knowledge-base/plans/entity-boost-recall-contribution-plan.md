---
slug: entity-boost-recall-contribution
milestone_id: M15
created_at: 2026-07-24
goal: Ligar o terceiro sinal do recall híbrido (entity boost) ao ranking, com ganho provado por benchmark determinístico e sem regressão do conjunto recuperado.
---

# Plan: entity-boost-recall-contribution (M15 — theo-memory#122)

- **Version:** 1.1 (v1.1 absorve 4 MUST FIX de `/edge-case-plan` — EC-1 metacaractere de regex, EC-2 definição de churn, EC-3 degradação observável, EC-4 workspace ausente)
- **Slug:** `entity-boost-recall-contribution`
- **Milestone:** M15 (`ROADMAP.md`) — tracked theo-memory#122
- **Blueprint:** `.claude/knowledge-base/discoveries/blueprints/entity-boost-recall-contribution-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89)

## Goal

Popular `entityBoostById` no Step 6 do pipeline de recall a partir do grafo de entidades já persistido, de modo que uma memória ligada às entidades mencionadas na query ranqueie acima de uma memória equivalente sem esse vínculo — com o ganho **medido** (precision@k) e com o conjunto recuperado **provadamente não-regredido**.

Sucesso é observável por três números, todos produzidos por um benchmark determinístico versionado:

1. `precision_at_k` com boost ≥ `precision_at_k` sem boost (delta registrado, positivo ou honestamente zero).
2. `recall_set_churn` = número de memórias que estavam no resultado sem boost e sumiram com boost. Alvo: `0`.
3. `boosted_candidate_count` > 0 no cenário do benchmark (prova que o sinal está vivo — o oposto do bug #122).

`recall_set_churn` é medido sobre o conjunto **pós-threshold e pré-topK** (EC-2). Medi-lo sobre o resultado final truncado seria insatisfazível por construção: promover uma memória ligada para dentro do topK necessariamente empurra outra para fora, e esse é o efeito desejado da feature, não a regressão que D2 quer vigiar.

## Baseline Context

Estado do repositório na abertura do plano: branch `develop`, HEAD `80f79fb`.

### Files that will be touched

| Arquivo | LoC | Último commit | Papel neste plano |
|---|---|---|---|
| `packages/core/src/domain/retrieval/pipeline.ts` | 707 | `ce2cda8` | Step 6 (linhas 451-452) cria o `Map` vazio — o alvo |
| `packages/core/src/domain/scoring.ts` | 101 | `23e97f8` | `entityBoost`, `maxPossible`, `combineScores` — pronto e ocioso |
| `packages/core/src/domain/dip/memory-entity-store.ts` | 128 | `ac46d58` | Porta DIP do grafo (4 métodos hoje) |
| `packages/core/src/infrastructure/db/pg-memory-entity-store.ts` | 274 | `70ca1e1` | Implementação Postgres da porta |
| `packages/core/src/domain/dip/recall-trace-store.ts` | 197 | `0558ee6` | Linha 46 instrui a NÃO ler sinal da coluna `entity` |
| `packages/core/src/domain/extraction/entity-linking.ts` | — | — | `normalizeEntityKey` (linha 49) — a normalização do write path |
| `packages/core/src/domain/lemmatization.ts` | — | — | `lemmatizeForBm25` (linha 90) — a normalização do BM25 |

### Current callers / dependents

`Memory.recall` → `runRetrievalPipeline` (`pipeline.ts`) → Step 3 `vectorStore.search(queryVector, internalLimit, filters)` → Step 4/5 `vectorStore.keywordSearch` + `sigmoidBm25` → **Step 6 (morto)** → Step 7 monta o `candidates` Map → Step 8 threshold → top-K → MMR opcional.

O `internalLimit` é `Math.max(topK * 4, 60)` (`pipeline.ts:433`) — este é o limite superior do conjunto de candidatos e, portanto, o limite da consulta nova deste plano.

### Domain glossary

- **numLinked** — quantas entidades mencionadas na query estão ligadas a uma dada memória.
- **conjunto pós-threshold** — os candidatos que sobreviveram ao gate do Step 8, antes do corte de topK. É sobre ele que o churn é medido.
- **normalized_key** — chave canônica de uma entidade, produzida por `normalizeEntityKey`.
- **over-fetch set** — o conjunto de candidatos devolvido por semantic ∪ BM25 antes do threshold (≤ 2 × `internalLimit`).
- **recall_set_churn** — memórias presentes no resultado sem boost e ausentes com boost.

### Architecture boundaries affected

Por `.claude/rules/architecture.md` § 2, o domínio declara a porta e a infraestrutura implementa. O casamento query↔entidade é lógica de domínio (função pura, testável sem banco); o acesso ao grafo entra pela porta `MemoryEntityStore` já existente. O domínio não importa o adaptador pg.

## Prior Art

- **Interno:** `.claude/knowledge-base/discoveries/blueprints/entity-boost-recall-contribution-blueprint.md` — suas quatro decisões fecham combinação, normalização, posição do gate e métrica. As decisões deste plano abaixo consomem aquelas conclusões.
- **Externo (lido no discover):** `graphiti` — `node_distance_reranker` e `episode_mentions_reranker` em `.claude/knowledge-base/references/graphiti/graphiti_core/search/search_utils.py`. O blueprint concluiu que o mecanismo deles **substitui** o score do retriever e que a contagem de menções é usada **crua**; ambos rejeitados para o nosso modelo aditivo.
- **Interno:** o sigmoid do BM25 (`scoring.ts:33`) é o precedente de normalização já aceito no projeto — `entityBoost` (`scoring.ts:45`) segue a mesma disciplina com atenuação por espalhamento.

## Coverage Matrix

Toda afirmação do Goal mapeada para ≥ 1 task.

| # | Afirmação do Goal | Task(s) | Coberto? |
|---|---|---|---|
| C1 | Popular `entityBoostById` no Step 6 | T3.1 | sim |
| C2 | A partir do grafo já persistido | T2.1, T2.2 | sim |
| C3 | Memória ligada ranqueia acima da não-ligada | T3.2 | sim |
| C4 | Ganho medido por precision@k | T4.1 | sim |
| C5 | Conjunto recuperado não-regredido (`recall_set_churn`) | T4.1, T3.3 | sim |
| C6 | Boost não ressuscita candidato sub-threshold | T3.3 | sim |
| C7 | Casamento query↔entidade correto (diacrítico + multi-palavra) | T1.1, T1.2 | sim |
| C8 | Consulta única e limitada (sem N+1) | T2.2, T2.3 | sim |
| C9 | Coluna `entity` do trace passa a ser significativa | T3.4 | sim |

100% das afirmações mapeadas; nenhuma diferida.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `pg` | `^8.13.0` | npm | Driver já usado por `pg-memory-entity-store.ts`; a consulta nova entra no mesmo pool |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | | | Avaliado: nenhuma dependência nova é necessária. O blueprint confirmou que o caminho de scoring do `graphiti` não puxa dependência além de numpy para MMR, que já temos resolvido internamente. Normalização de string é `String.prototype` nativo (degrau 2 da escada de parcimônia). | n/a |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## ADRs

### D1 — Manter `combineScores` e `maxPossible` intocados

**Decisão:** não alterar `scoring.ts`. O denominador continua somando `ENTITY_BOOST_WEIGHT` quando o sinal entity está ativo, exatamente como já está codificado.

**Rationale:** o trabalho do M15 é **popular o mapa**, não redesenhar o score. A fórmula aditiva já foi portada, documentada e testada; mexer nela é retrabalho especulativo. A escada de parcimônia (`.claude/rules/parsimony-ladder.md`, degrau 1) diz que o código mais barato é o que não se escreve.

**Consequência conhecida e assumida:** quando o sinal entity liga, o denominador vai de 2.0 para 2.5 e o score de todo candidato **sem** vínculo cai 20% em termos absolutos. Isso pode empurrar um candidato para baixo do threshold final. Esse efeito é **medido** por `recall_set_churn` em T4.1, não presumido — ver D2.

**Alternativas rejeitadas:**

- **Somar entity só no numerador, mantendo o denominador sem entity, com clamp em 1.0.** Rejeitada: satura o topo. Vários candidatos bons grudam em 1.0 e perdem discriminação exatamente onde ela mais importa.
- **Forma de headroom `final = base + (1 - base) * boost`.** Rejeitada: é monótona e não satura, mas abandona o modelo aditivo que o primeira decisão do blueprint (modelo aditivo preservado) mandou preservar, e introduz uma fórmula sem prova em produção.
- **Dois scores (um para o gate, outro para a ordenação).** Rejeitada: devolve ao consumidor um score inconsistente com o threshold que ele pediu.

### D2 — O benchmark mede churn do conjunto, não só precision@k

**Decisão:** o benchmark reporta `precision_at_k` (com e sem boost) **e** `recall_set_churn`, este último medido sobre o conjunto pós-threshold e pré-topK.

**Rationale:** D1 aceita conscientemente um efeito de renormalização. Aceitar sem instrumentar seria decidir no escuro. `recall_set_churn` é o instrumento que transforma o risco em número: se for `0`, o efeito não se materializa no cenário medido; se for `> 0`, temos dado para revisitar D1 com evidência em vez de especulação.

**Alternativas rejeitadas:**

- **Medir só precision@k.** Rejeitada: precision@k pode subir enquanto o sistema silenciosamente descarta resultados válidos; a métrica sozinha mascara a regressão.
- **Medir churn sobre o resultado final (pós-topK).** Rejeitada por EC-2: o corte de topK faz com que qualquer promoção bem-sucedida expulse o último colocado, produzindo churn positivo pelo sucesso da feature. O alvo `0` seria inalcançável e forçaria enfraquecer o teste, o que `.claude/rules/cycle-implement.md` proíbe.
- **LLM-as-judge sobre LongMemEval, como o `graphiti` faz.** Rejeitada pelo decisão do blueprint sobre a métrica: caro, não determinístico, e não isola a contribuição do boost.

### D3 — Casamento query↔entidade no domínio, sem chamada de LLM no recall

**Decisão:** a resolução das entidades mencionadas na query é uma **função pura de domínio** que normaliza o texto da query com a mesma regra do write path e testa contenção das `normalized_key` dos candidatos.

**Rationale:** medido no baseline, as duas normalizações existentes são incompatíveis. `normalizeEntityKey` produz `são_paulo` (diacrítico preservado, multi-palavra unida por underscore); `lemmatizeForBm25` produz `["s","o","paulo"]` (o split por `\W+` quebra o diacrítico e o Porter stemmer altera o radical). Casar token de BM25 contra `normalized_key` **nunca daria match** — o boost ligaria e continuaria zero, reproduzindo o bug #122 numa forma nova e mais difícil de enxergar. A normalização precisa ser a do write path, aplicada ao texto bruto da query, com suporte a entidade multi-palavra.

**Alternativas rejeitadas:**

- **Extrair entidades da query com o LLM.** Rejeitada: adiciona uma chamada de rede ao caminho quente de leitura. O write path já pagou esse custo; pagá-lo de novo por recall é inaceitável para latência.
- **Busca vetorial sobre os embeddings de entidade.** Rejeitada: adiciona uma segunda consulta ANN por recall para resolver um problema que casamento textual resolve.
- **Reusar `lemmatizeForBm25` nos dois lados.** Rejeitada: destruiria diacríticos nas chaves persistidas e exigiria migração de `entities.normalized_key`, além de quebrar entidades multi-palavra.

### D4 — Uma consulta limitada, partindo dos candidatos

**Decisão:** a porta devolve os vínculos de entidade **dos candidatos**, em uma consulta única com `memory_id = ANY($ids)`.

**Rationale:** o conjunto de candidatos já está limitado por `internalLimit` (`pipeline.ts:433`) e já passou pelo filtro de escopo e de `t_invalid` na busca vetorial. Partir dele torna a consulta pequena, indexada e correta por construção. Uma consulta por candidato (N+1) multiplicaria round-trips por até 120 no caminho quente. Varrer a tabela `entities` do escopo para casar contra a query seria uma varredura sem limite superior.

**Alternativas rejeitadas:**

- **N+1: uma consulta por candidato.** Rejeitada: até 120 round-trips por recall.
- **Casar as chaves no SQL com `LIKE`.** Rejeitada: varredura da tabela de entidades do escopo, sem limite superior, e joga lógica de domínio para dentro do adaptador.

### D5 — Novo método na porta DIP existente

**Decisão:** adicionar um quinto método a `MemoryEntityStore` em vez de criar uma porta nova.

**Rationale:** a responsabilidade é a mesma da porta atual (acesso ao grafo de entidades). Criar uma porta nova com um método só para o mesmo agregado viola coesão e multiplica dublês de teste sem ganho.

**Alternativas rejeitadas:**

- **Porta nova `EntityBoostStore`.** Rejeitada: interface com um método sobre o mesmo agregado; ISP não pede isso quando o consumidor já depende da porta inteira.
- **Domínio importando o adaptador pg direto.** Rejeitada: viola `.claude/rules/architecture.md` § 2.

## Phase 1 — Casamento query↔entidade (domínio puro)

### T1.1 — Normalizar a query com a regra do write path

#### Files to edit

- `packages/core/src/domain/retrieval/entity-query-match.ts` (novo)
- `packages/core/src/domain/retrieval/entity-query-match.test.ts` (novo)

#### Why this step

Sem uma normalização compatível com `normalizeEntityKey`, todo o resto do plano produz zero. Este é o degrau que decide se a feature nasce viva ou morta.

#### Deep dive

`normalizeEntityKey` (`entity-linking.ts:49`) faz `trim().toLowerCase().replace(/\s+/g,'_')`. Diacríticos são preservados; espaços viram underscore. Para casar, a query passa pela mesma minúscula e colapso de espaço, e a chave da entidade tem o underscore revertido para espaço antes da comparação, de modo que uma entidade multi-palavra case contra a sequência correspondente no texto.

A comparação é por contenção de sequência de palavras, com fronteira de palavra, para que `paul` não case com `paulo`.

**A fronteira é verificada por índice, nunca por regex construída a partir da chave (EC-1).** As `normalized_key` vêm de nomes emitidos pelo LLM, e num acervo de desenvolvimento `C++`, `F#`, `.NET` e `A*` são nomes ordinários. `normalizeEntityKey("C++")` produz `c++`, e `new RegExp('c++')` lança `SyntaxError: Nothing to repeat` — uma exceção no caminho quente de leitura que derrubaria o `recall` inteiro por causa de uma única memória no acervo. A busca é feita com `indexOf` e a fronteira é checada nos caracteres adjacentes.

#### TDD

RED: test_entity_key_with_regex_metacharacters_does_not_throw — dado a chave `c++` e a query "eu escrevo em C++", expect(() => matchEntityKeys(query, keys)).not.toThrow() e expect(matchedKeys).toContain('c++').

RED: test_normalized_query_matches_single_word_entity_key — dado a query "quem é o Paulo" e a chave `paulo`, expect(matchedKeys).toContain('paulo').

RED: test_empty_query_matches_no_entity_key — dado `""` e `"   "`, expect(matchedKeys).toHaveLength(0). Uma contenção ingênua faria a string vazia casar com toda chave, dando boost a todo candidato.

RED: test_entity_key_with_literal_underscore_still_matches — dado a chave `user_id` e a query "o campo user_id está nulo", expect(matchedKeys).toContain('user_id').

RED: test_normalized_query_matches_multi_word_entity_key — dado a query "moro em São Paulo desde 2020" e a chave `são_paulo`, expect(matchedKeys).toContain('são_paulo'). Este é o caso que a lematização do BM25 jamais resolveria.

RED: test_diacritics_are_preserved_in_matching — dado a query "conheço são paulo" e a chave `são_paulo`, expect(matchedKeys).toContain('são_paulo'); e dado a chave `sao_paulo` sem diacrítico, expect(matchedKeys).not.toContain('sao_paulo').

RED: test_partial_word_does_not_match — dado a query "paul mccartney" e a chave `paulo`, expect(matchedKeys).toHaveLength(0).

RED: test_case_is_ignored — dado a query "PAULO" e a chave `paulo`, expect(matchedKeys).toContain('paulo').

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `npm test -- entity-query-match` sai com exit code 0 e os 8 testes REDs desta task passam.
- A função é pura: `grep -cE "await|import .*(pg|fs)" entity-query-match.ts` returns 0.
- `wc -l entity-query-match.ts` reports < 120.

### T1.2 — Contar vínculos por memória

#### Files to edit

- `packages/core/src/domain/retrieval/entity-query-match.ts`
- `packages/core/src/domain/retrieval/entity-query-match.test.ts`

#### Why this step

`entityBoost(numLinked)` precisa de um inteiro por memória. Esta é a função que converte o mapa de vínculos em contagem, e é onde a atenuação por espalhamento passa a ter significado.

#### Deep dive

Entrada: o texto da query e um mapa `memoryId → chaves ligadas`. Saída: `memoryId → numLinked`, contendo **apenas** as memórias com `numLinked > 0`, para que `entityBoostById.size > 0` continue sendo o predicado honesto de "o sinal contribuiu" que o `pipeline.ts:480` já usa.

Chaves repetidas para a mesma memória contam uma vez — a contagem é de entidades distintas mencionadas, não de ocorrências.

#### TDD

RED: test_counts_distinct_matched_entities_per_memory — dada uma memória ligada a `paulo` e `são_paulo` e uma query que menciona ambos, expect(counts.get('m1')).toBe(2).

RED: test_memory_with_no_matched_entity_is_absent_from_map — dada uma memória ligada só a `berlim` e uma query sobre Paulo, expect(counts.has('m2')).toBe(false).

RED: test_duplicate_key_counts_once — dada uma memória cujas chaves ligadas contêm `paulo` duas vezes, expect(counts.get('m1')).toBe(1).

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `npm test -- entity-query-match` sai com exit code 0 incluindo os 3 REDs desta task.
- Memória sem vínculo casado: a asserção `expect(counts.has('m2')).toBe(false)` passa.

## Phase 2 — Porta DIP e implementação Postgres

### T2.1 — Declarar o método na porta

#### Files to edit

- `packages/core/src/domain/dip/memory-entity-store.ts`

#### Why this step

O domínio declara o contrato antes de qualquer SQL existir, conforme `.claude/rules/architecture.md` § 2.

#### Deep dive

Assinatura: recebe `memoryIds` e `workspaceId`; devolve `ReadonlyMap<string, readonly string[]>` de `memoryId` para as `normalized_key` ligadas. O `workspaceId` entra como defesa em profundidade — os ids já vieram filtrados por escopo pela busca vetorial, mas a porta não depende disso.

Lista vazia de ids devolve mapa vazio sem tocar o banco.

#### TDD

RED: test_port_contract_is_declared — expect(typeof store.linkedKeysForMemories).toBe('function') no dublê de teste da porta, garantindo que todo implementador satisfaz o contrato.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `npm run typecheck` sai com exit code 0 com o método declarado.
- `npm test` sai com exit code 0 após atualizar todos os dublês da porta.

### T2.2 — Implementar em Postgres com uma consulta única

#### Files to edit

- `packages/core/src/infrastructure/db/pg-memory-entity-store.ts`

#### Why this step

É onde D4 vira código: um round-trip, limitado pelos candidatos.

#### Deep dive

`SELECT me.memory_id, e.normalized_key FROM memory_entities me JOIN entities e ON e.id = me.entity_id WHERE me.memory_id = ANY($1) AND e.workspace_id = $2`.

O `ANY($1)` recebe o array de ids dos candidatos. O agrupamento em mapa acontece em memória, sobre um resultado limitado por construção.

Guarda de entrada: array vazio retorna cedo, sem `pool.connect()`.

**Workspace ausente normaliza para `'default'` (EC-4)**, coerente com a guarda de isolamento já presente em `local-memory.ts`. Deixar `undefined` chegar ao `=` do SQL faria a comparação com NULL não casar nada e devolver zero vínculo **sem erro** — exatamente a classe de falha silenciosa que este plano existe para fechar.

#### TDD

RED: test_absent_workspace_resolves_to_default_scope — com `workspaceId` ausente, expect(result.size).toBeGreaterThan(0) para vínculos semeados no workspace default.

RED: test_returns_linked_keys_for_candidate_memories — contra `ankane/pgvector:v0.5.1` real, semear duas memórias com entidades e expect(result.get(memoryId)).toContain('paulo').

RED: test_empty_id_list_does_not_touch_the_pool — expect(result.size).toBe(0) e o espião do pool não registra conexão.

RED: test_foreign_workspace_rows_are_not_returned — semear a mesma entidade em outro workspace e expect(result.has(foreignMemoryId)).toBe(false).

RED: test_single_query_for_many_candidates — com 20 ids, expect(queryspy.mock.calls).toHaveLength(1), provando ausência de N+1.

#### Concurrency tests

(none — single-threaded)

#### Failure scenarios

Ver a seção `## Failure scenarios` — timeout e queda de conexão são tratados lá.

#### Acceptance criteria

- `npm test -- pg-memory-entity-store` sai com exit code 0 contra `ankane/pgvector:v0.5.1`.
- Uma única consulta: a asserção `expect(querySpy.mock.calls).toHaveLength(1)` passa com 20 candidatos.

### T2.3 — Índice de suporte

#### Files to edit

- `packages/core/src/infrastructure/db/migrations/` (nova migration)

#### Why this step

`memory_id = ANY(...)` sobre `memory_entities` precisa de índice para não virar sequential scan quando a tabela crescer.

#### Deep dive

Verificar primeiro se `memory_entities` já tem índice em `memory_id` — se tiver, esta task não escreve migration nenhuma e registra a constatação (degrau 1 da escada de parcimônia). Se não tiver, criar índice.

#### TDD

RED: test_query_plan_uses_index_scan — rodar `EXPLAIN` na consulta de T2.2 e expect(plan).toMatch(/Index Scan|Bitmap/), não `Seq Scan`.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `EXPLAIN` da consulta de T2.2 returns um plano que contains `Index Scan` ou `Bitmap`, e não `Seq Scan`.
- Índice pré-existente: a task fecha sem migration e o log de implementação contains a evidência do `EXPLAIN`.

## Phase 3 — Wiring no pipeline

### T3.1 — Popular `entityBoostById` no Step 6

#### Files to edit

- `packages/core/src/domain/retrieval/pipeline.ts`
- `packages/core/src/domain/memory-event.ts`

#### Why this step

É a linha que o issue #122 aponta. Tudo antes existe para que esta linha seja correta.

#### Deep dive

Entre o Step 5 e o Step 7: montar a união de ids de `semanticResults` e `bm25Results`; se a porta de entidades não estiver configurada ou a união estiver vazia, manter o mapa vazio e o comportamento idêntico ao de hoje; caso contrário, chamar `linkedKeysForMemories`, passar o resultado pela função pura da Phase 1 e preencher com `entityBoost(numLinked)`.

Degradação graciosa é requisito: instalação sem grafo populado continua funcionando exatamente como hoje.

**A degradação por falha de I/O é construída aqui (EC-3), não só declarada.** A seção `## Failure scenarios` e o Global DoD prometem que timeout ou queda de conexão degradam para boost vazio **emitindo evento**; nenhuma task construía isso na v1.0. Esta task adiciona o literal novo à união tipada `MEMORY_EVENTS` em `memory-event.ts` — sem o literal o código nem compila, como já ocorreu com `entity_forgotten` no M14 — e envolve a chamada à porta num `catch` que degrada para mapa vazio e emite o evento. Engolir a exceção sem registro violaria `.claude/rules/error-handling.md` § 2.

#### TDD

RED: test_entity_store_failure_degrades_to_empty_boost_and_emits_event — com a porta lançando, expect(results).toEqual(baselineResults) e expect(emittedEvents).toContain('entity_boost_degraded').

RED: test_bm25_only_candidate_also_receives_boost — um candidato ausente do resultado semântico e presente só no BM25, expect(entityBoostById.has(bm25OnlyId)).toBe(true), provando que a união de ids foi montada antes da consulta.

RED: test_entity_boost_map_is_populated_when_query_mentions_linked_entity — expect(entityBoostById.size).toBeGreaterThan(0).

RED: test_pipeline_without_entity_store_behaves_identically — sem a porta configurada, expect(resultIds).toEqual(baselineResultIds).

RED: test_query_with_no_entity_match_leaves_signal_off — expect(signals.entity).toBe(false).

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `npm test -- pipeline` sai com exit code 0 incluindo os 4 REDs desta task.
- Com vínculo: `expect(entityBoostById.size).toBeGreaterThan(0)` passa; sem porta: `expect(resultIds).toEqual(baselineResultIds)` passa.
- Falha da porta: metric `entity_boost_degraded` emits ao menos uma vez no teste de degradação.

### T3.2 — Provar que a ordem relativa melhora

#### Files to edit

- `tests/integration/entity-boost/ranking.test.ts` (novo)

#### Why this step

É o comportamento que o issue promete e que o `graphiti` não testa — o blueprint registrou que eles asseveram cardinalidade, não ordem. Aqui não há precedente para copiar; o teste é desenho nosso.

#### Deep dive

Duas memórias com texto semanticamente equivalente, uma ligada à entidade da query e a outra não. Contra Postgres real. A asserção é de **posição relativa**, não de conjunto.

#### TDD

RED: test_linked_memory_ranks_above_unlinked_equivalent — expect(results.indexOf(linkedId)).toBeLessThan(results.indexOf(unlinkedId)).

RED: test_entity_component_is_positive_in_trace_for_linked_memory — expect(trace.components.entity).toBeGreaterThan(0).

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `npm test -- entity-boost/ranking` sai com exit code 0.
- Ordem relativa: `expect(results.indexOf(linkedId)).toBeLessThan(results.indexOf(unlinkedId))` passa.
- Trace: `expect(trace.components.entity).toBeGreaterThan(0)` passa para a ligada e equals 0 para a não-ligada.

### T3.3 — Provar as duas guardas de não-regressão

#### Files to edit

- `tests/integration/entity-boost/ranking.test.ts`

#### Why this step

O DoD do issue exige que o boost não ressuscite candidato sub-threshold. D1 aceita conscientemente um efeito de renormalização, e a guarda simétrica precisa ser verificada, não presumida.

#### Deep dive

Caso negativo, na acepção de `.claude/rules/testing.md` § 4.1: um candidato cujo score semântico está abaixo do gate não pode voltar por efeito do boost. Isso é verdadeiro por construção, porque o gate semântico roda antes da combinação (decisão do blueprint sobre a posição do gate) — o teste existe para que uma refatoração futura não inverta a ordem sem alarme.

A segunda guarda mede o churn: comparar o conjunto **pós-threshold e pré-topK** com e sem boost na mesma query (EC-2). Comparar o resultado final truncado mediria também a reordenação legítima, que é o efeito desejado.

#### TDD

RED: test_sub_threshold_candidate_is_not_resurrected_by_boost — uma memória ligada mas semanticamente irrelevante, expect(resultIds).not.toContain(irrelevantId).

RED: test_boost_does_not_remove_memory_from_post_threshold_set — sobre o conjunto pós-threshold e pré-topK, expect(withBoostIds).toEqual(expect.arrayContaining(withoutBoostIds)).

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- Sub-threshold: `expect(resultIds).not.toContain(irrelevantId)` passa.
- Churn: `expect(withBoostIds).toEqual(expect.arrayContaining(withoutBoostIds))` passa sobre o conjunto pós-threshold.
- Se o churn falhar, o número é evidência para revisitar D1 — enfraquecer o teste é proibido.

### T3.4 — Atualizar o comentário que instrui a ignorar a coluna

#### Files to edit

- `packages/core/src/domain/dip/recall-trace-store.ts`

#### Why this step

A linha 46 diz textualmente para não ler sinal da coluna `entity`. Com o boost ligado a instrução passa a ser falsa, e comentário desatualizado é pior que comentário nenhum.

#### Deep dive

Substituir a instrução por uma descrição do significado atual, citando M15 como a mudança e mantendo a nota de que memórias anteriores ao M15 têm `entity` zero por não terem sido reprocessadas.

#### TDD

RED: test_trace_comment_does_not_instruct_to_ignore_entity — sentinela lendo o arquivo, expect(source).not.toMatch(/Do NOT read signal into it today/).

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- A sentinela `expect(source).not.toMatch(/Do NOT read signal into it today/)` passa.
- `npm test -- recall-trace-store` sai com exit code 0.

## Phase 4 — Benchmark e validação de integração

### T4.1 — Benchmark determinístico com e sem boost

#### Files to edit

- `tests/integration/entity-boost/precision-benchmark.test.ts` (novo)
- `docs/benchmarks/entity-boost-m15.md` (novo)

#### Why this step

O goal exige dados. Sem número medido, a entrega é opinião.

#### Deep dive

Corpus determinístico com embedder de stub, seguindo o precedente de `tests/integration/kit-recall-parity/recall-coverage-benchmark.test.ts`, que usa `DeterministicStubEmbedder` e corpus de 300 para ter poder discriminante. Um conjunto de queries com relevância conhecida e memórias ligadas a entidades.

Três números reportados, conforme D2: `precision_at_k` sem boost, `precision_at_k` com boost, e `recall_set_churn` medido sobre o conjunto pós-threshold e pré-topK (EC-2).

O documento **não** faz comparação com concorrente — `.claude/rules/public-copy.md` § 4 exige reprodução independente para claim comparativo, e este benchmark é interno, medindo nós contra nós mesmos com e sem a feature.

#### TDD

RED: test_boost_does_not_degrade_precision_at_k — expect(withBoost.precisionAtK).toBeGreaterThanOrEqual(withoutBoost.precisionAtK).

RED: test_recall_set_churn_is_zero_on_post_threshold_set — expect(result.recallSetChurn).toBe(0), medido antes do corte de topK.

RED: test_benchmark_actually_exercised_the_boost — expect(result.boostedCandidateCount).toBeGreaterThan(0). Sem esta asserção o benchmark passaria trivialmente com o boost morto, que é exatamente o bug que este plano fecha.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `npm test -- entity-boost/precision-benchmark` sai com exit code 0 e writes o JSON com os três números.
- Sinal vivo: `expect(result.boostedCandidateCount).toBeGreaterThan(0)` passa.
- Não-degradação: `expect(withBoost.precisionAtK).toBeGreaterThanOrEqual(withoutBoost.precisionAtK)` passa.
- `docs/benchmarks/entity-boost-m15.md` contains o comando exato de reprodução.

### T4.2 — Validação de integração final

#### Files to edit

- `CHANGELOG.md`
- `.claude/knowledge-base/implementations/entity-boost-recall-contribution-implementation.md`

#### Why this step

Fecha o ciclo com evidência consolidada e mantém a disciplina de changelog (Regra Inquebrável 6).

#### Deep dive

Rodar a suíte inteira contra Postgres real, registrar os números do benchmark no log de implementação, e escrever a entrada de changelog voltada para o consumidor, descrevendo o ganho e não a mecânica interna.

#### TDD

RED: test_full_suite_is_green — a suíte completa executa com expect(exitCode).toBe(0).

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

- `npm test` sai com exit code 0 na suíte completa contra Postgres real.
- `grep -c '(#122)' CHANGELOG.md` returns >= 1 sob `[Unreleased]`.
- O log de implementação contains os três números do benchmark.

## Failure scenarios

O plano toca I/O externo (Postgres), portanto os modos de falha são explícitos.

| Cenário | Comportamento esperado |
|---|---|
| Timeout da consulta de vínculos | O recall **não** falha. O boost degrada para vazio e o resultado é o de hoje. Um evento de observabilidade registra a degradação, para que a falha não seja silenciosa (Princípio 3). |
| Conexão derrubada durante a consulta | Mesmo tratamento: degradar para boost vazio, registrar, devolver o recall. Recall é caminho de leitura; perder o terceiro sinal é preferível a devolver erro ao consumidor. |
| Porta de entidades não configurada | Mapa vazio, comportamento idêntico ao de hoje, sem log de erro — é configuração válida, não falha. |
| Tabela `entities` vazia (grafo ainda não populado) | Mapa vazio; sem erro. É o estado de toda instalação anterior ao M13. |
| Array de ids vazio | Retorno antecipado sem tocar o pool. |

A degradação silenciosa é aceitável **apenas** porque é observável: cada degradação emite evento. Engolir a exceção sem registro violaria `.claude/rules/error-handling.md` § 2.

## Drawbacks & Risks

| Risco | Por que é real | Mitigação / posição |
|---|---|---|
| Renormalização do denominador pode demover candidatos | Quando o sinal entity liga, o divisor vai de 2.0 para 2.5 e todo candidato sem vínculo perde 20% de score absoluto | Aceito em D1 e **medido** por `recall_set_churn` em T4.1. Se o churn for maior que zero, o número é evidência para revisitar a decisão; enfraquecer o teste de T3.3 é proibido |
| O casamento textual não resolve correferência | "ele", "lá" ou um apelido não casam com a `normalized_key` da entidade | O boost não contribui nesses casos — degrada para o comportamento de hoje, nunca para resultado errado. Resolver exigiria LLM no caminho quente, rejeitado em D3 |
| Custo de uma consulta adicional por recall | É um round-trip a mais no caminho quente de leitura | Limitada aos candidatos e indexada (D4, T2.3); retorno antecipado quando não há candidatos ou porta configurada |
| Memórias anteriores ao M13 não têm entidades extraídas | Nunca recebem boost, criando assimetria entre acervo antigo e novo | O comando `themory reextract` (M13) é o caminho de remediação; este plano não o executa e registra a assimetria |
| Entidade muito frequente pode empurrar ruído | `entityBoost` atenua por número de vínculos da memória, não pela frequência global da entidade no acervo | Não resolvido aqui; fica registrado como limite conhecido da atenuação atual |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Test Plan

- **Unidade:** casamento query↔entidade e contagem de vínculos (Phase 1), puros, sem I/O, em milissegundos.
- **Integração:** porta Postgres contra `ankane/pgvector:v0.5.1` real (Phase 2); ranking, guardas de não-regressão e benchmark contra Postgres real (Phases 3 e 4).
- **Casos negativos** conforme `.claude/rules/testing.md` § 4.1: workspace estrangeiro não retorna vínculo; palavra parcial não casa; candidato sub-threshold não ressuscita; lista vazia não toca o pool.
- **Sentinela:** o comentário do trace não pode voltar a instruir que se ignore a coluna.

## Critical paths

- `packages/core/src/domain/retrieval/entity-query-match.ts`
- `packages/core/src/domain/retrieval/pipeline.ts`
- `packages/core/src/infrastructure/db/pg-memory-entity-store.ts`

## Global Definition of Done

- Todas as tasks com status `committed` no checkpoint `.progress-entity-boost-recall-contribution.json`.
- `npm run typecheck` sai com exit code 0; `npm run lint` sai com exit code 0 e returns 0 avisos.
- `npm test` sai com exit code 0 na suíte completa contra `ankane/pgvector:v0.5.1`.
- Benchmark: `expect(result.boostedCandidateCount).toBeGreaterThan(0)` e `expect(result.recallSetChurn).toBe(0)` passam sobre o conjunto pós-threshold.
- Tríade de wiring: `check_wiring.py` returns exit code 0 para cada símbolo novo, e metric `entity_boost_degraded` emits no teste de degradação.
- `grep -c '(#122)' CHANGELOG.md` returns >= 1 sob `[Unreleased]`.
- `/code-quality` returns veredito equals `PASS` ou `PASS_WITH_CAVEATS`.
- `/review` returns veredito equals `READY_TO_MERGE`.
