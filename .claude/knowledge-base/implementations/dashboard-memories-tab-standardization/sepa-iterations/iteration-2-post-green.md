# SEPA — Iteration 2 / Task T2.1 / Phase post-GREEN (TIGHT)

## Verdict: PASS_WITH_OBSERVATIONS — greenlight COMMIT

## ADR/EC Audit (line-by-line)
| Contract | Evidence | Verdict |
|---|---|---|
| ADR D1 (additive optional field, no breaking change) | `MemoriesRow.created_at?: Date \| null`; `VectorStoreResult.createdAt` composed via spread honoring `exactOptionalPropertyTypes` | PASS |
| EC-1 (NULL → undefined, not `new Date(0)`) | `row.created_at != null` catches BOTH null + undefined; test 2 control-row pairing forces TRUE RED pre-fix | PASS |
| EC-2 (deterministic pagination ordering) | SQL literal `ORDER BY created_at DESC, id ASC`; test 3 uses 5× repeated invocation with id-later forcing behavior contrast | PASS |
| ADR D5 (scope discipline — 5 deferred sites untouched) | `git diff src/local/index.ts src/local/scoped-skill-memory.ts src/local/skills/payload.ts` = 0 lines | PASS |
| pg native timestamptz → Date | JSDoc declares no manual parse; correct (node-pg default OID 1184 parser) | PASS |

## SOLID / Clean Code
- SRP / OCP / DRY / Naming: all satisfied.

## Test-shape rigor
- GWT structure on all 3 tests; explicit comments
- TRUE RED pre-fix engineered (control row in T2; idLater row in T3 — no vacuous-pass risk)
- Determinism: TRUNCATE before/after; explicit UUIDs + timestamps
- AAA single-purpose
- Cleanup: try/finally with DELETE-before-SET-NOT-NULL

## Observations (MINOR — non-blockers)
1. Test 2 `not.toEqual(new Date(0))` redundant given preceding `toBeUndefined()` — kept as didactic anti-epoch-lie documentation. Keep as-is.

## Wiring triad
- (a) Caller — production `list()` invoked by `src/local/index.ts`, `src/local/skills/consolidate.ts`, `src/core/extraction/pipeline.ts`
- (b) Integration test — 3 tests against real pgvector boundary
- (c) Runtime metric — N/A (contract widen, not phase decision; OTel `getall_temporal_fallback{count}` deferred to T2.2 consumer)

## Suggested commit subject
`feat(pgvector): project created_at + flip list() ORDER BY DESC,id ASC (T2.1)`
