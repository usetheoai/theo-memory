# Implementation Contract: entity-boost-monotonic-and-non-evicting (M18)

Plan: `.claude/knowledge-base/plans/entity-boost-monotonic-and-non-evicting-plan.md` (SHIPPABLE 98)
Branch: `develop`
Issues: #125 (monotonicity), #127 (renormalization eviction)

## Ordered task list (halt-loop contract)

| ID | Phase | Title | Status |
|---|---|---|---|
| T1.1 | 1 | Inverter o teste decrescente + `entityBoost` não-decrescente saturante | pending |
| T1.2 | 1 | Monotonicidade end-to-end através do step; assinatura inalterada | pending |
| T2.1 | 2 | Numerador-only: candidato sem vínculo não é despejado (#127) | pending |
| T2.2 | 2 | Integração pg real: churn zero na banda sensível (threshold 0.8) | pending |
| T3.1 | 3 | Benchmark com numLinked variável: monotonic_violations=0, churn_sensitive=0, precisão não-regredida | pending |
| T3.2 | 3 | Documento de benchmark antes/depois + CHANGELOG | pending |

## Wiring

- `entityBoost` — production caller: `entity-boost-step.ts:100`. Pillar (a) satisfied by existing caller (no new export).
- `maxPossible`/`combineScores` — callers: `pipeline.ts`. No new public export; the change is behavioral inside existing functions.
- No new runtime metric declared → pillar (c) N/A (the change reuses existing entity_boost OTel events from M16).

## Global DoD

- `npm run typecheck` exit 0; `npm run lint` 0 warnings.
- `npm test -- scoring` + `entity-boost` green.
- Benchmark: monotonic_violations=0, recall_set_churn_sensitive=0, precision not regressed.
- CHANGELOG `[Unreleased]` with (#125) and (#127).
