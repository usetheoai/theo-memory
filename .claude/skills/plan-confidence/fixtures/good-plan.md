---
type: plan
created_at: 2026-05-17
slug: good-plan
status: draft
---

# Plan: Good Fixture (passes all M2 checks)

> Version 1.0 — Plano sintético usado como fixture. Cobertura completa, ADRs com alternativas, bug-fix com TDD, zero smells. Segue `architecture.md` e `testing.md`, respeitando SOLID + DRY + KISS. Todos os arquivos ≤ 500 LoC.

## Context

Toy plan para teste do `check_coverage_matrix.py`, `check_adr_completeness.py`, `check_tdd_in_bugfix.py`, `check_spec_smells.py`. Compliance: cita `architecture.md`, `testing.md`, SOLID, DRY.

## Objective

Done = passa todos os 4 checks estruturais. Verdict SHIPPABLE.

## ADRs

### D1 — Use Python stdlib only

- **Decisão:** Implementar com stdlib + PyYAML.
- **Rationale:** Alternativas consideradas: usar `pydantic` (rejeitada por dependência extra); usar `regex` lib (rejeitada — `re` da stdlib basta). Stdlib é YAGNI puro.
- **Consequências:** Zero deps adicionais.

### D2 — Determinismo total

- **Decisão:** Zero LLM calls em M2.
- **Rationale:** Alternativa rejeitada: usar LLM para summarization (fica para M3). Determinismo permite cache forte.
- **Consequências:** Tests podem ser hashable input/output.

## Dependency Graph

```
T1.1 -> T1.2 -> T2.1
```

## Phase 1: Setup

### T1.1 — Add bug-fix regression test

#### Objective
Resolve bug em parsing.

#### Files to edit
```
src/parser.py
```

#### TDD
```
RED: test_parser_handles_empty_input
GREEN: implement fix
REFACTOR: None
VERIFY: pytest
```

#### Acceptance Criteria
- [ ] Test passes

#### DoD
- [ ] Code merged

### T1.2 — Add feature

#### Objective
Add new feature.

#### Files to edit
```
src/feature.py
```

#### TDD
```
RED: test_feature_works
GREEN: implement
REFACTOR: None
VERIFY: pytest
```

#### Acceptance Criteria
- [ ] Works

#### DoD
- [ ] Merged

## Phase 2: Polish

### T2.1 — Documentation

#### Objective
Document.

#### Files to edit
```
README.md
```

#### Tasks
1. Update README.

#### Acceptance Criteria
- [ ] README updated

#### DoD
- [ ] Done

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Parser bug | T1.1 | Regression test + fix |
| 2 | New feature | T1.2 | Implementation |
| 3 | Docs gap | T2.1 | README updated |

**Coverage: 3/3 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases done
- [ ] Tests passing
- [ ] cargo clippy passes (lint, complexity ≤ 10)
- [ ] All files ≤ 500 LoC
