# Edge Case Review — llm-entity-reextraction (plano de implementação M13)

Date: 2026-07-23
Plan analyzed: knowledge-base/plans/llm-entity-reextraction-plan.md
Tasks analyzed: 6 (T1.1, T2.1, T2.2, T3.1, T3.2, T4.1)
Edge cases found: 7 (MUST FIX: 3, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: Sessão/workspace dos alvos do reextract não declarados (isolação M8)
- **Affected task:** T3.1
- **Family:** Correctness/Isolation
- **Scenario:** a seleção de alvos por SQL varre `memories` sem declarar como o job respeita
  `(workspace_id, user_id, session_id)`. Um reextract que re-linka entidades de uma memória
  SESSION-tier com filters de user-tier grava entidades com colunas de escopo erradas
  (`entities.user_id/session_id` vêm dos filters do write — `pg-memory-entity-store.ts`).
- **Impact:** entidades re-extraídas nascem no escopo errado → invisíveis nas tabs certas /
  vazamento entre tiers.
- **Suggested fix:** T3.1 deriva os `Filters` POR MEMÓRIA a partir das colunas da própria
  linha (`workspace_id, user_id, session_id, agent_id`) e passa-os ao linking — assert no
  teste E2E (entidade re-extraída herda exatamente o escopo da memória-fonte).

### EC-2: Coerção default pode quebrar ontologias Item 15 configuradas (regressão)
- **Affected task:** T1.1
- **Family:** Compatibility
- **Scenario:** o pipeline aplica coerção ao vocabulário DEFAULT quando `ontology ===
  undefined`; mas `resolveOntology` é chamado no scoped-memory — se um consumer passa
  ontology `code`, os types válidos dela (ex. `FUNCTION`) NÃO pertencem ao default. Se a
  ordem das mudanças fizer a coerção default rodar ANTES/DEPOIS errado, types de ontologia
  seriam coagidos a OTHER.
- **Impact:** regressão silenciosa do Item 15 (types de domínio destruídos).
- **Suggested fix:** coerção default SÓ no caminho sem ontology (mutuamente exclusiva, um
  único call-site decide) + teste de regressão explícito
  `test_ontology_configured_keeps_item15_vocabulary` já listado — PROMOVIDO a obrigatório
  com assert de que `FUNCTION` sobrevive.

### EC-3: Supersede cruzando identidades JÁ semânticas (re-run pós-Phase 1)
- **Affected task:** T3.1
- **Family:** Idempotency
- **Scenario:** após a Phase 1 em produção, memórias novas já têm entidades semânticas. O
  reextract seleciona por type de mecanismo — ok; mas a MESMA memória pode ter AMBOS (link
  antigo PROPER + link novo PERSON da mesma entidade-nome). O supersede por identidade deve
  casar `normalized_key` igual entre OLD (mecanismo) e NEW (semântica) — se a nova
  identidade já existir POR OUTRA memória, o supersede deve apontar para ELA (não criar
  terceira).
- **Impact:** sem essa regra, re-runs criam cadeias/duplicatas residuais.
- **Suggested fix:** regra explícita no engine: NEW = linha retornada pelo upsert do
  linking (existente OU criada); supersede liga OLD→NEW por `normalized_key` igual no MESMO
  escopo; teste `test_reextract_end_to_end...` ganha o caso "identidade nova já existia".

## SHOULD TEST

### EC-4: Memórias gigantes (47K chars) no reextract
- **Affected task:** T3.1
- **Suggested checkpoint:** os alvos incluem importadas M12 (até dezenas de KB). O prompt de
  extração deve truncar o INPUT ao mesmo teto do embedder (precedente #109
  `EMBED_INPUT_MAX_CHARS`)? Adicionar caso de teste com memória de 40K chars → extração roda
  com input truncado (head) e não estoura contexto; documentar o teto no engine.

### EC-5: Entidade OLD com summary/edges ricos vs NEW recém-criada
- **Affected task:** T2.1
- **Suggested checkpoint:** o supersede re-aponta edges (preserva), mas payload/embedding da
  OLD não migram (NEW tem embedding próprio do linking). Assert no teste: edges contam
  igual antes/depois; nenhuma edge órfã (`entity_edges` sem endpoint válido = 0).

## DOCUMENT

### EC-6: Resíduo de não-determinismo do LLM
- **Accepted risk:** nomes podem variar entre runs (Risco #3 do plano) — absorvido por
  `normalized_key` + medição no benchmark; resíduo reportado honestamente no T4.1.

### EC-7: Custo do backfill live é estimado, não garantido
- **Accepted risk:** guarda operacional de 2x no T4.1 (pausa e reavalia); o dry-run é
  estimativa por chars/4 — precisão documentada no relatório.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| T1.1 | 1 | 1 | 0 | 0 |
| T2.1 | 1 | 0 | 1 | 0 |
| T3.1 | 3 | 2 | 1 | 0 |
| T4.1 | 2 | 0 | 0 | 2 |

**Verdict:** PLAN NEEDS ADJUSTMENT (3 MUST FIX → absorver antes do /plan-confidence)
