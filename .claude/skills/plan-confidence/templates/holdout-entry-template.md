---
type: holdout-entry
plan_path: knowledge-base/plans/EXAMPLE-plan.md
plan_slug: EXAMPLE
graded_by: nome-do-reviewer
graded_at: 2026-MM-DD
plan_size_lines: 0
plan_size_words: 0
total_grading_time_minutes: 0
---

# Holdout Entry: {plan_slug}

> Copie este arquivo, preencha cada campo, salve em `.claude/knowledge-base/concepts/plan-confidence/holdout/{plan-slug}.md`.

## Dimensão 1 — Completude factual (peso 0.30)

**Score:** _0-100_

### Top 3 motivos para o score

1. ...
2. ...
3. ...

## Dimensão 2 — Aderencia a evidencia (peso 0.30)

**Score:** _0-100_

### Top 3 motivos

1. ...
2. ...
3. ...

## Dimensão 3 — Calibracao da LLM (peso 0.20)

**Score:** _0-100_ — ou `DEFERRED` se a dimensão não puder ser avaliada manualmente (e.g., M3+ ainda não rodou).

### Top 3 motivos

1. ...
2. ...
3. ...

## Dimensão 4 — Risco tecnico (peso 0.20)

**Score:** _0-100_

### Top 3 motivos

1. ...
2. ...
3. ...

## Final Score (computed)

**Composite (SOTA pesos originais):** `= 0.30·D1 + 0.30·D2 + 0.20·D3 + 0.20·D4 = ___`

**Composite (M2 renormalizado ADR D8, dimensions = [completude, risco]):** `= 0.60·D1 + 0.40·D4 = ___`

## Hard Caps (manual check)

- [ ] Coverage Matrix 100% — se não → cap 49
- [ ] Sem citação fabricada (M3) — se uma fabricada → cap 49
- [ ] Cada ADR tem alternativas listadas em Rationale — se não → cap 70
- [ ] Cada task de bug-fix tem TDD RED-GREEN-REFACTOR — se não → cap 70

**Final after caps:** _calcule_

## Outcome (preenchido post-implementação)

- `cross_validation`: PENDING | PASS | PASS_WITH_CAVEATS | FAIL
- `dogfood`: PENDING | PASS | PASS_WITH_CAVEATS | FAIL | NOT_RUN
- `revisions_required`: 0
- `edge_cases_surfaced`: 0

## Notes

_Notas livres do reviewer: surpresas, contexto, dúvidas, etc._
