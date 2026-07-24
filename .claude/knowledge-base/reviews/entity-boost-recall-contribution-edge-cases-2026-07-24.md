# Edge Case Review — entity-boost-recall-contribution

Date: 2026-07-24
Plan analyzed: `.claude/knowledge-base/plans/entity-boost-recall-contribution-plan.md` (v1.0)
Tasks analyzed: 11
Cases found: 8 (EDGE: 4, NEGATIVE: 4 | MUST FIX: 4, SHOULD TEST: 3, DOCUMENT: 1)

## MUST FIX

### EC-1: nome de entidade com metacaractere de regex derruba o recall

- **Affected task:** T1.1
- **Kind:** NEGATIVE (input inválido vindo do banco)
- **Family:** Format
- **Scenario:** T1.1 especifica casamento "com fronteira de palavra", o que naturalmente leva a `new RegExp(key)`. As `normalized_key` vêm de nomes de entidade emitidos pelo LLM. Num sistema de memória de desenvolvimento, `C++`, `F#`, `.NET`, `Node.js`, `A*` são nomes ordinários. `normalizeEntityKey("C++")` produz `c++`, e `new RegExp('c++')` lança `SyntaxError: Nothing to repeat`.
- **Impact:** exceção não tratada no caminho quente de leitura. Uma única memória sobre C++ no acervo derruba **todo** recall cuja query traga aquele candidato. Não é degradação: é falha total do `recall`.
- **Suggested fix:** não construir regex a partir da chave — comparar por índice e checar as fronteiras nos caracteres adjacentes; adicionar RED `test_entity_key_with_regex_metacharacters_does_not_throw` com a chave `c++`.

### EC-2: `recall_set_churn` medido no topK é insatisfazível por construção

- **Affected task:** T4.1 (e o critério de aceite de T3.3)
- **Kind:** EDGE (extremo de cenário válido)
- **Family:** Boundary
- **Scenario:** o plano define churn como "memórias presentes no resultado sem boost e ausentes com boost" e exige `recallSetChurn === 0`. Mas o resultado final é truncado em topK. Se o boost promove uma memória ligada da posição 7 para a 3 — que é **exatamente o efeito desejado** — a memória que estava na posição `topK` cai para `topK+1` e desaparece do resultado. O churn fica maior que zero por causa do sucesso da feature, não do risco que ADR-M15-2 quis medir.
- **Impact:** o critério de aceite não pode ser satisfeito enquanto o boost fizer qualquer reordenação atravessando a fronteira do topK. O halt-loop do `/implement` iteraria contra um alvo impossível, e a única saída seria enfraquecer o teste — proibido por `.claude/rules/cycle-implement.md`.
- **Suggested fix:** medir o churn sobre o conjunto **pós-threshold e pré-topK**, isolando o efeito de eliminação por renormalização do efeito legítimo de reordenação; ajustar ADR-M15-2 e o critério de T4.1 para essa definição.

### EC-3: a degradação prometida em `## Failure scenarios` não tem task que a construa

- **Affected task:** T3.1
- **Kind:** NEGATIVE (falha de I/O)
- **Family:** Resource
- **Scenario:** a seção `## Failure scenarios` promete que timeout e queda de conexão degradam para boost vazio **emitindo evento**, e o Global DoD exige "evento de observabilidade na degradação". Nenhuma task tem isso em `#### Files to edit`, nenhum RED cobre o caminho de falha, e o literal do evento não é adicionado a `MEMORY_EVENTS` — que é uma união tipada em `packages/core/src/domain/memory-event.ts`. Sem o literal, o código nem compila.
- **Impact:** DoD promete comportamento que nenhuma task entrega. Na melhor hipótese a exceção sobe e derruba o recall (contrariando a própria seção de falhas); na pior, alguém adiciona um `catch` silencioso, violando `.claude/rules/error-handling.md` § 2 e o Princípio 3 de auditabilidade.
- **Suggested fix:** acrescentar a T3.1 o literal novo em `MEMORY_EVENTS`, o `try/catch` que degrada para mapa vazio emitindo o evento, e RED `test_entity_store_failure_degrades_to_empty_boost_and_emits_event`.

### EC-4: `workspaceId` ausente devolve zero vínculo em silêncio

- **Affected task:** T2.2
- **Kind:** NEGATIVE (input inválido no limite do adaptador)
- **Family:** Input
- **Scenario:** a consulta filtra por `e.workspace_id = $2`. No resto do código o workspace é resolvido com `?? 'default'` (ver `local-memory.ts`, guarda de isolamento). Se `undefined` chegar aqui, a comparação com NULL não casa nada e a consulta devolve zero linhas — sem erro.
- **Impact:** é exatamente a classe de bug que este plano existe para fechar: a feature liga, não lança nada, e o boost permanece zero para sempre. Silencioso e indistinguível de "não há entidades".
- **Suggested fix:** normalizar para `'default'` no limite, coerente com o resto do repositório, com RED `test_absent_workspace_resolves_to_default_scope` asseverando que os vínculos do workspace default retornam.

## SHOULD TEST

### EC-5: query vazia ou só com espaços

- **Affected task:** T1.1
- **Kind:** EDGE
- **Suggested test:** `test_empty_query_matches_no_entity_key` — dado `""` e `"   "`, assevera o resultado no limite: `expect(matchedKeys).toHaveLength(0)`. Importa porque uma implementação por contenção ingênua faria a string vazia casar com tudo, dando boost a todo candidato.

### EC-6: chave de entidade com underscore legítimo

- **Affected task:** T1.1
- **Kind:** EDGE
- **Suggested test:** `test_entity_key_with_literal_underscore_still_matches` — a entidade `user_id` normaliza para `user_id`; revertendo underscore para espaço a comparação vira "user id" e não casa a query "o campo user_id". Assevera o comportamento escolhido no limite (casar ambas as formas, ou documentar que só a forma com espaço casa).

### EC-7: candidato que veio só do BM25

- **Affected task:** T3.1
- **Kind:** EDGE
- **Suggested test:** `test_bm25_only_candidate_also_receives_boost` — o Step 7 monta a união de semantic e BM25. Assevera que um candidato ausente do resultado semântico e presente só no BM25 aparece no mapa de boost, provando que a união de ids foi montada antes da consulta e não só a partir do semântico.

## DOCUMENT

### EC-8: `topK` grande gera array grande no `ANY(...)`

- **Kind:** EDGE
- **Accepted risk:** `internalLimit` é `Math.max(topK * 4, 60)`, então um `topK` alto produz um array grande no `ANY($1)`. Não é regressão introduzida por este plano — a busca vetorial e a busca por palavra-chave já pagam o mesmo limite hoje, e a consulta nova é sempre menor ou igual a elas. Fica registrado, sem task.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 2 | 1 | 1 | 2 | 0 |
| T1.2 | 0 | 0 | 0 | 0 | 0 |
| T2.1 | 0 | 0 | 0 | 0 | 0 |
| T2.2 | 1 | 1 | 1 | 0 | 1 |
| T2.3 | 0 | 0 | 0 | 0 | 0 |
| T3.1 | 1 | 1 | 1 | 1 | 0 |
| T3.2 | 0 | 0 | 0 | 0 | 0 |
| T3.3 | 0 | 0 | 0 | 0 | 0 |
| T3.4 | 0 | 0 | 0 | 0 | 0 |
| T4.1 | 1 | 0 | 1 | 0 | 0 |
| T4.2 | 0 | 0 | 0 | 0 | 0 |

**Coverage check:** T1.1, T2.2 e T3.1 são as tasks que tocam limite de entrada, e cada uma recebeu ao menos um caso EDGE e um NEGATIVE. T1.2, T2.1, T2.3, T3.2, T3.3, T3.4 e T4.2 operam sobre dados já validados pelas anteriores ou são puramente asseverativas — nenhuma lente adicional se aplica.

**Verdict:** PLAN NEEDS ADJUSTMENT (4 MUST FIX)
