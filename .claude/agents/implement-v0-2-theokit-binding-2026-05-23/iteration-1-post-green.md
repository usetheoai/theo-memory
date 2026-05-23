# SEPA — Iteration 1 / Task T0.1 / Phase post-GREEN

## Plan recap
- T0.1 adds the `MissingScopeError` typed domain error class to `src/core/errors.ts`, exported from the core barrel, with EC-2 cross-module `instanceof` survival + ADR D4 JSDoc cross-reference.

## Findings
- INFO — JSDoc cross-reference to ADR D4 IS present + correctly names all 3 resolver states.
- INFO — `Object.setPrototypeOf` EC-2 absorption correctly applied; follows sibling pattern.
- INFO — Naming conventions honored.
- INFO — Test shape covers ADR D4 invariants at the error-class layer.
- MINOR — Message-as-1st-arg passes verbatim (asymmetry with InvalidScope's prefix is intentional, documented in JSDoc). Optional polish: add "no-prefix" assertion. Not blocking.
- INFO — Signature is right ergonomic for T1.1's 3-state resolver call site.
- INFO — Barrel re-export placed correctly.

## Recommended action
- Proceed to REFACTOR. No code changes required. Optional polish (5th test) not blocking. Move to COMMIT when ready.
