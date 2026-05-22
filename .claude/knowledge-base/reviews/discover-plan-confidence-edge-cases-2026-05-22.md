# Edge Case Review — discover-plan-confidence

Data: 2026-05-22
Plano analisado: `.claude/knowledge-base/plans/discover-plan-confidence-plan.md` v1.0
Tasks analisadas: 15 (T0.1–T0.5, T1.1–T1.4, T2.1–T2.2, T3.1–T3.4, T4.1–T4.2, T5.1)
Edge cases encontrados: 11 (MUST FIX: 3, SHOULD TEST: 6, DOCUMENT: 2)

---

## MUST FIX

### EC-1: Mecanismo de deferral de coverage corner inconsistente entre dois checkers

- **Task afetada:** T0.2 / T1.1 (`check_research_coverage`) **vs** T1.3 (`check_plan_completeness`, sub-check question_budget)
- **Família:** State / Format
- **Cenário:** O plano define DUAS convenções diferentes para "este corner está deferido conscientemente, não conta como vazio":
  - **T0.2 Deep Dives + T1.1**: marcador HTML `<!-- DEFERRED: reason -->` em uma row da `## Coverage Matrix`.
  - **T1.3 Deep Dives** (sub-check question_budget): regex case-insensitive `defer.*{corner}` no body da seção `## ADRs`.

  Um plano que usa o marcador HTML em Coverage Matrix passa em `check_research_coverage` (corner contado como populated) mas FALHA em `check_plan_completeness` (count[corner] == 0 + nenhum "defer tests" no ADR body → `corner_uncovered_tests` violation → hard cap 70).
- **Impacto:** Plano honestamente deferido recebe verdict `SHIPPABLE_WITH_CAVEATS` em vez de `SHIPPABLE`. Pior: usuário fica confuso porque um checker diz OK e outro diz violation. Falsa rejeição = retrabalho desnecessário; pode forçar usuário a adicionar texto cosmético no ADR para satisfazer regex.
- **Fix sugerido:** Em D2 (ou novo D5), declarar UMA convenção única — `<!-- DEFER-CORNER: {corner} | {reason} -->` em ADR body OU em Coverage Matrix row. Atualizar T0.2/T1.1/T1.3 Deep Dives para apontarem para o mesmo regex (`<!--\s*DEFER-CORNER:\s*(tests|deps|tools|techniques)\b`). Remover a busca por `defer.*{corner}` (loose) de T1.3.

---

### EC-2: Strategy de parsing da tabela de Research Questions não-especificada — frágil a mudanças de schema

- **Task afetada:** T1.3 (`check_plan_completeness`, sub-checks question_budget + method_per_question)
- **Família:** Format / Boundary
- **Cenário:** A tabela de Research Questions tem 7 colunas no template atual (`#`, `Question`, `Corner`, `Reference project(s)`, `Fase A`, `Fase B`, `Expected answer shape`). O plano descreve sub-check 3 como "para cada Q row, check column labeled `Fase A` is non-empty…" — mas não diz se a localização é **por posição** (col-5) ou **por texto do header**. Se for por posição: qualquer plano que adicione/remova coluna quebra silenciosamente (Fase A passa a apontar para outra célula). Se for por texto do header: regex precisa lidar com variantes (`Fase A`, `Phase A`, `Fase A (broad)`, `Fase A — ast-grep map`).

  O template atual escreve **`Fase A (broad — ast-grep map)`** e **`Fase B (deep — Read at each hotspot)`** — header tem sufixos descritivos. Match exato em "Fase A" falha.
- **Impacto:** Falso positivo OU falso negativo no sub-check `method_per_question` dependendo da implementação escolhida. Bug load-bearing — toda execução do gate fica não-confiável.
- **Fix sugerido:** Em T1.3 Deep Dives, especificar: "localizar colunas por regex de header `^Fase\s*A\b` e `^Fase\s*B\b` (case-insensitive, sufixo descritivo OK); falhar com erro tipado se nenhum header bater (não silenciosamente assumir posição)". Adicionar teste `test_fase_a_header_with_suffix_recognized` em T0.4 RED tests.

---

### EC-3: Phase numbering "1.5" em T3.1 contradiz D3 e a posição real no chain

- **Task afetada:** T3.1 (SKILL.md) **vs** D3 e T4.1
- **Família:** State / Documentation drift
- **Cenário:** O plano diz coisas diferentes em lugares diferentes:
  - **D3** correctly: "novo skill roda DEPOIS de `/discover-edge-cases` e ANTES de `/discover-execute`".
  - **T4.1 Deep Dives** correctly: chain diagram insere o novo skill entre edge-cases e execute.
  - **T3.1 Tasks**: "update cycle phase number (**1.5** between edge-cases and execute)" — **errado**. `/discover-edge-cases` já é phase 2 (verificável em `cycle-discover.md § Chain`: phase 1 = /discover-plan, phase 2 = /discover-edge-cases, phase 3 = /discover-execute, phase 4 = /discover-confidence, phase 5 = /discover-improve). Inserir entre 2 e 3 é **phase 2.5**, não 1.5.

  Bonus: ao virar "phase 3", todos os downstream skills (`/discover-execute`, `/discover-confidence`, `/discover-improve`) renumerariam. `/discover-confidence/SKILL.md` afirma textualmente "This skill is **phase 4** of cycle-discover" — se renumerarmos, três SKILL.md ficam desatualizados silenciosamente.
- **Impacto:** Documentação drift entre cycle-discover.md e SKILL.md downstream. Operador lendo a SKILL.md errada pula uma fase ou roda na ordem errada. Bug load-bearing porque o chain é o contrato.
- **Fix sugerido:** Em T3.1 Tasks substituir "phase 1.5" por **"phase 2.5"** (preferido — preserva numeração existente downstream sem renumerar). Adicionar nota explícita em T4.1 Tasks: "verificar via `grep -rn 'phase [0-9]' .claude/skills/discover-*/SKILL.md` que nenhuma referência a phase 3/4/5 precisa ser bumpada — se for, renumerar tudo OU manter 2.5 para evitar churn".

---

## SHOULD TEST

### EC-4: Empty plan file (0 bytes) deve sair graceful, não crashar

- **Task afetada:** T2.1 (orchestrator)
- **Teste sugerido:** `test_empty_plan_file_returns_error_exit_code` — escrever `Path` vazio via tmp_path; rodar orchestrator; assertar exit code 2 (error) com mensagem em stderr, não traceback. Cada um dos 4 checkers também deve ter teste `test_checker_handles_empty_input` (retorna report com zeros, não exception).

### EC-5: Q row com Fase A vazia e Fase A != "SKIP" — methodless_questions deve disparar

- **Task afetada:** T0.4 / T1.3
- **Teste sugerido:** `test_methodless_q_with_empty_fase_a` — fixture com `| Q3 | ... | tests | ... | | <conteúdo> | <output> |` (Fase A literalmente vazio entre dois pipes). Assertar `report["methodless_questions"] == ["Q3"]`. Complementa o `test_skip_token_allowed_in_fase_a` já planejado.

### EC-6: Self-application smoke test deve rodar ANTES de T5.1 — não esperar Phase 5 para descobrir que template não passa

- **Task afetada:** T3.2 (rubric) ou novo T3.5
- **Teste sugerido:** Logo após T3.2 (rubric existir) e T2.1 (orchestrator funcionando), rodar `python3 scripts/run_discover_plan_score.py .claude/skills/discover-plan/templates/discovery-plan-template.md` manualmente e registrar verdict observado. Se < `SHIPPABLE_WITH_CAVEATS`, debugar agora (template é o contrato — desacordo entre template e gate é blocker semântico). Adicionar como sub-step explícito em T3.2 DoD ("Manual self-application smoke ran; verdict registrado em commit message").

### EC-7: Citações dentro de fenced code blocks — assertar comportamento herdado da sibling

- **Task afetada:** T0.3 / T1.2
- **Teste sugerido:** `test_citation_inside_code_fence_counted_per_sibling` — fixture com `` ```bash \n grep referencia/mem0/fake-path.md \n ``` ``. Sibling `discover-confidence/check_reference_citations.py` NÃO strip-a code fences (só `check_spec_smells.py` faz). Assertar que essa citation é contada (pode disparar `fabricated_citation` se path não existir) — preservando comportamento sibling. Se decidirmos divergir, documentar em ADR novo.

### EC-8: Regex de mandatory section `In-Scope` não casa `In Scope` (sem hífen) apesar do plano afirmar que casa

- **Task afetada:** T1.3 Deep Dives
- **Teste sugerido:** `test_in_scope_header_with_space_variant_accepted` — fixture com `## In Scope / Out of Scope` (sem hífens). Assertar `In-Scope` em `present`. Implementação requer ajustar regex para `^##\s+In[- ]Scope` (subtle fix). Sem este teste, plano que use a variante perfeitamente válida quebra silenciosamente como `mandatory_section_missing`.

### EC-9: Tabela de Research Questions malformada (linha sem `|` separator suficientes) — falha graceful ou detecção explícita

- **Task afetada:** T1.3
- **Teste sugerido:** `test_malformed_question_row_logged_not_crashed` — fixture com uma linha `| Q3 partial row` (4 colunas em vez de 7). Assertar que parser ignora a row OU adiciona `Q3` a `malformed_rows` no report; NÃO crashar com IndexError. Sub-check `question_budget` deve contar a Q3 OU explicitamente marcar como malformada (decidir em T1.3 — DOCUMENTAR a decisão).

---

## DOCUMENT

### EC-10: Drift entre checker copiado (T1.2 / T1.4) e checker sibling — sem alerta automatizado

- **Risco aceito:** D1 escolhe duplicate-with-attribution explicitamente (sobre refator para `common/`). Consequência inerente: melhorias futuras na sibling não propagam. Mitigação documentada em T1.2 DoD ("`diff` deve mostrar APENAS deltas de docstring"). Aceitável para v1.0 — refator para `.claude/scripts/common/` é trabalho de plano futuro quando um 4º sibling existir. Nada a fazer agora além de garantir o diff check no DoD.

### EC-11: Filesystem case-sensitivity — gate roda em Linux CI; macOS dev seria case-insensitive

- **Risco aceito:** `Path.exists()` em macOS pode validar `referencia/mem0/X.md` mesmo se arquivo real é `x.md`; em Linux falha. Projeto é Linux-first per CLAUDE.md (não há macOS CI declarado). Single-developer (per gitStatus) também em Linux. Risco real só se contribuidor macOS aparecer — aí ajustar com `Path.resolve().exists()` + comparação case-sensitive manual. Não vale antecipar agora (YAGNI).

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.2 / T1.1 | 1 (parcial EC-1) | 1 (parcial) | — | — |
| T0.3 / T1.2 | 1 | — | 1 (EC-7) | — |
| T0.4 / T1.3 | 5 | 2 (EC-1, EC-2) | 3 (EC-5, EC-8, EC-9) | — |
| T0.5 / T1.4 | 0 | — | — | 1 (EC-10) |
| T2.1 (orchestrator) | 1 | — | 1 (EC-4) | — |
| T3.1 (SKILL.md) | 1 | 1 (EC-3) | — | — |
| T3.2 (rubric) | 1 | — | 1 (EC-6) | — |
| T5.1 (validation) | — | — | — | 1 (EC-11) |

**Veredicto:** PLANO PRECISA DE AJUSTE

Os 3 MUST FIX são todos baixo-custo (≤ 3 linhas no plano cada) mas inquebráveis:

- **EC-1** harmoniza um contrato interno fraco — sem fix, plano honestamente deferido falha em 1 dos 2 checkers e a UX vira ruído.
- **EC-2** trava ambiguidade que vira bug load-bearing (todo plano gated por parser não-determinístico).
- **EC-3** é drift documental que cycle-discover.md v1.1 vai propagar para baixo se não corrigido pré-ship.

Recomendação: bumpar plano v1.0 → v1.1 absorvendo os 3 MUST FIX como edits cirúrgicos nos Deep Dives de T0.2/T1.1/T1.3/T3.1 + novo D5 declarando convenção `<!-- DEFER-CORNER: ... -->`. SHOULD TEST adicionam ~6 tests aos contadores já planejados (~30 → ~36) — incremento marginal. Depois rodar `/plan-confidence`.
