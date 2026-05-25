# Edge Case Review — cycle-design-patterns-v0-1

Data: 2026-05-25
Plano analisado: `.claude/knowledge-base/plans/cycle-design-patterns-v0-1-plan.md` (v1.0)
Tasks analisadas: 13 (T0.1, T1.1-T1.2, T2.1, T3.1, T4.1-T4.5, T5.1-T5.3, T6.1-T6.2)
Edge cases encontrados: 11 (MUST FIX: 3, SHOULD TEST: 5, DOCUMENT: 3)

## MUST FIX

### EC-1: Allowlist sem domínios canônicos de padrões — cycle nasce inutilizável
- **Task afetada:** T3.1 (halt-loop), T1.2 (allowlist) — fix horizontal
- **Família:** Boundary / State
- **Cenário:** O cycle pesquisa padrões via WebSearch nos top-results para "Strategy pattern", "Repository pattern", etc. Top-results canônicos são `refactoring.guru`, `sourcemaking.com`, `martinfowler.com`, `en.wikipedia.org`. NENHUM está no `discover-web-allowlist.txt` atual (que tem só vendor docs + arXiv + RFCs + npmjs/pypi). Resultado: TODA iteração do halt-loop encontra URL relevante → host check falha → `<!-- BLOCKED: domain-not-in-allowlist -->` → pattern fica sem citação → audit incompleto → confidence HARD CAP por `unverdict_pattern`. Cycle inteiro inutilizável até humano adicionar domínios manualmente.
- **Impacto:** Primeira invocação do `/design-pattern-execute` post-/implement falha em 100% das patterns. Plan SHIPPABLE no `/plan-confidence` mas zero valor em produção.
- **Fix sugerido:** Adicionar nova sub-task **T0.2** (em Phase 0) OU step na T1.2: "Adicionar ao `.claude/rules/discover-web-allowlist.txt` os 4 domínios canônicos de padrões: `martinfowler.com` (Fowler PEAA + bliki), `refactoring.guru` (GoF + DDD sumários), `sourcemaking.com` (GoF detalhado), `en.wikipedia.org` (com cautela documentada — variance alta)". Cada entry com rationale `added for cycle-design-patterns-v0-1 at 2026-05-XX — canonical {GoF/Fowler/Wikipedia} pattern source`. Logged previamente como F-T3.1-1 mas é blocker, não follow-up.

### EC-2: Template do `/design-pattern-plan` não dá guia heurístico para autorar shortlist
- **Task afetada:** T2.1
- **Família:** Input
- **Cenário:** O `/design-pattern-plan` espera que o operator declare 5-15 padrões a auditar. Para um operator sem expertise GoF/DDD profunda, ESCOLHER quais 5-15 padrões é o ponto mais difícil. Sem guidance, usuário ou (a) inclui patterns demais ("vamos auditar todos os 23 GoF") — `soft_floor_shortlist_out_of_range` cap, (b) inclui patterns irrelevantes ("Singleton em plano que não tem singleton") — todos OVER_ENGINEERED/NOT_APPLICABLE, ou (c) abandona o cycle por overhead cognitivo.
- **Impacto:** Cycle tem barrier-to-entry alto; adoção fica baixa; outputs ruins reforçam ceticismo.
- **Fix sugerido:** Em T2.1, adicionar na `pattern-plan-template.md` (e SKILL.md) uma **tabela heurística domínio → padrões candidatos**, ex:
  - `src/core/` contracts + DIP → GoF: Strategy, Factory, Adapter; DDD: Value Object, Aggregate
  - `src/local/` adapters + I/O → GoF: Adapter, Facade; arch: Repository, Hexagonal
  - `src/agent-tools/` MCP/RPC → GoF: Command, Strategy, Chain of Responsibility
  - `src/cloud/` future → cloud: Sidecar, Circuit Breaker, Saga (D8 cloud opt-in)
  - `.claude/skills/` scripts + halt-loop → arch: Pipeline, Layered; lang-idiom: Python context managers, exhaustive switches

  ≤10 linhas total no template. Reduz friction de "qual escolher" para "qual aplicar do menu".

### EC-3: Phase 0 verifica `discover-web` completed/ mas plan diz `/implement depois` (ordering invariant não enforced em /to-plan time)
- **Task afetada:** T0.1
- **Família:** State / Permission
- **Cenário:** Usuário escolheu "/to-plan dos DOIS agora, /implement depois" nessa sessão. Os dois planos já estão SHIPPABLE no /plan-confidence. Próxima sessão, usuário invoca `/implement cycle-design-patterns-v0-1` ANTES de `/implement discover-web-v0-1`. Phase 0 audit detecta que helpers não existem em discover-confidence/, HALT honesto. **Mas:** entre o /plan-confidence (SHIPPABLE) e Phase 0 halt, o usuário pode ter aprovado mentalmente o plano, criado branch, etc. Trabalho desperdiçado.
- **Impacto:** Surpresa ruim em sessão futura. Inquebrável Rule 3 (honestidade): plano declara dependência em D4 + Phase 0 audit, mas o `/plan-confidence` não trava por dependência ordenada não-cumprida.
- **Fix sugerido:** Adicionar 1 frase no header do plano (executive summary) e no Sub-goal 0 (NOVO): **"PRE-REQ INVIOLÁVEL: `/implement discover-web-v0-1` MUST be completed (PR merged to main) BEFORE `/implement` of THIS plan. Phase 0 audit enforces this hard."** + adicionar à Global DoD: `[ ] discover-web-v0-1 plan moved to .claude/knowledge-base/plans/completed/ BEFORE invoking /implement of this plan`. Reforça ordering em multiple locations.

## SHOULD TEST

### EC-4: Halt-loop re-lê target plan completo a cada iteração (token overhead)
- **Task afetada:** T3.1
- **Teste sugerido:** `test_halt_loop_extracts_target_summary_at_iteration_1` — fixture com plano-target de 1000+ linhas; assert que iteração 1 emite `.claude/halt-loop-prompts/design-pattern-execute-{slug}-target-summary.md` (gitignored) com seções condensadas; iterações 2+ leem o summary (small) ao invés do plano completo. Sem otimização, 15 iterações × 1000-linha plan-read = 150k tokens só de re-leitura. Com summary cache, drop para ~15k overhead total.

### EC-5: Cloud-keyword grep no target plan pega menções tangenciais em Context
- **Task afetada:** T4.5
- **Teste sugerido:** `test_cloud_keyword_in_context_only_does_not_trigger_cloud_applicable` — fixture com target plan que menciona "TheoCloud" só em background prose de Context (não em Goal/Objective); assert que `check_pattern_classifications.py` NÃO marca cloud-applicable + `soft_floor_cloud_over_engineering` cap NÃO dispara quando audit declara DEFER-CORNER cloud. Hoje a heurística está implícita; teste explícita.

### EC-6: `cycle-design-patterns-allowlist.txt` criada sem use case claro
- **Task afetada:** T1.2
- **Teste sugerido:** `test_allowlist_has_documented_use_case_section` — após T1.2 land, asserir que o header do `cycle-design-patterns-allowlist.txt` contém pelo menos 1 exemplo concreto de quando adicionar entry (ex: "downgrade `soft_floor_too_many_misapplied` from 70 to 89 for legacy plans where MISAPPLIED is intentional"). Sem use case documentado, file vira dead code; com use case, evolve organicamente.

### EC-7: T4.5 ADR-DEFER marker para MISSING_RECOMMENDED não tem sintaxe locked
- **Task afetada:** T4.5
- **Teste sugerido:** `test_adr_defer_marker_syntax_for_missing_recommended` — assert que `check_pattern_classifications.py` reconhece exatamente um formato: `<!-- ADR-DEFER: {reason-keyword} | {1-sentence rationale} -->` (sibling format to cycle-discover.md v1.1 DEFER-CORNER). Sem syntax locked, autor pode escrever de N formas e checker silently miss → cap dispara incorretamente. Sintaxe trivial; locked agora previne drift.

### EC-8: T6.1 hypothesized findings para v0-3 são baseadas em julgamento subjetivo do planner
- **Task afetada:** T6.1
- **Teste sugerido:** `test_v0_3_golden_fixture_findings_match_actual_v0_3_design` — o teste deve ler o REAL `v0-3-agent-tools-mcp` source code/plan e validar que cada hypothesized finding na fixture é defensável: se fixture afirma "Adapter pattern → MISSING_RECOMMENDED", grep no código real busca por evidência. Caso contrário, fixture vira "test passes by fiat" sem signal real. Substituir manual review (DOCUMENT-level) por teste automated quando possível.

## DOCUMENT

### EC-9: T6.1 manual-authoring de 30min de fixture pode ser pulado em pressão
- **Risco aceito:** project workflow é AI-author + human-review; 30min manual authoring para uma fixture é fora do padrão. Sob pressão (deadline ou ralph-loop bloqueado), pode virar shortcut. Mitigação documentada no plano (acceptance criteria explícita + DoD). Não é blocker — alternativa (dogfood real) cria chicken-and-egg na primeira run. Aceitar para v0.1; v0.2 pode usar real audit.

### EC-10: Token budget para /implement do PRÓPRIO plano (cycle-implement) + budget para USAR o cycle são separados mas não distinguidos
- **Risco aceito:** plan declara 95-240k para USAR o cycle (full chain de 3 skills). Mas `/implement` deste plano (criar os 3 skills + tests + golden fixtures) é estimado em ~130-360k via cycle-implement halt-loop. Sessão combinada poderia ultrapassar 600k. T5.1 token-budget update deveria clarificar "uso vs construção". Não é blocker — usuário pode rodar `/implement` em sessão dedicada. Documentar como expectativa de scoping.

### EC-11: Subjetividade do rubric (APPLIED_CORRECTLY vs MISAPPLIED) — risco aceito em D5+EC-A do plano
- **Risco aceito:** ADR D5 + Context § Accepted risks já documentam que classificação é judgment-laden e mitigada por citation-mandatory. Aceito explicitamente. Sem código adicional.

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 1 | 1 (EC-3) | 0 | 0 |
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 2 | 1 (EC-1, shared with T3.1) | 1 (EC-6) | 0 |
| T2.1 | 1 | 1 (EC-2) | 0 | 0 |
| T3.1 | 2 | 1 (EC-1, shared) | 1 (EC-4) | 0 |
| T4.1 | 0 | 0 | 0 | 0 |
| T4.2 | 0 | 0 | 0 | 0 |
| T4.3 | 0 | 0 | 0 | 0 |
| T4.4 | 0 | 0 | 0 | 0 |
| T4.5 | 2 | 0 | 2 (EC-5, EC-7) | 0 |
| T5.1 | 1 | 0 | 0 | 1 (EC-10) |
| T5.2 | 0 | 0 | 0 | 0 |
| T5.3 | 0 | 0 | 0 | 0 |
| T6.1 | 2 | 0 | 1 (EC-8) | 1 (EC-9) |
| T6.2 | 0 | 0 | 0 | 0 |
| Plan-wide | 1 | 0 | 0 | 1 (EC-11) |
| **TOTAL** | **11** | **3** | **5** | **3** |

**Veredicto:** PLANO PRECISA DE AJUSTE

3 MUST FIX são todos sobre **usabilidade no day-1**, não bugs internos. Sem eles:
- **EC-1** (allowlist sem domínios canônicos): cycle inteiro inutilizável na primeira invocação — primeira coisa que quebra
- **EC-2** (template sem guia heurístico): adoption barrier alto — operators sem expertise GoF/DDD ficam paralisados
- **EC-3** (ordering invariant não reforçado): surpresa ruim em sessão futura quando /implement halt-loop trava em Phase 0

5 SHOULD TEST são otimizações + locks de sintaxe que custam pouco e previnem regressões; 3 DOCUMENT são riscos aceitos consciously.

**Recomendação ao usuário (humano absorbe os MUST FIX):**

1. Bumpar plano v1.0 → v1.1 incorporando:
   - **EC-1** em nova T0.2 (Phase 0): adicionar 4 domínios canônicos de patterns no `discover-web-allowlist.txt` antes de Phase 1
   - **EC-2** em T2.1: adicionar tabela heurística domínio→padrões no template (~10 linhas)
   - **EC-3** em header do plano + Sub-goal 0 + Global DoD: PRE-REQ explícito para ordering discover-web → cycle-design-patterns
2. Adicionar **EC-4, EC-5, EC-6, EC-7, EC-8** como SHOULD TEST nas DoDs dos tasks correspondentes
3. **EC-9, EC-10, EC-11** ficam como nota em Context § Accepted risks

Após absorção: re-rodar `/plan-confidence cycle-design-patterns-v0-1` no plano v1.1.
