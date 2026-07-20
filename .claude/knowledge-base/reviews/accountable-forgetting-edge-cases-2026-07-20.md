# Discover Edge Case Review — accountable-forgetting

Date: 2026-07-20
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/accountable-forgetting-plan.md
Research questions analyzed: 6
Edge cases found: 5 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 3)

## Citation verification (pre-flight)

All 21 cited reference paths resolve on disk; 3 key symbols spot-checked at the exact cited line:

- `graphiti/graphiti_core/utils/maintenance/edge_operations.py` → `def resolve_edge_contradictions(` at **L538** ✅
- `mem0/openmemory/api/app/models.py` → `class MemoryStatusHistory(Base)` at **L161** ✅
- `mem0/mem0/configs/prompts.py` → `DEFAULT_UPDATE_MEMORY_PROMPT` at **L176** ✅

**No fabricated citation.** The `/discover-plan-confidence` hard cap on fabricated references (Golden Rule § 1.2) will NOT fire.

## MUST FIX

None. The plan cites only verified paths, covers all 4 corners (techniques ×3, deps ×1, tools ×1, tests ×1), respects the question budget (6 ≤ 15), and every question maps to a concrete Fase A → Fase B method.

## SHOULD TEST

### EC-1: Q3 depende de Q2 (ordem não declarada)
- **Affected question:** Q3
- **Family:** Dependency
- **Scenario:** Durante `/discover-execute`, se Q3 (o que o OpenMemory expõe vs esconde) for respondida ANTES de Q2 (as 4 ações ADD/UPDATE/DELETE/NONE do engine mem0-core), o achado "OpenMemory só materializa `ADD` e esconde o resto" fica sem referência ao que "o resto" é — a decisão de supersessão/contradição vive em `mem0/mem0/` (Q2), não em `openmemory/` (Q3).
- **Suggested halt-loop checkpoint:** Antes de fechar Q3, validar que Q2 já está `done` (Q2 define a taxonomia de eventos que Q3 mostra ser descartada silenciosamente). Ordem: Q2 → Q3.

### EC-2: Scope creep em Q2 (dedup + extração dos dois repos)
- **Affected question:** Q2
- **Family:** Scope
- **Scenario:** "Como cada sistema decide descartar/deduplicar" pode inchar para ler todo o pipeline de dedup + extração de Graphiti E Mem0 (node_operations, extract_edges, todo o prompt de extração), estourando o orçamento de 4h/2h.
- **Suggested halt-loop checkpoint:** Cap Fase B de Q2 aos hotspots já listados (`dedup_helpers.py:39-131`, `edge_operations.py:623-745`, `mem0/configs/prompts.py:176-258`, `mem0/memory/main.py:1901-2054`); node-level dedup (`node_operations.py`) fica fora (ver EC-4).

## DOCUMENT

### EC-3: Clone sem SHA/data registrada no plano
- **Family:** Reference / version
- **Accepted risk:** Os clones (`graphiti`, `mem0`) são `--depth 1` do HEAD do default branch em 2026-07-20, sem SHA anotado no plano. As citações line-exact (ex: `edge_operations.py:538`) podem derivar num re-clone futuro. Mitigado porque **toda Fase A busca por NOME de símbolo** (grep), não por linha — a linha é só o ponto de leitura da Fase B. Registro aqui a data do clone (2026-07-20) como âncora; se um re-clone divergir, é esperado e a Fase A ainda encontra o símbolo.

### EC-4: Q2 cobre dedup de arestas, não de nós
- **Family:** Coverage
- **Accepted risk:** Q2 dissecar dedup no nível de aresta (`dedup_helpers.py` + `edge_operations.py`), não de entidade (`node_operations.py:336/467`). O dedup de nós é análogo (mesmo MinHash/LSH + escalonamento pra LLM). Adicionar uma questão de node-dedup estouraria o teto de 3 techniques. Aceito: dedup de aresta é representativo; o blueprint pode nota-de-rodapé que node-dedup segue o mesmo padrão.

### EC-5: Q2 exige interpretação ("persiste o motivo?")
- **Family:** Interpretation
- **Accepted risk:** "Cada decisão de descarte registra o motivo?" requer julgamento (o que conta como "persistir o motivo" — uma linha no grafo com `expired_at` conta; um evento LLM efêmero não). O formato de resposta esperado (taxonomia + sim/não por tipo) já acomoda o julgamento; não é uma pergunta binária determinística, e isso é OK para uma discovery (a decisão de design fica no blueprint/`to-plan`).

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 0 | 0 | 0 | 0 |
| Q2 | 3 | 0 | 1 (EC-2) | 2 (EC-4, EC-5) |
| Q3 | 1 | 0 | 1 (EC-1) | 0 |
| Q4 | 0 | 0 | 0 | 0 |
| Q5 | 0 | 0 | 0 | 0 |
| Q6 | 0 | 0 | 0 | 0 |
| (global) | 1 | 0 | 0 | 1 (EC-3) |

**Verdict:** DISCOVERY PLAN OK

Zero MUST FIX — o plano pode seguir para `/discover-plan-confidence` sem edição obrigatória. As 2 SHOULD TEST (EC-1 ordem Q2→Q3; EC-2 cap de hotspots de Q2) são melhorias baratas dos "Halt-loop checkpoints" que fortalecem o `/discover-execute`; recomendo absorvê-las num bump v1.0 → v1.1 antes do execute, mas não bloqueiam o confidence.
