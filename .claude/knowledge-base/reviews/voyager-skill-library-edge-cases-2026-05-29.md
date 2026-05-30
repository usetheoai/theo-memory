# Edge Case Review — voyager-skill-library v0.6

Data: 2026-05-29
Plano analisado: `.claude/knowledge-base/plans/voyager-skill-library-plan.md` v1.0
Tasks analisadas: 9 (T0.1, T1.1, T1.2, T2.1, T2.2, T3.1, T4.1, T4.2, T5.1)
Edge cases encontrados: 11 (MUST FIX: 4, SHOULD TEST: 5, DOCUMENT: 2)

## MUST FIX

### EC-1: Plano não cita o nome explícito da CHECK constraint a fazer DROP/RE-ADD em T0.1

- **Task afetada:** T0.1
- **Família:** Boundary (schema migration)
- **Cenário:** T0.1 diz "the CHECK constraint must be DROP + RE-ADD because Postgres does not support ALTER CHECK in-place" mas NÃO nomeia o constraint. Verificação 2026-05-29 em `src/local/migrations/0001_reflection_columns.sql:16` confirma que o constraint existente chama-se `memories_kind_derived_from_check` (Drizzle nomeia explicitamente). Sem o nome correto no SQL, `DROP CONSTRAINT` falha com `does not exist` e a migration aborta.
- **Impacto:** `npm run db:push` falha em ambiente CI; toda Phase 0-5 bloqueada; `/implement` halt-loop trava em Stop Condition #1 (pre-condition fail).
- **Fix sugerido:** Adicionar uma linha em T0.1 Deep Dives: "Constraint name from 0001 migration is `memories_kind_derived_from_check`; DDL uses `ALTER TABLE memories DROP CONSTRAINT IF EXISTS memories_kind_derived_from_check;` then re-ADD with `'skill'` added to the `kind` literal set."

### EC-2: T3.1 `consolidate()` não declara transação atomicidade entre `markSuperseded` e `insertDerivedSkill`

- **Task afetada:** T3.1
- **Família:** State (não-atomicidade)
- **Cenário:** O plano descreve Phase 3 (Consolidate) chamando primeiro `insertDerivedSkill(...)` (que insere o derived skill) e depois `markSuperseded([s1.id, s2.id], newSkill.id)` (que atualiza source rows). Se `markSuperseded` falha após `insertDerivedSkill` ter sucedido (race com `forget()`, network blip, deadlock), o sistema fica em estado inconsistente: derived skill existe mas sources NÃO estão marcados superseded → próximo `recall({onlySkills:true, includeSuperseded:false})` retorna 3 skills (2 sources + 1 derived) em vez de 1. THE GOAL TEST falha de forma flaky.
- **Impacto:** Acceptance criterion "supersededBy === derivedSkills[0].id" não garantido; THE GOAL TEST flaky; rollback impossível sem reconciliação manual.
- **Fix sugerido:** Adicionar em T3.1 Deep Dives uma sub-item: "Atomicidade — `insertDerivedSkill` + `markSuperseded` correm dentro de uma transaction (`withTransaction` helper já existe em `src/local/pgvector-store.ts` da v0.4a T4.3). InMemoryStore precisa de marker de checkpoint equivalente (rollback de Map state) OU declara que in-memory store é best-effort transactional (DOCUMENT)."

### EC-3: T3.1 — comportamento indefinido quando um skill JÁ tem `superseded_by` setado é incluído num novo cluster

- **Task afetada:** T3.1
- **Família:** State (semantics)
- **Cenário:** Phase 1 (Orient) chama `scope.getAll({onlySkills: true})`. Mas getAll é silent sobre `includeSuperseded` — fica claro pelo plano que `recall({onlySkills:true, includeSuperseded:false})` é filtrado, mas `getAll` não tem essa documentação. Se `getAll` retorna TUDO (inclusive superseded), Phase 2 cluster pode juntar `skill_v1` (já superseded por `skill_v2`) com `skill_v3` (novo, similar) — gerando um derived `skill_v4` com `derived_from = [skill_v1.id, skill_v3.id]`. Mas `skill_v1.superseded_by = skill_v2.id` já existe! Agora skill_v1 tem DOIS sucessores: skill_v2 E skill_v4. Quem precede quem fica ambíguo; recall sai com behavior undefined.
- **Impacto:** Provenance corruption; consolidate chamado N vezes pode multiplicar versions exponencialmente; debugging audit trail vira impossível.
- **Fix sugerido:** Adicionar em T3.1 Phase 1: "Orient filtra `scope.getAll({onlySkills: true, includeSuperseded: false})` — apenas tip-of-version-chain skills entram em clusters. Já-superseded skills são fora-de-escopo." E expor `includeSuperseded` em `GetAllOptions` (Phase 2 adicionou em RecallOptions; estender GetAllOptions também).

### EC-4: T4.1 — RepoScope adiciona 4º Scope kind mas plano só atualiza 2 dos 4 switch statements existentes

- **Task afetada:** T4.1
- **Família:** Integration (DIP boundary breaking)
- **Cenário:** Verificação 2026-05-29 (`grep -rn "switch.*scope.kind"`) encontra 4 sites discriminando sobre Scope.kind: `src/local/index.ts:77` (filtersFromScope — plan menciona), `src/local/index.ts:???` (assertScopeIsNonEmpty — plan menciona), `src/local/reflection/threshold-reflection-policy.ts:46` (scopeToCounterTuple — NÃO mencionado), `src/core/reflection/prompt.ts:18` (scope identifier formatting — NÃO mencionado). Adicionar `RepoScope` na união discriminada quebra type exhaustiveness em todos os 4 — typecheck FALHA até cada switch ganhar uma `case 'repo':` arm.
- **Impacto:** `npm run typecheck` fail; Phase 1+ tasks bloqueadas; `/implement` halt-loop Stop Condition #2 (GREEN fails) em T1.1 ou T4.1.
- **Fix sugerido:** Acrescentar em T4.1 Files to edit duas linhas: `src/local/reflection/threshold-reflection-policy.ts — add 'repo' case to scopeToCounterTuple` e `src/core/reflection/prompt.ts — add 'repo' case to scope identifier formatting (returns "repo:<repoId>")`. Acrescentar em Deep file dependency analysis: "Type exhaustiveness extension is non-trivial — RepoScope discriminant lands in 4 switches across core+local."

## SHOULD TEST

### EC-5: T2.1 — duas chamadas `insertSkill` concorrentes com mesma description não têm dedup explícito

- **Task afetada:** T2.1
- **Teste sugerido:** `test_insertSkill_concurrent_same_description_does_not_dedup` — assert que 2 inserts concorrentes com mesma `description` produzem 2 rows distintos (cada um com seu próprio UUID). Decisão honesta: skill dedup é responsabilidade do CALLER no v0.6 (não do storage layer). Test documenta esse contract.

### EC-6: T2.2 — cross-repo skill leak guard

- **Task afetada:** T2.2
- **Teste sugerido:** `test_recall_onlySkills_isolates_by_repo` — `memory.skills('repo-A').add(...)` + `memory.skills('repo-B').recall(...)` deve retornar zero rows. Verifica que o filter combina `kind='skill'` AND `repo_id=<scope.repoId>` (não só kind='skill').

### EC-7: T3.1 — `clusterThreshold` default 0.85 é magic number sem justificação

- **Task afetada:** T3.1
- **Teste sugerido:** `test_consolidate_cluster_threshold_default_0_85_clusters_intended_pairs` — usa a fixture de 2 skills semanticamente equivalentes (a mesma fixture que T5.1 usa) + assert que clusterThreshold=0.85 gera EXATAMENTE 1 cluster contendo as 2. Em paralelo, adicionar nota em T3.1 Deep Dives explicando: "0.85 foi escolhido empiricamente alinhado com Mem0's default semantic-dedup threshold (per `.claude/knowledge-base/references/mem0/CLAUDE.md`); validado por este test."

### EC-8: T3.1 — comportamento quando `executeReflection` retorna empty drafts

- **Task afetada:** T3.1
- **Teste sugerido:** `test_consolidate_empty_drafts_returns_empty_result_no_throw` — mock LLM retorna `[]`; assert que `ConsolidationResult.derivedSkills.length === 0` AND `sourceClusters` ainda lista as fontes que foram tentadas AND ZERO calls em `markSuperseded` (não consolidou, então NÃO superseded). Garante que cluster mal-classificado pelo LLM não corrompe state.

### EC-9: T5.1 — escolha LLM-real vs stub no integration test é ambígua

- **Task afetada:** T5.1
- **Teste sugerido:** Não é um test novo — é uma DECISÃO documentada no Deep Dives de T5.1. Sugestão: "T5.1 usa STUB determinístico do LLM (`MockReflectionLLM` que retorna pre-canned drafts). Real LLM é validado em `/dogfood` lifecycle, não em CI. Justifica:custo + flakiness. Pattern segue v0.4a T4.3+ que usaram StubLLM para integration tests."

## DOCUMENT

### EC-10: T3.1 — Cluster size cap NÃO implementado em v0.6

- **Risco aceito:** Se um repo tem 100 skills semelhantes (improvável mas possível), `consolidate()` chamado com clusterThreshold baixo poderia tentar passar 100 skills para `executeReflection()` em uma única chamada. Custo de LLM tokens explode + context window pode ser excedido. v0.6 aceita isso porque (a) clusterThreshold default 0.85 é alto o suficiente para limitar cluster size na prática; (b) consumer pode chamar `consolidate({maxClusterSize: N})` em v0.6.1+ se demanda surgir; (c) implementar agora seria YAGNI. Documentar em T3.1 Deep Dives como Accepted risk.

### EC-11: T1.1 — `Skill.text === normalize(description)` é lossy para descriptions multi-linha ou multi-language

- **Risco aceito:** `MemoryItem` interface requer `text: string` — Skill herda. O plano normaliza `description` para preencher `text`. Se `description` é multi-line markdown ou multi-language, a normalização perde estrutura. v0.6 aceita porque `text` é usado apenas por consumers genéricos de `MemoryItem`; consumers de skill devem ler `description` diretamente. Documentar em T1.1 Deep Dives + JSDoc na interface Skill: "`text` is a normalized projection of `description` for `MemoryItem` superinterface compatibility — DO NOT use as the canonical skill description."

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 1 | 1 (EC-1) | 0 | 0 |
| T1.1 | 1 | 0 | 0 | 1 (EC-11) |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 1 | 0 | 1 (EC-5) | 0 |
| T2.2 | 1 | 0 | 1 (EC-6) | 0 |
| T3.1 | 5 | 2 (EC-2, EC-3) | 2 (EC-7, EC-8) | 1 (EC-10) |
| T4.1 | 1 | 1 (EC-4) | 0 | 0 |
| T4.2 | 0 | 0 | 0 | 0 |
| T5.1 | 1 | 0 | 1 (EC-9) | 0 |
| **Total** | **11** | **4** | **5** | **2** |

**Veredicto:** PLANO PRECISA DE AJUSTE — 4 MUST FIX exigem absorção em v1.1 antes de `/plan-confidence` (ou no mínimo antes de `/implement`).

## Como absorver (sugestão de v1.0 → v1.1 patch)

1. **EC-1 (T0.1 constraint name)**: adicionar nome explícito do constraint em T0.1 Deep Dives + DDL line citando `DROP CONSTRAINT IF EXISTS memories_kind_derived_from_check`.
2. **EC-2 (T3.1 atomicidade)**: T3.1 Deep Dives ganha sub-item "Transação atomic markSuperseded+insertDerivedSkill via `withTransaction` (v0.4a helper)".
3. **EC-3 (T3.1 superseded re-cluster)**: Phase 1 (Orient) explicitamente filtra `includeSuperseded:false`; estender `GetAllOptions` em T2.2 para honrar isso (já estende RecallOptions; trivial adicionar 1 linha).
4. **EC-4 (T4.1 4 switches)**: T4.1 Files to edit ganha 2 linhas (threshold-reflection-policy.ts + prompt.ts); Deep file dependency analysis menciona "discriminant exhaustiveness extension across 4 switch sites".
5. **EC-5/6/7/8/9 (SHOULD TEST)**: 5 tests novos adicionados aos blocos TDD das respectivas tasks (T2.1, T2.2, T3.1×2, T5.1).
6. **EC-10/11 (DOCUMENT)**: 2 sub-items em Deep Dives + 1 JSDoc na interface Skill.

Total estimado de absorção: ~25 linhas de patch no plan. Após v1.1, re-rodar `/edge-case-plan` é OPCIONAL (only confirms absorption); pode pular direto pra `/deps-audit` + `/plan-confidence`.
