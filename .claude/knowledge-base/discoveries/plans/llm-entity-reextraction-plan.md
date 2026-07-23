# Discovery Plan: LLM Entity Re-extraction — batch backfill mechanics (M13, corrige #111)

> **Version 1.1** — Investiga a MECÂNICA de execução da Fase B do blueprint `multilingual-entity-extraction` (D2): como substituir o grafo de entidades ruidoso por extração LLM com types semânticos, via backfill batch idempotente. Referências em escopo: `graphiti` (primária — engine de knowledge-graph com ingestão bulk, dedup LLM e entity types) e `mem0` (secundária — batch/update semantics). Saída esperada: blueprint executável cobrindo substituição/supersede, taxonomia fechada + coerção, engenharia de custo do backfill (chunk/checkpoint/dry-run) e metodologia de benchmark do DoD do M13. v1.1 absorve MUST FIX EC-1/EC-2 e checkpoints EC-3/EC-4 do edge-case review.

**Slug:** `llm-entity-reextraction`
**Owner:** auto-plan M13 (goal do owner 2026-07-23)
**Created:** 2026-07-23
**Time budget:** 4.5h (per-project breakdown in ADR D1)

## Context

A Phase A do blueprint `multilingual-entity-extraction` (SHIPPABLE 100, 2026-07-19) estancou a FONTE do ruído (D1: `infer:false` sem extração inline — paridade mem0; D6: `CompromiseEntityExtractor` rebaixado a fallback EN-only endurecido). Ficou o ESTOQUE: a análise da tela Entities (2026-07-23, theo-memory#111) mediu 80 entidades ALL-CAPS + 53 nomes ≤3 chars + types de MECANISMO (`PROPER` 734/`COMPOUND` 89/`QUOTED` 16) numa base de ~840 — e as memórias verbatim/importadas (M12) seguem SEM grafo (gap D1→D2). O M13 do `ROADMAP.md` exige: backfill batch idempotente com dry-run/custo bounded, types SEMÂNTICOS, metas de ruído verificáveis (ALL-CAPS ≤10; ≤3 chars ≤10), grafo para verbatim/importadas e desbloqueio da coluna TYPE (theo-cloud#253 Fase 2). Regras do projeto que o resultado deve respeitar: `.claude/rules/architecture.md` (DIP), `.claude/rules/testing.md § 4.1`, `.claude/rules/error-handling.md`, `.claude/rules/parsimony-ladder.md`.

Este plano NÃO re-documenta o que o blueprint Phase A já cobriu (mercado, D1–D8 de alto nível); investiga a MECÂNICA que o blueprint deixou em um parágrafo (D2).

## Objective

Produzir um blueprint que permita decidir COMO executar a re-extração batch — substituição idempotente do grafo, taxonomia semântica, batching/custo e benchmark — sem inventar um segundo stack de extração. Critérios de sucesso do blueprint:

- [ ] All research questions in this plan answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated for every in-scope reference project
- [ ] Recommendations section provides at least one concrete decision proposal per in-scope research question
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/graphiti/` | `graphiti_core/utils/bulk_utils.py`, `graphiti_core/graphiti.py`, `graphiti_core/utils/maintenance/`, `graphiti_core/prompts/`, `graphiti_core/utils/ontology_utils/entity_types_utils.py`, `graphiti_core/nodes.py`, `graphiti_core/llm_client/`, `tests/`, `pyproject.toml` | Engine de knowledge-graph temporal com ingestão bulk, dedup LLM e entity types — exatamente o problema da Fase B |
| `.claude/knowledge-base/references/mem0/` | `mem0/memory/main.py`, `mem0/memory/utils.py`, `mem0/configs/prompts.py`, `evaluation/` | Batch/update semantics (decisão ADD/UPDATE/DELETE) + eval harness; papel limitado — ver ADR D2 |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/graphiti/server/`, `mcp_server/`, `examples/`, `signatures/`, `images/` | Superfícies de serviço/demos — não tocam a mecânica de bulk/dedup |
| `.claude/knowledge-base/references/graphiti/graphiti_core/driver/` (falkordb/kuzu/neptune específicos) | Somos Postgres-only (Item 14 declinado); só o shape das operações importa, não drivers |
| `.claude/knowledge-base/references/mem0/docs/`, `examples/`, `integrations/`, `embedchain/` | Marketing/demos; o clone (2026-06) NÃO contém o módulo graph_memory — papel de mem0 restrito a batch semantics |
| Qualquer projeto não clonado em `.claude/knowledge-base/references/` | Nunca afirmar feature sem ler o source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** graphiti: 3h, mem0: 45min, repo interno (leitura direta de `packages/core/src`): 45min.

**Rationale:** graphiti é o análogo mais próximo do problema (bulk + dedup + types) e carrega 5 das 8 questões; mem0 tem papel restrito (clone sem módulo de grafo); o repo interno é conhecido — 45min bastam para mapear o ponto de acoplamento. Alternativas consideradas: split igual (desperdiça budget em mem0), deep-dive single-project (perde o cruzamento batch-semantics), sem budget (halt-loop sem freio).

**Stop condition — per question (mandatory):** quando a Fase A de uma questão retornar vazio após 3 tentativas com variantes de query (pattern → símbolo alternativo → path alternativo → escopo mais amplo), marcar a questão BLOCKED com razão "Fase A exhausted" e seguir para a próxima. NUNCA preencher com hotspots de outra questão.

**Stop condition — per project (mandatory):** budget do projeto esgotado com questões pendentes → marcar as restantes BLOCKED com razão "budget exhausted" e avançar. Se todos os projetos terminarem nesse estado, emitir `<promise>BLUEPRINT_BLOCKED</promise>` com o relatório honesto — nunca `BLUEPRINT_COMPLETE` com questões bloqueadas.

**Anti-pattern:** NUNCA fabricar respostas de Fase B para fechar questão com Fase A esgotada (Unbreakable Rule 3).

**Consequences:** o halt-loop para no budget mesmo com questões bloqueadas; bloqueios viram seed da próxima discovery.

### D2 — Graphiti primário; mem0 secundário; web só como complemento

**Decision:** graphiti carrega a investigação de grafo (Q1–Q4, Q6–Q7); mem0 entra apenas em Q5 (batch/update semantics) e Q7 (eval harness); WebFetch (allowlist `.claude/rules/discover-web-allowlist.txt`) apenas se uma questão local ficar sem resposta — o sweep web já foi feito na Phase A (Zep arXiv:2501.13956, mem0 arXiv:2504.19413, GraphRAG, GLiNER).

**Rationale:** o clone mem0 (shallow, 2026-06) não contém o módulo graph_memory — insistir nele produziria lacunas; reclonar mem0 atualizado exigiria re-gate de licença/custo sem ganho (graphiti cobre o gap). DRY: não re-descobrir o que a Phase A documentou. Alternativas consideradas: reclonar mem0 (rejeitado — custo sem ganho), sweep web novo (rejeitado — duplicaria a Phase A).

**Consequences:** Q5 pode fechar com resposta parcial honesta se o clone não tiver o prompt de UPDATE (checkpoint EC-3); a taxonomia final ancora no NOSSO Item 15 se o graphiti delegar types ao chamador (checkpoint EC-4).

### D3 — Parcimônia: reuso do pipeline Phase 2, nunca um segundo stack

**Decision:** toda recomendação do blueprint DEVE se acoplar ao pipeline LLM Phase 2 existente (`packages/core/src/domain/extraction/`) e às colunas existentes (`t_invalid`, `superseded_by`, `derived_from`) — nenhuma dependência nova de NLP, nenhuma migração especulativa.

**Rationale:** decisão já locked na Phase A (blueprint D1/D6) + `.claude/rules/parsimony-ladder.md` rungs 1–4 (reusar o que está instalado) + KISS. Alternativas consideradas: stack de NER dedicado (GLiNER local — já rejeitado como backlog D7 da Phase A), serviço externo de extração (rejeitado — custo/latência/lock-in sem necessidade).

**Consequences:** o backfill é um CALLER novo do pipeline existente (CLI/job atrás de porta DIP per `.claude/rules/architecture.md`), não um extrator novo; Q8 existe para cravar o ponto de acoplamento exato.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Como o graphiti executa ingestão/re-processamento BULK (ordem extração→dedup→persist, paralelismo, chunking, resume)? | techniques | `.claude/knowledge-base/references/graphiti/` | `ast-grep run --pattern 'async def add_episode_bulk($$$): $$$' --lang python .claude/knowledge-base/references/graphiti/graphiti_core/` (EC-1: entrypoint em `graphiti_core/graphiti.py`, não em bulk_utils); fallback Grep `semaphore\|bulk` em `graphiti_core/` | Read `graphiti_core/graphiti.py` (região add_episode_bulk) + `graphiti_core/utils/bulk_utils.py` fim-a-fim (15 defs) | Fluxo numerado extração→dedup→persist + limites de concorrência, com `path:line` por passo |
| Q2 | Como o graphiti SUBSTITUI/deduplica nós e edges existentes sem duplicar em re-runs (idempotência, uuid_map, invalidação de edges)? | techniques | `.claude/knowledge-base/references/graphiti/` | `ast-grep run --pattern 'def $F($$$uuid_map$$$): $$$' --lang python .claude/knowledge-base/references/graphiti/graphiti_core/utils/`; fallback Grep `invalidat\|uuid_map` em `graphiti_core/utils/maintenance/` | Read `graphiti_core/utils/maintenance/dedup_helpers.py`, `node_operations.py`, `edge_operations.py` nos hotspots | Mecânica supersede-vs-delete + provenance, mapeada explicitamente para nossos `t_invalid`/`superseded_by`/`derived_from` |
| Q3 | Qual taxonomia de entity types o graphiti usa (default + custom via ontology) e como coage out-of-vocab? | techniques | `.claude/knowledge-base/references/graphiti/` | `ast-grep run --pattern 'entity_types' --lang python .claude/knowledge-base/references/graphiti/graphiti_core/` (lista call-sites); fallback Grep `entity_types` | Read `graphiti_core/utils/ontology_utils/entity_types_utils.py`, `graphiti_core/prompts/extract_nodes.py`, `graphiti_core/nodes.py` | Vocabulário (fechado ou delegado — EC-4) + regra de coerção, casado com nosso Item 15 (`ONTOLOGY_FALLBACK_TYPE`) |
| Q4 | Que deps o graphiti usa para o bulk LLM (client, retry/rate-limit, saída estruturada) e em que versões? | deps | `.claude/knowledge-base/references/graphiti/` | SKIP Fase A — text-shape. Glob `pyproject.toml`; Grep `retry\|rate\|semaphore` em `graphiti_core/llm_client/` | Read `pyproject.toml` + os matches do llm_client em contexto | Tabela dep→versão→papel→equivalente nosso (openai já instalada; expectativa: zero dep nova) |
| Q5 | Como o mem0 estrutura o prompt/fluxo de decisão em batch sobre memórias EXISTENTES (ADD/UPDATE/DELETE) — reaproveitável para a decisão de substituição de entidades? | deps | `.claude/knowledge-base/references/mem0/` | SKIP Fase A — text-shape. Grep `UPDATE\|DELETE\|update_memory` em `mem0/mem0/memory/*.py` e `mem0/mem0/configs/prompts.py` (EC-3: o prompt pode morar em configs/prompts.py) | Read `mem0/mem0/memory/main.py` + `mem0/mem0/memory/utils.py` + `mem0/mem0/configs/prompts.py` nos matches | Shape do prompt de decisão + mapeamento para a troca de grafo; lacuna do clone reportada honestamente se ausente |
| Q6 | Como o graphiti TESTA extração/dedup/exclusão de entidades (fixtures, LLM real vs stub, asserts de qualidade)? | tests | `.claude/knowledge-base/references/graphiti/` | `ast-grep run --pattern 'def test_$F($$$): $$$' --lang python .claude/knowledge-base/references/graphiti/tests/` (mapa de testes); fallback ls `tests/` | Read `tests/test_entity_exclusion_int.py` + `tests/test_add_triplet.py` fim-a-fim | Tabela test→fixture→tipo de assert, com padrões reusáveis no nosso harness (real pgvector + LLM stub determinístico) |
| Q7 | Que ferramentas de avaliação/benchmark de qualidade de extração os refs trazem, e que metodologia adotamos para o DoD (ALL-CAPS ≤10, ≤3 chars ≤10, precision)? | tools | `.claude/knowledge-base/references/graphiti/`, `.claude/knowledge-base/references/mem0/` | SKIP Fase A — text-shape. Glob `graphiti_core/prompts/eval.py`; ls `mem0/evaluation/` | Read `graphiti_core/prompts/eval.py` + amostras de `mem0/evaluation/` | SOMENTE metodologia (EC-2): métricas escolhidas + queries SQL de ruído como TEXTO + procedimento baseline/pós; o harness executável é task do plano M13 |
| Q8 | Onde o backfill se acopla ao NOSSO pipeline Phase 2→Phase 7 SEM segundo stack, e onde o type semântico substitui `PROPER` (write + backfill)? | tests | repo interno (`packages/core/src/`) | `ast-grep run --pattern 'ontology' --lang typescript packages/core/src/domain/extraction/` (call-sites da tipagem); fallback Grep `PROPER` em `packages/core/src/` | Read `packages/core/src/domain/extraction/entity-linking.ts`, `pipeline.ts`, `packages/core/src/domain/ontology.ts`, `packages/core/src/infrastructure/db/pg-memory-entity-store.ts` | Ponto de acoplamento único do reextract + local exato da tipagem + teste de integração existente a estender |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q6, Q8 | Covered |
| Dependencies | Q4, Q5 | Covered |
| Tools | Q7 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Path declarado na Fase A existe em `.claude/knowledge-base/references/{...}` (ou `packages/core/src/` para Q8) | Mark Qx BLOCKED "path not found", continue |
| Per-question Fase A budget | Fase A retornou ≥1 hotspot OU 3 variantes tentadas | Após 3 retries vazios, BLOCKED "Fase A exhausted"; continue |
| After answering Qx | Seção do blueprint sob Qx tem ≥1 citação `path:line` lida NESTA iteração (nunca de memória) | Re-iterate Qx (1 retry max) |
| Q2 specific | Resposta mapeada explicitamente para `t_invalid`/`superseded_by`/`derived_from` existentes (sem migração especulativa) | Re-iterate Q2 (1 retry max) |
| Q5 specific (EC-3) | Grep incluiu `mem0/mem0/configs/prompts.py`; lacuna do clone reportada honestamente se o prompt não existir | Re-iterate Q5 com o grep ampliado |
| Q3 specific (EC-4) | Se types forem delegados ao chamador, a resposta diz isso e ancora a taxonomia no Item 15 — nunca inventa default | Re-iterate Q3 (1 retry max) |
| Q7 specific (EC-2) | Entrega é metodologia/texto (métricas + SQL), zero código de harness | Cortar código; re-iterate |
| Q8 specific | Confirma reuso do pipeline Phase 2 (parsimony D3) — nenhuma proposta de segundo stack | Re-iterate Q8 (1 retry max) |
| Per-project time budget | Budget ADR D1 não esgotado | Esgotou → BLOCKED "budget exhausted" nas restantes; próximo projeto |
| Before promising complete | 4 coverage corners populadas no blueprint | Refuse promise, continue |

## Acceptance Criteria

- [ ] All research questions answered OR explicitly marked BLOCKED with reason
- [ ] All four coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real `.claude/knowledge-base/references/{...}` path (ou `packages/core/src/` para Q8)
- [ ] At least one ADR section in the blueprint synthesizes decisions taken (mecânica da Fase B)
- [ ] Time budget respected per project (ADR D1)
- [ ] Blueprint contém: fluxo de substituição idempotente, taxonomia final, plano de batching/custo com dry-run, metodologia de benchmark (texto + SQL)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/llm-entity-reextraction-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → execute → confidence → improve if needed → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs reference at least one principle from project rules (DIP/`architecture.md`, DRY, KISS, `parsimony-ladder.md`, `testing.md § 4.1`, Unbreakable Rule 3)
