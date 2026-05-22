# Implementation Contract — teacher-student-model-split

Plan: `.claude/knowledge-base/plans/teacher-student-model-split-plan.md` (v1.1, SHIPPABLE 100/100)
Started: 2026-05-22
Completed: 2026-05-22
Feature branch: `feat/teacher-student-model-split`
Execution mode: **manual TDD-cycle-per-task** (per user decision; not ralph-loop)

## Task progress (final)

| ID | Task | Status | Commit |
|---|---|---|---|
| T0.1 | Pre-condition validation gate | ✅ completed | (gate, no commit) |
| T1.1 | TDD RED: 10 tests para frontmatter model | ✅ completed | `df47b45` |
| T1.2 | Adicionar {MODEL} placeholder nos 5 templates | ✅ completed | `711d1f4` |
| T1.3 | Implementar resolução de modelo em spawn_reviewers.py | ✅ completed | `7e8189c` |
| T1.4 | Criar review-model-routing.txt + xrefs | ✅ completed | `5bd6901` |
| T1.5 | Atualizar token-budget.md | ✅ completed | `f425a25` |
| T2.1 | Spike viabilidade halt-loop split | ✅ completed (VIÁVEL) | `5ea8d18` |
| T2.2-A | Implementar split per-phase (escopo enxuto: COMMIT only) | ✅ completed | `23cebfe` |
| T3.1 | End-to-end dry-run | ✅ completed | (validation, no commit) |
| T3.2 | Cross-references validation | ✅ completed | (validation, no commit) |
| T3.3 | Final validation + CHANGELOG | ⏳ in_progress | — |

## T0.1 pre-condition gate output (2026-05-22)

```
1. Plan exists: OK
2. Not on main: OK (feat/teacher-student-model-split)
3. Working tree clean: OK
4. npm: 11.12.1 PRESENT (but package.json absent → npm-based checks skip)
5. package.json: ABSENT (pre-code phase ok)
6. pytest: 8.4.2 PRESENT
7. ralph-loop plugin: PRESENT (not invoked per user decision)
```

## T2.1 spike outcome (2026-05-22)

**VIÁVEL** — Agent tool aninhado funciona dentro de ralph-loop iterations. Both canonical source paths (cache + marketplace) verified, drift = zero. Decided T2.2-A with **escopo enxuto** per spike recommendation: COMMIT phase only ships initially; GREEN deferred to 2026-08-22 review.

## T3.1 dry-run result

```
routing_loaded: True
experimental_routings: ['architecture', 'tests', 'wiring', 'domain-pgvector-schema']
agents_count: 5
  architecture            model=haiku
  tests                   model=haiku
  wiring                  model=haiku
  cross-validation        model=opus
  domain-pgvector-schema  model=haiku
```

4 student + 1 teacher per default rule. ✓

## T3.2 cross-references

- `review-model-routing.txt` ← `cycle-review.md`, `token-budget.md` ✓
- `implement-model-routing.txt` ← `cycle-implement.md`, `token-budget.md` ✓
- Spike blueprint ← `cycle-implement.md` § Model routing ✓
- Source plan ← 5 rule files ✓
- `check_xrefs.py`: not executable, skipped per plan

## Test suite status

- `pytest .claude/skills/review/tests/` → 27 passed (4 existing + 10 T1.1 + 13 from other test modules)
- `pytest .claude/skills/plan-confidence/tests/` → 182 passed, 14 skipped (snapshot entry added for this plan)

## Known follow-ups (logged, NOT in scope of this plan)

1. `test_spawn_reviewers.py` grew to 372 LoC, exceeds T1.1 AC budget of 300 LoC (within `loc-limits.md` default 500). Refactor opportunity: extract `_parse_frontmatter` + `routing_rule` fixture to `conftest.py` if reused by other test modules.
2. T2.2-A ships INSTRUCTION-LEVEL infra in `implementation-prompt.md`. Runtime exercise only happens when `/implement` is invoked via ralph-loop with `implement-model-routing.txt` present. Integration validation deferred to first real `/implement` run.
3. GREEN phase migration in `/implement` deferred to 2026-08-22 review per spike recommendation.
4. A/B baseline (technique deferred via plan ADR D5) is the quantitative validation of the splits — entirely separate plan.

## Handoff

Ready for `cycle-review` (manual review via PR until `/review` is exercised end-to-end on its own dogfood). Commits ready to merge.
