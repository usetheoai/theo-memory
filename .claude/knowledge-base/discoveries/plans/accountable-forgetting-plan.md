# Discovery Plan: Accountable Forgetting — explicando o espaço-negativo da memória

> **Version 1.1** — Investiga como Graphiti (Zep) e OpenMemory (Mem0) modelam supersessão temporal, proveniência e as decisões de descarte (dedup / invalidação / eviction), para desenhar o diferencial **"accountable forgetting"**: uma superfície `explain`/`replay` que expõe, consultável e governada por tenant, **o que a memória ignorou, deduplicou e esqueceu — e por quê**. Referências em escopo: `graphiti/` e `mem0/openmemory/` (+ o engine de decisão em `mem0/mem0/`). Saída esperada: um blueprint técnico que alimenta o `/to-plan` da superfície `explain`/`replay`.
>
> **v1.1 (2026-07-20)** — absorve 2 SHOULD TEST do edge-case review (`.claude/knowledge-base/reviews/accountable-forgetting-edge-cases-2026-07-20.md`): EC-1 (ordem Q2→Q3) e EC-2 (cap de hotspots de Q2) adicionados aos Halt-loop checkpoints. Zero MUST FIX; paths 21/21 verificados.

**Slug:** `accountable-forgetting`
**Owner:** paulohenriquevn
**Created:** 2026-07-20
**Time budget:** 6h (Graphiti 4h + mem0/OpenMemory 2h — ver ADR D1)

## Context

O de-risk competitivo (WebSearch 2026-07-20) mostrou que a narrativa ampla "explainable/auditable memory" **não está livre**: Zep já é dono público de *provenance + bi-temporal* ([blog.getzep.com/how-zep-tracks-provenance-in-agent-memory](https://blog.getzep.com/how-zep-tracks-provenance-in-agent-memory/), LongMemEval 63.8 vs Mem0 49.0) e vendors de observabilidade (Braintrust/Langfuse) já "tracem" memory reads/writes como spans. O pedaço que **sobrevive e é único** é o **espaço-negativo**: nenhum concorrente expõe, por recall, os candidatos filtrados sub-threshold, o dedup que colidiu, a extração que rendeu zero fatos e a memória evicted — governado por tenant (Principal + RBAC + fail-closed), não apenas observado por um sink externo.

Isso está ancorado no nosso próprio código: os 3 eventos IGNORE "antes silenciosos" já existem em `packages/core/src/domain/memory-event.ts` (`dedup_collision_confirmed:33`, `extraction_zero_facts:39`, `recall_threshold_filtered:46`) e a flag `MemoryItem.rejectedAsDuplicate`. O que falta é a **superfície legível** que costura eventos + `asOf` + provenance + Principal num único `explain(recallId)` / `replay(scope, asOf)`. Antes de desenhar (via `/to-plan`), precisamos dissecar como os dois SOTA modelam a metade "descarte/supersessão/proveniência" — para **não colidir com Zep** e para mapear cada técnica sobre nossas 3 tabelas Postgres existentes.

Restrições travadas que esta discovery respeita:

- **`CLAUDE.md` § Princípio 3 (auditabilidade)** — toda decisão de gravar/ignorar/deduplicar/expirar/substituir é observável; IGNORE nunca é silencioso.
- **`CLAUDE.md` § Roadmap Item 14 (graph backend AGE/Neo4j) DECLINADO** — o grafo de entidades evolui em `entities` + `memory_entities` + `entity_edges` (Postgres), sem graph DB. Toda técnica emprestada do Graphiti DEVE ser mapeada para essas 3 tabelas.
- **`.claude/rules/architecture.md § 2 (DIP)`** — a emissão de eventos de decisão é domínio; o sink (OTel/tabela de auditoria) é infraestrutura. A superfície `explain` não pode vazar tipo de infra pro domínio.
- **`.claude/rules/testing.md § 4.1`** — o boundary temporal/proveniência é território de teste de integração contra store real (não unit com mock).

## Objective

Produzir um blueprint que permita decidir **como implementar a superfície `explain`/`replay` (accountable forgetting) sobre a stack Postgres+pgvector existente, sem graph DB, diferenciada da proveniência do Zep**.

Critérios mensuráveis de sucesso do blueprint:

- [ ] Todas as 6 research questions respondidas com citações a `.claude/knowledge-base/references/`
- [ ] Tabela comparativa Graphiti vs OpenMemory vs (implicação de design nossa) populada para cada questão
- [ ] Seção de Recommendations com ≥ 1 proposta de decisão concreta por research question (mapeada às tabelas `entities`/`memory_entities`/`entity_edges` + `memory-event.ts`)
- [ ] Taxonomia explícita de "decisões de descarte" (exact-dedup / entropy-gate / LLM-resolve / contradiction-supersession / eviction) com o que persistir como proveniência de cada
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (por reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/graphiti/` | `graphiti_core/edges.py`, `graphiti_core/nodes.py`, `graphiti_core/utils/maintenance/` (`edge_operations.py`, `dedup_helpers.py`, `node_operations.py`), `graphiti_core/models/edges/edge_db_queries.py`, `graphiti_core/graphiti.py`, `graphiti_core/prompts/`, `tests/`, `Makefile`, `docker-compose.yml`, `pyproject.toml`, `pytest.ini` | SOTA de supersessão temporal + dedup determinístico; é o concorrente cuja narrativa (provenance/bi-temporal) precisamos diferenciar |
| `.claude/knowledge-base/references/mem0/openmemory/` | `api/app/models.py`, `api/app/routers/memories.py`, `api/app/utils/`, `api/requirements.txt`, `api/tests/`, `Makefile`, `docker-compose.yml`, `api/alembic/` | Baseline black-box: modela descarte como estado + esconde o espaço-negativo do usuário (anti-pattern a evitar) |
| `.claude/knowledge-base/references/mem0/mem0/` | `configs/prompts.py`, `memory/main.py` | Onde o "porquê" do descarte (ADD/UPDATE/DELETE/NONE) realmente vive no Mem0 — o engine de decisão que o OpenMemory não persiste |

### Out-of-Scope (explícito)

| Project / Subdir | Why excluded |
|---|---|
| `graphiti/docs/`, `graphiti/mcp_server/`, `graphiti/examples/` (subdirs do clone, fora do alvo) | Docs/exemplos, não fonte-de-verdade da técnica |
| `.claude/knowledge-base/references/mem0/openmemory/ui/`, `mem0/docs/`, `mem0/embedchain*/`, `mem0/vercel-ai-sdk/`, `mem0/mem0-ts/` | UI e SDKs periféricos; o alvo é o engine de decisão + o API layer do OpenMemory |
| `.claude/knowledge-base/references/mem0/openmemory/compose/` (overrides de vector-store alternativo) | Só confirmamos existência; a escolha de vector-store não é o alvo (nós já somos pgvector) |
| Qualquer `*/.venv/`, `dist/`, `build/`, `uv.lock` como leitura de técnica | Artefatos; `uv.lock`/`requirements.txt` lidos só na corner Deps |
| Qualquer projeto NÃO clonado em `.claude/knowledge-base/references/` | Cross-Project Rule: nunca afirmar feature de projeto sem ler a fonte (Zep-cloud, MOSS paper ficam como contexto do de-risk, não citados como técnica) |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** Graphiti: 4h (técnica-rica, alvo primário — supersessão temporal + dedup determinístico); mem0/OpenMemory: 2h (baseline + engine de decisão).

**Rationale:** Graphiti é o análogo mais próximo e o concorrente a diferenciar; concentra as decisões temporais que queremos mapear pro Postgres. OpenMemory é mais raso (o "porquê" está no mem0-core) e serve de contraexemplo.

**Alternatives considered:** split igual (rejeitado — OpenMemory é raso); só Graphiti (rejeitado — perde o anti-pattern black-box).

**Stop condition — per question (mandatory):** Quando a Fase A de uma questão retorna zero matches após 3 tentativas com variações de query (símbolo → kind-based → path alternativo → escopo mais amplo), marcar a questão BLOCKED com motivo "Fase A exhausted" e seguir. NÃO preencher com hotspots de outra questão.

**Stop condition — per project (mandatory):** Orçamento de projeto esgotado com N questões pendentes → marcar as restantes daquele projeto como BLOCKED "budget exhausted" e seguir. Se toda questão restante está `done` ou honestamente `blocked`, emitir `<promise>BLUEPRINT_BLOCKED</promise>` (nunca `BLUEPRINT_COMPLETE`).

**Anti-pattern:** NUNCA fabricar respostas de Fase B para fechar uma questão cuja Fase A foi esgotada (Unbreakable Rule 3).

**Consequences:** o halt-loop pausa por projeto ao esgotar orçamento; questões bloqueadas viram seed da próxima discovery.

### D2 — Investigation depth

**Decision:** Read end-to-end nos hotspots densos (`graphiti_core/utils/maintenance/edge_operations.py`, `graphiti_core/utils/maintenance/dedup_helpers.py`, `openmemory/api/app/models.py`, `openmemory/api/app/routers/memories.py`, `mem0/mem0/configs/prompts.py`); Grep-then-Read pontual no resto.

**Rationale:** a lógica de supersessão/dedup exige entender pré-condições e comentários, não só assinatura. Deps/tools são text-shape (leitura direta do manifesto).

**Consequences:** custo de leitura concentrado em ~5 arquivos; o resto é citação pontual.

### D3 — Mapear TUDO para Postgres relacional (sem graph DB)

**Decision:** cada técnica emprestada do Graphiti no blueprint DEVE vir com a proposta de como espelhá-la nas tabelas `entities` / `memory_entities` / `entity_edges` já existentes (migrations `0018`/`0019`/`0022`), NUNCA num graph DB.

**Rationale:** Item 14 declinado (`CLAUDE.md`); a migration `0022_adorable_spacker_dave.sql` já adicionou `t_valid`/`t_invalid` em `entity_edges` — a supersessão temporal do Graphiti tem morada relacional pronta.

**Alternatives considered:** adotar Neo4j/AGE (rejeitado — Item 14 declinado, viola KISS e a stack travada).

**Consequences:** o blueprint fica implementável na stack atual; qualquer técnica que EXIJA grafo nativo é registrada como "não portável" com justificativa, não como recomendação.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — grep/ast-grep map) | Fase B (deep — Read at hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Como o Graphiti persiste a **supersessão temporal** de um fato contradito — quais campos carregam "quando/por que expirou" e como é gravado no store? | techniques | graphiti | grep `resolve_edge_contradictions\|expired_at\|invalid_at\|valid_at` em `graphiti_core/utils/maintenance/edge_operations.py` + `graphiti_core/models/edges/edge_db_queries.py` | Read `edge_operations.py:538-575` (`resolve_edge_contradictions`), `edges.py:263-277` (`EntityEdge` campos `expired_at`/`valid_at`/`invalid_at`), `edge_db_queries.py:96-98` (query de save) | Tabela dos 4 campos temporais + o predicado de supersessão + a query que persiste — mapeados a `entity_edges.t_valid`/`t_invalid` (mig `0022`) |
| Q2 | Como cada sistema **DECIDE descartar/deduplicar** um fato e registra (ou não) o motivo? | techniques | graphiti + mem0 | grep `resolve_extracted_edge\|_has_high_entropy\|_resolve_with_similarity` (graphiti `dedup_helpers.py`/`edge_operations.py`); grep `ADD\|UPDATE\|DELETE\|NONE` em `mem0/mem0/configs/prompts.py` + `_update_memory\|_delete_memory` em `mem0/mem0/memory/main.py` | Read `dedup_helpers.py:39-131` (MinHash/LSH + entropy-gate) + `edge_operations.py:623-745` (LLM resolve); `mem0/configs/prompts.py:176-258` (4 ações) + `mem0/memory/main.py:1901-2054` | Taxonomia das decisões de descarte (exact-dedup / entropy-gate / LLM-resolve / contradiction) e se cada uma persiste o motivo — insumo pro nosso enum de eventos IGNORE |
| Q3 | O que o OpenMemory **EXPÕE vs ESCONDE** do espaço-negativo (ignore/dedup/evict) ao consumidor? | techniques | mem0/openmemory | grep `MemoryState\|MemoryStatusHistory` em `openmemory/api/app/models.py`; grep `event.*ADD\|deleted\|archived` em `openmemory/api/app/routers/memories.py` | Read `models.py:30-99` + `161-175` (estado + histórico); `routers/memories.py:221-305` (`create_memory` só materializa ADD, L277) + `102-130` (`list` filtra deleted/archived) | Mapa do que é registrado (`MemoryStatusHistory`) vs descartado silenciosamente (UPDATE/DELETE/NONE não materializados) — o anti-pattern black-box a evitar |
| Q4 | Quais **deps de runtime** cada um puxa para a camada temporal/proveniência, e dá para espelhar sem graph DB (Item 14 declinado)? | deps | graphiti + mem0/openmemory | Read `graphiti/pyproject.toml:13-38`; Read `mem0/openmemory/api/requirements.txt` (text-shape — sem Fase A) | idem (leitura direta dos manifestos) | Tabela de deps-chave (Graphiti: `neo4j>=5.26` default + `falkordb`/`kuzu`/`neptune` extras; OpenMemory: `psycopg2` + `mem0ai` + qdrant) + veredito "nossa stack Postgres+pgvector já cobre — sem Neo4j" |
| Q5 | Como o boundary temporal/proveniência é **testado localmente** (docker-compose + comando de teste + marker de integração)? | tools | graphiti + mem0/openmemory | Read `graphiti/Makefile` + `graphiti/docker-compose.yml` + `graphiti/pytest.ini`; Read `mem0/openmemory/Makefile` + `mem0/openmemory/docker-compose.yml` (text-shape) | idem | Dev harness de cada um (Graphiti: `uv run pytest -m "not integration"` default, neo4j via compose; OpenMemory: test-in-container, qdrant via compose) → informa nosso harness de `explain`/`replay` |
| Q6 | Como o Graphiti **testa a invalidação/supersessão** contra um driver de grafo real, e qual a forma da asserção (o que asseveram sobre `invalidated_edges`)? | tests | graphiti | grep `invalidate_facts\|invalidated_edges\|expired_at` em `graphiti/tests/` | Read `tests/test_add_triplet.py:48-145` (mock `invalidate_facts`) + `tests/utils/maintenance/test_edge_operations.py` + `tests/test_edge_int.py:53-159` (fixture driver real) | Padrão de teste (fixture de store real + asserção de que o fato invalidado permanece com carimbo) → o padrão que espelhamos: "assert a decisão de ignore/evict é gravada e consultável" |

## Coverage Matrix

100% das questões mapeadas a método concreto. Corners (tokens canônicos `tests`/`deps`/`tools`/`techniques`): techniques = Q1,Q2,Q3 (3/3, no teto); deps = Q4 (1); tools = Q5 (1); tests = Q6 (1). Nenhum corner vazio; nenhum ADR-deferral necessário.

| # | Corner | Método (Fase A → Fase B) | Answer format |
|---|---|---|---|
| Q1 | techniques | grep símbolos temporais → Read `edge_operations.py:538`, `edges.py:263`, `edge_db_queries.py:96` | Tabela de campos + predicado + mapeamento a `entity_edges` |
| Q2 | techniques | grep dedup/decisão → Read `dedup_helpers.py:39`, `edge_operations.py:623`, `mem0/configs/prompts.py:176`, `memory/main.py:1901` | Taxonomia de descarte + persistência-do-motivo (sim/não) |
| Q3 | techniques | grep estado/evento → Read `models.py:30/161`, `memories.py:221/102` | Mapa expõe-vs-esconde (anti-pattern) |
| Q4 | deps | Read `pyproject.toml:13`, `requirements.txt` | Tabela de deps + veredito sem-graph-DB |
| Q5 | tools | Read Makefiles + docker-compose + pytest.ini | Dev/test harness de cada projeto |
| Q6 | tests | grep asserções → Read `test_add_triplet.py:48`, `test_edge_operations.py`, `test_edge_int.py:53` | Padrão de teste + forma da asserção |

## Halt-loop checkpoints

Para `/discover-execute`, uma questão só é marcada `done` quando:

- Fase A produziu o hotspot map (paths + linhas) OU foi honestamente esgotada (→ BLOCKED com motivo).
- Fase B produziu prosa + citação line-exact a um path REAL em `.claude/knowledge-base/references/` (verificável via Read).
- Para Q1–Q3 e Q6: a resposta inclui a **proposta de mapeamento** para nossa stack (tabelas `entities`/`memory_entities`/`entity_edges` + `memory-event.ts`), per ADR D3.

Checkpoints adicionais (absorvidos do edge-case review v1.1):

- **EC-1 (ordem Q2→Q3):** Q3 (o que o OpenMemory expõe vs esconde) só pode ser marcada `done` DEPOIS de Q2 (as ações ADD/UPDATE/DELETE/NONE do engine `mem0/mem0/`) — o achado "OpenMemory só materializa `ADD`" depende de saber o que "o resto" é.
- **EC-2 (cap de hotspots de Q2):** a Fase B de Q2 limita-se aos hotspots listados na tabela (`dedup_helpers.py:39-131`, `edge_operations.py:623-745`, `mem0/configs/prompts.py:176-258`, `mem0/memory/main.py:1901-2054`); node-level dedup (`node_operations.py`) fica fora (padrão análogo — nota-de-rodapé no blueprint, não questão nova).

Antes de emitir `<promise>BLUEPRINT_COMPLETE</promise>`: todas as 6 questões `done` ou `blocked` com motivo; todos os 4 coverage corners do blueprint populados; ≥ 1 ADR no blueprint; toda citação resolve em disco.

## Acceptance Criteria

- [ ] Q1–Q6 respondidas, cada uma com citação a um path real em `.claude/knowledge-base/references/{graphiti,mem0}/`.
- [ ] Tabela comparativa Graphiti vs OpenMemory vs (implicação nossa) para as 4 corners.
- [ ] Taxonomia de decisões de descarte consolidada (exact-dedup / entropy-gate / LLM-resolve / contradiction-supersession / eviction) com "o que persistir" por tipo.
- [ ] ≥ 1 proposta de decisão concreta por questão, mapeada às tabelas Postgres existentes + aos eventos `memory-event.ts` (sem graph DB — ADR D3).
- [ ] Seção explícita "espaço-negativo": o que Zep/Mem0 NÃO expõem e que é o nosso diferencial.
- [ ] Nenhuma citação fabricada (todo path verificado por Read).

## Global Definition of Done

- `/discover-edge-cases accountable-forgetting` executado; MUST-FIX absorvidos.
- `/discover-plan-confidence accountable-forgetting` ≥ SHIPPABLE_WITH_CAVEATS (sem hard cap de citação fabricada / coverage-corner vazio, per `.claude/rules/discover-plan-golden-rule.md § 1`).
- `/discover-execute` produz `knowledge-base/discoveries/blueprints/accountable-forgetting-blueprint.md`.
- `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS, per `.claude/rules/discover-blueprint-golden-rule.md`.

## Verified reference anchors

Índice de evidência — todo path abaixo foi confirmado por `Read`/`grep` no clone (2026-07-20); a Fase B do `/discover-execute` parte destes hotspots.

Graphiti (supersessão temporal + dedup + testes + tooling):

- `.claude/knowledge-base/references/graphiti/graphiti_core/edges.py:263` — `EntityEdge` com `expired_at`/`valid_at`/`invalid_at`
- `.claude/knowledge-base/references/graphiti/graphiti_core/nodes.py:318` — `EpisodicNode` (âncora de proveniência)
- `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/edge_operations.py:538` — `resolve_edge_contradictions` (supersessão)
- `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/edge_operations.py:623` — `resolve_extracted_edge` (dedup+resolução)
- `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/dedup_helpers.py:79` — entropy-gate do dedup determinístico
- `.claude/knowledge-base/references/graphiti/graphiti_core/utils/maintenance/node_operations.py:336` — dedup de entidades (análogo)
- `.claude/knowledge-base/references/graphiti/graphiti_core/models/edges/edge_db_queries.py:96` — persistência de `expired_at`/`invalid_at`
- `.claude/knowledge-base/references/graphiti/graphiti_core/graphiti.py:980` — `add_episode` (orquestração)
- `.claude/knowledge-base/references/graphiti/tests/test_add_triplet.py:48` — asserção de `invalidate_facts`
- `.claude/knowledge-base/references/graphiti/tests/utils/maintenance/test_edge_operations.py` — teste de invalidação/contradição
- `.claude/knowledge-base/references/graphiti/tests/test_edge_int.py:53` — fixture de driver de grafo real
- `.claude/knowledge-base/references/graphiti/pyproject.toml` — deps (`neo4j>=5.26` + extras)
- `.claude/knowledge-base/references/graphiti/Makefile` — comando de teste (integração opt-in)
- `.claude/knowledge-base/references/graphiti/docker-compose.yml` — dev harness (neo4j)

Mem0 / OpenMemory (estado vs tempo; espaço-negativo escondido):

- `.claude/knowledge-base/references/mem0/openmemory/api/app/models.py:161` — `MemoryStatusHistory` (auditoria de estado, sem validade temporal)
- `.claude/knowledge-base/references/mem0/openmemory/api/app/routers/memories.py:277` — `create_memory` só materializa `ADD`
- `.claude/knowledge-base/references/mem0/openmemory/api/requirements.txt` — deps (`psycopg2` + `mem0ai` + qdrant)
- `.claude/knowledge-base/references/mem0/openmemory/docker-compose.yml` — dev harness (qdrant)
- `.claude/knowledge-base/references/mem0/mem0/configs/prompts.py:176` — `DEFAULT_UPDATE_MEMORY_PROMPT` (ADD/UPDATE/DELETE/NONE)
- `.claude/knowledge-base/references/mem0/mem0/memory/main.py:1901` — engine de decisão (onde o "porquê" vive)

## Related

- Golden rule (plano): `.claude/rules/discover-plan-golden-rule.md`
- Golden rule (blueprint): `.claude/rules/discover-blueprint-golden-rule.md`
- Cycle: `.claude/rules/cycle-discover.md`
- Próximo passo: `/discover-edge-cases accountable-forgetting`
- Anchor do nosso lado: `packages/core/src/domain/memory-event.ts` (3 eventos IGNORE), `packages/core/src/infrastructure/db/migrations/0022_adorable_spacker_dave.sql` (`t_valid`/`t_invalid` em `entity_edges`)
