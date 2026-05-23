# SEPA — Iteration 1 / Task T0.1 / Phase pre-RED

## Plan recap
- T0.1 adds `MissingScopeError` to `src/core/errors.ts` (mirror existing classes), append 3 RED tests to existing `__tests__/errors.test.ts`, and verify barrel `src/core/index.ts` re-exports it. Per ADR D4: fail-loud distinct messages for resolver states (b) and (c).

## Findings
- INFO — `src/core/errors.ts` (61 LoC) follows STABLE pattern: `override readonly name = 'ClassName' as const`, constructor with `super(message, options?)` and `Object.setPrototypeOf(this, ClassName.prototype)`. `MissingScopeError` MUST follow this exact shape — including `setPrototypeOf` (cross-module instanceof) and `as const` literal name.
- INFO — `src/core/__tests__/errors.test.ts` exists (72 LoC) using vitest `describe`/`test`/`expect`. APPEND path correct.
- INFO — `src/core/index.ts` does NOT use `export *`; uses explicit named re-exports. Barrel MUST be edited to add `MissingScopeError`.
- INFO — Existing tests use BDD `describe → test` shape with behavior naming (not snake_case method-style). Plan's RED test names should be adapted.
- MINOR — Add 4th RED test for cross-module instanceof (`instanceof MissingScopeError === true`) to match the file's EC-2 pattern.
- INFO — JSDoc class with `@see ADR D4 — binding 3-state resolver fail-loud errors`.

## Recommended action
1. Use `describe('MissingScopeError — fail-loud per ADR D4', ...)` BDD shape with behavior-naming.
2. Add a 4th RED test for `instanceof MissingScopeError` (cross-module trap).
3. New class MUST include `override readonly name = 'MissingScopeError' as const` + `Object.setPrototypeOf(this, MissingScopeError.prototype)`.
4. JSDoc: `@see ADR D4 — binding 3-state resolver fail-loud errors`.
5. EDIT `src/core/index.ts` to add `MissingScopeError` to the explicit named re-export block.
