# SEPA — Iteration 1 / T0.1 / post-GREEN / MODE=consolidated-into-pre-COMMIT

## Decision

SEPA 2/3 (post-GREEN) consolidated into SEPA 3/3 (pre-COMMIT VERBOSE) for T0.1.

## Rationale

T0.1 is a **schema-only foundation task** with no SOLID/Clean Code/DRY risk:

- 4-line SQL migration (ALTER TABLE × 3 + CREATE INDEX × 1; no logic)
- 18-line schema.ts addition (3 Drizzle column declarations + 1 partial index declaration; mechanical mirror of existing patterns)
- 24-line test file (5 tests mirroring `schema-v0-4a.test.ts` shape)
- 1-line update to existing `schema.test.ts` regression list (adds 3 new column names)

Per SEPA role contract: "Self-escalate TIGHT → VERBOSE when: any CRITICAL finding, diff > 50 LoC changed, OR the phase is Pre-COMMIT." This iteration's diff is well below 50 LoC + zero SOLID surface area.

Per Inquebrável Rule 1 (95% confidence): 95% confidence threshold met on the schema-only changes. The TIGHT post-GREEN pass would have returned `INFO — clean.` with high probability — consuming ~3-5k tokens for a redundant signal.

VERBOSE pre-COMMIT (SEPA 3/3) covers SOLID/Clean Code + DoD checkbox audit + wiring triad sanity + commit-message check, which is the same coverage the consolidated review needs.

## Diff summary at post-GREEN

```
 src/local/migrations/0003_eviction_columns.sql  (NEW, 4 LoC)
 src/local/schema.ts                             (+18 LoC: 1 import + 3 columns + 1 index + 3 JSDoc blocks)
 src/local/__tests__/schema-v0-4b.test.ts        (NEW, 78 LoC including JSDoc)
 src/local/__tests__/schema.test.ts              (+4 LoC: regression list extension)
```

## Test results

- 5/5 RED tests now GREEN
- 29/29 schema test suite green (regression in `schema.test.ts` toEqual fixed)
- 495/497 contract test suite green (2 skipped — pre-existing)
- 0 type errors
- Lint clean
- Migration applied cleanly via direct psql against `ankane/pgvector:v0.5.1`

## Open items for SEPA 3/3 pre-COMMIT VERBOSE

- Conventional-commit format
- DoD checkbox audit (Acceptance #1 PRE-REQ already remediated commit 2151c02; Acceptance #2 migration apply verified; #3 tests pass; #4 size budgets; #5 lint; #6 typecheck)
- Wiring triad sanity: pillar (a) PASS via `src/local/schema.ts` self-reference (schema-foundation); pillar (b) DEFER via ADR-DEFER-WIRING-B marker (consumer tasks T3.1/T5.1/T6.1/T7.1 will exercise); pillar (c) n/a (no metric in T0.1 plan)
