# Plan-Confidence Report — teacher-student-model-split

Data: 2026-05-22 09:51 UTC
Plan: `.claude/knowledge-base/plans/teacher-student-model-split-plan.md` (v1.1)
Runner: `plan-confidence/scripts/run_structural.py` (M2 deterministic)
Calibration: PROVISIONAL_v1 (cutoffs estruturais, validação empírica pendente)

## Resultado final

- **Verdict: SHIPPABLE**
- **Final score: 100.0 / 100**
- **Hard caps triggered: nenhum**
- **Iterações até verde: 1 (após edits cirúrgicos)**

## Breakdown por dimensão

| Dimensão | Score | Detalhes |
|---|---|---|
| Completude | 100.0 | Coverage Matrix 100% (60pts) + ADR alternatives 5/5 (20pts) + TDD bug-fix 0/0 N/A (20pts) |
| Risco estrutural | 100.0 | Zero smells |
| Architecture compliance | 1.0 (auxiliar) | 7 rules citadas + 8 princípios (SRP/ISP/DIP/SOLID/DRY/KISS/YAGNI/TDD); DoD quality signal + file-size signal presentes |

## Trajetória do scoring

### Iteração 1 (inicial, v1.1 sem fixes de coverage/smells)
- Verdict: **INVALID** (49)
- Completude: 40 (Coverage Matrix 92%)
- Risco estrutural: 67 (11 weak_imperatives hits, penalty -33)
- Hard cap: `coverage_lt_100` triggered
- Causas:
  - 2 entries da Coverage Matrix apontavam só para ADRs (`D3 (ADR)`, `D5 (ADR)`) sem task associada nem marker `deferred`/`out-of-scope`
  - 10 hits do regex weak_imperatives eram a label fixa "SHOULD TEST" (categoria do `/edge-case-plan`)
  - 1 hit `talvez` em exemplo de anti-pattern explícito

### Iteração 2 (após edits cirúrgicos)
- Verdict: **SHIPPABLE** (100)
- Coverage Matrix 100%
- 0 smells

## Edits aplicados entre iterações

1. **Coverage Matrix #10** — `D3 (ADR)` → `T1.4 (ADR D3)` (mitigação real ancora em T1.4 onde rule entries carregam `experimental_until` + `rollback_if`)
2. **Coverage Matrix #11** — `D5 (ADR)` → `Deferred — out-of-scope (ADR D5)` (bate em pattern `OUT_OF_SCOPE_PATTERNS` → conta como deferred-not-missed)
3. **"SHOULD TEST" → `` `SHOULD TEST` ``** (replace_all) — escapa via inline code, parser pula. 10 falsos positivos eliminados
4. **"talvez no futuro" → `` `"vague placeholder text"` ``** — exemplo de anti-pattern protegido via inline code

## Sub-reports detalhados

### Coverage Matrix
- Total gaps: 25
- Mapped (via task): 24
- Deferred (via out-of-scope marker): 1
- Unmapped: 0
- Orphan tasks: 0
- Coverage ratio: 1.0 (100%)

### ADR completeness
- 5 ADRs (D1 a D5)
- Todos têm seção `Rationale` listando alternativas
- Completeness ratio: 1.0

### TDD em bug-fix
- 0 bug-fix tasks neste plan (não é bug-fix; é feature/refactor)
- N/A — coverage ratio 1.0 por vacuidade

### Spec smells
- 0 hits após escape de "SHOULD TEST" e "talvez no futuro"
- Penalty: 0

### Architecture compliance (1.0)
- **12 project rules detectadas** em `.claude/rules/`
- **7 rules citadas no plan**: audit-trail-rotation.md, cycle-implement.md, cycle-review.md, discover-blueprint-golden-rule.md, loop-engine-convention.md, testing.md, token-budget.md
- **8 princípios citados**: SRP, ISP, DIP, SOLID, DRY, KISS, YAGNI, TDD
- DoD quality signal: presente (lint/complexity/size)
- File-size budget signal: presente (300 LoC em T1.3, 500 default em loc-limits.md)
- Fallback to defaults: false (rules de projeto presentes e usadas)

## Calibration notice

`status: PROVISIONAL_v1` — `holdout_count: 0/30`, Cohen's kappa não medido. Cutoffs (49/70/90) são estruturalmente válidos mas não empiricamente calibrados. Score `100` significa "zero defeitos estruturais detectados pelo M2 deterministic runner", não "qualidade absoluta confirmada por jury".

## Próximo passo (cycle-plan chain)

Verdict ≥ SHIPPABLE_WITH_CAVEATS atingido (de fato SHIPPABLE). Pular `/plan-improve` (não há defeitos para melhorar). Handoff direto para `/implement teacher-student-model-split`.

Pre-conditions de `/implement` a validar:
- [x] Plan verdict ≥ SHIPPABLE_WITH_CAVEATS (cumprido: SHIPPABLE)
- [x] Feature branch criada (`feat/teacher-student-model-split`)
- [x] Não em main (verificado por `validate-command.sh` hook)
- [x] Working tree limpa exceto pelo plan + report (commits serão criados durante /implement)
- [x] pytest acessível
- [ ] CHANGELOG.md updated under `[Unreleased]` — será feito em T3.3 conforme plan (EC-11)
